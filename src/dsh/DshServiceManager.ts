import * as childProcess from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig, ExtensionConfig } from '../config';
import { log, showOutput } from '../util/logger';
import { checkPort, isPortFree, waitForDsh } from './PortDetector';
import { findLocalDshDefaultPort, resolveDshHome, writeLocalDshPort } from './LocalDshConfig';
import { DshStatus, ManagedDshProcess, DshStartMode } from './types';

const DEFAULT_PORT = 3080;

export class DshServiceManager {
  private managedProcess?: ManagedDshProcess;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  async getStatus(): Promise<DshStatus> {
    const cfg = getConfig();
    if (!(await this.isAnyDshInstalled(cfg))) {
      return { state: 'not-installed' };
    }

    const running = await this.findRunningDsh(cfg);
    if (running) {
      return {
        state: 'running',
        port: running.port,
        managed: running.managed,
        pid: running.pid,
        mode: running.mode,
      };
    }

    const port = await this.resolveEffectivePort(cfg);
    return { state: 'not-running', port };
  }

  async ensureDshRunning(workspaceFolder?: string): Promise<{ port: number; managed: boolean; pid?: number; mode?: DshStartMode }> {
    const cfg = getConfig();
    if (!(await this.isAnyDshInstalled(cfg))) {
      throw new Error('dsh is not installed. Please install @deepseek-ai/dsh first.');
    }

    const running = await this.findRunningDsh(cfg);
    if (running) {
      this.onDidChangeEmitter.fire();
      return running;
    }

    const port = await this.resolveEffectivePort(cfg);
    const free = await isPortFree(port);
    if (!free) {
      const occupied = await checkPort(port, 3000);
      if (!occupied.isDsh) {
        throw new Error(`Port ${port} is occupied by a non-dsh application. Please choose another port.`);
      }
      // It became dsh between checks; connect to it.
      this.onDidChangeEmitter.fire();
      return { port, managed: false };
    }

    const proc = await this.startDsh(port, cfg, workspaceFolder);
    this.managedProcess = proc;
    this.onDidChangeEmitter.fire();
    return { port, managed: true, pid: proc.pid, mode: proc.mode };
  }

  async stopManagedDsh(): Promise<boolean> {
    if (!this.managedProcess) {
      return false;
    }
    const proc = this.managedProcess;
    this.managedProcess = undefined;
    await this.killProcessTree(proc);
    this.onDidChangeEmitter.fire();
    return true;
  }

  getManagedProcess(): ManagedDshProcess | undefined {
    return this.managedProcess;
  }

  async syncLocalPortToPlugin(): Promise<number | undefined> {
    const cfg = getConfig();
    const localPort = await findLocalDshDefaultPort(cfg.dshCommand);
    if (localPort === undefined) {
      return undefined;
    }
    await vscode.workspace.getConfiguration('easyVscGuiForDsh').update('port', localPort, vscode.ConfigurationTarget.Global);
    this.onDidChangeEmitter.fire();
    return localPort;
  }

  async syncPluginPortToLocal(port: number): Promise<{ ok: boolean; file?: string; message?: string }> {
    const result = await writeLocalDshPort(port);
    this.onDidChangeEmitter.fire();
    return result;
  }

  async isAnyDshInstalled(cfg: ExtensionConfig = getConfig()): Promise<boolean> {
    const npxOk = await this.isCommandAvailable('npx');
    const globalOk = await this.isCommandAvailable(cfg.dshCommand);
    return npxOk || globalOk;
  }

  async findLocalDshPort(): Promise<number | undefined> {
    return findLocalDshDefaultPort(getConfig().dshCommand);
  }

  async resolveEffectivePort(cfg: ExtensionConfig = getConfig()): Promise<number> {
    const localPort = await findLocalDshDefaultPort(cfg.dshCommand);
    // If the user has not customized away from the default, prefer the local dsh default.
    if (localPort !== undefined && cfg.port === DEFAULT_PORT) {
      return localPort;
    }
    return cfg.port;
  }

  async findRunningDsh(cfg: ExtensionConfig = getConfig()): Promise<{ port: number; managed: boolean; pid?: number; mode?: DshStartMode } | undefined> {
    const candidates = new Set<number>([cfg.port]);
    const localPort = await findLocalDshDefaultPort(cfg.dshCommand);
    if (localPort !== undefined) {
      candidates.add(localPort);
    }
    candidates.add(DEFAULT_PORT);

    for (const port of candidates) {
      const result = await checkPort(port, 1500);
      if (result.occupied && result.isDsh) {
        const managed = this.managedProcess?.pid !== undefined && this.managedProcessPort() === port;
        return {
          port,
          managed,
          pid: managed ? this.managedProcess?.pid : undefined,
          mode: managed ? this.managedProcess?.mode : undefined,
        };
      }
    }
    return undefined;
  }

  private managedProcessPort(): number | undefined {
    if (!this.managedProcess) {
      return undefined;
    }
    const argIndex = this.managedProcess.args.indexOf('--port');
    if (argIndex >= 0) {
      return Number(this.managedProcess.args[argIndex + 1]);
    }
    return undefined;
  }

  private async startDsh(port: number, cfg: ExtensionConfig, workspaceFolder?: string): Promise<ManagedDshProcess> {
    const cwd = workspaceFolder ?? (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
    const modes: DshStartMode[] = cfg.startMode === 'npx' ? ['npx'] : cfg.startMode === 'global' ? ['global'] : ['npx', 'global'];
    let lastError: string | undefined;

    for (const mode of modes) {
      try {
        log(`Starting dsh via ${mode} on port ${port} (cwd=${cwd})`);
        const proc = this.spawnDsh(mode, port, cfg, cwd);
        const ready = await waitForDsh(port, cfg.startTimeout * 1000);
        if (ready) {
          log(`dsh ready via ${mode} (pid=${proc.pid})`);
          return { ...proc, mode };
        }
        lastError = `dsh did not become ready on port ${port} within ${cfg.startTimeout}s`;
        await this.killProcessTree(proc);
      } catch (err) {
        lastError = `${mode} start failed: ${String(err)}`;
        log(lastError);
      }
    }

    showOutput();
    throw new Error(lastError ?? 'Failed to start dsh');
  }

  private spawnDsh(mode: DshStartMode, port: number, cfg: ExtensionConfig, cwd: string): ManagedDshProcess {
    const isWin = process.platform === 'win32';
    let command: string;
    let args: string[];

    if (mode === 'npx') {
      command = isWin ? 'npx.cmd' : 'npx';
      args = ['--yes', cfg.dshPackage, 'web', '--port', String(port)];
    } else {
      command = isWin ? `${cfg.dshCommand}.cmd` : cfg.dshCommand;
      args = ['web', '--port', String(port)];
    }

    const child = childProcess.spawn(command, args, {
      cwd,
      detached: !isWin,
      windowsHide: true,
      shell: isWin,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_HOME: process.env.DSH_HOME ?? resolveDshHome() },
    });

    child.stdout?.on('data', (d: Buffer) => log(`[dsh:${mode}] ${d.toString().trimEnd()}`));
    child.stderr?.on('data', (d: Buffer) => log(`[dsh:${mode}:err] ${d.toString().trimEnd()}`));
    child.on('error', (err) => log(`[dsh:${mode}] process error: ${err.message}`));
    child.on('exit', (code, signal) => {
      log(`[dsh:${mode}] exited code=${code} signal=${String(signal)}`);
      if (this.managedProcess?.child === child) {
        this.managedProcess = undefined;
        this.onDidChangeEmitter.fire();
      }
    });

    return { pid: child.pid ?? 0, mode, command, args, cwd, startedAt: Date.now(), child };
  }

  private isCommandAvailable(command: string): boolean {
    try {
      const result = childProcess.spawnSync(command, ['--version'], {
        timeout: 5000,
        windowsHide: true,
        shell: process.platform === 'win32',
        stdio: 'ignore',
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private killProcessTree(proc: ManagedDshProcess): Promise<void> {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        childProcess.exec(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true }, () => resolve());
      } else {
        try {
          process.kill(-proc.pid, 'SIGTERM');
        } catch {
          try {
            process.kill(proc.pid, 'SIGTERM');
          } catch {
            // ignore
          }
        }
        setTimeout(resolve, 500);
      }
    });
  }

  dispose(): void {
    const cfg = getConfig();
    if (cfg.stopDshOnVscClose && this.managedProcess) {
      void this.stopManagedDsh();
    }
    this.onDidChangeEmitter.dispose();
  }
}

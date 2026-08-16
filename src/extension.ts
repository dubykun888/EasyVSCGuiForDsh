import * as vscode from 'vscode';
import { getConfig, setConfigPort } from './config';
import { DshServiceManager } from './dsh/DshServiceManager';
import { DshProxy } from './proxy/DshProxy';
import { DshWebviewProvider } from './webview/DshWebviewProvider';
import { getWebviewTheme } from './webview/theme';
import { WorkspaceAdapter } from './workspace/WorkspaceAdapter';
import { log, showOutput } from './util/logger';

let serviceManager: DshServiceManager;
let webviewProvider: DshWebviewProvider;
let statusBarItem: vscode.StatusBarItem;
let fallbackPanel: vscode.WebviewPanel | undefined;
let proxy: DshProxy | undefined;
let currentPort = 3080;
let currentBaseUrl = '';
let currentSessionId: string | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('Easy VSC GUI for DSH activating');

  serviceManager = new DshServiceManager();
  const workspaceAdapter = new WorkspaceAdapter();

  currentPort = getConfig().port;

  webviewProvider = new DshWebviewProvider({
    getUrl: () => buildFrameUrl(),
    getTheme: () => getWebviewTheme(),
    onOpenInBrowser: () => void openInBrowser(),
    onStopDsh: () => void stopDsh(),
    onSyncPortToPlugin: () => void syncPortToPlugin(),
    onRefresh: () => webviewProvider.refresh(),
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DshWebviewProvider.viewType, webviewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyVscGuiForDsh.open', () => openDshGui(workspaceAdapter)),
    vscode.commands.registerCommand('easyVscGuiForDsh.stopDsh', () => stopDsh()),
    vscode.commands.registerCommand('easyVscGuiForDsh.openInBrowser', () => openInBrowser()),
    vscode.commands.registerCommand('easyVscGuiForDsh.syncPortToPlugin', () => syncPortToPlugin()),
    vscode.commands.registerCommand('easyVscGuiForDsh.syncPortToDsh', () => syncPortToDsh()),
    vscode.commands.registerCommand('easyVscGuiForDsh.refresh', () => webviewProvider.refresh())
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      const theme = getWebviewTheme();
      webviewProvider.updateTheme(theme);
      if (proxy) {
        proxy.setTheme(theme === 'dark' || theme === 'high-contrast' ? 'dark' : 'light');
      }
    })
  );

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'easyVscGuiForDsh.open';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(serviceManager);
  context.subscriptions.push(
    serviceManager.onDidChange(() => {
      void updateStatusBar();
      vscode.commands.executeCommand('setContext', 'easyVscGuiForDsh.managedRunning', serviceManager.getManagedProcess() !== undefined);
    })
  );

  await updateStatusBar();
  log('Easy VSC GUI for DSH activated');
}

async function openDshGui(workspaceAdapter: WorkspaceAdapter): Promise<void> {
  try {
    const workspaceInfo = await workspaceAdapter.getWorkspaceInfo();
    const result = await serviceManager.ensureDshRunning(workspaceInfo.folder?.uri.fsPath);
    currentPort = result.port;
    const cfg = getConfig();
    currentSessionId = cfg.autoOpenLastChat ? workspaceInfo.lastSessionId : undefined;
    await updateProxyForTheme();
    webviewProvider.updateUrl(buildFrameUrl());

    if (cfg.autoOpenLastChat && workspaceInfo.isDshWorkspace) {
      log(`Workspace detected, dsh started with cwd=${workspaceInfo.folder?.uri.fsPath}, session=${currentSessionId ?? 'none'}`);
    }

    await revealSidebar();
    await updateStatusBar();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Open DSH failed: ${message}`);
    const action = await vscode.window.showErrorMessage(`无法打开 DSH：${message}`, '查看日志', '重新指定端口');
    if (action === '查看日志') {
      showOutput();
    } else if (action === '重新指定端口') {
      await promptForPort();
    }
  }
}

async function revealSidebar(): Promise<void> {
  try {
    await vscode.commands.executeCommand('easyVscGuiForDsh.view.focus');
  } catch {
    try {
      await vscode.commands.executeCommand('workbench.view.extension.easyVscGuiForDsh');
      await vscode.commands.executeCommand('easyVscGuiForDsh.view.focus');
    } catch {
      openFallbackPanel();
    }
  }
}

function openFallbackPanel(): void {
  if (fallbackPanel) {
    fallbackPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  fallbackPanel = vscode.window.createWebviewPanel(
    'easyVscGuiForDsh.fallback',
    'DSH GUI',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  fallbackPanel.webview.html = fallbackHtml(currentPort);
  fallbackPanel.onDidDispose(() => {
    fallbackPanel = undefined;
  });
}

function fallbackHtml(port: number): string {
  const nonce = getNonce();
  const url = buildFrameUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src http://127.0.0.1:*;">
<style>html,body{height:100%;margin:0}iframe{width:100%;height:100%;border:none}</style>
</head>
<body><iframe src="${url}"></iframe></body>
</html>`;
}

function directUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function buildFrameUrl(): string {
  const base = currentBaseUrl || directUrl(currentPort);
  if (!currentSessionId) {
    return base;
  }
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}session=${encodeURIComponent(currentSessionId)}`;
}

async function updateProxyForTheme(): Promise<void> {
  const cfg = getConfig();
  if (cfg.themeFollow !== 'vscode') {
    if (proxy) {
      await proxy.stop();
      proxy = undefined;
    }
    currentBaseUrl = '';
    return;
  }
  if (!proxy || proxy.portNumber === 0 || proxy.upstreamPortNumber !== currentPort) {
    if (proxy) {
      await proxy.stop();
      proxy = undefined;
    }
    proxy = new DshProxy({ upstreamPort: currentPort, theme: getWebviewTheme() === 'dark' || getWebviewTheme() === 'high-contrast' ? 'dark' : 'light' });
    await proxy.start();
  } else {
    proxy.setTheme(getWebviewTheme() === 'dark' || getWebviewTheme() === 'high-contrast' ? 'dark' : 'light');
  }
  currentBaseUrl = proxy.url;
}

async function openInBrowser(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${currentPort}`));
}

async function stopDsh(): Promise<void> {
  const managed = serviceManager.getManagedProcess();
  if (!managed) {
    vscode.window.showInformationMessage('当前没有由插件启动的 dsh 进程。外部 dsh 请自行关闭。');
    return;
  }
  const answer = await vscode.window.showWarningMessage(`确定要停止插件启动的 dsh 进程 (PID ${managed.pid}) 吗？`, { modal: true }, '停止');
  if (answer === '停止') {
    await serviceManager.stopManagedDsh();
    vscode.window.showInformationMessage('已停止插件启动的 dsh。');
    await updateStatusBar();
  }
}

async function syncPortToPlugin(): Promise<void> {
  const port = await serviceManager.syncLocalPortToPlugin();
  if (port === undefined) {
    vscode.window.showWarningMessage('未能在本地 dsh 配置中找到端口，请确认 dsh 已安装并初始化过 web profile。');
    return;
  }
  currentPort = port;
  await updateProxyForTheme();
  webviewProvider.updateUrl(buildFrameUrl());
  vscode.window.showInformationMessage(`已将插件端口同步为本地 dsh 端口 ${port}。`);
  await updateStatusBar();
}

async function syncPortToDsh(): Promise<void> {
  const port = getConfig().port;
  const answer = await vscode.window.showWarningMessage(
    `将插件端口 ${port} 写入本地 dsh web profile 配置（会先备份原文件）？`,
    { modal: true },
    '写入'
  );
  if (answer !== '写入') {
    return;
  }
  const result = await serviceManager.syncPluginPortToLocal(port);
  if (result.ok) {
    vscode.window.showInformationMessage(`已写入 ${result.file}，下次 dsh 启动将使用端口 ${port}。`);
  } else {
    vscode.window.showErrorMessage(`写入本地 dsh 配置失败：${result.message ?? '未知错误'}`);
  }
}

async function promptForPort(): Promise<void> {
  const value = await vscode.window.showInputBox({
    prompt: '请输入新的 dsh 端口',
    value: String(currentPort),
    validateInput: (input) => {
      const n = Number(input);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return '端口必须是 1-65535 的整数';
      }
      return undefined;
    },
  });
  if (!value) {
    return;
  }
  const port = Number(value);
  await setConfigPort(port);
  currentPort = port;
  await updateProxyForTheme();
  webviewProvider.updateUrl(buildFrameUrl());
  vscode.window.showInformationMessage(`端口已设置为 ${port}。请重新点击打开 DSH GUI。`);
}

async function updateStatusBar(): Promise<void> {
  const status = await serviceManager.getStatus();
  let text = 'DSH: 未运行';
  let tooltip = '点击打开 DSH GUI';
  let color = new vscode.ThemeColor('statusBarItem.warningForeground');
  switch (status.state) {
    case 'not-installed':
      text = 'DSH: 未安装';
      tooltip = '未检测到 dsh，请安装 @deepseek-ai/dsh';
      color = new vscode.ThemeColor('statusBarItem.errorForeground');
      break;
    case 'not-running':
      text = `DSH: 未运行 (:${status.port})`;
      tooltip = `点击启动 dsh 并打开侧栏（端口 ${status.port}）`;
      break;
    case 'starting':
      text = `DSH: 启动中 (:${status.port})`;
      break;
    case 'running':
      text = status.managed ? `DSH: 运行中 (插件 :${status.port})` : `DSH: 运行中 (外部 :${status.port})`;
      tooltip = status.managed ? '点击打开 DSH GUI；停止请使用命令/侧栏按钮' : '检测到外部 dsh，点击打开 DSH GUI';
      color = new vscode.ThemeColor('statusBarItem.prominentForeground');
      break;
    case 'error':
      text = 'DSH: 错误';
      tooltip = status.message;
      color = new vscode.ThemeColor('statusBarItem.errorForeground');
      break;
  }
  statusBarItem.text = text;
  statusBarItem.tooltip = tooltip;
  statusBarItem.color = color;
  statusBarItem.show();
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export async function deactivate(): Promise<void> {
  if (proxy) {
    await proxy.stop();
    proxy = undefined;
  }
  // Service manager dispose handles stopDshOnVscClose.
}

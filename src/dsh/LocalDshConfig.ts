import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from '../util/logger';

const DEFAULT_DSH_PORT = 3080;

export function resolveDshHome(): string {
  const env = process.env.DSH_HOME;
  if (env && env.trim().length > 0) {
    return path.resolve(env.trim());
  }
  return path.join(os.homedir(), '.dsh');
}

/**
 * Best-effort discovery of the port local dsh uses by default.
 * Tries `dsh --profile web --dump-config` first, then scans known profile files.
 */
export async function findLocalDshDefaultPort(_dshCommand = 'dsh'): Promise<number | undefined> {
  // NOTE: we intentionally do not run `dsh --profile web --dump-config` here:
  // it can initialize/write profile files and would interfere with a running dsh.
  const home = resolveDshHome();
  const candidates = [
    path.join(home, 'profiles', 'web', 'cordis.patch.yml'),
    path.join(home, 'profiles', 'web', 'cordis.yml'),
    path.join(home, 'profiles', 'web', 'dsh.profile'),
    path.join(home, 'profiles', 'web', 'package.json'),
    path.join(home, 'settings.yaml'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      continue;
    }
    try {
      const content = fs.readFileSync(file, 'utf8');
      const port = scanPortFromText(content);
      if (port !== undefined) {
        log(`Local dsh default port from ${file}: ${port}`);
        return port;
      }
    } catch (err) {
      log(`Failed to read ${file}: ${String(err)}`);
    }
  }

  // dsh's hardcoded web default is 3080 when no explicit port is configured.
  if (fs.existsSync(path.join(home, 'profiles', 'web'))) {
    return DEFAULT_DSH_PORT;
  }
  return undefined;
}

function scanPortFromText(text: string): number | undefined {
  // Prefer port values near webServer/webStartup sections.
  const sectionRegex = /web(?:Server|Startup)[\s\S]{0,400}?port\s*:\s*(\d+)/i;
  const sectionMatch = sectionRegex.exec(text);
  if (sectionMatch) {
    return Number(sectionMatch[1]);
  }
  const generic = /port\s*:\s*(\d+)/i.exec(text);
  if (generic) {
    return Number(generic[1]);
  }
  return undefined;
}

/**
 * Experimental: write plugin port into the local web profile user patch.
 * Creates a backup before writing. This is best-effort and may be unsupported
 * on some dsh versions; failures are reported but never fatal.
 */
export async function writeLocalDshPort(port: number): Promise<{ ok: boolean; file?: string; message?: string }> {
  const home = resolveDshHome();
  const profileDir = path.join(home, 'profiles', 'web');
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  const fallbackFile = path.join(profileDir, 'cordis.yml');
  const target = fs.existsSync(patchFile) ? patchFile : fallbackFile;

  if (!fs.existsSync(profileDir)) {
    return { ok: false, message: `dsh web profile not found at ${profileDir}` };
  }

  try {
    if (!fs.existsSync(target)) {
      fs.writeFileSync(
        target,
        `# Added by Easy VSC GUI for DSH\n- id: easy-vsc-gui-for-dsh-port\n  patch:\n    webServer:\n      port: ${port}\n`,
        'utf8'
      );
      return { ok: true, file: target };
    }

    const content = fs.readFileSync(target, 'utf8');
    fs.copyFileSync(target, `${target}.bak`);
    const updated = replaceOrAppendPort(content, port);
    fs.writeFileSync(target, updated, 'utf8');
    return { ok: true, file: target };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

function replaceOrAppendPort(content: string, port: number): string {
  // If there is an existing port line, replace the first one.
  const portLine = /^(\s*port\s*:\s*)\d+/m;
  if (portLine.test(content)) {
    return content.replace(portLine, `$1${port}`);
  }
  // Otherwise append a new patch entry; this is intentionally conservative.
  return `${content.replace(/\s*$/, '')}\n- id: easy-vsc-gui-for-dsh-port\n  patch:\n    webServer:\n      port: ${port}\n`;
}

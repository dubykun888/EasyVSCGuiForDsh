import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveDshHome } from '../dsh/LocalDshConfig';
import { log } from '../util/logger';

export interface WorkspaceInfo {
  folder?: vscode.WorkspaceFolder;
  isDshWorkspace: boolean;
  lastSessionId?: string;
}

interface SessionCache {
  tables?: {
    sessions?: Record<string, SessionCacheEntry>;
  };
}

interface SessionCacheEntry {
  identity?: {
    cwd?: string;
    createdAt?: number;
  };
  rows?: {
    sessionListMetadata?: {
      val?: {
        blank?: boolean;
        lastPromptAt?: number | null;
      };
    };
  };
}

/**
 * Adapter for workspace-aware dsh behavior.
 * Reads dsh's read-only projection cache under $DSH_HOME to detect workspaces
 * and find the most recent chat for the current VS Code folder.
 */
export class WorkspaceAdapter {
  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return { isDshWorkspace: false };
    }
    const isDshWorkspace = await this.isDshWorkspace(folder.uri.fsPath);
    const lastSessionId = isDshWorkspace ? await this.findLastSessionId(folder.uri.fsPath) : undefined;
    return { folder, isDshWorkspace, lastSessionId };
  }

  async isDshWorkspace(folderPath: string): Promise<boolean> {
    const sessions = this.readSessionCache();
    const needle = normalizePath(folderPath);
    const found = sessions.some((entry) => entry.cwd !== undefined && normalizePath(entry.cwd) === needle);
    if (found) {
      log(`Detected dsh workspace: ${folderPath}`);
    }
    return found;
  }

  async findLastSessionId(folderPath: string): Promise<string | undefined> {
    const sessions = this.readSessionCache();
    const needle = normalizePath(folderPath);
    let bestId: string | undefined;
    let bestTime = -1;

    for (const session of sessions) {
      if (session.id === undefined || session.cwd === undefined || normalizePath(session.cwd) !== needle) {
        continue;
      }
      if (session.blank) {
        continue;
      }
      const time = session.lastPromptAt ?? session.createdAt ?? 0;
      if (time > bestTime) {
        bestTime = time;
        bestId = session.id;
      }
    }
    if (bestId) {
      log(`Last dsh session for ${folderPath}: ${bestId}`);
    }
    return bestId;
  }

  private readSessionCache(): Array<{
    id: string;
    cwd?: string;
    createdAt?: number;
    blank: boolean;
    lastPromptAt?: number;
  }> {
    const cacheFile = path.join(resolveDshHome(), 'storages', 'session_projcache.json');
    try {
      if (!fs.existsSync(cacheFile)) {
        return [];
      }
      const raw = fs.readFileSync(cacheFile, 'utf8');
      const data = JSON.parse(raw) as SessionCache;
      const table = data.tables?.sessions ?? {};
      return Object.entries(table).map(([id, entry]) => ({
        id,
        cwd: entry.identity?.cwd,
        createdAt: entry.identity?.createdAt,
        blank: entry.rows?.sessionListMetadata?.val?.blank ?? false,
        lastPromptAt: entry.rows?.sessionListMetadata?.val?.lastPromptAt ?? undefined,
      }));
    } catch (err) {
      log(`Failed to read dsh session cache: ${String(err)}`);
      return [];
    }
  }
}

function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

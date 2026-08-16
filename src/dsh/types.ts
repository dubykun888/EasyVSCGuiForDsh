export type DshStartMode = 'npx' | 'global';

export interface ManagedDshProcess {
  pid: number;
  mode: DshStartMode;
  command: string;
  args: string[];
  cwd: string;
  startedAt: number;
  child: import('child_process').ChildProcess;
}

export type DshStatus =
  | { state: 'not-installed'; reason?: string }
  | { state: 'not-running'; port: number }
  | { state: 'running'; port: number; managed: boolean; pid?: number; mode?: DshStartMode }
  | { state: 'starting'; port: number; mode: DshStartMode }
  | { state: 'error'; message: string };

export interface PortCheckResult {
  occupied: boolean;
  isDsh: boolean;
  statusCode?: number;
  detail?: string;
}

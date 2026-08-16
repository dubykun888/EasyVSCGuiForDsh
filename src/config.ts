import * as vscode from 'vscode';

export type StartMode = 'auto' | 'npx' | 'global';
export type ThemeFollow = 'vscode' | 'system' | 'dsh';

export interface ExtensionConfig {
  port: number;
  startMode: StartMode;
  dshPackage: string;
  startTimeout: number;
  stopDshOnVscClose: boolean;
  themeFollow: ThemeFollow;
  autoOpenLastChat: boolean;
  dshCommand: string;
}

const SECTION = 'easyVscGuiForDsh';

export function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    port: cfg.get<number>('port', 3080),
    startMode: cfg.get<StartMode>('startMode', 'auto'),
    dshPackage: cfg.get<string>('dshPackage', '@deepseek-ai/dsh'),
    startTimeout: cfg.get<number>('startTimeout', 60),
    stopDshOnVscClose: cfg.get<boolean>('stopDshOnVscClose', false),
    themeFollow: cfg.get<ThemeFollow>('themeFollow', 'vscode'),
    autoOpenLastChat: cfg.get<boolean>('autoOpenLastChat', true),
    dshCommand: cfg.get<string>('dshCommand', 'dsh'),
  };
}

export async function setConfigPort(port: number): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('port', port, vscode.ConfigurationTarget.Global);
}

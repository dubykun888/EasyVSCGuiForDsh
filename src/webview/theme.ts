import * as vscode from 'vscode';
import { WebviewTheme } from './DshWebviewProvider';

export function getWebviewTheme(theme = vscode.window.activeColorTheme): WebviewTheme {
  switch (theme.kind) {
    case vscode.ColorThemeKind.Dark:
      return 'dark';
    case vscode.ColorThemeKind.HighContrast:
      return 'high-contrast';
    case vscode.ColorThemeKind.HighContrastLight:
      return 'light';
    case vscode.ColorThemeKind.Light:
    default:
      return 'light';
  }
}

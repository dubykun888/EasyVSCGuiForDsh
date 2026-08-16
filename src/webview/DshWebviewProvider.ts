import * as vscode from 'vscode';
import { log } from '../util/logger';

export type WebviewTheme = 'light' | 'dark' | 'high-contrast';

export interface DshWebviewProviderOptions {
  getUrl: () => string;
  getTheme: () => WebviewTheme;
  onOpenInBrowser: () => void;
  onStopDsh: () => void;
  onSyncPortToPlugin: () => void;
  onRefresh: () => void;
}

export class DshWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'easyVscGuiForDsh.view';

  private view?: vscode.WebviewView;

  constructor(private readonly options: DshWebviewProviderOptions) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    this.updateHtml();

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'ready':
          log('DSH webview ready');
          break;
        case 'openInBrowser':
          this.options.onOpenInBrowser();
          break;
        case 'stopDsh':
          this.options.onStopDsh();
          break;
        case 'syncPortToPlugin':
          this.options.onSyncPortToPlugin();
          break;
        case 'refresh':
          this.options.onRefresh();
          break;
      }
    });
  }

  updateHtml(): void {
    if (!this.view) {
      return;
    }
    const url = this.options.getUrl();
    const theme = this.options.getTheme();
    this.view.webview.html = this.getHtml(url, theme);
  }

  refresh(): void {
    if (!this.view) {
      return;
    }
    this.updateHtml();
  }

  updateUrl(url: string): void {
    if (!this.view) {
      return;
    }
    this.postMessage({ type: 'setUrl', url });
  }

  updateTheme(theme: WebviewTheme): void {
    if (!this.view) {
      return;
    }
    this.postMessage({ type: 'setTheme', theme });
  }

  private postMessage(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(url: string, theme: WebviewTheme): string {
    const nonce = getNonce();
    const bodyClass = theme === 'dark' || theme === 'high-contrast' ? 'vscode-dark' : 'vscode-light';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src http://127.0.0.1:*;">
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { display: flex; flex-direction: column; background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); }
    #dshFrame { flex: 1; border: none; width: 100%; height: 100%; }
    #loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family); }
  </style>
</head>
<body class="${bodyClass}">
  <div id="loading">Loading DSH…</div>
  <iframe id="dshFrame" src="${url}" allow="clipboard-read; clipboard-write"></iframe>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('dshFrame');
    const loading = document.getElementById('loading');
    frame.addEventListener('load', () => { loading.style.display = 'none'; });
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'setUrl') {
        frame.src = msg.url;
        loading.style.display = 'flex';
      } else if (msg.type === 'setTheme') {
        document.body.className = (msg.theme === 'dark' || msg.theme === 'high-contrast') ? 'vscode-dark' : 'vscode-light';
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

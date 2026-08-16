import * as vscode from 'vscode';
import { getConfig, setConfigPort } from './config';
import { DshServiceManager } from './dsh/DshServiceManager';
import { DshProxy } from './proxy/DshProxy';
import { getWebviewTheme } from './webview/theme';
import { WorkspaceAdapter } from './workspace/WorkspaceAdapter';
import { log, showOutput } from './util/logger';

let serviceManager: DshServiceManager;
let statusBarItem: vscode.StatusBarItem;
let sidePanel: vscode.WebviewPanel | undefined;
let proxy: DshProxy | undefined;
let currentPort = 3080;
let currentBaseUrl = '';
let currentSessionId: string | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('Easy VSC GUI for DSH activating');

  serviceManager = new DshServiceManager();
  const workspaceAdapter = new WorkspaceAdapter();

  currentPort = getConfig().port;

  context.subscriptions.push(
    vscode.commands.registerCommand('easyVscGuiForDsh.open', () => openDshGui(workspaceAdapter)),
    vscode.commands.registerCommand('easyVscGuiForDsh.stopDsh', () => stopDsh()),
    vscode.commands.registerCommand('easyVscGuiForDsh.openInBrowser', () => openInBrowser()),
    vscode.commands.registerCommand('easyVscGuiForDsh.syncPortToPlugin', () => syncPortToPlugin()),
    vscode.commands.registerCommand('easyVscGuiForDsh.syncPortToDsh', () => syncPortToDsh()),
    vscode.commands.registerCommand('easyVscGuiForDsh.refresh', () => updateSidePanel())
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      const theme = getWebviewTheme();
      if (proxy) {
        proxy.setTheme(theme === 'dark' || theme === 'high-contrast' ? 'dark' : 'light');
      }
      updateSidePanel();
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
    updateSidePanel();

    if (cfg.autoOpenLastChat && workspaceInfo.isDshWorkspace) {
      log(`Workspace detected, dsh started with cwd=${workspaceInfo.folder?.uri.fsPath}, session=${currentSessionId ?? 'none'}`);
    }

    await openSidePanel();
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

async function openSidePanel(): Promise<void> {
  if (sidePanel) {
    sidePanel.reveal(vscode.ViewColumn.Beside);
  } else {
    sidePanel = vscode.window.createWebviewPanel(
      'easyVscGuiForDsh.sidePanel',
      'DSH GUI',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    sidePanel.onDidDispose(() => {
      sidePanel = undefined;
    });
    sidePanel.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'openInBrowser':
          void openInBrowser();
          break;
        case 'stopDsh':
          void stopDsh();
          break;
        case 'syncPortToPlugin':
          void syncPortToPlugin();
          break;
        case 'refresh':
          updateSidePanel();
          break;
      }
    });
  }
  updateSidePanel();
  // Move the editor/webview into the secondary side bar (right auxiliary bar).
  try {
    await vscode.commands.executeCommand('workbench.action.moveEditorToSecondarySideBar');
  } catch {
    // Fallback: keep the webview as a Beside editor panel on the right.
  }
}

function updateSidePanel(): void {
  if (!sidePanel) {
    return;
  }
  sidePanel.webview.html = sidePanelHtml();
}

function sidePanelHtml(): string {
  const nonce = getNonce();
  const url = buildFrameUrl();
  const theme = getWebviewTheme();
  const bodyClass = theme === 'dark' || theme === 'high-contrast' ? 'vscode-dark' : 'vscode-light';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src http://127.0.0.1:*;">
<style>
  html,body{height:100%;margin:0;font-family:var(--vscode-font-family)}
  body.vscode-dark{background:#1e1e1e;color:#cccccc}
  body.vscode-light{background:#ffffff;color:#333333}
  #toolbar{display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid var(--vscode-panel-border,#ccc);align-items:center}
  #toolbar button{background:transparent;border:1px solid var(--vscode-button-border,transparent);color:var(--vscode-button-foreground,#333);cursor:pointer;padding:3px 8px;border-radius:4px;font-size:12px}
  #toolbar button:hover{background:var(--vscode-toolbar-hoverBackground,#eee)}
  #frameWrap{position:relative;height:calc(100% - 37px)}
  iframe{width:100%;height:100%;border:none;display:block}
  #loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground,#888)}
</style>
</head>
<body class="${bodyClass}">
<div id="toolbar">
  <button id="refresh">刷新</button>
  <button id="browser">浏览器打开</button>
  <button id="sync">同步本地端口</button>
  <button id="stop">停止 dsh</button>
</div>
<div id="frameWrap">
  <div id="loading">Loading DSH…</div>
  <iframe id="dshFrame" src="${url}" allow="clipboard-read; clipboard-write"></iframe>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const frame = document.getElementById('dshFrame');
  const loading = document.getElementById('loading');
  frame.addEventListener('load', () => { loading.style.display = 'none'; });
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({type:'refresh'}));
  document.getElementById('browser').addEventListener('click', () => vscode.postMessage({type:'openInBrowser'}));
  document.getElementById('sync').addEventListener('click', () => vscode.postMessage({type:'syncPortToPlugin'}));
  document.getElementById('stop').addEventListener('click', () => vscode.postMessage({type:'stopDsh'}));
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'setUrl') {
      frame.src = msg.url;
      loading.style.display = 'flex';
    }
  });
  vscode.postMessage({type:'ready'});
</script>
</body>
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
  updateSidePanel();
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
  updateSidePanel();
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

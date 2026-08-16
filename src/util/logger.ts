type OutputChannel = import('vscode').OutputChannel;

let output: OutputChannel | undefined;

function getOutput(): OutputChannel | undefined {
  if (output) {
    return output;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode') as typeof import('vscode');
    output = vscode.window.createOutputChannel('Easy VSC GUI for DSH');
  } catch {
    // Running outside the VS Code extension host (e.g. unit tests).
  }
  return output;
}

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  getOutput()?.appendLine(line);
}

export function showOutput(): void {
  getOutput()?.show(true);
}

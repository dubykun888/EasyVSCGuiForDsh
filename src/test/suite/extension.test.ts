import * as assert from 'assert';
import * as vscode from 'vscode';

suite('EasyVSCGuiForDsh Extension', () => {
  test('should activate and register core commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'easyVscGuiForDsh.open',
      'easyVscGuiForDsh.stopDsh',
      'easyVscGuiForDsh.openInBrowser',
      'easyVscGuiForDsh.syncPortToPlugin',
      'easyVscGuiForDsh.syncPortToDsh',
      'easyVscGuiForDsh.refresh',
    ]) {
      assert.ok(commands.includes(command), `missing command ${command}`);
    }
  });

  test('should expose configuration defaults', () => {
    const cfg = vscode.workspace.getConfiguration('easyVscGuiForDsh');
    assert.strictEqual(cfg.get<number>('port'), 3080);
    assert.strictEqual(cfg.get<string>('startMode'), 'auto');
  });
});

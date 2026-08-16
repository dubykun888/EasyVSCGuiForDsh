import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 20000,
  });

  const suiteDir = __dirname;
  const files = fs
    .readdirSync(suiteDir)
    .filter((file) => file.endsWith('.test.js') && !file.endsWith('.d.ts'));

  for (const file of files) {
    mocha.addFile(path.join(suiteDir, file));
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}

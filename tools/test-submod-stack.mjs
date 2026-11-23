import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureFiles, stackReads, stacks } from './submod-fixture.js';

const { openGame } = await import(pathToFileURL(path.resolve('tools/megfs.mjs')).href);
const temporary = path.resolve(os.tmpdir());
const root = fs.mkdtempSync(path.join(temporary, 'eaw-submod-'));
const install = path.join(root, 'game');
const keep = process.argv.includes('--keep');

function put(folder, relative, text) {
  const file = path.join(folder, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

try {
  for (const [file, bytes] of fixtureFiles()) put(root, file, bytes);

  for (const expansion of [false, true]) {
    const edition = expansion ? 'foc' : 'eaw';
    for (const row of stacks) {
      const { mods } = row;
      const game = openGame(
        install,
        mods.map(name => path.join(root, name)),
        { expansion }
      );
      const stack = mods.join(' + ') || 'base';
      try {
        for (const [key, expected] of stackReads(row, edition)) {
          const resolved = game.resolve(key);
          assert.equal(resolved ? game.read(resolved).toString('utf8') : null, expected, `${edition}, ${stack}: ${key}`);
        }
      } finally {
        game.close();
      }
    }
  }
  console.log('loose-stack/1: PASS (dev loader; 4 stacks x 2 editions)');
} finally {
  if (keep) console.log(`Fixtures: ${root}`);
  else if (path.dirname(root) === temporary && path.basename(root).startsWith('eaw-submod-')) fs.rmSync(root, { recursive: true });
}

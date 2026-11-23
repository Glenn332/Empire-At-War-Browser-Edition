import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [reference, candidate] = process.argv.slice(2);
assert(
  reference && candidate && process.argv.length === 4,
  'usage: node tools/verify-submod-bundle.mjs <reference-site> <fork-compat-site>'
);
assert.notEqual(fs.realpathSync(reference), fs.realpathSync(candidate), 'use two separate site directories');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function inventory(root) {
  assert(fs.lstatSync(root).isDirectory(), `expected a real directory: ${root}`);
  const files = new Map();
  function visit(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file, name + '/');
      else {
        assert(entry.isFile(), `not a regular file: ${file}`);
        files.set(name, hash(fs.readFileSync(file)));
      }
    }
  }
  visit(root, '');
  return files;
}

const expected = inventory(reference);
const actual = inventory(candidate);
for (const name of ['index.html', 'play.html', 'sw.js', 'js/game/pathsearch.wasm'])
  assert(expected.has(name), `incomplete reference: missing ${name}`);
const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort();
const differences = paths.filter(name => actual.get(name) !== expected.get(name));
if (differences.length) {
  for (const name of differences.slice(0, 20))
    console.error(`${!expected.has(name) ? 'extra' : !actual.has(name) ? 'missing' : 'changed'}: ${name}`);
  console.error(`FAIL: ${differences.length} differing paths`);
  process.exitCode = 1;
} else {
  const digest = hash(JSON.stringify(paths.map(name => [name, expected.get(name)])));
  console.log(`PASS: identical static bundle (${paths.length} files, SHA-256 ${digest}); hosting and gameplay not verified by this check`);
}

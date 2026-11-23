import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const toolsDir = fileURLToPath(new URL('.', import.meta.url));
const root = path.dirname(toolsDir);
const withoutGame = process.argv.includes('--without-game');
const parallel = Math.max(1, Number(process.argv.find(arg => arg.startsWith('--parallel='))?.split('=')[1]) || 4);
const timeoutMs = 5 * 60 * 1000;
const NEEDS_GAME = /openGame|megfs\.mjs|Star Wars Empire at War|SWR_TEST_MOD/;
const LOCAL_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.\/[^'"]+\.mjs)['"]/g;
const TIMED = /^test-lockstep/;

const needsGameCache = new Map();
function needsGame(file, seen = new Set()) {
  if (needsGameCache.has(file)) return needsGameCache.get(file);
  if (seen.has(file)) return false;
  seen.add(file);
  const source = readFileSync(path.join(toolsDir, file), 'utf8');
  let result = NEEDS_GAME.test(source);
  for (const match of source.matchAll(LOCAL_IMPORT)) {
    if (result) break;
    const imported = path.basename(match[1]);
    if (imported !== file && readdirSync(toolsDir).includes(imported)) result = needsGame(imported, seen);
  }
  needsGameCache.set(file, result);
  return result;
}

function runTest(file) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join('tools', file)], { cwd: root });
    let output = '';
    child.stdout.on('data', data => (output += data));
    child.stderr.on('data', data => (output += data));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      const passed = code === 0;
      console.log(`${passed ? 'ok  ' : 'FAIL'} ${file} (${seconds} s)`);
      resolve({ file, passed, code, signal, seconds, output });
    });
  });
}

async function runAll(files, workers) {
  const queue = [...files],
    results = [];
  await Promise.all(
    Array.from({ length: Math.min(workers, queue.length) }, async () => {
      while (queue.length) results.push(await runTest(queue.shift()));
    })
  );
  return results;
}

const allTests = readdirSync(toolsDir)
  .filter(file => /^test-.*\.mjs$/.test(file))
  .sort();
const chosen = withoutGame ? allTests.filter(file => !needsGame(file)) : allTests;
const started = Date.now();
console.log(`${chosen.length} of ${allTests.length} tests${withoutGame ? ' that need no game install' : ''}`);
const results = [
  ...(await runAll(
    chosen.filter(file => !TIMED.test(file)),
    parallel
  )),
  ...(await runAll(
    chosen.filter(file => TIMED.test(file)),
    1
  ))
];
const failed = results.filter(result => !result.passed);
for (const result of failed) {
  console.log(`\n==== ${result.file} (exit ${result.code}${result.signal ? ', ' + result.signal : ''})`);
  console.log(result.output.trim().split('\n').slice(-25).join('\n'));
}
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed in ${Math.round((Date.now() - started) / 1000)} s`);
process.exitCode = failed.length ? 1 : 0;

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_FLAG = '--baseline-sample';
const UPDATE_RUNS = 3;
const baselinesDir = fileURLToPath(new URL('./baselines/', import.meta.url));
const baselineFile = name => path.join(baselinesDir, name + '.json');
const readAll = name => (existsSync(baselineFile(name)) ? JSON.parse(readFileSync(baselineFile(name), 'utf8')) : {});

export const sampleFile = () => {
  const at = process.argv.indexOf(SAMPLE_FLAG);
  return at < 0 ? null : process.argv[at + 1];
};

export const readBaseline = (name, key) => readAll(name)[key] || null;

export function recordSample(file, key, now) {
  writeFileSync(file, JSON.stringify({ key, now }));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : +((sorted[middle - 1] + sorted[middle]) / 2).toFixed(3);
}

export function updateBaseline(name, script) {
  const args = process.argv.slice(2).filter(arg => arg !== '--update');
  const samples = [];
  for (let run = 1; run <= UPDATE_RUNS; run++) {
    const file = path.join(tmpdir(), `${name}-baseline-${process.pid}-${run}.json`);
    console.log(`baseline run ${run} of ${UPDATE_RUNS}`);
    const result = spawnSync(process.execPath, [script, ...args, SAMPLE_FLAG, file], { stdio: 'inherit' });
    if (result.status !== 0 || !existsSync(file)) {
      console.error(`FAIL baseline run ${run} did not pass, the baseline was left as it was`);
      process.exit(1);
    }
    samples.push(JSON.parse(readFileSync(file, 'utf8')));
    unlinkSync(file);
  }
  const key = samples[0].key,
    kept = Object.fromEntries(Object.keys(samples[0].now).map(field => [field, median(samples.map(sample => sample.now[field]))]));
  const all = readAll(name);
  all[key] = { ...kept, runs: UPDATE_RUNS, at: new Date().toISOString().slice(0, 10) };
  mkdirSync(baselinesDir, { recursive: true });
  writeFileSync(baselineFile(name), JSON.stringify(all, null, 2) + '\n');
  console.log(`baseline kept for ${key}, the median of ${UPDATE_RUNS} runs: ${JSON.stringify(kept)}`);
  process.exit(0);
}

// The benchmark's process figures: what the desktop app answers for api/process-stats (stubbed here) is kept
// as min / average / max per figure for the total and for each process, shown in the overlay's table and
// written into the bug report; a browser tab records its JavaScript heap and says what needs the app.
import assert from 'node:assert/strict';

const MB = 1024 * 1024;

const {
  ProcessStatsLog,
  ProcessStatsSampler,
  processSnapshot,
  processStatsLines,
  processTable,
  browserTable,
  browserSample,
  readProcessStats,
  bytesText,
  shortBytes,
  DESKTOP_ONLY,
  PROCESS_METRICS
} = await import('../public/js/procstats.js');
const { performanceLines } = await import('../public/js/perfreport.js');

// one answer of the app: the app itself, the WebView2 browser, GPU and renderer processes
function answer(step, { renderer = 300, gpu = true } = {}) {
  const row = (pid, type, cpu, privateMB, gpuPercent, dedicatedMB, read, write) => ({
    pid,
    name: type === 'app' ? 'empire-at-war-browser-edition.exe' : 'msedgewebview2.exe',
    type,
    cpuPercent: cpu,
    workingSetBytes: (privateMB + 20) * MB,
    privateBytes: privateMB * MB,
    gpuPercent: gpu ? gpuPercent : null,
    gpuEngine: gpu && gpuPercent ? '3D' : null,
    gpuDedicatedBytes: gpu ? dedicatedMB * MB : null,
    gpuSharedBytes: gpu ? 0 : null,
    ioReadBytesPerSec: read,
    ioWriteBytesPerSec: write,
    ioOtherBytesPerSec: 0
  });
  const processes = [
    row(100, 'app', 1 + step, 50, 0, 0, 0, 1000 * step),
    row(200, 'browser', 2, 80, 0, 0, 2048, 0),
    row(210, 'gpu', 10 + 10 * step, 300 + 100 * step, 40 + 10 * step, 500 + 50 * step, 0, 0),
    row(renderer, 'renderer', 5 * step, 700, 0, 4, 1024 * 1024 * step, 0)
  ];
  const sum = key => (processes[0][key] == null ? null : processes.reduce((n, p) => n + p[key], 0));
  return {
    supported: true,
    intervalMs: 1000,
    logicalProcessors: 16,
    gpuCounters: { utilisation: gpu, memory: gpu },
    unreadable: 0,
    processes,
    total: {
      processes: processes.length,
      ...Object.fromEntries(PROCESS_METRICS.map(key => [key, sum(key)])),
      // the busiest engine type over the processes, not their sum
      gpuPercent: gpu ? 40 + 10 * step : null
    }
  };
}

{
  // min / avg / max of the totals and of each process over three samples
  const log = new ProcessStatsLog();
  for (const step of [0, 1, 2]) log.add(answer(step));
  const s = log.summary();
  assert.equal(s.source, 'desktop');
  assert.equal(s.samples, 3);
  assert.equal(s.logicalProcessors, 16);
  assert.equal(s.mostProcesses, 4);
  // cpu totals: 13, 29, 45
  assert.deepEqual(s.total.cpuPercent, { min: 13, avg: 29, max: 45 });
  // private memory totals: 1130, 1230, 1330 MB
  assert.deepEqual(s.total.privateBytes, { min: 1130 * MB, avg: 1230 * MB, max: 1330 * MB });
  assert.deepEqual(s.total.workingSetBytes, { min: 1210 * MB, avg: 1310 * MB, max: 1410 * MB });
  assert.deepEqual(s.total.gpuPercent, { min: 40, avg: 50, max: 60 });
  assert.deepEqual(s.total.gpuDedicatedBytes, { min: 504 * MB, avg: 554 * MB, max: 604 * MB });
  assert.deepEqual(s.total.ioReadBytesPerSec, { min: 2048, avg: 2048 + MB, max: 2048 + 2 * MB });
  assert.deepEqual(s.total.ioWriteBytesPerSec, { min: 0, avg: 1000, max: 2000 });
  assert.deepEqual(
    s.processes.map(p => `${p.type} ${p.pid}`),
    ['app 100', 'browser 200', 'gpu 210', 'renderer 300']
  );
  const gpu = s.processes.find(p => p.type === 'gpu');
  assert.equal(gpu.samples, 3);
  assert.deepEqual(gpu.cpuPercent, { min: 10, avg: 20, max: 30 });
  assert.deepEqual(gpu.gpuPercent, { min: 40, avg: 50, max: 60 });
  assert.deepEqual(gpu.privateBytes, { min: 300 * MB, avg: 400 * MB, max: 500 * MB });
  const renderer = s.processes.find(p => p.type === 'renderer');
  assert.deepEqual(renderer.ioReadBytesPerSec, { min: 0, avg: MB, max: 2 * MB });
  assert.equal(JSON.parse(JSON.stringify(s)).total.cpuPercent.avg, 29, 'the summary goes into the benchmark result as JSON');

  // fractions of a percent are kept to one decimal, bytes are whole
  const fine = new ProcessStatsLog();
  for (const cpu of [0.26, 0.31, 1.04]) {
    const a = answer(0);
    a.total.cpuPercent = cpu;
    a.total.privateBytes = 1000.4 + cpu;
    fine.add(a);
  }
  assert.deepEqual(fine.summary().total.cpuPercent, { min: 0.3, avg: 0.5, max: 1 });
  assert.deepEqual(fine.summary().total.privateBytes, { min: 1001, avg: 1001, max: 1001 });
}

{
  // the first answer after a pause has no rates yet (null): they do not count as zero
  const log = new ProcessStatsLog();
  const first = answer(0);
  for (const p of first.processes) p.cpuPercent = p.ioReadBytesPerSec = p.ioWriteBytesPerSec = null;
  first.total.cpuPercent = first.total.ioReadBytesPerSec = first.total.ioWriteBytesPerSec = null;
  log.add(first);
  assert.equal(log.summary().total.cpuPercent, null);
  assert.ok(log.summary().total.privateBytes, 'memory is known at once');
  log.add(answer(2));
  assert.deepEqual(log.summary().total.cpuPercent, { min: 45, avg: 45, max: 45 });

  // a renderer that restarted is a new process in the record
  log.add(answer(1, { renderer: 301 }));
  const s = log.summary();
  assert.deepEqual(
    s.processes.filter(p => p.type === 'renderer').map(p => [p.pid, p.samples]),
    [
      [300, 2],
      [301, 1]
    ]
  );

  // nothing, or an answer without figures, adds nothing
  log.add(null);
  log.add({ supported: false, why: 'x' });
  assert.equal(log.summary().samples, 3);
  log.reset();
  assert.equal(log.summary(), null);
}

{
  // sizes
  assert.equal(bytesText(0), '0 B');
  assert.equal(bytesText(1536), '2 KB');
  assert.equal(bytesText(5.5 * MB), '5.5 MB');
  assert.equal(bytesText(812 * MB), '812 MB');
  assert.equal(bytesText(1.25 * 1024 * MB), '1.25 GB');
  assert.equal(bytesText(null), '-');
  assert.equal(shortBytes(812 * MB), '812M');
  assert.equal(shortBytes(1.25 * 1024 * MB), '1.25G');
  assert.equal(shortBytes(340 * 1024), '340k');
  assert.equal(shortBytes(12), '12');
  assert.equal(shortBytes(undefined), '-');
}

{
  // the overlay's table: a row for each process and the total last
  const rows = processTable(answer(2));
  assert.deepEqual(
    rows.map(r => r.label),
    ['app', 'browser', 'gpu', 'render', 'total']
  );
  assert.deepEqual(rows[2], { label: 'gpu', cpu: '30', memory: '500M', gpu: '60', gpuMemory: '600M', io: '0/0' });
  assert.deepEqual(rows[0], { label: 'app', cpu: '3.0', memory: '50M', gpu: '0.0', gpuMemory: '0', io: '0/2k' });
  assert.deepEqual(rows[4], { label: 'total', cpu: '45', memory: '1.30G', gpu: '60', gpuMemory: '604M', io: '2.0M/2k' });
  const blind = processTable(answer(1, { gpu: false }));
  assert.equal(blind[2].gpu, '-', 'no GPU counters: a dash, not zero');
  assert.equal(blind[2].gpuMemory, '-');
  const util = answer(0);
  util.processes.push(
    { ...util.processes[1], pid: 220, type: 'utility (network)' },
    { ...util.processes[1], pid: 230, type: 'crash handler' }
  );
  assert.deepEqual(
    processTable(util)
      .slice(4, 6)
      .map(r => r.label),
    ['u:network', 'crash']
  );
  assert.deepEqual(processTable({ supported: false }), []);
  assert.deepEqual(processTable(null), []);
}

{
  // the report's lines
  const log = new ProcessStatsLog();
  for (const step of [0, 1, 2]) log.add(answer(step));
  const lines = processStatsLines(log.summary());
  assert.equal(lines.length, 6);
  assert.equal(
    lines[0],
    '  Processes (desktop app, 3 samples, up to 4 processes, CPU as a share of 16 logical processors, min / avg / max):'
  );
  assert.equal(
    lines[1],
    '    total: CPU 13 / 29 / 45 %; memory 1.10 GB / 1.20 GB / 1.30 GB; working set 1.18 GB / 1.28 GB / 1.38 GB; GPU 40 / 50 / 60 %; ' +
      'GPU memory 504 MB / 554 MB / 604 MB; shared GPU memory 0 B / 0 B / 0 B; read 2 KB/s / 1.0 MB/s / 2.0 MB/s; written 0 B/s / 1000 B/s / 2 KB/s; other I/O 0 B/s / 0 B/s / 0 B/s'
  );
  assert.match(lines[2], /^    app \(pid 100, 3 samples\): CPU 1 \/ 2 \/ 3 %; memory 50\.0 MB \/ 50\.0 MB \/ 50\.0 MB/);
  assert.match(
    lines[4],
    /^    gpu \(pid 210, 3 samples\): CPU 10 \/ 20 \/ 30 %; memory 300 MB \/ 400 MB \/ 500 MB; .*GPU 40 \/ 50 \/ 60 %; GPU memory 500 MB \/ 550 MB \/ 600 MB/
  );
  assert.match(lines[5], /^    renderer \(pid 300, 3 samples\)/);
  assert.deepEqual(processStatsLines(null), []);

  // Windows without the GPU counters: said, and no GPU columns
  const blind = new ProcessStatsLog();
  blind.add(answer(1, { gpu: false }));
  const said = processStatsLines(blind.summary(), '', 'Processes now');
  assert.match(said[0], /^Processes now \(desktop app, 1 samples/);
  assert.ok(!said[1].includes('GPU'), said[1]);
  assert.equal(said.at(-1), '  Windows gave no figures for: GPU use, GPU memory');

  // and inside the bug report's performance section
  const text = performanceLines({ processes: blind.summary(), benchmarkProcesses: log.summary() }, [], null).join('\n');
  assert.match(text, /^  Processes now \(desktop app, 1 samples/m);
  assert.match(text, /^  Processes during the last benchmark \(desktop app, 3 samples/m);
  assert.match(text, /^    total: CPU 13 \/ 29 \/ 45 %/m);
  assert.ok(text.indexOf('Processes during') < text.indexOf('CPU profile:'), 'before the profile and causes lines');
  assert.ok(!performanceLines({}, [], null).join('\n').includes('Processes'), 'a report without the figures says nothing');
}

{
  // the sampler asks the (stubbed) command once per interval, off the frame loop, and stops when told to
  const timers = [];
  const asked = [];
  const seen = [];
  const sampler = new ProcessStatsSampler({
    read: async count => {
      asked.push(count);
      return answer(count);
    },
    interval: 1000,
    onSample: sample => seen.push(sample.total.cpuPercent),
    setTimer: (run, ms) => timers.push({ run, ms }) && timers.length,
    clearTimer: id => (timers[id - 1].cleared = true)
  });
  const turn = async () => {
    const next = timers.find(t => !t.ran && !t.cleared);
    next.ran = true;
    await next.run();
  };
  assert.equal(sampler.summary(), null);
  sampler.start();
  sampler.start();
  assert.equal(timers.length, 1, 'started once');
  assert.equal(timers[0].ms, 0, 'the first question at once');
  await turn();
  assert.equal(timers[1].ms, 1000, 'then one a second');
  await turn();
  await turn();
  assert.deepEqual(asked, [0, 1, 2]);
  assert.deepEqual(seen, [13, 29, 45]);
  assert.equal(sampler.latest.total.cpuPercent, 45);
  assert.deepEqual(sampler.summary().total.cpuPercent, { min: 13, avg: 29, max: 45 });
  sampler.reset();
  assert.equal(sampler.summary(), null, 'a restarted run starts its record again');
  await turn();
  assert.equal(sampler.summary().samples, 1);
  sampler.stop();
  assert.ok(timers.at(-1).cleared, 'the pending question is dropped');
  assert.equal(timers.filter(t => !t.ran && !t.cleared).length, 0, 'and nothing is asked after the stop');

  // an answer that arrives after the stop is not recorded
  let release;
  const late = new ProcessStatsSampler({ read: () => new Promise(done => (release = done)), setTimer: run => (run(), 1), clearTimer() {} });
  late.start();
  late.stop();
  release(answer(1));
  await null;
  await null;
  assert.equal(late.summary(), null);
}

{
  // an app without the command (an older build): three failed questions, then no more
  const timers = [];
  let asked = 0;
  const sampler = new ProcessStatsSampler({
    read: async () => {
      asked++;
      throw new Error('api/process-stats answered 404');
    },
    setTimer: run => timers.push(run),
    clearTimer() {}
  }).start();
  while (timers.length) await timers.shift()();
  assert.equal(asked, 3);
  assert.equal(sampler.running, false);
  assert.deepEqual(sampler.summary(), { source: 'none', samples: 0, note: 'api/process-stats answered 404' });
  assert.deepEqual(processStatsLines(sampler.summary()), ['  Processes: not measured (api/process-stats answered 404)']);
}

{
  // in a browser (no desktop app): the JavaScript heap, and a line saying what needs the app
  assert.equal(typeof window, 'undefined');
  const realMemory = Object.getOwnPropertyDescriptor(performance, 'memory');
  let used = 100 * MB;
  Object.defineProperty(performance, 'memory', {
    configurable: true,
    get: () => ({ usedJSHeapSize: used, totalJSHeapSize: 400 * MB, jsHeapSizeLimit: 4096 * MB })
  });
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => (fetched++, new Response('{}'));
  try {
    const sample = await readProcessStats(0);
    assert.equal(fetched, 0, 'a browser tab never asks for the command');
    assert.equal(sample.supported, false);
    assert.equal(sample.why, DESKTOP_ONLY);
    assert.equal(sample.browser.jsHeapUsedBytes, 100 * MB);
    assert.equal(sample.browser.pageMemoryBytes, null, 'not cross-origin isolated: no page total');
    assert.deepEqual(browserTable(sample), [{ label: 'JS heap', value: '100M of 400M, limit 4.00G' }]);
    assert.deepEqual(processTable(sample), []);

    const log = new ProcessStatsLog();
    for (const mb of [100, 200, 600]) {
      used = mb * MB;
      log.add(browserSample(1));
    }
    const s = log.summary();
    assert.equal(s.source, 'browser');
    assert.equal(s.samples, 3);
    assert.deepEqual(s.browser.jsHeapUsedBytes, { min: 100 * MB, avg: 300 * MB, max: 600 * MB });
    assert.equal(s.browser.pageMemoryBytes, null);
    assert.ok(s.note.startsWith(DESKTOP_ONLY));
    const lines = processStatsLines(s);
    assert.equal(
      lines[0],
      '  Processes (browser tab, 3 samples, min / avg / max): JavaScript heap used 100 MB / 300 MB / 600 MB; heap size 400 MB / 400 MB / 400 MB'
    );
    assert.ok(lines[1].includes(DESKTOP_ONLY));

    // the page total, where the browser allows measuring it
    globalThis.crossOriginIsolated = true;
    performance.measureUserAgentSpecificMemory = async () => ({ bytes: 900 * MB });
    assert.equal(browserSample(0).browser.pageMemoryBytes, null, 'asked for, not there yet');
    await new Promise(done => setTimeout(done, 0));
    const measured = browserSample(1);
    assert.equal(measured.browser.pageMemoryBytes, 900 * MB);
    assert.deepEqual(browserTable(measured)[1], { label: 'page', value: '900M' });
  } finally {
    delete globalThis.crossOriginIsolated;
    delete performance.measureUserAgentSpecificMemory;
    if (realMemory) Object.defineProperty(performance, 'memory', realMemory);
    else delete performance.memory;
    globalThis.fetch = realFetch;
  }
}

{
  // in the desktop app: the command is asked, with a stubbed answer; the bug report takes two a second apart
  globalThis.window = { __TAURI_INTERNALS__: {} };
  const urls = [];
  let step = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    urls.push([url, options?.cache]);
    return new Response(JSON.stringify(answer(step++)), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const waits = [];
    const s = await processSnapshot({ wait: async ms => waits.push(ms) });
    assert.deepEqual(urls, [
      ['api/process-stats', 'no-store'],
      ['api/process-stats', 'no-store']
    ]);
    assert.deepEqual(waits, [1000]);
    assert.equal(s.source, 'desktop');
    assert.deepEqual(s.total.cpuPercent, { min: 13, avg: 21, max: 29 });

    globalThis.fetch = async () => new Response('not found', { status: 404 });
    assert.deepEqual(await processSnapshot({ wait: async () => {} }), {
      source: 'none',
      samples: 0,
      note: 'api/process-stats answered 404'
    });
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.window;
  }
}

console.log('benchmark process figures: aggregation, table, report lines, sampler, browser and desktop sources OK');

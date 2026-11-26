// CPU, memory, GPU and I/O of the game's own processes for the benchmark and the bug report. The desktop app
// answers api/process-stats (the app itself and each WebView2 process); a browser tab can only see its own
// JavaScript heap and, when the page is cross-origin isolated, the page's memory total.
import { inApp } from './platform.js';

export const SAMPLE_MS = 1000;
const PAGE_MEMORY_EVERY = 15;
export const DESKTOP_ONLY = 'CPU, GPU, per-process memory and I/O need the desktop app';

export const PROCESS_METRICS = [
  'cpuPercent',
  'workingSetBytes',
  'privateBytes',
  'gpuPercent',
  'gpuDedicatedBytes',
  'gpuSharedBytes',
  'ioReadBytesPerSec',
  'ioWriteBytesPerSec',
  'ioOtherBytesPerSec'
];
export const BROWSER_METRICS = ['jsHeapUsedBytes', 'jsHeapTotalBytes', 'pageMemoryBytes'];
const PERCENT = /Percent$/;

class Range {
  constructor() {
    this.n = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }
  add(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    this.n++;
    this.sum += value;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;
  }
  figures(percent) {
    if (!this.n) return null;
    const round = v => (percent ? +v.toFixed(1) : Math.round(v));
    return { min: round(this.min), avg: round(this.sum / this.n), max: round(this.max) };
  }
}

const ranges = names => Object.fromEntries(names.map(name => [name, new Range()]));
const figures = held => Object.fromEntries(Object.entries(held).map(([name, range]) => [name, range.figures(PERCENT.test(name))]));

// every sample of one run: min, average and max of each figure, for the total and for each process
export class ProcessStatsLog {
  constructor() {
    this.reset();
  }

  reset() {
    this.samples = 0;
    this.total = ranges(PROCESS_METRICS);
    this.processes = new Map();
    this.most = 0;
    this.browserSamples = 0;
    this.browser = ranges(BROWSER_METRICS);
    this.logicalProcessors = null;
    this.gpuCounters = null;
    this.why = null;
  }

  add(sample) {
    if (!sample) return;
    if (sample.browser) {
      this.browserSamples++;
      for (const name of BROWSER_METRICS) this.browser[name].add(sample.browser[name]);
      if (sample.browser.why) this.why = sample.browser.why;
    }
    if (!sample.supported) {
      if (sample.why) this.why = sample.why;
      return;
    }
    this.samples++;
    this.logicalProcessors = sample.logicalProcessors ?? this.logicalProcessors;
    if (sample.gpuCounters) this.gpuCounters = { ...sample.gpuCounters };
    const list = sample.processes || [];
    this.most = Math.max(this.most, list.length);
    for (const name of PROCESS_METRICS) this.total[name].add(sample.total?.[name]);
    for (const row of list) {
      // a renderer that restarts gets a new pid: it is a new process in the record
      const key = `${row.type}#${row.pid}`;
      let held = this.processes.get(key);
      if (!held)
        this.processes.set(key, (held = { pid: row.pid, type: row.type, name: row.name, samples: 0, metrics: ranges(PROCESS_METRICS) }));
      held.samples++;
      for (const name of PROCESS_METRICS) held.metrics[name].add(row[name]);
    }
  }

  summary() {
    if (!this.samples) {
      if (!this.browserSamples) return this.why ? { source: 'none', samples: 0, note: this.why } : null;
      return {
        source: 'browser',
        samples: this.browserSamples,
        browser: figures(this.browser),
        note: this.why ? `${DESKTOP_ONLY}; ${this.why}` : DESKTOP_ONLY
      };
    }
    return {
      source: 'desktop',
      samples: this.samples,
      logicalProcessors: this.logicalProcessors,
      gpuCounters: this.gpuCounters,
      mostProcesses: this.most,
      total: figures(this.total),
      processes: [...this.processes.values()].map(held => ({
        type: held.type,
        pid: held.pid,
        name: held.name,
        samples: held.samples,
        ...figures(held.metrics)
      }))
    };
  }
}

export function bytesText(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return '-';
  const abs = Math.abs(bytes);
  if (abs >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (abs >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(abs >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  if (abs >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

// the same sizes in the overlay's narrow columns: 1.25G, 812M, 340k, 12
export function shortBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return '-';
  const abs = Math.abs(bytes);
  if (abs >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(abs >= 10 * 1024 ** 3 ? 1 : 2)}G`;
  if (abs >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(abs >= 10 * 1024 ** 2 ? 0 : 1)}M`;
  if (abs >= 1024) return `${Math.round(bytes / 1024)}k`;
  return String(Math.round(bytes));
}

const percentText = value => (value == null ? '-' : value >= 10 ? value.toFixed(0) : value.toFixed(1));
const SHORT_TYPES = { renderer: 'render', 'crash handler': 'crash' };
const shortType = type => SHORT_TYPES[type] || String(type || '?').replace(/^utility \((.*)\)$/, 'u:$1');

// the overlay's table: one row for each process, then the total
export function processTable(sample) {
  if (!sample?.supported) return [];
  const row = (label, from) => ({
    label,
    cpu: percentText(from.cpuPercent),
    memory: shortBytes(from.privateBytes),
    gpu: percentText(from.gpuPercent),
    gpuMemory: shortBytes(from.gpuDedicatedBytes),
    io: from.ioReadBytesPerSec == null ? '-' : `${shortBytes(from.ioReadBytesPerSec)}/${shortBytes(from.ioWriteBytesPerSec)}`
  });
  return [...(sample.processes || []).map(p => row(shortType(p.type), p)), row('total', sample.total || {})];
}

// what a browser tab shows instead
export function browserTable(sample) {
  const b = sample?.browser;
  if (!b) return [];
  const out = [];
  if (b.jsHeapUsedBytes != null)
    out.push({
      label: 'JS heap',
      value: `${shortBytes(b.jsHeapUsedBytes)} of ${shortBytes(b.jsHeapTotalBytes)}${b.jsHeapLimitBytes ? `, limit ${shortBytes(b.jsHeapLimitBytes)}` : ''}`
    });
  if (b.pageMemoryBytes != null) out.push({ label: 'page', value: shortBytes(b.pageMemoryBytes) });
  return out;
}

const spread = (range, text) => (range ? `${text(range.min)} / ${text(range.avg)} / ${text(range.max)}` : null);
const percentSpread = range => (range ? `${range.min} / ${range.avg} / ${range.max} %` : null);
const perSecond = bytes => `${bytesText(bytes)}/s`;

function figureLine(label, from) {
  const parts = [];
  const push = (name, text) => text && parts.push(`${name} ${text}`);
  push('CPU', percentSpread(from.cpuPercent));
  push('memory', spread(from.privateBytes, bytesText));
  push('working set', spread(from.workingSetBytes, bytesText));
  push('GPU', percentSpread(from.gpuPercent));
  push('GPU memory', spread(from.gpuDedicatedBytes, bytesText));
  push('shared GPU memory', spread(from.gpuSharedBytes, bytesText));
  push('read', spread(from.ioReadBytesPerSec, perSecond));
  push('written', spread(from.ioWriteBytesPerSec, perSecond));
  push('other I/O', spread(from.ioOtherBytesPerSec, perSecond));
  return `${label}: ${parts.join('; ') || 'no figures'}`;
}

// a run's summary (ProcessStatsLog.summary()) as lines of a report
export function processStatsLines(summary, indent = '  ', title = 'Processes') {
  if (!summary) return [];
  if (summary.source === 'none') return [`${indent}${title}: not measured (${summary.note})`];
  if (summary.source === 'browser') {
    const b = summary.browser || {};
    const parts = [];
    if (b.jsHeapUsedBytes) parts.push(`JavaScript heap used ${spread(b.jsHeapUsedBytes, bytesText)}`);
    if (b.jsHeapTotalBytes) parts.push(`heap size ${spread(b.jsHeapTotalBytes, bytesText)}`);
    if (b.pageMemoryBytes) parts.push(`page memory ${spread(b.pageMemoryBytes, bytesText)}`);
    return [
      `${indent}${title} (browser tab, ${summary.samples} samples, min / avg / max): ${parts.join('; ') || 'the browser gives no memory figures'}`,
      `${indent}  ${summary.note}`
    ];
  }
  const missing = [];
  if (summary.gpuCounters && !summary.gpuCounters.utilisation) missing.push('GPU use');
  if (summary.gpuCounters && !summary.gpuCounters.memory) missing.push('GPU memory');
  const lines = [
    `${indent}${title} (desktop app, ${summary.samples} samples, up to ${summary.mostProcesses} processes, CPU as a share of ${summary.logicalProcessors ?? '?'} logical processors, min / avg / max):`,
    `${indent}  ${figureLine('total', summary.total || {})}`,
    ...(summary.processes || []).map(p => `${indent}  ${figureLine(`${p.type} (pid ${p.pid}, ${p.samples} samples)`, p)}`)
  ];
  if (missing.length) lines.push(`${indent}  Windows gave no figures for: ${missing.join(', ')}`);
  return lines;
}

// one call may start it and later calls read its last answer: the measurement takes the browser a while
let pageMemory = null;
let pageMemoryBusy = false;
function measurePage() {
  if (pageMemoryBusy || typeof performance.measureUserAgentSpecificMemory !== 'function' || !globalThis.crossOriginIsolated) return;
  pageMemoryBusy = true;
  performance
    .measureUserAgentSpecificMemory()
    .then(result => (pageMemory = result?.bytes ?? null))
    .catch(() => {})
    .finally(() => (pageMemoryBusy = false));
}

export function browserSample(count = 0) {
  const heap = globalThis.performance?.memory;
  const canMeasure = typeof globalThis.performance?.measureUserAgentSpecificMemory === 'function' && !!globalThis.crossOriginIsolated;
  if (canMeasure && count % PAGE_MEMORY_EVERY === 0) measurePage();
  const why = [];
  if (!heap) why.push('this browser does not report its JavaScript heap');
  if (!canMeasure) why.push('the page memory total is not available here');
  return {
    supported: false,
    why: DESKTOP_ONLY,
    browser: {
      jsHeapUsedBytes: heap?.usedJSHeapSize ?? null,
      jsHeapTotalBytes: heap?.totalJSHeapSize ?? null,
      jsHeapLimitBytes: heap?.jsHeapSizeLimit ?? null,
      pageMemoryBytes: canMeasure ? pageMemory : null,
      why: why.join('; ') || null
    }
  };
}

async function appSample() {
  const response = await fetch('api/process-stats', { cache: 'no-store' });
  if (!response.ok) throw new Error(`api/process-stats answered ${response.status}`);
  return response.json();
}

export const readProcessStats = count => (inApp() ? appSample() : browserSample(count));

// asks about once a second while it runs; nothing happens per frame
export class ProcessStatsSampler {
  constructor({ read = readProcessStats, interval = SAMPLE_MS, onSample = null, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) } = {}) {
    Object.assign(this, { read, interval, onSample, setTimer, clearTimer });
    this.log = new ProcessStatsLog();
    this.latest = null;
    this.count = 0;
    this.failures = 0;
    this.running = false;
    this.timer = null;
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.timer = this.setTimer(() => this.step(), 0);
    return this;
  }

  stop() {
    this.running = false;
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
  }

  reset() {
    this.log.reset();
  }

  async step() {
    this.timer = null;
    let sample = null;
    try {
      sample = await this.read(this.count++);
      this.failures = 0;
    } catch (error) {
      // an older app has no such answer: stop asking after a few tries
      this.failures++;
      sample = { supported: false, why: String(error?.message || error) };
    }
    if (!this.running) return;
    this.latest = sample;
    this.log.add(sample);
    this.onSample?.(sample, this);
    if (this.failures >= 3) {
      this.running = false;
      return;
    }
    this.timer = this.setTimer(() => this.step(), this.interval);
  }

  summary() {
    return this.log.summary();
  }
}

// for the bug report: what the processes use right now, over about a second
export async function processSnapshot({
  read = readProcessStats,
  wait = ms => new Promise(done => setTimeout(done, ms)),
  samples = 2
} = {}) {
  const log = new ProcessStatsLog();
  try {
    for (let i = 0; i < samples; i++) {
      if (i) await wait(SAMPLE_MS);
      log.add(await read(i));
    }
  } catch (error) {
    if (!log.samples && !log.browserSamples) return { source: 'none', samples: 0, note: String(error?.message || error) };
  }
  return log.summary();
}

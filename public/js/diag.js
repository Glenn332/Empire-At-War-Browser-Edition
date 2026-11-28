import { inApp, appRequestBody } from './platform.js';

const RING = 240;
const KEEP = 200;

export class Diag {
  constructor() {
    this.stages = new Map();
    this.counts = new Map();
    this.hitches = [];
    this.recent = new Float32Array(RING);
    this.ri = 0;
    this.filled = 0;
    this.frameStart = 0;
    this.last = 0;
    this.t = 0;
    this.frames = 0;
    this.started = performance.now();
    this.info = null;
    this.prev = { programs: 0, textures: 0, geometries: 0, heap: 0 };
    this.longTasks = [];
    this.tasks = [];
    this.total = new Map();
    this.slow = { frames: 0, by: {} };
    this.context = () => ({});
    this.panel = null;
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) this.longTasks.push({ at: e.startTime, ms: e.duration });
      }).observe({ entryTypes: ['longtask'] });
    } catch {}
    this.loaf = [];
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          const top = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
          this.loaf.push({
            at: e.startTime,
            ms: Math.round(e.duration),
            layout: e.styleAndLayoutStart ? Math.round(e.startTime + e.duration - e.styleAndLayoutStart) : 0,
            forced: Math.round((e.scripts || []).reduce((a, x) => a + (x.forcedStyleAndLayoutDuration || 0), 0)),
            script: top
              ? `${(top.sourceURL || '').split('/').pop()}:${top.sourceFunctionName || top.invoker || ''} ${Math.round(top.duration)}ms`
              : ''
          });
          if (this.loaf.length > 60) this.loaf.shift();
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch {}
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('diag')) this.showPanel();
  }

  attach(renderer, context) {
    this.info = renderer.info;
    this.context = context;
    try {
      const gl = renderer.getContext(),
        ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext) this.gpu = { gl, ext, pending: [], active: null, byFrame: new Map() };
    } catch {}
  }

  gpuBegin() {
    const G = this.gpu;
    if (!G || G.active || G.pending.length > 8) return;
    G.active = G.gl.createQuery();
    G.gl.beginQuery(G.ext.TIME_ELAPSED_EXT, G.active);
  }

  gpuEnd() {
    const G = this.gpu;
    if (!G) return;
    const gl = G.gl;
    if (G.active) {
      gl.endQuery(G.ext.TIME_ELAPSED_EXT);
      G.pending.push({ q: G.active, frame: this.frames });
      G.active = null;
    }
    while (G.pending.length && gl.getQueryParameter(G.pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const p = G.pending.shift();
      const ms = gl.getParameter(G.ext.GPU_DISJOINT_EXT) ? -1 : gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(p.q);
      if (ms >= 0) {
        this.gpuTotal = (this.gpuTotal || 0) + ms;
        this.gpuFrames = (this.gpuFrames || 0) + 1;
        this.gpuWorst = Math.max(this.gpuWorst || 0, ms);
      }
      for (const h of this.hitches) if (h.frame === p.frame + 1 || h.frame === p.frame) h.gpuMs = Math.max(h.gpuMs || 0, +ms.toFixed(1));
    }
  }

  begin(now) {
    this.interval = this.frameStart ? now - this.frameStart : 0;
    this.frameStart = now;
    this.t = performance.now();
    this.stages.clear();
    this.counts.clear();
    this.gpuBegin();
  }

  lap(name) {
    const n = performance.now();
    this.stages.set(name, (this.stages.get(name) || 0) + n - this.t);
    this.t = n;
  }

  task(name, fn) {
    const t = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - t;
      if (this.info) {
        this.tasks.push({ at: t, name, ms: +ms.toFixed(1) });
        if (this.tasks.length > 400) this.tasks.shift();
      }
    }
  }

  note(name, n = 1) {
    this.counts.set(name, (this.counts.get(name) || 0) + n);
  }

  median() {
    const n = this.filled;
    if (n < 30) return n ? 16.7 : 0;
    const a = Array.from(this.recent.subarray(0, n)).sort((x, y) => x - y);
    return a[n >> 1];
  }

  frameStats() {
    const n = this.filled;
    if (!n) return { median: 0, p95: 0, p99: 0, worst: 0, low1: 0 };
    const a = Array.from(this.recent.subarray(0, n)).sort((x, y) => x - y),
      at = q => a[Math.min(n - 1, Math.floor((n - 1) * q))],
      p99 = at(0.99);
    return { median: at(0.5), p95: at(0.95), p99, worst: a[n - 1], low1: p99 > 0 ? 1000 / p99 : 0 };
  }

  end() {
    this.gpuEnd();
    const work = performance.now() - this.frameStart >= 0 ? [...this.stages.values()].reduce((a, b) => a + b, 0) : 0;
    const iv = this.interval;
    this.frames++;
    if (iv > 0) {
      const med = this.median();
      if (med && iv > med * 2.5 && iv - med > 12 && !document.hidden) this.record(iv, med, work);
      else if (med && iv > med * 1.6 && !document.hidden) {
        const top = [...this.stages].sort((a, b) => b[1] - a[1])[0];
        const key = work > med && top ? top[0] : 'outside the game';
        const b = this.slow.by[key] || (this.slow.by[key] = { frames: 0, ms: 0 });
        b.frames++;
        b.ms = +(b.ms + iv).toFixed(1);
        this.slow.frames++;
      }
      for (const [k, v] of this.stages) this.total.set(k, (this.total.get(k) || 0) + v);
      this.recent[this.ri] = iv;
      this.ri = (this.ri + 1) % RING;
      this.filled = Math.min(RING, this.filled + 1);
    }
    const i = this.info,
      p = this.prev;
    if (i) {
      p.programs = i.programs ? i.programs.length : 0;
      p.textures = i.memory.textures;
      p.geometries = i.memory.geometries;
    }
    if (performance.memory) p.heap = performance.memory.usedJSHeapSize;
  }

  record(iv, med, work) {
    const i = this.info,
      p = this.prev,
      now = performance.now();
    const made = {};
    if (i) {
      const d = (k, v) => {
        if (v > p[k]) made[k] = v - p[k];
      };
      d('programs', i.programs ? i.programs.length : 0);
      d('textures', i.memory.textures);
      d('geometries', i.memory.geometries);
    }
    let gc = 0;
    if (performance.memory && p.heap) {
      const drop = p.heap - performance.memory.usedJSHeapSize;
      if (drop > 2e6) gc = +(drop / 1e6).toFixed(1);
    }
    const tasks = this.longTasks.filter(t => t.at > now - iv - 50).map(t => Math.round(t.ms));
    this.longTasks.length = 0;
    const late = this.tasks.filter(t => t.at > now - iv - 30 && t.at < now);
    const lateMs = late.reduce((a, t) => a + t.ms, 0);
    const page = this.loaf.filter(l => l.at > now - iv - 60).sort((a, b) => b.ms - a.ms)[0] || null;
    const stages = Object.fromEntries([...this.stages].map(([k, v]) => [k, +v.toFixed(1)]));
    const slow = [...this.stages].sort((a, b) => b[1] - a[1])[0];
    const outside = +(iv - work).toFixed(1);
    let cause;
    if (made.programs) cause = 'shader compile (GPU driver building shader programs)';
    else if (made.textures || made.geometries || this.counts.get('model')) cause = 'new model / texture upload (GPU receiving new geometry or textures)';
    else if (gc) cause = `garbage collection (freed ${gc} MB)`;
    else if (slow && slow[1] > med * 1.5 && slow[1] > outside) cause = `stage: ${slow[0]} (${slow[1].toFixed(1)} ms)`;
    else if (lateMs > 4 && lateMs > iv * 0.3) cause = 'file loaded mid-battle (I/O or parsing)';
    else if (page && page.layout + page.forced > iv * 0.4) cause = 'page layout / paint (HUD DOM elements reflowing)';
    else if (outside > med * 2) cause = `browser compositor (${outside.toFixed(0)} ms blending canvases, WebKitGTK)`;
    else cause = `browser overhead (${outside.toFixed(0)} ms outside game code)`;
    const h = {
      frame: this.frames,
      at: +((now - this.started) / 1000).toFixed(1),
      ms: +iv.toFixed(1),
      usual: +med.toFixed(1),
      cause,
      stages,
      outside,
      made,
      gcMB: gc,
      longTasks: tasks,
      page,
      late: late.map(t => `${t.name} ${t.ms}ms`),
      counts: Object.fromEntries(this.counts),
      ...this.context()
    };
    this.hitches.push(h);
    if (this.hitches.length > KEEP) this.hitches.shift();
    if (this.panel) this.drawPanel();
  }

  report(quiet = false) {
    const by = {};
    for (const h of this.hitches) {
      const b = by[h.cause] || (by[h.cause] = { count: 0, worst: 0, total: 0 });
      b.count++;
      b.worst = Math.max(b.worst, h.ms);
      b.total += h.ms;
    }
    const secs = (performance.now() - this.started) / 1000;
    const average = Object.fromEntries([...this.total].map(([k, v]) => [k, +(v / this.frames).toFixed(2)]));
    const gpu = this.gpuFrames
      ? { averageMs: +(this.gpuTotal / this.gpuFrames).toFixed(2), worstMs: +this.gpuWorst.toFixed(1) }
      : 'not available in this browser';
    const lateLoads = this.tasks.map(t => ({ at: +((t.at - this.started) / 1000).toFixed(1), name: t.name, ms: t.ms }));

    // Last 30 seconds performance summary
    const now = performance.now();
    const recent = this.hitches.filter(h => now - (this.started + h.at * 1000) < 30000);
    const recentBy = {};
    for (const h of recent) {
      const key = h.cause.replace(/ \(.*\)/, ''); // Group by cause without details
      const b = recentBy[key] || (recentBy[key] = { count: 0, worst: 0, total: 0 });
      b.count++;
      b.worst = Math.max(b.worst, h.ms);
      b.total += h.ms;
    }

    // Calculate what dominated the last 30s
    const gpuMs = (this.stages.get('draw') || 0) + (this.stages.get('post') || 0) + (this.stages.get('shadows') || 0);
    const cpuMs = (this.stages.get('logic') || 0) + (this.stages.get('hud') || 0) + (this.stages.get('ai') || 0);
    const overlayMs = this.stages.get('overlay') || 0;
    const totalMs = this.median();
    const outsideMs = Math.max(0, totalMs - gpuMs - cpuMs - overlayMs);

    const last30s = {
      hitches: recent.length,
      byCause: recentBy,
      bottleneck: [
        ['GPU (3D render)', gpuMs],
        ['CPU (game logic)', cpuMs],
        ['Overlay (2D canvas)', overlayMs],
        ['Browser compositor', outsideMs]
      ].sort((a, b) => b[1] - a[1])[0],
      breakdown: {
        gpu: +gpuMs.toFixed(2),
        cpu: +cpuMs.toFixed(2),
        overlay: +overlayMs.toFixed(2),
        outside: +outsideMs.toFixed(2)
      }
    };

    const out = {
      gpu,
      warmUpMs: this.warmUpMs ?? null,
      lateLoads,
      seconds: +secs.toFixed(0),
      frames: this.frames,
      usualFrameMs: +this.median().toFixed(2),
      frameStats: Object.fromEntries(Object.entries(this.frameStats()).map(([key, value]) => [key, +value.toFixed(2)])),
      averageStageMs: average,
      missedRefreshes: this.slow,
      hitches: this.hitches.length,
      byCause: by,
      last30s,
      list: this.hitches
    };
    if (!quiet) {
      console.table(this.hitches.map(h => ({ at: h.at, ms: h.ms, usual: h.usual, cause: h.cause, outside: h.outside, ...h.stages })));
      console.table(by);
      console.log('Last 30s:', last30s);
    }
    return out;
  }

  async saveReport(extra = null) {
    const name = `eaw-performance_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      report = this.report(true),
      blob = new Blob([JSON.stringify(extra ? { ...extra, diagnostics: report } : report, null, 2)], { type: 'application/json' });
    if (inApp()) {
      try {
        const response = await fetch('api/save-report?name=' + encodeURIComponent(name), {
          method: 'POST',
          headers: { 'X-SWR': '1' },
          body: await appRequestBody(blob)
        });
        if (response.ok) {
          const result = await response.json();
          return { saved: true, where: result.path || null, name };
        }
      } catch {}
    }
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { saved: true, where: null, name };
  }

  showPanel() {
    if (this.panel) {
      this.panel.parentElement.hidden = false;
      return;
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;right:8px;top:120px;z-index:9999;max-width:440px;background:rgba(0,0,0,.72);color:#9fe;font:11px/1.35 Consolas,monospace';
    wrap.dataset.page = '';
    const save = document.createElement('button');
    save.textContent = 'Save report';
    save.title = 'Save frame timings, stage metrics and hitch details as JSON';
    save.style.cssText = 'margin:6px 8px 0;padding:3px 8px;background:#173b46;color:#cff;border:1px solid #578;cursor:pointer;font:11px Consolas,monospace;pointer-events:auto';
    save.onclick = async () => {
      save.disabled = true;
      try {
        const result = await this.saveReport();
        save.textContent = result.where ? 'Saved to app reports' : 'Report downloaded';
      } catch (error) {
        save.textContent = 'Save failed';
        console.error('[diagnostics]', error);
      } finally {
        setTimeout(() => {
          save.textContent = 'Save report';
          save.disabled = false;
        }, 2500);
      }
    };
    const d = document.createElement('pre');
    d.style.cssText = 'margin:0;padding:6px 8px;pointer-events:none;max-width:420px;white-space:pre-wrap;font:11px/1.35 Consolas,monospace';
    wrap.append(save, d);
    document.body.appendChild(wrap);
    this.panel = d;
    this.drawPanel();
    setInterval(() => this.drawPanel(), 1000);
  }

  drawPanel() {
    const stats = this.frameStats(),
      last = this.hitches.slice(-6),
      stages = [...this.stages].sort((a, b) => b[1] - a[1]).slice(0, 7),
      info = this.info?.render,
      context = this.context() || {};

    // Calculate what dominates the frame: GPU work (draw+post+shadows), CPU work (logic+hud+ai),
    // overlay (2D canvas), or outside (compositor/browser).
    const gpuMs = (this.stages.get('draw') || 0) + (this.stages.get('post') || 0) + (this.stages.get('shadows') || 0);
    const cpuMs = (this.stages.get('logic') || 0) + (this.stages.get('hud') || 0) + (this.stages.get('ai') || 0);
    const overlayMs = this.stages.get('overlay') || 0;
    const totalMs = stats.median;
    const outsideMs = Math.max(0, totalMs - gpuMs - cpuMs - overlayMs);

    // Find the dominant cost
    const costs = [
      ['GPU (3D render)', gpuMs],
      ['CPU (game logic)', cpuMs],
      ['Overlay (2D canvas)', overlayMs],
      ['Browser compositor', outsideMs]
    ].sort((a, b) => b[1] - a[1]);

    const dominant = costs[0];
    const pct = totalMs > 0 ? Math.round((dominant[1] / totalMs) * 100) : 0;

    // Analyze recent hitches (last 30s)
    const now = performance.now();
    const recent = this.hitches.filter(h => now - (this.started + h.at * 1000) < 30000);
    const hitchCauses = {};
    for (const h of recent) {
      const key = h.cause.replace(/ \(.*\)/, ''); // Remove parenthetical details
      hitchCauses[key] = (hitchCauses[key] || 0) + 1;
    }
    const topCauses = Object.entries(hitchCauses)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cause, count]) => `${cause} (${count}×)`)
      .join(', ');

    this.panel.textContent =
      `BOTTLENECK: ${dominant[0]} ${dominant[1].toFixed(1)} ms (${pct}% of frame)\n` +
      `\n` +
      `Breakdown (median ${totalMs.toFixed(1)} ms):\n` +
      costs.map(([name, ms]) => `  ${name.padEnd(22)} ${ms.toFixed(1)} ms`).join('\n') +
      `\n\n` +
      `Scene: ${info?.calls ?? '?'} draws, ${info?.triangles ? (info.triangles / 1000).toFixed(0) + 'k' : '?'} tris, ${context.units ?? '?'} units\n` +
      `\n` +
      `Recent hitches (30s): ${recent.length}\n` +
      (topCauses ? `  ${topCauses}\n` : '') +
      `\n` +
      last.map(h => {
        const ago = ((now - (this.started + h.at * 1000)) / 1000).toFixed(0);
        return `${ago}s ago: ${h.ms.toFixed(0)} ms — ${h.cause}`;
      }).join('\n');
  }
}

export const diag = new Diag();

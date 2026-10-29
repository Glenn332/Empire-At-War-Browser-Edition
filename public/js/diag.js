const RING = 240;
const KEEP = 200;

export class Diag {
  constructor() {
    this.stages = new Map();
    this.counts = new Map();
    this.hitches = [];
    this.recent = new Float32Array(RING); this.ri = 0; this.filled = 0;
    this.frameStart = 0; this.last = 0; this.t = 0;
    this.frames = 0; this.started = performance.now();
    this.info = null;
    this.prev = { programs: 0, textures: 0, geometries: 0, heap: 0 };
    this.longTasks = [];
    this.tasks = [];
    this.total = new Map();
    this.slow = { frames: 0, by: {} };
    this.context = () => ({});
    this.panel = null;
    try {
      new PerformanceObserver(list => { for (const e of list.getEntries()) this.longTasks.push({ at: e.startTime, ms: e.duration }); })
        .observe({ entryTypes: ['longtask'] });
    } catch { }
    this.loaf = [];
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          const top = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
          this.loaf.push({
            at: e.startTime, ms: Math.round(e.duration),
            layout: e.styleAndLayoutStart ? Math.round(e.startTime + e.duration - e.styleAndLayoutStart) : 0,
            forced: Math.round((e.scripts || []).reduce((a, x) => a + (x.forcedStyleAndLayoutDuration || 0), 0)),
            script: top ? `${(top.sourceURL || '').split('/').pop()}:${top.sourceFunctionName || top.invoker || ''} ${Math.round(top.duration)}ms` : '',
          });
          if (this.loaf.length > 60) this.loaf.shift();
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch { }
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('diag')) this.showPanel();
  }

  attach(renderer, context) {
    this.info = renderer.info; this.context = context;
    try {
      const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext) this.gpu = { gl, ext, pending: [], active: null, byFrame: new Map() };
    } catch { }
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
    if (G.active) { gl.endQuery(G.ext.TIME_ELAPSED_EXT); G.pending.push({ q: G.active, frame: this.frames }); G.active = null; }
    while (G.pending.length && gl.getQueryParameter(G.pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
      const p = G.pending.shift();
      const ms = gl.getParameter(G.ext.GPU_DISJOINT_EXT) ? -1 : gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(p.q);
      if (ms >= 0) { this.gpuTotal = (this.gpuTotal || 0) + ms; this.gpuFrames = (this.gpuFrames || 0) + 1; this.gpuWorst = Math.max(this.gpuWorst || 0, ms); }
      for (const h of this.hitches) if (h.frame === p.frame + 1 || h.frame === p.frame) h.gpuMs = Math.max(h.gpuMs || 0, +ms.toFixed(1));
    }
  }

  begin(now) {
    this.interval = this.frameStart ? now - this.frameStart : 0;
    this.frameStart = now; this.t = performance.now();
    this.stages.clear(); this.counts.clear();
    this.gpuBegin();
  }

  lap(name) {
    const n = performance.now();
    this.stages.set(name, (this.stages.get(name) || 0) + n - this.t);
    this.t = n;
  }

  task(name, fn) {
    const t = performance.now();
    try { return fn(); } finally {
      const ms = performance.now() - t;
      if (this.info) { this.tasks.push({ at: t, name, ms: +ms.toFixed(1) }); if (this.tasks.length > 400) this.tasks.shift(); }
    }
  }

  note(name, n = 1) { this.counts.set(name, (this.counts.get(name) || 0) + n); }

  median() {
    const n = this.filled;
    if (n < 30) return n ? 16.7 : 0;
    const a = Array.from(this.recent.subarray(0, n)).sort((x, y) => x - y);
    return a[n >> 1];
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
        b.frames++; b.ms = +(b.ms + iv).toFixed(1); this.slow.frames++;
      }
      for (const [k, v] of this.stages) this.total.set(k, (this.total.get(k) || 0) + v);
      this.recent[this.ri] = iv; this.ri = (this.ri + 1) % RING; this.filled = Math.min(RING, this.filled + 1);
    }
    const i = this.info, p = this.prev;
    if (i) { p.programs = i.programs ? i.programs.length : 0; p.textures = i.memory.textures; p.geometries = i.memory.geometries; }
    if (performance.memory) p.heap = performance.memory.usedJSHeapSize;
  }

  record(iv, med, work) {
    const i = this.info, p = this.prev, now = performance.now();
    const made = {};
    if (i) {
      const d = (k, v) => { if (v > p[k]) made[k] = v - p[k]; };
      d('programs', i.programs ? i.programs.length : 0); d('textures', i.memory.textures); d('geometries', i.memory.geometries);
    }
    let gc = 0;
    if (performance.memory && p.heap) { const drop = p.heap - performance.memory.usedJSHeapSize; if (drop > 2e6) gc = +(drop / 1e6).toFixed(1); }
    const tasks = this.longTasks.filter(t => t.at > now - iv - 50).map(t => Math.round(t.ms));
    this.longTasks.length = 0;
    const late = this.tasks.filter(t => t.at > now - iv - 30 && t.at < now);
    const lateMs = late.reduce((a, t) => a + t.ms, 0);
    const page = this.loaf.filter(l => l.at > now - iv - 60).sort((a, b) => b.ms - a.ms)[0] || null;
    const stages = Object.fromEntries([...this.stages].map(([k, v]) => [k, +v.toFixed(1)]));
    const slow = [...this.stages].sort((a, b) => b[1] - a[1])[0];
    const outside = +(iv - work).toFixed(1);
    let cause;
    if (made.programs) cause = 'shader compile';
    else if (made.textures || made.geometries || this.counts.get('model')) cause = 'new model / texture upload';
    else if (gc) cause = 'garbage collection';
    else if (slow && slow[1] > med * 1.5 && slow[1] > outside) cause = 'stage: ' + slow[0];
    else if (lateMs > 4 && lateMs > iv * 0.3) cause = 'file loaded mid-battle';
    else if (page && page.layout + page.forced > iv * 0.4) cause = 'page layout / paint (HUD elements)';
    else cause = 'outside the game (browser)';
    const h = {
      frame: this.frames, at: +((now - this.started) / 1000).toFixed(1), ms: +iv.toFixed(1), usual: +med.toFixed(1), cause, stages, outside,
      made, gcMB: gc, longTasks: tasks, page, late: late.map(t => `${t.name} ${t.ms}ms`), counts: Object.fromEntries(this.counts), ...this.context(),
    };
    this.hitches.push(h);
    if (this.hitches.length > KEEP) this.hitches.shift();
    if (this.panel) this.drawPanel();
  }

  report() {
    const by = {};
    for (const h of this.hitches) { const b = by[h.cause] || (by[h.cause] = { count: 0, worst: 0, total: 0 }); b.count++; b.worst = Math.max(b.worst, h.ms); b.total += h.ms; }
    const secs = (performance.now() - this.started) / 1000;
    const average = Object.fromEntries([...this.total].map(([k, v]) => [k, +(v / this.frames).toFixed(2)]));
    const gpu = this.gpuFrames ? { averageMs: +(this.gpuTotal / this.gpuFrames).toFixed(2), worstMs: +this.gpuWorst.toFixed(1) } : 'not available in this browser';
    const lateLoads = this.tasks.map(t => ({ at: +((t.at - this.started) / 1000).toFixed(1), name: t.name, ms: t.ms }));
    const out = { gpu, warmUpMs: this.warmUpMs ?? null, lateLoads, seconds: +secs.toFixed(0), frames: this.frames, usualFrameMs: +this.median().toFixed(2), averageStageMs: average,
      missedRefreshes: this.slow, hitches: this.hitches.length, byCause: by, list: this.hitches };
    console.table(this.hitches.map(h => ({ at: h.at, ms: h.ms, usual: h.usual, cause: h.cause, outside: h.outside, ...h.stages })));
    console.table(by);
    return out;
  }

  showPanel() {
    const d = document.createElement('pre');
    d.style.cssText = 'position:fixed;right:8px;top:120px;z-index:9999;margin:0;padding:6px 8px;background:rgba(0,0,0,.72);color:#9fe;font:11px/1.35 Consolas,monospace;pointer-events:none;max-width:420px;white-space:pre-wrap';
    d.dataset.page = '';
    document.body.appendChild(d);
    this.panel = d;
    setInterval(() => this.drawPanel(), 1000);
  }

  drawPanel() {
    const med = this.median(), last = this.hitches.slice(-8);
    this.panel.textContent = `frame ${med.toFixed(1)} ms (${med ? Math.round(1000 / med) : 0} fps)   hitches ${this.hitches.length}\n`
      + last.map(h => `${String(h.at).padStart(6)}s ${String(h.ms).padStart(6)} ms  ${h.cause}`).join('\n');
  }
}

export const diag = new Diag();

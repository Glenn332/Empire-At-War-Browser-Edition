const FT_FRAMES = 240;
const FT_TOP = 50;
const W = 236, H = 38;
const HIST_BUCKETS = 10000;
const FPS_POINTS = 240;

const clock = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : String(Math.round(n)));

export class BenchOverlay {
  constructor({ label, result, seconds, renderer, count, parent, net = null, shotsLabel = null, more = null }) {
    Object.assign(this, { label, head: result, seconds, count, net, shotsLabel, more, info: renderer.info, frames: [], start: performance.now(), shown: 0, done: false });
    this.open = !(seconds > 0 && Number.isFinite(seconds)); if (this.open) this.seconds = Infinity; this.resetRun();
    this.info.autoReset = false; this.info.reset();
    this.calls = 0; this.tris = 0; this.callFrames = 0; this.drawSum = 0; this.drawN = 0; this.peakShots = 0;
    this.fps = [];
    const box = this.box = document.createElement('div');
    box.id = 'bench';
    box.innerHTML = `<div class="bh"><b>BENCH</b><span>${label}</span><i data-k="t"></i></div>
      <div class="bp"><div data-k="bar"></div></div>
      <dl>
        <dt>FPS</dt><dd data-k="fps"></dd><dt>avg</dt><dd data-k="afps"></dd><dt>1% low</dt><dd data-k="low"></dd>
        <dt>ms</dt><dd data-k="ms"></dd><dt>avg</dt><dd data-k="ams"></dd><dt>worst</dt><dd data-k="worst"></dd>
        <dt>&gt;33</dt><dd data-k="o33"></dd><dt>&gt;50</dt><dd data-k="o50"></dd><dt>units</dt><dd data-k="units"></dd>
        <dt>${shotsLabel || 'shots'}</dt><dd data-k="shots"></dd><dt>draws</dt><dd data-k="draws"></dd><dt>tris</dt><dd data-k="tris"></dd>
      </dl>
      ${net ? `<div class="bh"><b>NET</b><span data-k="nrole"></span><i data-k="nnow"></i></div>
      <dl>
        <dt>tick</dt><dd data-k="ntps"></dd><dt>target</dt><dd data-k="ntarget"></dd><dt>turns</dt><dd data-k="nturns"></dd>
        <dt>ping</dt><dd data-k="nping"></dd><dt>behind</dt><dd data-k="nbehind"></dd><dt>cmd</dt><dd data-k="ndelay"></dd>
        <dt>stalls</dt><dd data-k="nstalls"></dd><dt>stall s</dt><dd data-k="nstallms"></dd><dt></dt><dd></dd>
      </dl>` : ''}
      <div class="bg"><span>frame ms</span><canvas data-k="ft"></canvas></div>
      <div class="bg"><span>fps / run</span><canvas data-k="fg"></canvas></div>`;
    this.el = Object.fromEntries([...box.querySelectorAll('[data-k]')].map(e => [e.dataset.k, e]));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const k of ['ft', 'fg']) {
      const c = this.el[k]; c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
      c.getContext('2d').scale(dpr, dpr);
    }
    if (this.open) box.querySelector('.bp').style.display = 'none';
    parent.appendChild(box);
  }

  restart() {
    this.start = performance.now(); this.shown = 0; this.frames.length = 0; this.fps.length = 0; this.resetRun();
    this.calls = this.tris = this.callFrames = this.drawSum = this.drawN = this.peakShots = 0;
  }

  resetRun() {
    this.run = this.open ? { n: 0, sum: 0, worst: 0, o33: 0, o50: 0, hist: new Uint32Array(HIST_BUCKETS), histSum: new Float64Array(HIST_BUCKETS) } : null;
    this.fpsEvery = 1; this.fpsPending = [];
  }

  dispose() {
    if (this.open && !this.done && this.result) { window.benchmarkResult = this.result; console.log('benchmark', JSON.stringify(this.result)); }
    this.done = true; this.info.autoReset = true; this.box.remove();
  }

  tick(ms, now) {
    if (this.done || !(ms > 0)) return;
    const r = this.info.render;
    this.calls += r.calls; this.tris += r.triangles; this.callFrames++;
    this.info.reset();
    this.frames.push(ms);
    if (this.open) {
      const s = this.run, b = Math.min(HIST_BUCKETS - 1, Math.floor(ms * 10));
      s.n++; s.sum += ms; s.hist[b]++; s.histSum[b] += ms; s.worst = Math.max(s.worst, ms); if (ms > 33.4) s.o33++; if (ms > 50) s.o50++;
      if (this.frames.length > 2 * FT_FRAMES) this.frames.splice(0, this.frames.length - FT_FRAMES);
    }
    const elapsed = (now - this.start) / 1000;
    if (now - this.shown < 500 && elapsed < this.seconds) return;
    this.shown = now;
    this.done = elapsed >= this.seconds;

    const f = this.frames, { n, avg, low, worst, o33, o50 } = this.open ? this.openFigures() : this.figures();
    const recent = f.slice(-30), cur = recent.reduce((a, v) => a + v, 0) / recent.length;
    const draws = this.calls / Math.max(1, this.callFrames), tris = this.tris / Math.max(1, this.callFrames);
    this.calls = this.tris = this.callFrames = 0;
    this.drawSum += draws; this.drawN++;
    const { units, shots } = this.count();
    if (typeof shots === 'number') this.peakShots = Math.max(this.peakShots, shots);
    this.pushFps(1000 / cur);

    const result = {
      ...this.head, seconds: Math.round(elapsed), frames: n, avgFps: +(1000 / avg).toFixed(1), low1Fps: +(1000 / low).toFixed(1),
      avgMs: +avg.toFixed(2), worstMs: +worst.toFixed(1), over33ms: o33, over50ms: o50,
      avgDrawCalls: Math.round(this.drawSum / this.drawN), ...(this.shotsLabel ? {} : { peakShots: this.peakShots }), ...this.more?.(),
    };
    this.result = result;
    const e = this.el;
    e.t.textContent = this.open ? clock(elapsed) : `${this.done ? 'done' : Math.floor(elapsed) + 's'} / ${this.seconds}s`;
    e.bar.style.width = Math.min(100, (elapsed / this.seconds) * 100) + '%';
    e.fps.textContent = (1000 / cur).toFixed(0);
    e.afps.textContent = result.avgFps;
    e.low.textContent = result.low1Fps;
    e.ms.textContent = cur.toFixed(1);
    e.ams.textContent = avg.toFixed(1);
    e.worst.textContent = result.worstMs;
    e.o33.textContent = result.over33ms;
    e.o50.textContent = result.over50ms;
    e.units.textContent = units;
    e.shots.textContent = typeof shots === 'number' ? fmt(shots) : shots;
    e.draws.textContent = fmt(draws);
    e.tris.textContent = fmt(tris);
    if (this.net) {
      const n = this.net();
      e.nrole.textContent = n.host ? 'host' : 'player';
      e.nnow.textContent = n.desync ? 'DESYNC' : n.now || '';
      e.ntps.textContent = n.tps.toFixed(1);
      e.ntarget.textContent = n.target ? n.target.toFixed(0) : 'paused';
      e.nturns.textContent = n.turns.toFixed(1);
      e.nping.textContent = n.ping === null ? '-' : Math.round(n.ping) + 'ms';
      e.nbehind.textContent = n.behind;
      e.ndelay.textContent = Math.round(n.delay) + 'ms';
      e.nstalls.textContent = n.stalls;
      e.nstallms.textContent = (n.stallMs / 1000).toFixed(1);
      Object.assign(result, { tickRate: +n.tps.toFixed(1), targetTickRate: +n.target.toFixed(1), pingMs: n.ping, stalls: n.stalls, stallSeconds: +(n.stallMs / 1000).toFixed(1), desync: n.desync });
    }
    this.box.classList.toggle('done', this.done);
    this.drawFrameTimes(avg);
    this.drawFps();
    if (this.done) {
      this.info.autoReset = true;
      window.benchmarkResult = result; console.log('benchmark', JSON.stringify(result));
    }
  }

  figures() {
    const f = this.frames, sorted = Float32Array.from(f).sort();
    const slow = sorted.subarray(Math.floor(sorted.length * 0.99));
    return { n: f.length, avg: f.reduce((a, v) => a + v, 0) / f.length, low: slow.reduce((a, v) => a + v, 0) / Math.max(1, slow.length), worst: sorted[sorted.length - 1],
      o33: f.filter(v => v > 33.4).length, o50: f.filter(v => v > 50).length };
  }

  openFigures() {
    const s = this.run, want = s.n - Math.floor(s.n * 0.99);
    let left = want, slow = 0;
    for (let b = HIST_BUCKETS - 1; b >= 0 && left > 0; b--) { const c = s.hist[b]; if (!c) continue; const take = Math.min(c, left); slow += s.histSum[b] * take / c; left -= take; }
    return { n: s.n, avg: s.sum / s.n, low: slow / Math.max(1, want), worst: s.worst, o33: s.o33, o50: s.o50 };
  }

  pushFps(v) {
    if (!this.open) { this.fps.push(v); return; }
    this.fpsPending.push(v); if (this.fpsPending.length < this.fpsEvery) return;
    this.fps.push(this.fpsPending.reduce((a, x) => a + x, 0) / this.fpsPending.length); this.fpsPending.length = 0;
    if (this.fps.length <= FPS_POINTS) return;
    const p = this.fps; this.fps = []; this.fpsEvery *= 2;
    for (let i = 0; i < p.length; i += 2) this.fps.push(i + 1 < p.length ? (p[i] + p[i + 1]) / 2 : p[i]);
  }

  drawFrameTimes(avg) {
    const g = this.el.ft.getContext('2d'), f = this.frames, n = Math.min(FT_FRAMES, f.length), bw = W / FT_FRAMES;
    const y = ms => H - Math.min(1, ms / FT_TOP) * H;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (const ms of [16.7, 33.3]) g.fillRect(0, Math.round(y(ms)), W, 1);
    for (let i = 0; i < n; i++) {
      const ms = f[f.length - n + i];
      g.fillStyle = ms > 50 ? '#ff5a4a' : ms > 33.4 ? '#ffb347' : '#9be564';
      const top = y(ms);
      g.fillRect(W - (n - i) * bw, top, Math.max(1, bw - 0.2), H - top);
    }
    g.fillStyle = '#d7e6f5';
    g.fillRect(0, Math.round(y(avg)), W, 1);
  }

  drawFps() {
    const g = this.el.fg.getContext('2d'), p = this.fps, slots = Math.max(2, this.open ? p.length : Math.ceil(this.seconds * 2)), dx = W / (slots - 1);
    const top = Math.max(60, ...p) * 1.1, y = v => H - (v / top) * (H - 2) - 1;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (const v of [30, 60]) g.fillRect(0, Math.round(y(v)), W, 1);
    g.beginPath();
    p.forEach((v, i) => (i ? g.lineTo(i * dx, y(v)) : g.moveTo(0, y(v))));
    g.strokeStyle = '#4fb3ff'; g.lineWidth = 1.5; g.stroke();
    g.lineTo((p.length - 1) * dx, H); g.lineTo(0, H); g.closePath();
    g.fillStyle = 'rgba(79,179,255,0.15)'; g.fill();
  }
}

import * as THREE from '../vendor/three/build/three.module.js';
import { luaTrace } from './lua.js';

const KEEP = 1000;
const KEEP_MAX = 100000;

export const KINDS = [
  ['decision', 'a goal chosen for a target (with its desire), or one that could not be begun', true],
  ['drop', 'a running goal stopped: not wanted any more, or outbid', true],
  ['proposals', 'each goal pass: the most wanted proposals (recorded only while shown: there are many)', false],
  ['plan', 'a plan script started or ended, and how it ended. This is the kind of line, not who gave it', true],
  ['attack', 'an attack order on a target (galactic: an invasion)', true],
  ['attackmove', 'a move that fights on the way', true],
  ['move', 'a move order (galactic: a fleet sent)', true],
  ['guard', 'a guard order', true],
  ['stop', 'a stop order', true],
  ['build', 'construction and production', true],
  ['reinforce', 'units called down from the reinforcements (galactic: troops landed)', true],
  ['ability', 'abilities, special weapons, bombing runs', true],
  ['retreat', 'a retreat asked for', true],
  ['spawn', 'units a script creates out of nothing (Spawn_Unit)', true],
  ['changes', 'what a script changes outright: a planet given to another owner, credits given or taken, tech locked or unlocked', true]
];
const SOURCES = ['plan', 'freestore', 'story'];
const SOURCE_LABEL = { plan: 'goal plans', freestore: 'free store', story: 'story scripts' };
const SOURCE_WORD = { goalplans: 'plan', freestore: 'freestore', story: 'story' };

const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const clock = t => {
  if (!Number.isFinite(t)) return '--:--.-';
  t = Math.round(t * 10) / 10;
  const m = Math.floor(t / 60),
    s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
};

let pending = [];
const ref = (t, o, s) => {
  if (o && pending.length < 200) pending.push({ t, o, s });
  return s;
};

export function nameOf(e) {
  if (!e) return '-';
  if (e.__planet) return nameOf(e.__planet);
  if (e.pos && e.production && e.name) return ref('planet', e, e.name);
  if (e.isPad) {
    const on = e.padChild && nameOf(e.padChild);
    return ref('unit', e, 'pad#' + e.id + (on && on[0] !== '?' ? '[' + on + ']' : ''));
  }
  const t = e.scriptType || e.type || (e.members && e.members[0] && e.members[0].type);
  const n = (t && t.name) || e.name || '?';
  return ref('unit', e, e.id !== undefined ? n + '#' + e.id : n);
}

const SHOW_IDS = 6;
export function group(list) {
  const by = new Map();
  for (const e of list || []) {
    const t = e && (e.scriptType || e.type || (e.members && e.members[0] && e.members[0].type)),
      n = (t && t.name) || '?',
      had = by.get(n);
    if (had) had.push(e);
    else by.set(n, [e]);
  }
  return (
    [...by]
      .map(([n, us]) => {
        const id = e => (e && e.id !== undefined ? ref('unit', e, '#' + e.id) : '');
        if (us.length === 1) return ref('unit', us[0], n + (us[0] && us[0].id !== undefined ? '#' + us[0].id : ''));
        const ids = us.slice(0, SHOW_IDS).map(id).filter(Boolean);
        return (
          us.length + 'x ' + ref('unit', us[0], n) + (ids.length ? ' (' + ids.join(', ') + (us.length > SHOW_IDS ? ', ...' : '') + ')' : '')
        );
      })
      .join(', ') || 'nothing'
  );
}

export function targetOf(v) {
  if (!v) return '-';
  if (v.type || v.isPad || v.members || v.__planet || v.production) return nameOf(v);
  if (Number.isFinite(v.x)) return ref('pos', { x: v.x, y: v.y }, '(' + Math.round(v.x) + ', ' + Math.round(v.y) + ')');
  return String(v.name || v.key || '?');
}

export function goalTarget(t) {
  if (!t) return 'global';
  if (t.planet) return ref('planet', t.planet, t.planet.name);
  if (t.unit) return nameOf(t.unit);
  const at = Number.isFinite(t.x) ? { x: t.x, y: t.y } : null;
  if (t.zone) return ref('pos', at, 'zone ' + t.zone.index);
  if (t.site) return ref('pos', at, 'build pad' + (t.type ? ' ' + t.type.name : ''));
  if (t.point) return ref('pos', at, 'reinforcement point');
  return ref('pos', at, t.type ? t.type.name : String(t.key ?? '?'));
}

export function who(c) {
  const p = c && (c.player || c);
  if (!p) return '?';
  const f = p.factionName || (p.faction && (p.faction.name || (typeof p.faction === 'string' ? p.faction : ''))) || '';
  const n = typeof p.name === 'string' && p.name !== f && p.name !== 'You' ? p.name : '';
  return ref('side', p, f && n ? f + '/' + n : f || n || String(p.id ?? '?'));
}

function camera(mode) {
  const g = globalThis.game;
  if (!g) return null;
  if (mode === 'G') return g.galaxy && g.view && g.zoomOut ? { v: g.view, g } : null;
  if (mode === 'L') return g.world && g.view && g.lookAt ? { v: g.view, g } : null;
  const rig = g.renderer && g.renderer.rig;
  return rig && g.world && !g.lookAt && !g.galaxy ? { v: rig, g, rig } : null;
}

function whereIs(r, mode, g) {
  const o = r.o;
  if (r.t === 'pos') return o;
  if (r.t === 'planet') return { x: o.pos[0], y: o.pos[1] };
  if (r.t === 'side') return baseOf(o, mode, g);
  if (mode === 'G') {
    const at = g.ai && g.ai.plans && g.ai.plans.where && g.ai.plans.where(o);
    if (!at || o.dead) return null;
    if (at.fleet && at.fleet.pos) return { x: at.fleet.pos[0], y: at.fleet.pos[1] };
    return at.planet ? { x: at.planet.pos[0], y: at.planet.pos[1] } : null;
  }
  if (o.dead || o.gone || (o.members && !o.members.length)) return null;
  return Number.isFinite(o.x) ? { x: o.x, y: o.y } : null;
}

function baseOf(p, mode, g) {
  if (mode === 'G') {
    const gp = g.galaxy.players.find(x => x === p || x.faction === p.faction),
      pl = gp && g.galaxy.planets[gp.home];
    const own = pl && pl.owner === gp.faction ? pl : g.galaxy.planets.find(x => gp && x.owner === gp.faction && !x.destroyed);
    return own ? { x: own.pos[0], y: own.pos[1] } : null;
  }
  if (mode === 'L') {
    const w = g.world,
      side = p.id,
      mine = w.units.filter(u => !u.dead && u.structure && u.side === side);
    const hq =
      mine.find(u => /command|hq|headquarter/i.test(u.type.name)) ||
      mine[0] ||
      w.points.find(x => x.reinforce && x.side === side) ||
      w.squads.find(q => q.side === side && q.members.length);
    return hq ? { x: hq.x, y: hq.y } : null;
  }
  const st = p.station;
  return st && !st.dead ? { x: st.x, y: st.y } : p.basePos ? { x: p.basePos.x, y: p.basePos.y } : null;
}

function multiplayer() {
  const g = globalThis.game;
  return !!(g && (g.net || (g.setup && g.setup.net)));
}

const revealed = new WeakSet();

function reveal(g, on) {
  if (!g) return;
  if (g.galaxy && g.zoomOut) {
    if (on && !g.galaxy.observer) {
      g.galaxy.observer = true;
      revealed.add(g.galaxy);
    } else if (!on && revealed.has(g.galaxy)) {
      revealed.delete(g.galaxy);
      if (!g.observer) g.galaxy.observer = false;
    }
    return;
  }
  if (g.lookAt) {
    if (!!g.reveal !== on) {
      g.reveal = on;
      g.hudTimer = 0;
    }
    return;
  }
  const w = g.world;
  if (w && w.reveal !== undefined && w.reveal !== on) {
    w.reveal = on;
    w.updateVisibility();
  }
}

let following = null;

function goTo(r, mode) {
  following = null;
  const c = camera(mode);
  if (!c) return 'that line is from another game';
  const at = whereIs(r, mode, c.g);
  if (!at) return 'no longer there';
  if (mode === 'G' && c.v.zoom > 0) c.g.zoomOut();
  const put = p => {
    c.v.x = p.x;
    c.v.y = p.y;
    if (c.rig) c.rig.clamp();
    return { x: c.v.x, y: c.v.y };
  };
  const last = put(at);
  if (r.t !== 'unit') return '';
  following = { r, mode, c, last };
  const step = () => {
    const f = following;
    if (!f || f.r !== r) return;
    if (Math.abs(f.c.v.x - f.last.x) > 2 || Math.abs(f.c.v.y - f.last.y) > 2 || camera(mode)?.v !== f.c.v) {
      following = null;
      return;
    }
    const p = whereIs(r, mode, f.c.g);
    if (!p) {
      following = null;
      return;
    }
    f.last = put(p);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return '';
}

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch {
    return {};
  }
}
function save(key, o) {
  try {
    localStorage.setItem(key, JSON.stringify(o));
  } catch {}
}
const session = {
  get(key) {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  },
  set(key, on) {
    try {
      sessionStorage.setItem(key, on ? '1' : '0');
    } catch {}
  }
};

class AIDebug {
  constructor(cfg) {
    this.cfg = cfg;
    this.kinds = cfg.kinds;
    const s = load(cfg.store);
    this.want = session.get(cfg.store + '.on') || cfg.url.test(globalThis.location ? location.search : '');
    this.on = this.want && !multiplayer();
    this.show = {};
    for (const [k, , d] of this.kinds) this.show[k] = s.show && k in s.show ? !!s.show[k] : d;
    this.sources = {};
    for (const k of SOURCES) this.sources[k] = s.sources && k in s.sources ? !!s.sources[k] : true;
    this.side = 'all';
    this.find = '';
    this.lines = [];
    this.sides = new Set();
    this.panel = null;
    this.dirty = false;
    this.paused = false;
    this.place = s.place || null;
    this.keep = Math.min(KEEP_MAX, Math.max(1, Math.round(+s.keep) || KEEP));
  }

  persist() {
    session.set(this.cfg.store + '.on', this.want);
    save(this.cfg.store, { show: this.show, sources: this.sources, place: this.place, keep: this.keep });
  }

  setKeep(n) {
    this.keep = Math.min(KEEP_MAX, Math.max(1, Math.round(+n) || KEEP));
    if (this.lines.length > this.keep) this.lines.splice(0, this.lines.length - this.keep);
    if (this.panel) this.panel.keep.value = this.keep;
    this.persist();
    this.touch();
    return this.keep;
  }

  log(kind, mode, t, side, text, src = '') {
    const refs = pending.length ? pending : null;
    pending = [];
    if (this.paused || (this.cfg.only.includes(kind) && this.show[kind] === false)) return;
    side = String(side || '?');
    if (!this.sides.has(side)) {
      this.sides.add(side);
      this.sidesChanged = true;
    }
    const W = this.cfg.width,
      col = side.length > W ? side.slice(0, W - 1) + '~' : pad(side, W);
    const s = '[' + clock(t).padStart(7) + '] ' + mode + ' ' + pad(kind, 10) + ' ' + col + ' ' + pad(src || '-', 9) + ' ' + text;
    this.lines.push({ kind, side, src, s, mode, refs });
    if (this.lines.length > this.keep) this.lines.splice(0, this.lines.length - this.keep);
    this.touch();
  }

  passes(l) {
    if (this.show[l.kind] === false) return false;
    if (l.src && this.sources[l.src] === false) return false;
    if (this.side !== 'all' && l.side !== this.side) return false;
    if (this.find && !l.s.toLowerCase().includes(this.find)) return false;
    return true;
  }

  text() {
    return this.lines
      .filter(l => this.passes(l))
      .map(l => l.s)
      .join('\n');
  }

  start() {
    if (multiplayer()) return false;
    this.want = true;
    this.persist();
    this.sync();
    this.show_(true);
    return true;
  }
  stop() {
    this.want = false;
    this.persist();
    this.sync();
  }

  sync() {
    const mp = multiplayer(),
      on = this.want && !mp;
    if (this.on !== on) {
      this.on = on;
      this.status();
    }
    if (mp && this.visible) this.show_(false);
    if (this.cfg.reveals) reveal(globalThis.game, on);
    if (this.cfg.onSync) this.cfg.onSync(on);
  }
  clear() {
    this.lines = [];
    this.sides.clear();
    this.sidesChanged = true;
    this.touch();
  }
  filter(kind, on) {
    const all = kind === 'all';
    for (const [k] of this.kinds) if (all || k === kind) this.show[k] = on;
    if (SOURCE_WORD[kind]) this.sources[SOURCE_WORD[kind]] = on;
    this.persist();
    this.syncChecks();
    this.touch();
  }
  only(kinds) {
    for (const [k] of this.kinds) this.show[k] = kinds.includes(k);
    this.persist();
    this.syncChecks();
    this.touch();
  }

  async copy() {
    const t = this.text();
    try {
      await navigator.clipboard.writeText(t);
      return t.split('\n').length;
    } catch {}
    const a = document.createElement('textarea');
    a.value = t;
    a.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(a);
    a.select();
    try {
      document.execCommand('copy');
    } finally {
      a.remove();
    }
    return t.split('\n').length;
  }

  touch() {
    if (!this.panel || this.panel.root.style.display === 'none' || this.dirty) return;
    this.dirty = true;
    setTimeout(() => {
      this.dirty = false;
      this.render();
    }, 250);
  }

  show_(on = true) {
    if (on && multiplayer()) return;
    if (on && !this.panel) this.build();
    if (!this.panel) return;
    this.panel.root.style.display = on ? 'flex' : 'none';
    if (on) {
      this.syncChecks();
      this.render();
      this.status();
    }
  }
  get visible() {
    return !!this.panel && this.panel.root.style.display !== 'none';
  }

  build() {
    style();
    const root = el('div', 'aid-panel');
    const head = el('div', 'aid-head', root);
    el('span', 'aid-title', head).textContent = this.cfg.title;
    const state = el('span', 'aid-state', head);
    const btn = (label, title, fn) => {
      const b = el('button', '', head);
      b.textContent = label;
      b.title = title;
      b.onclick = fn;
      return b;
    };
    const rec = btn('', 'Start or stop recording', () => {
      if (this.on) this.stop();
      else this.start();
    });
    const pause = btn('Pause', 'Stop taking new lines (keeps recording state)', () => {
      this.paused = !this.paused;
      pause.textContent = this.paused ? 'Resume' : 'Pause';
      this.status();
    });
    btn('Copy', 'Copy every line that passes the filters', async () => {
      const n = await this.copy();
      this.flash('copied ' + n + ' lines');
    });
    btn('Clear', 'Clear the log', () => this.clear());
    btn('×', 'Hide the panel (` then "' + this.cfg.cmd + ' show" brings it back)', () => this.show_(false));
    const kinds = el('div', 'aid-row', root),
      checks = new Map();
    const check = (row, k, title, get, set, label = k) => {
      const l = el('label', 'aid-chk', row),
        c = el('input', '', l);
      c.type = 'checkbox';
      c.checked = get();
      c.onchange = () => {
        set(c.checked);
        this.persist();
        this.touch();
      };
      l.append(label);
      l.title = title;
      checks.set(row === kinds ? k : 'from ' + k, { c, get });
    };
    el('span', 'aid-lbl', kinds).textContent = 'Lines:';
    for (const [k, help] of this.kinds)
      check(
        kinds,
        k,
        help,
        () => this.show[k] !== false,
        v => {
          this.show[k] = v;
        }
      );
    const all = el('button', 'aid-small', kinds);
    all.textContent = 'all';
    all.onclick = () => this.filter('all', true);
    const none = el('button', 'aid-small', kinds);
    none.textContent = 'none';
    none.onclick = () => this.filter('all', false);
    const row2 = el('div', 'aid-row', root);
    el('span', 'aid-lbl', row2).textContent = this.cfg.by;
    for (const k of SOURCES)
      check(
        row2,
        k,
        k === 'plan'
          ? 'the goal system and its plan scripts'
          : k === 'freestore'
            ? 'the free store: the units no plan holds'
            : 'story and map scripts',
        () => this.sources[k] !== false,
        v => {
          this.sources[k] = v;
        },
        SOURCE_LABEL[k]
      );
    const sel = el('select', '', row2);
    sel.onchange = () => {
      this.side = sel.value;
      this.touch();
    };
    const keepL = el('label', 'aid-chk', row2),
      keep = el('input', 'aid-keep', keepL);
    keepL.prepend('keep ');
    keepL.append(' lines');
    keepL.title = 'how many lines the log keeps; older ones are discarded';
    keep.type = 'number';
    keep.min = 1;
    keep.max = KEEP_MAX;
    keep.step = 100;
    keep.value = this.keep;
    keep.onchange = () => {
      keep.value = this.setKeep(keep.value);
    };
    const find = el('input', 'aid-find', row2);
    find.placeholder = 'search';
    find.oninput = () => {
      this.find = find.value.trim().toLowerCase();
      this.touch();
    };
    const body = el('pre', 'aid-body', root);
    const grip = el('div', 'aid-grip', root);
    body.addEventListener('pointerdown', () => {
      this.holding = true;
    });
    addEventListener(
      'pointerup',
      () => {
        this.holding = false;
      },
      true
    );
    body.addEventListener('click', e => {
      const a = e.target.closest('.aid-ref'),
        l = a && this.shown && this.shown[+a.dataset.l],
        r = l && l.refs && l.refs[+a.dataset.r];
      if (!r || String(getSelection()).length) return;
      const why = goTo(r, l.mode);
      if (why) this.flash(why);
    });
    root.dataset.page = '';
    document.body.appendChild(root);
    this.panel = { root, head, state, rec, body, sel, checks, keep };
    const p = this.place || this.cfg.at;
    if (p) Object.assign(root.style, { left: p.x + 'px', top: p.y + 'px', width: (p.w || 720) + 'px', height: (p.h || 340) + 'px' });
    this.keepOnScreen();
    drag(
      head,
      (dx, dy, s) => {
        root.style.left = s.x + dx + 'px';
        root.style.top = s.y + dy + 'px';
      },
      () => ({ x: root.offsetLeft, y: root.offsetTop }),
      () => this.remember()
    );
    drag(
      grip,
      (dx, dy, s) => {
        root.style.width = Math.max(360, s.w + dx) + 'px';
        root.style.height = Math.max(160, s.h + dy) + 'px';
      },
      () => ({ w: root.offsetWidth, h: root.offsetHeight }),
      () => this.remember()
    );
    for (const t of ['pointerdown', 'mousedown', 'wheel', 'contextmenu', 'click', 'dblclick'])
      root.addEventListener(t, e => e.stopPropagation());
    addEventListener('resize', () => this.keepOnScreen());
  }

  keepOnScreen() {
    const r = this.panel.root,
      x = Math.min(Math.max(0, r.offsetLeft), Math.max(0, innerWidth - 80)),
      y = Math.min(Math.max(0, r.offsetTop), Math.max(0, innerHeight - 30));
    r.style.left = x + 'px';
    r.style.top = y + 'px';
  }
  remember() {
    const r = this.panel.root;
    this.place = { x: r.offsetLeft, y: r.offsetTop, w: r.offsetWidth, h: r.offsetHeight };
    this.persist();
  }

  syncChecks() {
    if (this.panel) for (const { c, get } of this.panel.checks.values()) c.checked = get();
  }

  status() {
    if (!this.panel) return;
    const P = this.panel;
    P.rec.textContent = this.on ? 'Stop' : 'Record';
    P.state.textContent = this.on ? (this.paused ? 'paused' : '● recording') : 'off';
    P.state.className = 'aid-state' + (this.on && !this.paused ? ' aid-on' : '');
  }
  flash(msg) {
    if (!this.panel) return;
    const s = this.panel.state;
    s.textContent = msg;
    setTimeout(() => this.status(), 1500);
  }

  header() {
    const c = this.cfg,
      tip =
        'time: of the game, minutes:seconds. M: S space, L land, G conquest. kind: the kind of line (the boxes above). ' +
        c.who +
        ': ' +
        c.whoTip +
        ' ' +
        c.by.replace(':', '').toLowerCase() +
        ': ' +
        c.byTip +
        ' what: what happened.';
    return (
      '<span class="aid-colhead" title="' +
      esc(tip) +
      '">' +
      esc(
        pad('[time]', 9) + ' M ' + pad('kind', 10) + ' ' + pad(c.who, c.width) + ' ' + pad(c.by.replace(':', '').toLowerCase(), 9) + ' what'
      ) +
      '</span>'
    );
  }

  render() {
    const P = this.panel;
    if (!P || !this.visible) return;
    const sel = getSelection(),
      selecting = !!sel && !sel.isCollapsed && P.body.contains(sel.anchorNode);
    if (this.holding || selecting) {
      if (selecting && !this.held) {
        this.held = true;
        P.state.textContent = 'held while text is selected';
        P.state.className = 'aid-state';
      }
      this.touch();
      return;
    }
    if (this.held) {
      this.held = false;
      this.status();
    }
    if (this.sidesChanged) {
      this.sidesChanged = false;
      const keep = this.side;
      P.sel.textContent = '';
      for (const s of ['all', ...[...this.sides].sort()]) {
        const o = el('option', '', P.sel);
        o.value = s;
        o.textContent = s === 'all' ? 'every ' + this.cfg.who : s;
      }
      P.sel.value = this.sides.has(keep) || keep === 'all' ? keep : 'all';
      this.side = P.sel.value;
    }
    const b = P.body,
      atEnd = b.scrollHeight - b.scrollTop - b.clientHeight < 24;
    const lh = parseFloat(getComputedStyle(b).lineHeight) || 16,
      pad = parseFloat(getComputedStyle(b).paddingTop) || 0;
    const y = Math.max(0, b.scrollTop - pad),
      was = this.shown || [],
      top = atEnd ? null : was[Math.floor(y / lh)],
      within = y % lh;
    const out = [];
    for (let i = this.lines.length - 1; i >= 0; i--) if (this.passes(this.lines[i])) out.push(this.lines[i]);
    out.reverse();
    this.shown = out;
    if (out.length) b.innerHTML = this.header() + out.map((l, i) => linked(l, i)).join('\n');
    else
      b.textContent = this.on
        ? '(nothing yet that passes the filters)'
        : '(recording is off: press Record, or ` and type "' + this.cfg.cmd + ' on")';
    if (atEnd) b.scrollTop = b.scrollHeight;
    else if (top) {
      const i = out.indexOf(top);
      b.scrollTop = i >= 0 ? pad + i * lh + within : 0;
    }
  }
}

export const aidebug = new AIDebug({
  store: 'swr.aidebug',
  url: /[?&]aidebug\b/,
  title: 'AI diagnostics',
  cmd: 'debug',
  kinds: KINDS,
  only: ['proposals'],
  who: 'side',
  width: 16,
  by: 'Given by:',
  reveals: true,
  at: null,
  whoTip: 'the computer player it is about (click: its base).',
  byTip: 'what in the AI gave it: a goal plan, the free store or a story script.'
});

export const LUA_KINDS = [
  ['script', 'a script started (its file run) or let go', true],
  ['event', 'the game calling into a script: an event, a callback, a thread begun', true],
  ['action', 'a call into the game that does something, with its arguments and what came back', true],
  ['query', 'a call that only asks (Get_, Is_, Find_, Evaluate_...): recorded only while shown, there are many', false],
  [
    'library',
    "the bookkeeping of the game's Lua libraries (ThreadValue, GetEvent, a plan polling its Block, WeightedTypeList), recorded only while shown",
    false
  ],
  ['message', 'what a script writes for debugging (DebugMessage, _OuputDebug, _ScriptMessage...)', true],
  ['error', 'a Lua error: in a call into the game, or in the script itself', true]
];
export const luadebug = new AIDebug({
  store: 'swr.luadebug',
  url: /[?&]luadebug\b/,
  title: 'Lua scripts',
  cmd: 'luadebug',
  kinds: LUA_KINDS,
  only: ['query', 'library'],
  who: 'script',
  width: 28,
  by: 'Run by:',
  reveals: false,
  at: { x: 40, y: 420 },
  onSync: on => {
    luaTrace.on = on;
  },
  whoTip: 'the script that was running (cut to the column; the script list below the boxes has whole names).',
  byTip: "what kind of script it is: a goal plan, a free store, or a story or map script. A dash is the game's own (evaluators, libraries)."
});
luaTrace.on = luadebug.on;

const QUERY =
  /^(Get|Is|Has|Are|Can|Find|Evaluate|Test|Return|Should|Was|Check)_|^_?(Get|Is|Has|Are|Can|Was|Evaluate|Find)[A-Z]|^(tostring|type|StringCompare)$/;
const LIBRARY = /^(ThreadValue|GetEvent|Block|WeightedTypeList)$/;
const MESSAGE =
  /^(_OuputDebug|_ScriptMessage|_CustomScriptMessage|_MessagePopup|DebugMessage|ScriptMessage|ScriptError|MessageBox|DebugPrint|print)$/;

function luaVal(v, depth = 0) {
  if (v === undefined || v === null) return 'nil';
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 57) + '...' : v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'function') return 'function';
  if (v.__planet) return nameOf(v.__planet);
  if (v.__entity) return nameOf(v.__entity);
  if (v.__object && (v.__object.type || v.__object.record)) return nameOf(v.__object.record || v.__object);
  if (v.__force) return 'TaskForce ' + (v.__name || v.__force.name || '');
  if (v.__pos) return targetOf(v);
  if (v.__wrap || v.__name) return String(v.__name || 'userdata');
  if (v instanceof Object && v.ref !== undefined && v.vm) return 'function';
  if (Array.isArray(v))
    return depth > 1
      ? '{...}'
      : '{' +
          v
            .slice(0, 6)
            .map(x => luaVal(x, depth + 1))
            .join(', ') +
          (v.length > 6 ? ', ... ' + v.length : '') +
          '}';
  if (typeof v === 'object') {
    const ks = Object.keys(v);
    return depth > 1
      ? '{...}'
      : '{' +
          ks
            .slice(0, 5)
            .map(k => k + '=' + luaVal(v[k], depth + 1))
            .join(', ') +
          (ks.length > 5 ? ', ...' : '') +
          '}';
  }
  return String(v);
}

function luaWho(vm) {
  const h = vm.traceHost ? vm.traceHost() : null,
    i = h && h.inst;
  return {
    mode: h ? h.mode : '?',
    t: h ? h.t : NaN,
    name: i ? String(i.name || i.key || '?') : 'the game',
    src: !i ? '' : i.plan ? 'plan' : i.fs || i.freeStore ? 'freestore' : 'story'
  };
}
let luaLastMessage = null;
const luaLog = (vm, kind, text) => {
  const w = luaWho(vm);
  luadebug.log(kind, w.mode, w.t, w.name, text, w.src);
};

luaTrace.call = (vm, name, obj, args, result, error, waits) => {
  name = String(name || '?');
  if (MESSAGE.test(name)) {
    const text = args
        .map(a => (typeof a === 'string' ? a : luaVal(a)))
        .join(' ')
        .replace(/\s*\n\s*/g, ' ')
        .trim(),
      w = luaWho(vm),
      last = luaLastMessage;
    if (last && last.text === text && last.name === w.name && last.t === w.t) return;
    luaLastMessage = { text, name: w.name, t: w.t };
    luadebug.log('message', w.mode, w.t, w.name, text, w.src);
    return;
  }
  const kind = error
    ? 'error'
    : obj && LIBRARY.test(String(obj.__name))
      ? 'library'
      : QUERY.test(name) || (obj && obj.__name === 'FindTarget')
        ? 'query'
        : 'action';
  if ((kind === 'query' || kind === 'library') && luadebug.show[kind] === false) {
    pending = [];
    return;
  }
  const who = obj && obj.__name ? String(obj.__name) + ':' : '';
  luaLog(
    vm,
    kind,
    who +
      name +
      '(' +
      args.map(a => luaVal(a)).join(', ') +
      ')' +
      (error
        ? ' failed: ' + (error.message || error)
        : waits
          ? ' (answers when ready)'
          : result !== undefined
            ? ' -> ' + luaVal(result)
            : '')
  );
};
luaTrace.event = (vm, what, name, args) =>
  luaLog(vm, 'event', what + (name ? ' ' + name : '') + (args.length ? '(' + args.map(a => luaVal(a)).join(', ') + ')' : ''));
luaTrace.error = (vm, where, message) =>
  luaLog(
    vm,
    'error',
    'in ' +
      where +
      ': ' +
      String(message || '')
        .split('\n')
        .slice(0, 4)
        .join(' | ')
  );
luaTrace.script = (vm, what, name) => luaLog(vm, 'script', what + ' ' + name);

const esc = s => s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

function linked(l, li) {
  const s = l.s;
  if (!l.refs) return esc(s);
  const spans = [],
    order = l.refs.map((r, i) => i).sort((a, b) => l.refs[b].s.length - l.refs[a].s.length);
  for (const i of order) {
    const n = l.refs[i].s;
    if (!n || n === '-' || n === '?') continue;
    for (let at = s.indexOf(n); at >= 0; at = s.indexOf(n, at + 1)) {
      const end = at + n.length;
      if ((/\w/.test(n[n.length - 1]) && /\w/.test(s[end] || '')) || (/\w/.test(n[0]) && /\w/.test(s[at - 1] || ''))) continue;
      if (spans.some(([a, b]) => at < b && end > a)) continue;
      spans.push([at, end, i]);
      break;
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  let out = '',
    from = 0;
  for (const [a, b, i] of spans) {
    out +=
      esc(s.slice(from, a)) +
      '<span class="aid-ref aid-' +
      l.refs[i].t +
      '" data-l="' +
      li +
      '" data-r="' +
      i +
      '">' +
      esc(s.slice(a, b)) +
      '</span>';
    from = b;
  }
  return out + esc(s.slice(from));
}

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

function drag(handle, move, start, done) {
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button, input, select')) return;
    e.preventDefault();
    const x0 = e.clientX,
      y0 = e.clientY,
      s = start();
    const mv = ev => move(ev.clientX - x0, ev.clientY - y0, s);
    const up = () => {
      removeEventListener('pointermove', mv, true);
      removeEventListener('pointerup', up, true);
      done();
    };
    addEventListener('pointermove', mv, true);
    addEventListener('pointerup', up, true);
  });
}

let styled = false;
function style() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
    .aid-panel {
      position: fixed;
      left: 12px;
      top: 60px;
      width: 720px;
      height: 340px;
      z-index: 100000;
      display: flex;
      flex-direction: column;
      background: rgba(8, 12, 18, 0.92);
      color: #cfe3f2;
      border: 1px solid #3d5a73;
      font:
        12px/1.35 Consolas,
        Menlo,
        monospace;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
      user-select: text;
      pointer-events: auto;
    }
    .aid-head {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 6px;
      background: #16283a;
      cursor: move;
      user-select: none;
    }
    .aid-title {
      font-weight: bold;
      flex: 0 0 auto;
    }
    .aid-state {
      flex: 1;
      color: #8aa;
      padding-left: 6px;
    }
    .aid-state.aid-on {
      color: #f66;
    }
    .aid-panel button {
      font:
        11px Consolas,
        monospace;
      background: #22384d;
      color: #cfe3f2;
      border: 1px solid #47657f;
      padding: 1px 6px;
      cursor: pointer;
    }
    .aid-panel button:hover {
      background: #2f4d69;
    }
    .aid-row {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 8px;
      padding: 3px 6px;
      border-bottom: 1px solid #22384d;
      align-items: center;
      user-select: none;
    }
    .aid-lbl {
      color: #8aa;
    }
    .aid-chk {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      cursor: pointer;
    }
    .aid-chk input {
      margin: 0;
    }
    .aid-panel select,
    .aid-find {
      font:
        11px Consolas,
        monospace;
      background: #0d1822;
      color: #cfe3f2;
      border: 1px solid #47657f;
    }
    .aid-keep {
      width: 64px;
      font:
        11px Consolas,
        monospace;
      background: #0d1822;
      color: #cfe3f2;
      border: 1px solid #47657f;
    }
    .aid-find {
      flex: 1;
      min-width: 80px;
      user-select: text;
    }
    .aid-body {
      flex: 1;
      margin: 0;
      padding: 0 6px 4px;
      overflow: auto;
      white-space: pre;
      user-select: text;
      cursor: text;
    }
    .aid-colhead {
      display: block;
      position: sticky;
      top: 0;
      z-index: 1;
      margin: 0 -6px;
      padding: 0 6px;
      background: #16283a;
      color: #8fb3cf;
      box-shadow: 0 1px 0 #2f4d69;
      user-select: none;
      cursor: help;
    }
    .aid-ref {
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 2px;
    }
    .aid-ref:hover {
      color: #fff;
      background: #2f4d69;
    }
    .aid-unit {
      color: #9fd3ff;
    }
    .aid-side {
      color: #ffd37a;
    }
    .aid-pos,
    .aid-planet {
      color: #a8f0b0;
    }
    .pm-info {
      padding: 3px 6px;
      min-height: 16px;
      border-top: 1px solid #22384d;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pm-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 10px;
      padding: 3px 6px 5px;
      user-select: none;
    }
    .pm-legend i {
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-right: 4px;
      vertical-align: -1px;
      border: 1px solid #47657f;
    }
    .aid-grip {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, #47657f 50%);
    }
    .dcon {
      position: fixed;
      left: 0;
      right: 0;
      top: 0;
      height: 36vh;
      z-index: 100001;
      display: flex;
      flex-direction: column;
      background: rgba(4, 8, 12, 0.94);
      border-bottom: 1px solid #3d5a73;
      color: #cfe3f2;
      font:
        13px/1.4 Consolas,
        Menlo,
        monospace;
      user-select: text;
      pointer-events: auto;
    }
    .dcon-out {
      flex: 1;
      margin: 0;
      padding: 6px 10px;
      overflow: auto;
      white-space: pre-wrap;
    }
    .dcon-in {
      display: flex;
      align-items: center;
      padding: 4px 10px;
      border-top: 1px solid #22384d;
    }
    .dcon-in input {
      flex: 1;
      background: transparent;
      border: 0;
      outline: 0;
      color: #e8f4ff;
      font: inherit;
      margin-left: 6px;
    }
  `;
  document.head.appendChild(s);
}

const PM_CELL = 20;
const PM_KINDS = [
  ['building', 0xffffff],
  ['impassable', 0xff2020],
  ['obstacle', 0xff20ff],
  ['wall', 0x9040ff],
  ['steep', 0xff9020],
  ['water', 0x2080ff],
  ['infantry only', 0xffe020]
];
const PM_ROOMS = [
  ['building', 0xffffff],
  ['no room', 0xff2020]
];
const kindOf = (w, i) =>
  !w.open[i]
    ? 'building'
    : w.kind[i] & 256
      ? 'impassable'
      : w.kind[i] & 4
        ? 'obstacle'
        : w.kind[i] & 24
          ? 'wall'
          : w.kind[i] & 2
            ? 'steep'
            : w.kind[i] & 32
              ? 'water'
              : w.kind[i] & 128
                ? 'infantry only'
                : null;

function landBattle() {
  const g = globalThis.game;
  return g && g.lookAt && g.view && g.scene && g.terrain && g.world && g.world.rooms && g.world.kind ? g : null;
}

let pm = null;

function pmMode(g, words) {
  const w = g.world,
    a = (words[0] || 'ground').toLowerCase();
  if (a === 'ground') return { mode: 'ground', need: 0, label: 'ground kinds' };
  if (a === 'infantry') return { mode: 'room', need: 1, label: 'where infantry cannot go' };
  if (a === 'vehicle' || a === 'vehicles') return { mode: 'room', need: 2, label: 'where vehicles cannot go' };
  const M = w.tables && w.tables.moves,
    cls = [...(M ? M.keys() : [])].find(k => k.toLowerCase() === a);
  if (!cls) return null;
  const room = +words[1] === 1 || +words[1] === 2 ? +words[1] : /INFANTRY/.test(cls) ? 1 : 2;
  return {
    mode: 'room',
    need: w.needOf(cls, room),
    label: 'where ' + cls + (room === 1 ? ' (on foot)' : ' (vehicle width)') + ' cannot go'
  };
}

function passMap(words) {
  const g = landBattle();
  if ((words[0] || '').toLowerCase() === 'off') {
    closePassMap();
    return 'passability map off';
  }
  if (!g) return 'the passability map is for land battles';
  const m = pmMode(g, words);
  if (!m) {
    const M = g.world.tables && g.world.tables.moves;
    return (
      'passmap takes ground, infantry, vehicle, off, or a movement class: ' + [...(M ? M.keys() : [])].map(k => k.toLowerCase()).join(', ')
    );
  }
  if (pm && pm.g !== g) closePassMap();
  if (!pm) buildPassMap(g);
  Object.assign(pm, m);
  pm.title.textContent = 'Passability: ' + m.label;
  pm.legend.innerHTML =
    (m.mode === 'ground' ? PM_KINDS : PM_ROOMS)
      .map(([n, c]) => '<span><i style="background:#' + c.toString(16).padStart(6, '0') + '"></i>' + n + '</span>')
      .join('') + '<span>bare: open ground</span>';
  drawPassMap();
  return 'passability map: ' + m.label + ' ("passmap off" takes it away)';
}

function clearMarks() {
  for (const m of pm.marks) {
    m.removeFromParent();
    m.dispose();
    m.material.dispose();
  }
  pm.marks = [];
}

function closePassMap() {
  if (!pm) return;
  clearInterval(pm.timer);
  removeEventListener('mousemove', pm.onMove, true);
  clearMarks();
  pm.square.dispose();
  pm.root.remove();
  pm = null;
}

function buildPassMap(g) {
  style();
  const root = el('div', 'aid-panel pm-panel'),
    head = el('div', 'aid-head', root);
  const title = el('span', 'aid-title', head);
  el('span', 'aid-state', head);
  const x = el('button', '', head);
  x.textContent = '×';
  x.title = 'Take the map away';
  x.onclick = () => closePassMap();
  const info = el('div', 'pm-info', root),
    legend = el('div', 'pm-legend', root);
  info.textContent = 'move the mouse over the ground for what is there';
  root.style.cssText = 'left:' + Math.max(0, innerWidth - 420) + 'px;top:60px;width:400px;height:auto';
  root.dataset.page = '';
  document.body.appendChild(root);
  for (const t of ['pointerdown', 'mousedown', 'wheel', 'contextmenu', 'click', 'dblclick'])
    root.addEventListener(t, e => e.stopPropagation());
  drag(
    head,
    (dx, dy, s) => {
      root.style.left = s.x + dx + 'px';
      root.style.top = s.y + dy + 'px';
    },
    () => ({ x: root.offsetLeft, y: root.offsetTop }),
    () => {}
  );
  let last = 0;
  const onMove = e => {
    const now = performance.now();
    if (now - last < 100 || !pm || e.target.closest?.('.aid-panel, .dcon')) return;
    last = now;
    const g = landBattle(),
      p = g && g.groundAt && g.groundAt(e.clientX, e.clientY);
    if (!p) return;
    const w = g.world,
      n = w.n,
      ix = Math.round(p.x / PM_CELL),
      iy = Math.round(p.y / PM_CELL);
    if (ix < 0 || iy < 0 || ix >= n || iy >= n) return;
    const i = iy * n + ix,
      inf = w.rooms(1)[i],
      veh = w.rooms(2)[i];
    info.textContent =
      '(' +
      ix * PM_CELL +
      ', ' +
      iy * PM_CELL +
      ')  ' +
      (kindOf(w, i) || 'clear') +
      ', infantry ' +
      (inf >= 1 ? 'can' : 'cannot') +
      ' go, vehicles ' +
      (veh >= 2 ? 'can' : 'cannot') +
      (pm.mode === 'room' ? ', this class: ' + (w.rooms(pm.need)[i] >= (pm.need & 3) ? 'can' : 'cannot') : '');
  };
  addEventListener('mousemove', onMove, true);
  pm = {
    g,
    root,
    title,
    info,
    legend,
    onMove,
    marks: [],
    square: new THREE.PlaneGeometry(PM_CELL * 0.85, PM_CELL * 0.85),
    timer: setInterval(() => drawPassMap(), 500)
  };
}

function drawPassMap() {
  if (!pm) return;
  const g = landBattle();
  if (!g || g !== pm.g || multiplayer()) {
    closePassMap();
    return;
  }
  const w = g.world,
    n = w.n,
    key = pm.mode + '|' + pm.need + '|' + w.groundVer;
  if (pm.drawn === key) return;
  pm.drawn = key;
  const room = pm.mode === 'room' ? w.rooms(pm.need) : null,
    want = pm.need & 3,
    by = new Map();
  for (let i = 0; i < n * n; i++) {
    const k = room ? (room[i] >= want ? null : !w.open[i] ? 'building' : 'no room') : kindOf(w, i);
    if (!k) continue;
    let list = by.get(k);
    if (!list) by.set(k, (list = []));
    list.push(i);
  }
  clearMarks();
  const h = g.terrain.heights,
    at = new THREE.Matrix4(),
    colours = new Map(pm.mode === 'room' ? PM_ROOMS : PM_KINDS);
  for (const [k, list] of by) {
    const mesh = new THREE.InstancedMesh(
      pm.square,
      new THREE.MeshBasicMaterial({ color: colours.get(k), transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }),
      list.length
    );
    list.forEach((i, j) => mesh.setMatrixAt(j, at.makeTranslation((i % n) * PM_CELL, Math.floor(i / n) * PM_CELL, h[i] + 2)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 999;
    mesh.name = 'passability map';
    (w.scene || g.scene).add(mesh);
    pm.marks.push(mesh);
  }
}

const commands = new Map();
export function addCommand(name, args, help, run) {
  commands.set(name, { args, help, run });
}

const kindList = () => KINDS.map(([k]) => k).join(', ');

addCommand('help', '[command]', 'what the console takes; with a command, more about it', (a, print) => {
  if (a[0] && commands.has(a[0])) {
    const c = commands.get(a[0]);
    print(a[0] + ' ' + c.args + '\n  ' + c.help);
    return;
  }
  print('Commands (` opens and closes this console, Up/Down go through what was typed):');
  for (const [n, c] of commands) print('  ' + pad(n + ' ' + c.args, 34) + c.help);
});
addCommand(
  'debug',
  '[on|off|show|hide]',
  'AI diagnostics: start or stop recording AI decisions and orders (the fog of war is lifted while it records), show or hide the log panel. Alone: shows the state. Not in multiplayer',
  (a, print) => {
    const v = (a[0] || '').toLowerCase();
    if (multiplayer()) {
      print('AI diagnostics are not available in a multiplayer game');
      return;
    }
    if (v === 'on') aidebug.start();
    else if (v === 'off') aidebug.stop();
    else if (v === 'show') aidebug.show_(true);
    else if (v === 'hide') aidebug.show_(false);
    else if (v) {
      print('debug takes on, off, show or hide');
      return;
    }
    print(
      'AI diagnostics ' +
        (aidebug.on ? 'recording' : 'off') +
        ', ' +
        aidebug.lines.length +
        ' lines, panel ' +
        (aidebug.visible ? 'shown' : 'hidden')
    );
  }
);
addCommand(
  'luadebug',
  '[on|off|show|hide]',
  'Lua scripts: start or stop recording what the scripts do (calls into the game with their arguments and results, events, scripts started and ended, debug messages, errors), and show or hide its panel. Alone: shows the state. Not in multiplayer',
  (a, print) => {
    const v = (a[0] || '').toLowerCase();
    if (multiplayer()) {
      print('the Lua log is not available in a multiplayer game');
      return;
    }
    if (v === 'on') luadebug.start();
    else if (v === 'off') luadebug.stop();
    else if (v === 'show') luadebug.show_(true);
    else if (v === 'hide') luadebug.show_(false);
    else if (v) {
      print('luadebug takes on, off, show or hide');
      return;
    }
    print(
      'Lua log ' +
        (luadebug.on ? 'recording' : 'off') +
        ', ' +
        luadebug.lines.length +
        ' lines, panel ' +
        (luadebug.visible ? 'shown' : 'hidden')
    );
  }
);
addCommand(
  'passmap',
  '[ground|infantry|vehicle|<movement class>|off]',
  'land battles: marks on the battlefield where units cannot go: the kinds of ground, or where infantry, vehicles or one movement class have no room. Alone: the kinds of ground',
  (a, print) => {
    if (multiplayer()) {
      print('the passability map is not available in a multiplayer game');
      return;
    }
    print(passMap(a));
  }
);

function gameMode() {
  const g = globalThis.game;
  if (!g) return '';
  if (g.galaxy && g.zoomOut) return 'galactic';
  if (g.lookAt && g.world) return 'land';
  return g.renderer && g.renderer.rig && g.world ? 'space' : '';
}

function benchPage(mode, n) {
  const g = globalThis.game,
    q = new URLSearchParams(location.search),
    up = gameMode();
  for (const k of ['autostart', 'benchmark', 'mode', 'campaign', 'spacing', 'mptest', 'aidebug', 'luadebug']) q.delete(k);
  const map =
    up === mode && g.setup && g.setup.mapFile
      ? String(g.setup.mapFile)
          .split(/[\\/]/)
          .pop()
          .replace(/\.ted$/i, '')
      : '';
  if (map) q.set('map', map);
  else if (up !== mode) q.delete('map');
  if (mode === 'land') q.set('mode', 'land');
  q.set('benchmark', String(n));
  location.href = location.pathname + '?' + q.toString().replace(/=(?=&|$)/g, '');
}

let conquestRun = null;

addCommand(
  'benchmark',
  '[space|land|live|conquest] ...',
  'frame rate benchmarks. Alone: what each one does and how to run it',
  async (a, print) => {
    const what = (a[0] || '').toLowerCase(),
      up = gameMode();
    if (multiplayer()) {
      print('benchmarks are not available in a multiplayer game');
      return;
    }
    if (!what) {
      print('benchmark space [ships]   a space battle of that many ships a side (100, at most 400) meeting in the middle of the map,');
      print(
        '                          timed for a minute. Starts a new page (the game that is up ends), on the same map if you are in space.'
      );
      print(
        'benchmark land [companies]  the same on land: that many companies a side (30, at most 200), on the same map if you are on land.'
      );
      print(
        'benchmark live            the read-out over the game as it is, for as long as it is up (the same as F2). Again to take it away.'
      );
      print('benchmark conquest [seconds credits ships companies speed]');
      print(
        '                          conquest: every faction is handed to its AI with credits, ships and companies of its own, and the run'
      );
      print('                          is timed (120 seconds, 500000 credits, 20 ships, 8 companies, speed 1 when not given).');
      print('                          Start it only once the campaign has finished setting up: every story script and setup panel done');
      print("                          (a mod's era or faction pickers, the AI player types some mods hand out about twenty seconds in)");
      print(
        '                          and the galaxy in your control. Keep the page in view while it runs: a hidden page draws no frames.'
      );
      print('A finished run is printed here and kept in window.benchmarkResult.');
      return;
    }
    if (what === 'space' || what === 'land') {
      const max = what === 'space' ? 400 : 200,
        n = a[1] === undefined ? (what === 'space' ? 100 : 30) : Math.round(+a[1]);
      if (!(n >= 1 && n <= max)) {
        print('benchmark ' + what + ' takes a number from 1 to ' + max);
        return;
      }
      print(
        'starting the ' +
          what +
          ' benchmark: ' +
          n +
          (what === 'space' ? ' ships' : ' companies') +
          ' a side' +
          (up ? ' (the game that is up ends)' : '') +
          '...'
      );
      setTimeout(() => benchPage(what, n), 300);
      return;
    }
    if (what === 'live') {
      const g = globalThis.game;
      if (!up || !g.toggleBenchmark) {
        print('benchmark live is for a battle or the galaxy');
        return;
      }
      if (g.setup && g.setup.benchmark) {
        print('this is a benchmark run: it shows its own read-out');
        return;
      }
      g.toggleBenchmark();
      print('benchmark read-out toggled (F2 does the same)');
      return;
    }
    if (what === 'conquest') {
      const g = globalThis.game;
      if (up !== 'galactic' || !g.benchmark) {
        print('benchmark conquest is for the galaxy: start a conquest first');
        return;
      }
      if (conquestRun) {
        print('a conquest benchmark is already running');
        return;
      }
      const num = (i, d, lo, hi) => {
        const v = a[i] === undefined ? d : +a[i];
        return Number.isFinite(v) && v >= lo && v <= hi ? v : NaN;
      };
      const o = {
        seconds: num(1, 120, 5, 3600),
        credits: num(2, 500000, 0, 1e9),
        ships: num(3, 20, 0, 500),
        companies: num(4, 8, 0, 200),
        speed: num(5, 1, 0.1, 16)
      };
      const bad = Object.entries(o).find(([, v]) => Number.isNaN(v));
      if (bad) {
        print(
          'benchmark conquest: ' + bad[0] + ' is out of range (benchmark alone shows the order: seconds credits ships companies speed)'
        );
        return;
      }
      print(
        'conquest benchmark: ' +
          o.seconds +
          ' s at speed ' +
          o.speed +
          ', ' +
          o.credits +
          ' credits, ' +
          o.ships +
          ' ships and ' +
          o.companies +
          ' companies a faction.'
      );
      print(
        "Every faction now plays itself and you watch. Only run it once all the campaign's scripts are done and the galaxy is yours to play;"
      );
      print('keep the page in view until it ends. The result comes here.');
      try {
        conquestRun = g.benchmark(o);
        const r = await conquestRun;
        print('conquest benchmark done:');
        for (const [k, v] of Object.entries(r || globalThis.benchmarkResult || {}))
          if (v === null || typeof v !== 'object') print('  ' + pad(k, 22) + v);
      } finally {
        conquestRun = null;
      }
      return;
    }
    print('benchmark takes space, land, live or conquest (benchmark alone explains them)');
  }
);

addCommand('cls', '', 'clear this console', () => {
  if (con) con.out.textContent = '';
});
addCommand('close', '', 'close this console (or press `)', () => toggleConsole(false));

let con = null;
const history = [];
let hpos = 0;

function buildConsole() {
  style();
  const root = el('div', 'dcon'),
    out = el('pre', 'dcon-out', root),
    line = el('div', 'dcon-in', root);
  el('span', '', line).textContent = '>';
  const input = el('input', '', line);
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.addEventListener('input', () => {
    if (input.value.includes('`')) input.value = input.value.replace(/`/g, '');
  });
  for (const t of ['pointerdown', 'mousedown', 'wheel', 'contextmenu', 'click', 'dblclick'])
    root.addEventListener(t, e => e.stopPropagation());
  root.style.display = 'none';
  root.dataset.page = '';
  document.body.appendChild(root);
  con = { root, out, input };
  print('Developer console. Type "help" for the commands.');
}

function print(s) {
  if (!con) return;
  con.out.textContent += s + '\n';
  if (con.out.textContent.length > 200000) con.out.textContent = con.out.textContent.slice(-150000);
  con.out.scrollTop = con.out.scrollHeight;
}

async function run(text) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  print('> ' + text);
  const c = commands.get(parts[0].toLowerCase());
  if (!c) {
    print('unknown command "' + parts[0] + '", "help" lists them');
    return;
  }
  try {
    await c.run(parts.slice(1), print);
  } catch (e) {
    print('error: ' + ((e && e.message) || e));
  }
}

export function toggleConsole(on) {
  if (!con) buildConsole();
  const open = on ?? con.root.style.display === 'none';
  con.root.style.display = open ? 'flex' : 'none';
  if (open) {
    try {
      if (document.pointerLockElement) document.exitPointerLock();
    } catch {}
    con.input.focus();
  } else con.input.blur();
}

if (globalThis.addEventListener && globalThis.document)
  addEventListener(
    'keydown',
    e => {
      const t = e.target,
        mine = t && t.closest && t.closest('.dcon, .aid-panel');
      if ((e.code === 'Backquote' || e.key === '`') && !e.ctrlKey && !e.altKey && !e.metaKey && (!mine || (con && t === con.input))) {
        if (t && t.matches && t.matches('input, textarea, [contenteditable]') && !mine) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleConsole();
        return;
      }
      if (!mine || !t.matches('input, select')) return;
      e.stopImmediatePropagation();
      if (!con || t !== con.input) return;
      if (e.key === 'Enter') {
        const v = con.input.value;
        con.input.value = '';
        if (v.trim()) {
          history.push(v);
          hpos = history.length;
        }
        run(v);
      } else if (e.key === 'Escape') toggleConsole(false);
      else if (e.key === 'ArrowUp') {
        if (hpos > 0) con.input.value = history[--hpos];
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        hpos = Math.min(history.length, hpos + 1);
        con.input.value = history[hpos] || '';
        e.preventDefault();
      }
    },
    true
  );
if (globalThis.addEventListener)
  addEventListener(
    'keyup',
    e => {
      const t = e.target;
      if (t && t.closest && t.closest('.dcon, .aid-panel') && t.matches('input, select')) e.stopImmediatePropagation();
    },
    true
  );

globalThis.aidebug = aidebug;
globalThis.luadebug = luadebug;
aidebug.console = toggleConsole;
aidebug.help = () =>
  console.log(
    'aidebug.start() / .stop()  record AI decisions and orders\naidebug.show_(true|false) the log panel\naidebug.filter(kind|"all", on)  kinds: ' +
      kindList() +
      '\naidebug.only([kinds])\naidebug.text()  every line that passes the filters\naidebug.copy()\naidebug.clear()\n` in the game opens the console'
  );
if (globalThis.document && globalThis.setInterval)
  setInterval(() => {
    aidebug.sync();
    luadebug.sync();
  }, 1000);
for (const d of [aidebug, luadebug])
  if (d.on && globalThis.document) {
    const up = () => d.show_(true);
    if (document.body) up();
    else addEventListener('DOMContentLoaded', up);
  }

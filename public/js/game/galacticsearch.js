import { db } from '../gamedata.js';
import { fontFamily } from '../fonts.js';
import { logState } from './galacticlogdata.js';
import { cycleNumber } from './galacticeconomy.js';
import { linkPlanets } from './planetlinks.js';
import * as THREE from 'three';
import { connectionOwner } from './galacticfog.js';
import { relation } from './galacticrelation.js';
import { capturePlanet } from './planetinfo.js';
import { portraitBounds } from './planetportrait.js';
import { FleetWatch } from './galacticwitness.js';
import { skinImage } from './dialogs.js';

// The planet finder: a panel of the galactic HUD, turned on in Tweaks, with a planet list and search box over the
// recent events the local player could see. It is a view for the local player only: nothing here is part of the
// simulated state, so it never goes through the lockstep. Selection and camera use the same per-player view path
// as clicking a planet. Where it sits, its size and what it lists are kept in the browser.

export const LOCATION_LIMIT = 200;
const REPEAT_SECONDS = 5;

const fold = s =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export const planetLabel = (game, p) => game.planetViews?.[p.index]?.name || db.t(p.type?.str('Text_ID')) || p.name || '';

// planets whose displayed name contains the text, names that start with it first, then alphabetical; an empty
// box lists every planet alphabetically
export function searchPlanets(game, query, limit = Infinity) {
  const q = fold(query);
  const out = [];
  for (const p of game.galaxy?.planets || []) {
    if (p.background || game.planetViews?.[p.index]?.show === false) continue;
    const name = planetLabel(game, p),
      at = q ? fold(name).indexOf(q) : 0;
    if (at >= 0) out.push({ index: p.index, name, rank: at === 0 ? 0 : 1 });
  }
  out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}

// Small pictures of the planets as they look on the map, rendered from their galactic models with the same
// portrait capture the planet info screen uses. One planet is rendered at a time and each picture is kept for the
// session; a planet whose model changes (destroyed, say) gets a new picture.
const THUMB = 64,
  thumbs = new Map();
let queue = Promise.resolve();

function planetThumb(game, p) {
  const source = game.planetViews?.[p.index]?.inst;
  if (!source || !game.renderer) return null;
  const kept = thumbs.get(p.index);
  if (kept?.model === source.model) return kept.job;
  const run = async () => {
    const size = portraitBounds(source).getSize(new THREE.Vector3()),
      fov = 30,
      distance = (size.length() / 4 / Math.tan((fov * Math.PI) / 360)) * 1.05,
      // mostly from above and off the sun's side, so the small picture is lit with some shading but no glare
      eye = new THREE.Vector3(0.2, 0.4, 0.9).normalize().multiplyScalar(distance).toArray(),
      view = { size: THUMB, eye, fov, ambient: [0.15, 0.15, 0.18], rgb: [3, 14, 26] };
    // A model's first renders can come out as a flat untextured disc while its textures are still on their way to
    // the GPU, so a flat picture is taken again a moment later.
    let url = null;
    for (let tries = 0; tries < 6; tries++) {
      url = await capturePlanet(game, p, view);
      if (!url || (await detailed(url))) break;
      await new Promise(done => setTimeout(done, 100));
    }
    return url;
  };
  const job = (queue = queue.then(run, run)).catch(() => null);
  thumbs.set(p.index, { model: source.model, job });
  return job;
}

// whether the middle of a picture has any texture or shading at all
async function detailed(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const n = 16,
    cv = Object.assign(document.createElement('canvas'), { width: n, height: n }),
    ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, img.width / 4, img.height / 4, img.width / 2, img.height / 2, 0, 0, n, n);
  const d = ctx.getImageData(0, 0, n, n).data;
  let sum = 0,
    sq = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] + d[i + 1] + d[i + 2];
    sum += l;
    sq += l * l;
  }
  const count = d.length / 4;
  return Math.sqrt(Math.max(0, sq / count - (sum / count) ** 2)) > 6;
}

// a planet picture ringed in the colour of the side the local player last saw holding it, the same owner the
// hyperspace lanes use; the ring is grey when that is not known
export function planetIcon(game, index) {
  const p = game.galaxy?.planets?.[index],
    el = document.createElement('span');
  el.className = 'gs-icon';
  el.setAttribute('aria-hidden', 'true');
  if (!p) return el;
  const owner = connectionOwner(game.galaxy, p),
    rgb = owner && db.faction(owner) ? game.factionColor(owner) : null;
  el.style.borderColor = rgb ? `rgb(${rgb.map(c => Math.round(c * 255)).join(',')})` : 'rgba(100,100,100,.6)';
  el.dataset.planet = String(index);
  pictureWhenSeen(game, el);
  return el;
}

// pictures are only rendered for rows scrolled into view, so a long list costs nothing until it is looked at
let seen = null,
  seenGame = null;
function pictureWhenSeen(game, el) {
  if (typeof IntersectionObserver === 'undefined') return paint(game, el);
  seenGame = game;
  seen ||= new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      paint(seenGame, e.target);
    }
  });
  seen.observe(el);
}

function paint(game, el) {
  const p = game.galaxy?.planets?.[Number(el.dataset.planet)];
  planetThumb(game, p)?.then(url => {
    if (url) el.style.backgroundImage = `url("${url}")`;
  });
}

export function locationEntries(galaxy) {
  return (galaxy?.log && logState(galaxy).locations) || [];
}

// kind: what sort of event it is, for the panel's event filters (entries from before kinds existed have none)
export function recordLocation(galaxy, planet, text, kind) {
  if (!galaxy || !Number.isInteger(planet) || !galaxy.planets?.[planet] || !text) return null;
  const list = (logState(galaxy).locations ||= []),
    entry = { time: Math.round(galaxy.time || 0), cycle: cycleNumber(galaxy), planet, text: String(text) };
  if (kind) entry.kind = kind;
  // the same news about the same planet a moment later (two sources saw it) is kept once
  for (let i = list.length - 1; i >= 0 && entry.time - list[i].time <= REPEAT_SECONDS; i--)
    if (list[i].planet === planet && list[i].text === entry.text) return null;
  list.push(entry);
  if (list.length > LOCATION_LIMIT) list.splice(0, list.length - LOCATION_LIMIT);
  return entry;
}

export function clock(seconds) {
  const s = Math.max(0, Math.trunc(seconds || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// newest first; show(entry) picks which entries are listed
export function locationRows(game, limit = 60, show = () => true) {
  return locationEntries(game.galaxy)
    .filter(show)
    .slice(-limit)
    .reverse()
    .map(e => ({
      planet: e.planet,
      name: planetLabel(game, game.galaxy.planets[e.planet]),
      time: clock(e.time),
      cycle: e.cycle,
      text: e.text,
      kind: e.kind
    }));
}

export const PLANET_KINDS = [
  ['own', 'Own and allied'],
  ['enemy', 'Enemy'],
  ['neutral', 'Neutral'],
  ['unknown', 'Unknown owner']
];
export const EVENT_KINDS = [
  ['capture', 'Planets changing hands'],
  ['approach', 'Enemy fleets heading for your planets'],
  ['fleet', 'Other fleets arriving and leaving'],
  ['battle', 'Battle results'],
  ['production', 'Your production']
];

const same = (a, b) => String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();

// which planet filter a planet falls under, from the owner the local player last saw there
export function planetKind(game, p) {
  const viewer = game.localFaction ?? game.me;
  if (same(p.owner, viewer)) return 'own';
  const owner = connectionOwner(game.galaxy, p),
    faction = owner && db.faction(owner);
  if (!faction) return 'unknown';
  if (same(owner, viewer) || relation(owner, viewer) === 0) return 'own';
  if (faction.bool('Is_Neutral')) return 'neutral';
  return 'enemy';
}

const PREFS_KEY = 'swr-planet-finder-panel';
export function defaultPrefs() {
  return {
    rect: null,
    planets: Object.fromEntries(PLANET_KINDS.map(([k]) => [k, true])),
    events: Object.fromEntries(EVENT_KINDS.map(([k]) => [k, true])),
    pause: false
  };
}
function loadPrefs() {
  const prefs = defaultPrefs();
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved) {
      Object.assign(prefs.planets, saved.planets);
      Object.assign(prefs.events, saved.events);
      prefs.pause = !!saved.pause;
      if (saved.rect && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(saved.rect[k]))) prefs.rect = saved.rect;
    }
  } catch {}
  return prefs;
}

// an event with no kind (from an older save) is always listed
export const eventShown = (prefs, e) => !e.kind || prefs.events[e.kind] !== false;

const CSS = `
#galactic-search{position:fixed;z-index:40;display:flex;flex-direction:column;min-width:220px;min-height:180px;resize:both;overflow:hidden;padding:0 6px 6px;background:rgba(3,14,26,.9);border:1px solid #3b7ea6;box-shadow:0 4px 18px rgba(0,0,0,.7);font:14px/1.3 var(--gs-font);color:#bfe4ff;text-shadow:1px 1px 0 #000}
#galactic-search[hidden]{display:none}
#galactic-search *{box-sizing:border-box}
#galactic-search .gs-title{display:flex;align-items:center;gap:6px;margin:0 -6px 6px;padding:3px 4px 3px 8px;background:rgba(30,90,130,.55);border-bottom:1px solid #3b7ea6;cursor:move;user-select:none;touch-action:none;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
#galactic-search .gs-title span{flex:1}
#galactic-search .gs-cog{background:none;border:0;color:#bfe4ff;font:16px/1 Arial,sans-serif;padding:0 4px;cursor:pointer;text-shadow:1px 1px 0 #000}
#galactic-search .gs-cog:hover,#galactic-search .gs-cog[aria-expanded=true]{color:#fff}
#galactic-search .gs-bar{display:flex;gap:4px}
#galactic-search input[type=search]{flex:1;min-width:0;background:rgba(3,14,26,.85);color:#e6f6ff;border:1px solid #3b7ea6;padding:3px 6px;font:inherit;outline:none}
#galactic-search input[type=search]:focus{border-color:#7fd0ff}
#galactic-search ul{list-style:none;margin:4px 0 0;padding:0;background:rgba(3,14,26,.92);border:1px solid #3b7ea6;overflow:auto;flex:1 1 0;min-height:40px}
#galactic-search .gs-head{margin:8px 0 0;color:#7fa6bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
#galactic-search li{padding:3px 6px;cursor:pointer;display:block}
#galactic-search li.gs-empty{cursor:default;color:#7fa6bf}
#galactic-search .gs-icon{display:inline-block;width:26px;height:26px;margin-right:8px;vertical-align:middle;border:2px solid;border-radius:50%;background:#030e1a center/cover no-repeat;box-shadow:0 0 0 1px #000}
#galactic-search li:hover,#galactic-search li[aria-selected=true]{background:rgba(30,90,130,.9)}
#galactic-search li.gs-empty:hover{background:none}
#galactic-search .gs-time{color:#7fa6bf;font-size:11px}
#galactic-search .gs-place{color:#ffd37a}
#galactic-search .gs-settings{position:absolute;top:26px;right:4px;z-index:1;width:min(270px,calc(100% - 8px));max-height:calc(100% - 30px);overflow:auto;padding:6px 8px;background:rgba(3,14,26,.97);border:1px solid #7fd0ff;box-shadow:0 4px 12px rgba(0,0,0,.7);font-size:13px}
#galactic-search .gs-settings h4{margin:6px 0 2px;color:#7fa6bf;font-size:11px;font-weight:normal;text-transform:uppercase;letter-spacing:.06em}
#galactic-search .gs-settings h4:first-child{margin-top:0}
#galactic-search .gs-settings label{display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer}
#galactic-search [hidden]{display:none}
#galactic-search ul::-webkit-scrollbar{width:14px}
#galactic-search ul::-webkit-scrollbar-track{background:var(--sb-track,rgba(0,0,0,.35)) center top/100% auto repeat-y}
#galactic-search ul::-webkit-scrollbar-thumb{background:#3b7ea6;border-style:solid;border-width:3px;border-image:var(--sb-tab) 6 fill stretch}
#galactic-search ul::-webkit-scrollbar-button:single-button{display:block;height:14px;background:center/100% 100% no-repeat}
#galactic-search ul::-webkit-scrollbar-button:single-button:vertical:decrement{background-image:var(--sb-up)}
#galactic-search ul::-webkit-scrollbar-button:single-button:vertical:decrement:hover{background-image:var(--sb-up-over)}
#galactic-search ul::-webkit-scrollbar-button:single-button:vertical:decrement:active{background-image:var(--sb-up-down)}
#galactic-search ul::-webkit-scrollbar-button:single-button:vertical:increment{background-image:var(--sb-down)}
#galactic-search ul::-webkit-scrollbar-button:single-button:vertical:increment:hover{background-image:var(--sb-down-over)}
#galactic-search ul::-webkit-scrollbar-button:single-button:vertical:increment:active{background-image:var(--sb-down-down)}
@supports not selector(::-webkit-scrollbar){#galactic-search ul{scrollbar-width:thin;scrollbar-color:#3b7ea6 rgba(0,0,0,.35)}}
`;

// the scroll bars of the game's own lists: its skin's arrow buttons, track and tab
const SCROLL_SKIN = {
  '--sb-up': 'Scroll_Up_Button',
  '--sb-up-over': 'Scroll_Up_Button_Mouse_Over',
  '--sb-up-down': 'Scroll_Up_Button_Pressed',
  '--sb-down': 'Scroll_Down_Button',
  '--sb-down-over': 'Scroll_Down_Button_Mouse_Over',
  '--sb-down-down': 'Scroll_Down_Button_Pressed',
  '--sb-track': 'Scroll_Middle',
  '--sb-tab': 'Scroll_Tab'
};
async function skinScrollBars(el) {
  for (const [name, key] of Object.entries(SCROLL_SKIN)) {
    const im = await skinImage(key).catch(() => null),
      url = im?.url && (await tinted(im.url).catch(() => im.url));
    if (url) el.style.setProperty(name, `url("${url}")`);
  }
}

// The skin's scroll bar pieces are gold; the panel is blue. Turning every colour by the same hue angle makes the
// gold the panel's blue and leaves the greys of the arrows and the tab as they are.
const HUE = (155 * Math.PI) / 180;
async function tinted(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const cv = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight }),
    ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, cv.width, cv.height),
    d = pixels.data,
    c = Math.cos(HUE),
    s = Math.sin(HUE);
  // the hue-rotate matrix of CSS filters
  const m = [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072
  ];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    d[i] = m[0] * r + m[1] * g + m[2] * b;
    d[i + 1] = m[3] * r + m[4] * g + m[5] * b;
    d[i + 2] = m[6] * r + m[7] * g + m[8] * b;
  }
  ctx.putImageData(pixels, 0, 0);
  return cv.toDataURL();
}

const MARGIN = 4;

export class GalacticSearch {
  constructor(game, parent = document.body) {
    this.game = game;
    this.watch = new FleetWatch();
    this.prefs = loadPrefs();
    this.results = [];
    this.active = -1;
    const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
    const root = (this.root = el('div', { id: 'galactic-search', hidden: true }));
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Planet finder');
    root.style.setProperty('--gs-font', `${fontFamily('EmpireAtWar') || 'Arial'}, Arial, sans-serif`);
    const title = el('div', { className: 'gs-title' });
    const cog = (this.cog = el('button', { type: 'button', className: 'gs-cog', textContent: '⚙', title: 'What the panel lists' }));
    cog.setAttribute('aria-label', 'Planet finder settings');
    cog.setAttribute('aria-expanded', 'false');
    title.append(el('span', { textContent: 'Planet finder' }), cog);
    const input = (this.input = el('input', { type: 'search', placeholder: 'Search planets', autocomplete: 'off', spellcheck: false }));
    input.setAttribute('aria-label', 'Search planets');
    this.list = el('ul');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Planets');
    this.log = el('ul', { className: 'gs-log' });
    this.log.setAttribute('aria-label', 'Recent events');
    this.settings = this.buildSettings(el);
    const bar = (this.bar = el('div', { className: 'gs-bar' }));
    bar.append(input);
    this.head = el('div', { className: 'gs-head', textContent: 'Recent events' });
    root.append(el('style', { textContent: CSS }), title, bar, this.list, this.head, this.log, this.settings);
    this.sections();
    parent.appendChild(root);
    skinScrollBars(root);

    // keys pressed inside the panel must never reach the game's hotkeys
    input.addEventListener('keydown', e => this.key(e));
    for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, e => e.stopPropagation());
    input.addEventListener('input', () => this.search());
    input.addEventListener('focus', () => this.game.keys?.clear());
    root.addEventListener('pointerdown', e => e.stopPropagation());
    root.addEventListener('wheel', e => e.stopPropagation());
    cog.addEventListener('click', () => this.showSettings(this.settings.hidden));
    this.onDown = e => {
      if (!this.settings.hidden && !this.settings.contains(e.target) && !cog.contains(e.target)) this.showSettings(false);
    };
    addEventListener('pointerdown', this.onDown, true);
    this.drag(title, cog);
    // the size the player drags the corner to is kept
    this.resized = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.keepRect()) : null;
    this.resized?.observe(root);
    this.onWindow = () => this.opened && this.place();
    addEventListener('resize', this.onWindow);
    // double-clicking a planet named in an entry's text jumps to that planet
    this.unlink = linkPlanets(this.log, game);
  }

  buildSettings(el) {
    const box = el('div', { className: 'gs-settings', hidden: true });
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Planet finder settings');
    const check = (label, on, change) => {
      const row = el('label'),
        input = el('input', { type: 'checkbox', checked: on });
      input.addEventListener('change', () => {
        change(input.checked);
        this.savePrefs();
      });
      row.append(input, label);
      return row;
    };
    box.append(el('h4', { textContent: 'Planets' }));
    for (const [k, label] of PLANET_KINDS)
      box.append(
        check(label, this.prefs.planets[k] !== false, on => {
          this.prefs.planets[k] = on;
          this.sections();
          this.search();
        })
      );
    box.append(el('h4', { textContent: 'Events' }));
    for (const [k, label] of EVENT_KINDS)
      box.append(
        check(label, this.prefs.events[k] !== false, on => {
          this.prefs.events[k] = on;
          this.sections();
          this.refresh();
        })
      );
    box.append(el('h4', { textContent: 'When a listed event happens' }));
    box.append(check('Pause the game (single player)', this.prefs.pause, on => (this.prefs.pause = on)));
    return box;
  }

  // a section with every one of its filters off is left out, and the other one gets the room
  sections() {
    const planets = PLANET_KINDS.some(([k]) => this.prefs.planets[k] !== false),
      events = EVENT_KINDS.some(([k]) => this.prefs.events[k] !== false);
    this.bar.hidden = this.list.hidden = !planets;
    this.head.hidden = this.log.hidden = !events;
    this.head.style.marginTop = planets ? '' : '0';
    if (!planets && this.typing) this.input.blur();
  }

  showSettings(on) {
    this.settings.hidden = !on;
    this.cog.setAttribute('aria-expanded', String(on));
  }

  savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {}
  }

  // moves the panel by its title bar; the cog keeps its click
  drag(handle, cog) {
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || cog.contains(e.target)) return;
      e.preventDefault();
      const r = this.root.getBoundingClientRect(),
        dx = e.clientX - r.left,
        dy = e.clientY - r.top;
      handle.setPointerCapture?.(e.pointerId);
      const move = ev => this.place(ev.clientX - dx, ev.clientY - dy);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.keepRect();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // puts the panel at x, y (or where it was kept, or top right under the hero portraits), inside the window
  place(x, y) {
    const s = this.root.style,
      kept = this.prefs.rect;
    if (s.width === '') {
      s.width = Math.min(kept?.w ?? 300, innerWidth - MARGIN * 2) + 'px';
      s.height = Math.min(kept?.h ?? Math.min(480, innerHeight - 160), innerHeight - MARGIN * 2) + 'px';
    }
    const r = this.root.getBoundingClientRect();
    x ??= kept?.x ?? innerWidth - r.width - 12;
    y ??= kept?.y ?? 90;
    s.left = Math.round(Math.max(MARGIN, Math.min(innerWidth - r.width - MARGIN, x))) + 'px';
    s.top = Math.round(Math.max(MARGIN, Math.min(innerHeight - r.height - MARGIN, y))) + 'px';
  }

  keepRect() {
    if (!this.opened) return;
    const r = this.root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      was = this.prefs.rect;
    if (was && was.x === rect.x && was.y === rect.y && was.w === rect.w && was.h === rect.h) return;
    this.prefs.rect = rect;
    this.savePrefs();
  }

  get opened() {
    return !this.root.hidden;
  }

  // the panel stays out of the way of dialogs, menus, battles and scripted scenes
  get blocked() {
    const g = this.game;
    return !!(
      g.over ||
      g.battle ||
      g.controlsLocked ||
      g.modeSuspended ||
      g.menus?.open ||
      g.planetInfo?.open ||
      g.scriptUI?.modal ||
      g.storyMovie?.active ||
      g.storyDialog?.opened ||
      g.galacticLog?.opened
    );
  }

  // the Tweaks setting
  get enabled() {
    return !!globalThis.planetFinder;
  }

  show(on) {
    if (this.opened === on) return;
    this.root.hidden = !on;
    if (on) {
      this.place();
      this.search();
      this.refresh();
    } else {
      this.showSettings(false);
      if (this.typing) this.input.blur();
    }
  }

  get typing() {
    return document.activeElement === this.input;
  }

  search() {
    if (!this.opened) return;
    const keep = this.results[this.active]?.index;
    this.results = searchPlanets(this.game, this.input.value).filter(
      r => this.prefs.planets[planetKind(this.game, this.game.galaxy.planets[r.index])] !== false
    );
    const at = this.results.findIndex(r => r.index === keep);
    this.active = at >= 0 ? at : this.input.value.trim() && this.results.length ? 0 : -1;
    this.paintResults();
  }

  paintResults() {
    const top = this.list.scrollTop;
    this.list.replaceChildren(
      ...(this.results.length
        ? this.results.map((r, i) => {
            const li = document.createElement('li');
            li.append(planetIcon(this.game, r.index), r.name);
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', String(i === this.active));
            li.addEventListener('mousedown', e => e.preventDefault());
            li.addEventListener('click', () => this.go(r.index));
            return li;
          })
        : [Object.assign(document.createElement('li'), { className: 'gs-empty', textContent: 'No planets to list.' })])
    );
    this.list.scrollTop = top;
  }

  key(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!this.results.length) return;
      e.preventDefault();
      const n = this.results.length,
        down = e.key === 'ArrowDown';
      this.active = this.active < 0 ? (down ? 0 : n - 1) : (this.active + (down ? 1 : n - 1)) % n;
      [...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === this.active)));
      this.list.children[this.active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = this.results[Math.max(0, this.active)];
      if (pick) this.go(pick.index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.input.value = '';
      this.search();
      this.input.blur();
    }
  }

  go(index) {
    if (this.game.focusPlanet?.(index)) this.input.blur();
  }

  // a new entry in the location log: list it and, when the player asked for it, pause on it
  added(entry) {
    this.refresh();
    this.search();
    if (this.enabled && this.prefs.pause && eventShown(this.prefs, entry) && !this.game.net) this.game.setUserPaused?.(true);
  }

  // called when the log changes; cheap when the panel is hidden
  refresh() {
    if (!this.opened) return;
    const rows = locationRows(this.game, 60, e => eventShown(this.prefs, e));
    if (!rows.length) {
      this.log.replaceChildren(
        Object.assign(document.createElement('li'), { className: 'gs-empty', textContent: 'Nothing has happened yet.' })
      );
      return;
    }
    this.log.replaceChildren(
      ...rows.map(r => {
        const li = document.createElement('li'),
          t = Object.assign(document.createElement('div'), { className: 'gs-time', textContent: `Cycle ${r.cycle} - ${r.time}` }),
          p = Object.assign(document.createElement('span'), { className: 'gs-place', textContent: r.name + ': ' });
        p.dataset.planet = String(r.planet);
        p.dataset.planetLabel = '';
        li.append(t, planetIcon(this.game, r.planet), p, document.createTextNode(r.text));
        li.addEventListener('click', () => this.game.focusPlanet?.(r.planet));
        return li;
      })
    );
  }

  update() {
    const g = this.game.galaxy;
    if (g && !this.game.over)
      for (const [planet, text, kind] of this.watch.step(g, this.game.localFaction ?? this.game.me)) {
        const entry = recordLocation(g, planet, text, kind);
        if (entry) this.added(entry);
      }
    this.show(this.enabled && !this.blocked);
  }

  dispose() {
    removeEventListener('pointerdown', this.onDown, true);
    removeEventListener('resize', this.onWindow);
    this.resized?.disconnect();
    this.unlink?.();
    this.root.remove();
  }
}

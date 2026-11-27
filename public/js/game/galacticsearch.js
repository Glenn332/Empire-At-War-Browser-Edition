import { db } from '../gamedata.js';
import { fontFamily } from '../fonts.js';
import { logState } from './galacticlogdata.js';
import { cycleNumber } from './galacticeconomy.js';
import { linkPlanets } from './planetlinks.js';
import * as THREE from 'three';
import { connectionOwner } from './galacticfog.js';
import { capturePlanet } from './planetinfo.js';
import { portraitBounds } from './planetportrait.js';

// Planet search and the location log of the galactic HUD. Both are views for the local player only: nothing here
// is part of the simulated state, so it never goes through the lockstep. Selection and camera use the same
// per-player view path as clicking a planet.

export const LOCATION_LIMIT = 200;

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

export function recordLocation(galaxy, planet, text) {
  if (!galaxy || !Number.isInteger(planet) || !galaxy.planets?.[planet] || !text) return null;
  const list = (logState(galaxy).locations ||= []),
    entry = { time: Math.round(galaxy.time || 0), cycle: cycleNumber(galaxy), planet, text: String(text) };
  list.push(entry);
  if (list.length > LOCATION_LIMIT) list.splice(0, list.length - LOCATION_LIMIT);
  return entry;
}

export function clock(seconds) {
  const s = Math.max(0, Math.trunc(seconds || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// newest first
export function locationRows(game, limit = 60) {
  return locationEntries(game.galaxy)
    .slice(-limit)
    .reverse()
    .map(e => ({
      planet: e.planet,
      name: planetLabel(game, game.galaxy.planets[e.planet]),
      time: clock(e.time),
      cycle: e.cycle,
      text: e.text
    }));
}

const CSS = `
#galactic-search{position:fixed;top:18%;left:50%;transform:translateX(-50%);z-index:40;width:min(380px,90vw);padding:6px;background:rgba(3,14,26,.9);border:1px solid #3b7ea6;box-shadow:0 4px 18px rgba(0,0,0,.7);font:14px/1.3 var(--gs-font);color:#bfe4ff;text-shadow:1px 1px 0 #000}
#galactic-search[hidden]{display:none}
#galactic-search *{box-sizing:border-box}
#galactic-search .gs-bar{display:flex;gap:4px}
#galactic-search input{flex:1;min-width:0;background:rgba(3,14,26,.85);color:#e6f6ff;border:1px solid #3b7ea6;padding:3px 6px;font:inherit;outline:none}
#galactic-search input:focus{border-color:#7fd0ff}
#galactic-search ul{list-style:none;margin:4px 0 0;padding:0;background:rgba(3,14,26,.92);border:1px solid #3b7ea6;max-height:30vh;overflow:auto}
#galactic-search .gs-head{margin:8px 0 0;color:#7fa6bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
#galactic-search .gs-log{max-height:40vh}
#galactic-search li{padding:3px 6px;cursor:pointer;display:block}
#galactic-search .gs-icon{display:inline-block;width:26px;height:26px;margin-right:8px;vertical-align:middle;border:2px solid;border-radius:50%;background:#030e1a center/cover no-repeat;box-shadow:0 0 0 1px #000}
#galactic-search li:hover,#galactic-search li[aria-selected=true]{background:rgba(30,90,130,.9)}
#galactic-search .gs-time{color:#7fa6bf;font-size:11px}
#galactic-search .gs-place{color:#ffd37a}
#galactic-search [hidden]{display:none}
`;

export class GalacticSearch {
  constructor(game, parent = document.body) {
    this.game = game;
    this.results = [];
    this.active = -1;
    const root = (this.root = document.createElement('div'));
    root.id = 'galactic-search';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Search planets');
    root.style.setProperty('--gs-font', `${fontFamily('EmpireAtWar') || 'Arial'}, Arial, sans-serif`);
    const style = document.createElement('style');
    style.textContent = CSS;
    const bar = Object.assign(document.createElement('div'), { className: 'gs-bar' });
    const input = (this.input = Object.assign(document.createElement('input'), {
      type: 'search',
      placeholder: 'Search planets',
      autocomplete: 'off',
      spellcheck: false
    }));
    input.setAttribute('aria-label', 'Search planets');
    this.list = Object.assign(document.createElement('ul'), { hidden: true });
    this.list.setAttribute('role', 'listbox');
    // recent events by planet, shown under the search whenever the popup is open
    const head = Object.assign(document.createElement('div'), { className: 'gs-head', textContent: 'Recent events' });
    this.log = Object.assign(document.createElement('ul'), { className: 'gs-log' });
    this.log.setAttribute('aria-label', 'Location log');
    bar.append(input);
    root.append(style, bar, this.list, head, this.log);
    parent.appendChild(root);
    // keys pressed inside the popup must never reach the game's hotkeys
    input.addEventListener('keydown', e => this.key(e));
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, e => e.stopPropagation());
    input.addEventListener('input', () => this.search());
    input.addEventListener('focus', () => {
      this.game.keys?.clear();
      this.search();
    });
    root.addEventListener('pointerdown', e => e.stopPropagation());
    root.addEventListener('wheel', e => e.stopPropagation());
    // double-clicking a planet named in an entry's text jumps to that planet
    this.unlink = linkPlanets(this.log, game);
    // Ctrl+F (Cmd+F) opens the popup in the middle of the screen; a click anywhere outside it closes it
    this.onKey = e => {
      if (e.code !== 'KeyF' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || this.blocked) return;
      e.preventDefault();
      e.stopPropagation();
      this.open();
    };
    this.onDown = e => {
      if (this.opened && !root.contains(e.target)) this.close();
    };
    addEventListener('keydown', this.onKey, true);
    addEventListener('pointerdown', this.onDown, true);
  }

  get opened() {
    return !this.root.hidden;
  }

  // the popup stays out of the way of dialogs, battles and scripted scenes
  get blocked() {
    const g = this.game;
    return !!(g.over || g.battle || g.controlsLocked || g.modeSuspended || g.scriptUI?.modal || g.storyMovie?.active || g.galacticLog?.opened);
  }

  open() {
    this.root.hidden = false;
    this.refresh();
    this.input.focus();
    this.input.select();
  }

  close() {
    if (!this.opened) return;
    this.input.value = '';
    this.closeResults();
    this.log.replaceChildren();
    this.input.blur();
    this.root.hidden = true;
  }

  get typing() {
    return document.activeElement === this.input;
  }

  search() {
    this.results = searchPlanets(this.game, this.input.value);
    this.active = this.results.length ? 0 : -1;
    this.paintResults();
  }

  paintResults() {
    this.list.hidden = !this.results.length;
    this.list.replaceChildren(
      ...this.results.map((r, i) => {
        const li = document.createElement('li');
        li.append(planetIcon(this.game, r.index), r.name);
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === this.active));
        li.addEventListener('mousedown', e => e.preventDefault());
        li.addEventListener('click', () => this.go(r.index));
        return li;
      })
    );
  }

  closeResults() {
    this.results = [];
    this.active = -1;
    this.paintResults();
  }

  key(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!this.results.length) return;
      e.preventDefault();
      const n = this.results.length;
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      [...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === this.active)));
      this.list.children[this.active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = this.results[Math.max(0, this.active)];
      if (pick) this.go(pick.index);
    }
  }

  go(index) {
    if (this.game.focusPlanet?.(index)) this.close();
  }

  // called when the log changes; cheap when the popup is closed
  refresh() {
    if (!this.opened) return;
    const rows = locationRows(this.game);
    if (!rows.length) {
      this.log.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Nothing has happened yet.' }));
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
        li.addEventListener('click', () => {
          if (this.game.focusPlanet?.(r.planet)) this.close();
        });
        return li;
      })
    );
  }

  update() {
    if (this.opened && this.blocked) this.close();
  }

  dispose() {
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('pointerdown', this.onDown, true);
    this.unlink?.();
    this.root.remove();
  }
}

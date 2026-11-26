import { db } from '../gamedata.js';
import { fontFamily } from '../fonts.js';
import { logState } from './galacticlogdata.js';
import { cycleNumber } from './galacticeconomy.js';
import { linkPlanets } from './planetlinks.js';

// Planet search and the location log of the galactic HUD. Both are views for the local player only: nothing here
// is part of the simulated state, so it never goes through the lockstep. Selection and camera use the same
// per-player view path as clicking a planet.

export const LOCATION_LIMIT = 200;
export const SEARCH_LIMIT = 8;

const fold = s =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export const planetLabel = (game, p) => game.planetViews?.[p.index]?.name || db.t(p.type?.str('Text_ID')) || p.name || '';

// planets whose displayed name contains the text, names that start with it first, then alphabetical
export function searchPlanets(game, query, limit = SEARCH_LIMIT) {
  const q = fold(query);
  if (!q) return [];
  const out = [];
  for (const p of game.galaxy?.planets || []) {
    if (p.background || game.planetViews?.[p.index]?.show === false) continue;
    const name = planetLabel(game, p),
      at = fold(name).indexOf(q);
    if (at >= 0) out.push({ index: p.index, name, rank: at === 0 ? 0 : 1 });
  }
  out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return out.slice(0, limit);
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
#galactic-search{position:fixed;top:6px;right:6px;z-index:7;width:230px;font:13px/1.3 var(--gs-font);color:#bfe4ff;text-shadow:1px 1px 0 #000}
#galactic-search *{box-sizing:border-box}
#galactic-search .gs-bar{display:flex;gap:4px}
#galactic-search input{flex:1;min-width:0;background:rgba(3,14,26,.85);color:#e6f6ff;border:1px solid #3b7ea6;padding:3px 6px;font:inherit;outline:none}
#galactic-search input:focus{border-color:#7fd0ff}
#galactic-search button{background:rgba(3,14,26,.85);color:#bfe4ff;border:1px solid #3b7ea6;padding:3px 7px;font:inherit;cursor:pointer}
#galactic-search button:hover,#galactic-search button[aria-pressed=true]{background:rgba(30,90,130,.9)}
#galactic-search ul{list-style:none;margin:2px 0 0;padding:0;background:rgba(3,14,26,.92);border:1px solid #3b7ea6;max-height:60vh;overflow:auto}
#galactic-search li{padding:3px 6px;cursor:pointer;display:block}
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
    const toggle = (this.toggle = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Log' }));
    toggle.setAttribute('aria-pressed', 'false');
    toggle.title = 'Recent events by planet';
    this.list = Object.assign(document.createElement('ul'), { hidden: true });
    this.list.setAttribute('role', 'listbox');
    this.log = Object.assign(document.createElement('ul'), { hidden: true });
    this.log.setAttribute('aria-label', 'Location log');
    bar.append(input, toggle);
    root.append(style, bar, this.list, this.log);
    parent.appendChild(root);
    // typing must never reach the game's hotkeys
    for (const type of ['keydown', 'keyup', 'keypress']) input.addEventListener(type, e => e.stopPropagation());
    input.addEventListener('keydown', e => this.key(e));
    input.addEventListener('input', () => this.search());
    input.addEventListener('focus', () => {
      this.game.keys?.clear();
      this.search();
    });
    input.addEventListener('blur', () => setTimeout(() => this.closeResults(), 150));
    toggle.addEventListener('click', () => this.showLog(this.log.hidden));
    root.addEventListener('pointerdown', e => e.stopPropagation());
    root.addEventListener('wheel', e => e.stopPropagation());
    // double-clicking a planet named in an entry's text jumps to that planet
    this.unlink = linkPlanets(this.log, game);
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
        const li = Object.assign(document.createElement('li'), { textContent: r.name });
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
      this.paintResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = this.results[Math.max(0, this.active)];
      if (pick) this.go(pick.index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this.input.value) this.input.value = '';
      this.closeResults();
      this.input.blur();
    }
  }

  go(index) {
    if (this.game.focusPlanet?.(index)) {
      this.input.value = '';
      this.closeResults();
      this.input.blur();
    }
  }

  showLog(on) {
    this.log.hidden = !on;
    this.toggle.setAttribute('aria-pressed', String(on));
    if (on) this.refresh();
  }

  // called when the log changes; cheap when it is closed
  refresh() {
    if (this.log.hidden) return;
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
        li.append(t, p, document.createTextNode(r.text));
        li.addEventListener('click', () => this.game.focusPlanet?.(r.planet));
        return li;
      })
    );
  }

  // the panel stays out of the way of dialogs, battles and scripted scenes
  update() {
    const g = this.game,
      hide = !!(g.over || g.battle || g.controlsLocked || g.scriptUI?.modal || g.storyMovie?.active || g.galacticLog?.opened);
    if (this.root.hidden !== hide) this.root.hidden = hide;
  }

  dispose() {
    this.unlink?.();
    this.root.remove();
  }
}

import { inApp } from './platform.js';
import { db } from './gamedata.js';
import { loadedMods } from './vfs.js';
import { mapTitle } from './ted.js';

const KEY = 'swr-discord';
const EVERY_MS = 5000;

let mods = '',
  sent = '',
  since = 0,
  key = '',
  campaignName = '',
  timer = 0;

export function discordSetting() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

function send(params) {
  const q = new URLSearchParams(params).toString();
  if (q === sent) return;
  sent = q;
  fetch('api/discord?' + q).catch(() => {});
}

const text = id => {
  const t = id && db.t(id);
  return t && t !== id ? t : '';
};
const factionName = f => {
  const id = typeof f === 'string' ? f : f?.name || f?.factionName || '';
  return id ? text(db.faction(id)?.str('Text_ID')) || id : '';
};
const planetName = type => {
  const t = typeof type === 'string' ? db.type(type) : type;
  return (t && text(t.str('Text_ID'))) || (typeof type === 'string' ? type : t?.name || '');
};
const as = name => (name ? ' as ' + name : '');

function describe(g) {
  const s = g.setup || {};
  if (s.attract) return { details: 'In the menus', state: mods };
  if (s.benchmark) return { details: 'Running a benchmark', state: mods };
  const net = !!(s.net || g.net);
  if (g.galaxy && !g.world) {
    const c = g.galaxy.campaign;
    campaignName = (c && text(c.str('Text_ID'))) || c?.name || 'Galactic Conquest';
    const b = g.battle,
      p = b && g.galaxy.planets?.[b.p];
    return {
      details: (net ? 'Multiplayer: ' : '') + campaignName,
      state: p
        ? (b.mode === 'land' ? 'Land' : 'Space') + ' battle at ' + planetName(p.type || p.name)
        : g.linkedMission
          ? 'In a story mission'
          : 'On the galaxy map' + as(factionName(g.me))
    };
  }
  const land = s.mode === 'land',
    kind = land ? 'Land' : 'Space',
    watching = !!(g.observer || g.spectator),
    me = watching ? '' : factionName(land ? g.factions?.[g.me] : g.human?.factionName);
  if (s.campaign && typeof s.campaign === 'object') {
    return {
      details: (net ? 'Multiplayer: ' : '') + (campaignName || 'Galactic Conquest'),
      state: kind + ' battle at ' + planetName(s.campaign.planetType) + as(me)
    };
  }
  const map = s.mapFile ? mapTitle(s.mapFile) : '';
  return {
    details: (net ? 'Multiplayer ' : '') + kind + ' skirmish' + (map ? ' on ' + map : ''),
    state: watching ? 'Watching' : g.over ? 'Battle over' : 'Playing' + as(me)
  };
}

function tick() {
  if (!discordSetting()) return send({ on: '0' });
  const g = window.game;
  if (!g) return;
  let d;
  try {
    d = describe(g);
  } catch {
    return;
  }
  const k = d.details + '|' + d.state.replace(/^Battle over$/, 'Playing');
  if (k !== key) {
    key = k;
    since = Date.now();
  }
  send({ details: d.details, state: d.state, large: mods || 'Empire at War: Browser Edition', start: String(since) });
}

export function setDiscord(on) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {}
  tick();
}

export async function initDiscord() {
  if (!inApp() || timer) return;
  try {
    const list = await loadedMods();
    mods = list.length ? 'Mod: ' + list.join(' + ') : '';
  } catch {}
  timer = setInterval(tick, EVERY_MS);
  tick();
}

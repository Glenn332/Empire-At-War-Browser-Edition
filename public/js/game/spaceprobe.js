import { activeLanguage } from '../language.js';
import { snapshot, saveRefs } from './savegame.js';

export function battleSnapshot(game, save = null, refs = null) {
  const w = game.world;
  if (!save) { save = snapshot(game); refs = new Map([...saveRefs(w).refs].map(([e, r]) => [r, e])); }
  const pids = [];
  for (const [r, e] of refs) {
    if (!e || e.dead) continue;
    pids.push([r, e.id]);
    if (e.isSquad) e.fighters.forEach((f, i) => pids.push([r + '.' + i, f.id]));
  }
  const mapObjects = w.units.filter(u => !u.dead && !u.squad && u.mapIndex !== undefined)
    .map(u => ({ type: u.type.name, player: u.player.id, x: u.x, y: u.y, z: u.z, heading: u.heading, roll: u.roll || 0, pitch: u.pitch || 0, mapIndex: u.mapIndex }));
  const { restore, net, ...rest } = game.setup;
  const setup = JSON.parse(JSON.stringify(rest, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && v.constructor && v.constructor !== Object ? undefined : v)));
  return {
    mapFile: game.setup.mapFile, language: activeLanguage, autofire: !!w.autofire, fog: !!w.fog, skirmish: !!w.skirmish, campaign: !!w.campaign,
    setup, net: net ? { seed: game.setup.seed >>> 0 } : null,
    teams: w.teams.map(t => ({ faction: t.factionName, mapSide: t.mapSide, spawnPoints: t.spawnPoints.map(sp => ({ ...sp })), station: t.station && t.station.mapIndex !== undefined ? t.station.mapIndex : null })),
    players: w.players.filter(p => p.id >= 0).map(p => ({ id: p.id, team: w.teams.indexOf(p.team), human: !!p.human, credits: p.credits, popCap: p.popCap, color: p.color ? '#' + p.color.getHexString() : '#ffffff', difficulty: p.difficulty, name: p.name,
      adjust: p.adjust || null, campaignTech: p.campaignTech, autofire: p.autofire, spawn: p.spawn || null, upgrades: [...(p.upgrades || [])] })),
    fields: w.fields.map(f => ({ ...f })),
    mapObjects, save, pids, at: w.time,
    ai: !(game.setup.benchmark || game.setup.attract), switches: ['oldai', 'nofreestore', 'noscripts', 'noplans'].filter(k => new URLSearchParams(location.search).has(k)),
  };
}

export async function spaceProbe(game, steps = 600) {
  const start = game.probeStart || battleSnapshot(game);
  const w = game.world;
  const mine = [], wrap = (name) => { const f = w[name]; w[name] = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { cur += performance.now() - t; if (name === 'updateEnd') { mine.push(cur); cur = 0; } } }; return () => { w[name] = f; }; };
  let cur = 0;
  const undo = ['updateBegin', 'updateSome', 'updateEnd'].map(wrap);
  const worker = new Worker(new URL('./spacebattleworker.js', import.meta.url), { type: 'module' });
  const t0 = performance.now();
  const theirs = await new Promise(res => { worker.onmessage = e => res(e.data); worker.onerror = e => res({ ok: false, error: e.message }); worker.postMessage({ ...start, k: 'probe', base: new URL('.', location.href).href, steps }); });
  worker.terminate();
  undo.forEach(u => u());
  const avg = a => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(3);
  const p99 = a => (a.length ? +a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.99)].toFixed(2) : 0);
  const page = { steps: mine.length, stepAvg: avg(mine), stepP99: p99(mine), stepWorst: +Math.max(0, ...mine).toFixed(1), bySecond: Array.from({ length: Math.ceil(mine.length / 30) }, (_, k) => avg(mine.slice(k * 30, k * 30 + 30))) };
  return { worker: theirs, page, wallMs: Math.round(performance.now() - t0), entities: start.save.battle.entities.length };
}

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadMap } = await import('../public/js/ted.js');
const { Mind, target } = await import('../public/js/game/landbrain.js');
const { ScriptHost } = await import('../public/js/game/scripts.js');

const map = await loadMap('_MP_LAND_TATOOINE.TED');
const zones = map.zones;
assert(zones && zones.length > 10, 'the map has zones');
const n = map.terrain.size;
const team = [0, 1];
const tank = db.type('AT_AT_Walker');
assert(tank && tank.num('AI_Combat_Power', 0) > 0, 'a unit type with combat power');
const hot = zones.filter((z, i) => i % 3 === 1);
const units = hot.map(z => ({ side: 1, x: z.x, y: z.y, z: 0, type: tank, health: 1, maxHealth: 1, range: 0, dead: false }));
const w = {
  n,
  map,
  units,
  team,
  factions: [],
  owned: [new Set(), new Set()],
  teamSides: s => [s],
  ally: (a, b) => a === b || (team[a] !== undefined && team[a] === team[b])
};
const mind = new Mind({ eq: new Map(), fnOf: new Map() }, w, 0);
for (const z of zones) z.target ||= target.zone(z);
const threat = z => mind.at(z.target, true, 'force', null, 0);
assert(
  hot.every(z => threat(z) > 0),
  'the enemy stands as threat in its zones'
);

const G = {};
const host = Object.assign(Object.create(ScriptHost.prototype), {
  land: true,
  world: { units: [], fields: [], time: 1 },
  vm: { global: (k, v) => (G[k] = v) },
  missing: new Map(),
  wrapped: new Map(),
  plans: { at: () => null },
  game: {}
});
host.globals();
assert(G.FindTarget && G.FindTarget.Reachable_Target, 'FindTarget.Reachable_Target is registered');
let wanted = null;
mind.fn = (name, t) => (t === wanted ? 1 : 0);
const ai = { mind, player: { id: 0, team: 0 }, findable: () => zones.map(z => ({ t: z.target, thing: null })) };
host.current = { ai };

const tolOf = k =>
  [
    0,
    db.constants.num('Low_Threat_Reachability_Tolerance', 1000),
    db.constants.num('Medium_Threat_Reachability_Tolerance', 1000),
    db.constants.num('High_Threat_Reachability_Tolerance', 1000),
    1e18
  ][k];
const cheapest = from => {
  const best = new Map([[from, { hi: 0, len: 0 }]]),
    open = [from],
    step = z => Math.floor(Math.max(0, threat(z)) / 100) || 1;
  const less = (a, b) => a.hi < b.hi || (a.hi === b.hi && a.len < b.len);
  while (open.length) {
    open.sort((a, b) => (less(best.get(a), best.get(b)) ? -1 : 1));
    const a = open.shift(),
      c = best.get(a);
    for (const l of a.links) {
      const b = zones[l.to];
      if (!b || b === a) continue;
      const v = { hi: c.hi + step(b), len: c.len + (Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 10) & 0xffff) };
      if (!best.has(b) || less(v, best.get(b))) {
        if (!best.has(b)) open.push(b);
        best.set(b, v);
      }
    }
  }
  return best;
};

const names = ['NO_THREAT', 'LOW_THREAT', 'MEDIUM_THREAT', 'HIGH_THREAT', 'ANY_THREAT'];
const from = zones.find(z => !hot.includes(z));
const origin = host.pos(from.x, from.y, 0),
  player = { __player: true };
const ways = cheapest(from);
const kept = [];
for (let k = 0; k < names.length; k++) {
  const tol = tolOf(k);
  kept[k] = 0;
  for (const z of zones) {
    wanted = z.target;
    const got = G.FindTarget.Reachable_Target(player, 'Anything', 'TACTICAL_LOCATION', names[k], 1, origin);
    const way = ways.get(z),
      expect = k === 4 || (!!way && way.hi * 100 <= tol);
    assert.equal(!!got, expect, names[k] + ' to zone ' + z.index + ' (threat ' + (way ? way.hi * 100 : 'none') + ' against ' + tol + ')');
    if (got) {
      kept[k]++;
      assert.equal(got.x, z.x);
      assert.equal(got.y, z.y);
    }
    const free = G.FindTarget.Reachable_Target(player, 'Anything', 'TACTICAL_LOCATION', names[k], 1);
    assert(free && free.x === z.x, 'no source: nothing is left out');
  }
}
assert.equal(kept[0], 1, 'with no threat allowed only the source zone itself is kept');
assert(kept[0] < kept[1] && kept[1] < kept[2] && kept[2] < zones.length && kept[4] === zones.length, 'a wider tolerance keeps more places');
console.log('reachable target ok', { zones: zones.length, kept });

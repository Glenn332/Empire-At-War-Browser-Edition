import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { openGame } from './megfs.mjs';
let gameDir = fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url));
for (let up = new URL('../../../', import.meta.url); !existsSync(gameDir) && up.pathname.split('/').length > 3; up = new URL('../', up))
  gameDir = fileURLToPath(new URL('Star Wars Empire at War', up));
const archive = openGame(gameDir);
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
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy } = await import('../public/js/game/galaxy.js');
const { GalacticNetwork } = await import('../public/js/game/galacticnetwork.js');
const data = await loadCampaignData();

// AI route rows are computed per source on demand; each must give the all-pairs cheapest cost and a path of that cost.
const INF = 0xffffffff;
function allPairs(m) {
  const { n, use, weight, dist } = m,
    cost = new Uint32Array(n * n).fill(INF);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) cost[i * n + j] = 0;
      else if (use[i] && use[j] && dist[i * n + j] >= 0) cost[i * n + j] = (weight[j] + dist[i * n + j]) >>> 0;
    }
  for (let k = 0; k < n; k++)
    if (use[k])
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if (use[i] && cost[i * n + k] !== INF && cost[k * n + j] !== INF && cost[i * n + k] + cost[k * n + j] < cost[i * n + j])
            cost[i * n + j] = cost[i * n + k] + cost[k * n + j];
  return cost;
}
let seed = 3,
  pairs = 0,
  rows = 0;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
for (const [name, c] of [...data.campaigns].slice(0, 12)) {
  const g = startingGalaxy(data, c);
  const power = g.planets.map(() => (rnd() < 0.5 ? 0 : Math.floor(rnd() * 20000)));
  for (const p of g.planets) p.restricted = rnd() < 0.05;
  const ai = {
    game: { galaxy: g },
    forces: () => ({ total: (id, a, b, c, p) => power[p.index], related: () => false }),
    controllers: new Map([['X', { player: { faction: 'X' } }]])
  };
  const net = new GalacticNetwork(ai),
    m = net.matrix(ai.controllers.get('X')),
    n = m.n,
    want = allPairs(m);
  assert.equal(m.rows.size, 0, `${name}: no route row is built before it is asked for`);
  for (let i = 0; i < n; i++) {
    const r = m.row(i);
    rows++;
    for (let j = 0; j < n; j++, pairs++) {
      assert.equal(r.cost[j], want[i * n + j], `${name}: cheapest cost ${i} -> ${j}`);
      if (i === j || r.cost[j] === INF) continue;
      const path = net.path('X', g.planets[i], g.planets[j]);
      assert.equal(path[0], g.planets[i]);
      assert.equal(path.at(-1), g.planets[j]);
      let sum = 0;
      for (let k = 1; k < path.length; k++) sum += (m.weight[path[k].index] + m.dist[path[k - 1].index * n + path[k].index]) >>> 0;
      assert.equal(sum, r.cost[j], `${name}: path ${i} -> ${j} costs the cheapest cost`);
    }
  }
  assert.equal(net.matrix(ai.controllers.get('X')).row(0), m.row(0), 'a cached matrix keeps its rows');
}
console.log(`galactic network ok: ${rows} rows, ${pairs} pairs`);

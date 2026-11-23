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
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const S = await import('../public/js/game/sim.js');

// Space fog scans a squadron's cells once; every target must still get exactly the bits a per-unit scan gives.
let seed = 11;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
for (let round = 0; round < 6; round++) {
  const teams = [0, 1, 2].map(i => ({ bit: 1 << i })),
    players = [0, 1, 2].map(i => ({ id: i, bit: teams[i].bit, team: teams[i] })),
    units = [],
    squads = [];
  const unit = (player, x, y, squad) => {
    const u = {
      player,
      x,
      y,
      squad,
      revealRange: rnd() < 0.02 ? NaN : 200 + rnd() * 1800,
      hitRadius: 5 + rnd() * 300,
      cloaked: rnd() < 0.05,
      dead: rnd() < 0.03,
      everSeenBy: 0
    };
    units.push(u);
    return u;
  };
  for (let i = 0; i < 400; i++) unit(players[i % 3], rnd() * 30000 - 15000, rnd() * 30000 - 15000, null);
  for (let i = 0; i < 80; i++) {
    const p = players[i % 3],
      sq = { fighters: [] },
      x = rnd() * 30000 - 15000,
      y = rnd() * 30000 - 15000,
      range = 300 + rnd() * 900;
    for (let k = 0; k < 6; k++) {
      const f = unit(p, x + rnd() * 1200 - 600, y + rnd() * 1200 - 600, sq);
      f.revealRange = range;
      sq.fighters.push(f);
    }
    squads.push(sq);
  }
  const w = Object.assign(Object.create(S.World.prototype), {
    units,
    squads,
    teams,
    fog: true,
    reveals: [],
    fogLifted: 0,
    fowCell: 100,
    fowRegrow: 6,
    time: round,
    projectiles: [],
    markViewCells() {}
  });
  w.updateVisibility();
  const maxHit = Math.max(...units.filter(u => !u.dead).map(u => u.hitRadius));
  for (const u of units) {
    if (u.dead) continue;
    let want = u.player.bit;
    for (const o of units) {
      if (o.dead || !(Math.max(o.revealRange + maxHit, 160) >= 0)) continue;
      const r = u.cloaked ? 160 : o.revealRange + u.hitRadius;
      if ((u.x - o.x) ** 2 + (u.y - o.y) ** 2 <= r * r) want |= o.player.bit;
    }
    assert.equal(u.visMask, want, 'visibility matches a scan from every observer');
  }
}
console.log('space visibility ok');

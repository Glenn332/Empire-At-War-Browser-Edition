// pickFoe() chooses a unit's target among the foes in reach. It asks the costly questions (sight, categories, the
// gun's arc) only of a foe that would be taken, reads a company's health once, and canFireNow() skips the angle for
// a unit that fires all round. This checks its choice against the method as it was (pickPlain and canFirePlain
// below), over random fields of foes.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { LandWorld } = await import('../public/js/game/land.js');
const { prioritySet } = await import('../public/js/game/priorities.js');
const DEG = Math.PI / 180;

// The choice as it was made: every test for every foe in reach, the health share worked out per member.
function pickPlain(u, among, reach, gun, skip, auto = false) {
  const aa = (u.antiAir ??= !!(
    u.flies ||
    (u.ranks ? u.ranks.AIR < 9999 : /ANTIAIR/i.test(u.type.str('CategoryMask').replace(/\s/g, '')) || /ANTI_AIR/i.test(u.type.name))
  ));
  const set = u.prioSet || prioritySet(u.type),
    low = (this.healthLow ??= db.constants.num('Health_Low_Percent_Threshold', 0.33));
  let best = null,
    bd = Infinity,
    bl = false,
    bf = null,
    bp = Infinity;
  const T = this.team,
    mine = u.confuseUntil > this.time ? undefined : T[u.side];
  for (const e of among) {
    if (mine !== undefined && e && T[e.side] === mine) continue;
    if (
      !e ||
      e.dead ||
      e === u ||
      e.cloaked ||
      e.retreating ||
      e.inside ||
      (auto && e.noOpportunity) ||
      e.side < 0 ||
      (e.flies && !aa && !gun) ||
      !this.targetEnemy(u, e) ||
      e.x === undefined ||
      (skip && skip.has(e))
    )
      continue;
    if (gun && gun.spare.has(e.flies ? 'AIR' : e.kind)) continue;
    if (!e.spot && this.barred(u, e)) continue;
    const d = (e.x - u.x) ** 2 + (e.y - u.y) ** 2,
      far = reach + this.edgeOf(e);
    if (d >= far * far) continue;
    if (this.shooter && !this.shooter.sees(u, e)) continue;
    if (gun && !gun.turret && gun.cone < Math.PI * 2) {
      let a = Math.atan2(e.y - u.y, e.x - u.x) - u.heading - (gun.facing || 0);
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > gun.cone / 2 + (gun.onHead ? u.turret.extent : 0) && !(gun.onHead && this.headTurns(u))) continue;
    }
    let p = this.priorityFor(set, e);
    if (p < 0) {
      if (auto) continue;
      p = 1e18;
    }
    const l = this.healthShare(e) <= low;
    let take = !best;
    if (!take) {
      if (l !== bl) take = l;
      else if (p !== bp) take = p < bp;
      else {
        const f = canFirePlain.call(this, u, e, gun);
        if (bf === null) bf = canFirePlain.call(this, u, best, gun);
        take = f !== bf ? f : d < bd;
      }
    }
    if (take) {
      bp = p;
      bl = l;
      bd = d;
      bf = null;
      best = e;
    }
  }
  return best;
}

function canFirePlain(u, e, gun) {
  if (gun) return true;
  if (!u.weapon) return false;
  let a = Math.atan2(e.y - u.y, e.x - u.x) - u.heading;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  if (u.turret) {
    const d = a - u.turret.yaw;
    return Math.abs(a) <= u.turret.extent && Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.12;
  }
  return Math.abs(a) <= (u.cone ??= (u.type.num('Turret_Rotate_Extent_Degrees', 360) || 360) * DEG);
}

let seed = 99;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const some = l => l[Math.floor(rnd() * l.length)];
const types = [...db.types.values()]
  .filter(t => t.has && t.has('Company_Units'))
  .flatMap(t => t.list('Company_Units').map(n => db.type(n)))
  .filter(Boolean);
const kinds = [...new Set(types)].filter(t => t.str('LandBehavior') || t.str('Behavior')).slice(0, 60);
assert(kinds.length > 10, 'unit types to pick among');
const world = Object.assign(Object.create(LandWorld.prototype), {
  team: [0, 1, 1, 0],
  wild: 3,
  time: 10,
  units: [],
  squads: [],
  shooter: null
});

function field() {
  const foes = [];
  world.fowOn = rnd() < 0.5;
  // companies of one to six, the members one after another and now and then a stranger between them
  for (let c = 0, n = 3 + Math.floor(rnd() * 25); c < n; c++) {
    const side = rnd() < 0.15 ? -1 : Math.floor(rnd() * 4),
      type = some(kinds),
      q = { side, members: [], full: rnd() < 0.3 ? 400 : 0, native: rnd() < 0.5 },
      cx = (rnd() - 0.5) * 900,
      cy = (rnd() - 0.5) * 900,
      hurt = rnd() < 0.4;
    for (let k = 0, m = 1 + Math.floor(rnd() * 6); k < m; k++) {
      const e = {
        squad: rnd() < 0.05 ? null : q,
        side,
        type,
        kind: some(['INFANTRY', 'VEHICLE', 'STRUCTURE', 'AIR']),
        x: rnd() < 0.02 ? undefined : cx + (rnd() - 0.5) * 50,
        y: cy + (rnd() - 0.5) * 50,
        health: hurt ? rnd() * 60 : 60 + rnd() * 40,
        maxHealth: 100,
        dead: rnd() < 0.05,
        cloaked: rnd() < 0.04,
        retreating: rnd() < 0.03,
        inside: rnd() < 0.03,
        noOpportunity: rnd() < 0.05,
        untargetable: rnd() < 0.04,
        limbo: rnd() < 0.02,
        flies: rnd() < 0.1,
        spot: rnd() < 0.03,
        structure: rnd() < 0.1,
        hitRadius: rnd() < 0.5 ? 0 : rnd() * 80,
        vis:
          rnd() < 0.7
            ? new Map([
                [0, { at: world.time - rnd() * 8, cell: 0 }],
                [1, { at: world.time - rnd() * 0.5, cell: 0 }]
              ])
            : null
      };
      if (e.squad) q.members.push(e);
      foes.push(e);
      if (rnd() < 0.1) foes.push(null);
      // one that counts itself to the company without being on its list: its health is its own
      if (m === 1 && e.squad && rnd() < 0.5) foes.push({ ...e, health: hurt ? 90 : 10, x: e.x + 3 });
    }
  }
  // several foes at exactly the same distance from the origin: the first one met has to win the tie
  for (let k = 0; k < 4; k++)
    foes.push({ ...foes.find(e => e && e.x !== undefined), x: 120, y: k % 2 ? 50 : -50, squad: null, dead: false });
  return foes;
}
function picker() {
  const side = Math.floor(rnd() * 4),
    turret = rnd() < 0.3 ? { extent: rnd() * 3.2, yaw: (rnd() - 0.5) * 2 } : null;
  return {
    side,
    type: some(kinds),
    squad: { side, native: true, members: [] },
    x: rnd() < 0.5 ? 0 : (rnd() - 0.5) * 300,
    y: rnd() < 0.5 ? 0 : (rnd() - 0.5) * 300,
    heading: rnd() < 0.02 ? NaN : (rnd() - 0.5) * 12,
    weapon: rnd() < 0.85 ? {} : null,
    turret,
    cone: turret || rnd() < 0.5 ? undefined : rnd() * 7,
    path: [],
    antiAir: rnd() < 0.5,
    confuseUntil: rnd() < 0.08 ? world.time + 5 : 0
  };
}
const gunOf = u =>
  rnd() < 0.7
    ? null
    : {
        spare: new Set(rnd() < 0.5 ? [] : [some(['INFANTRY', 'VEHICLE', 'AIR'])]),
        turret: rnd() < 0.4,
        cone: rnd() < 0.5 ? 7 : rnd() * 5,
        facing: (rnd() - 0.5) * 3,
        onHead: !!u.turret && rnd() < 0.3
      };
const count = { asked: 0, found: 0, none: 0, fired: 0 };
for (let f = 0; f < 150; f++) {
  const foes = field();
  for (let i = 0; i < 40; i++) {
    const u = picker(),
      gun = gunOf(u),
      reach = 60 + rnd() * 700,
      auto = rnd() < 0.6,
      skip = rnd() < 0.2 ? new Set([some(foes), some(foes)]) : null,
      // the same picker for both, each with its own memo fields
      a = { ...u },
      b = { ...u };
    const want = pickPlain.call(world, a, foes, reach, gun, skip, auto),
      got = world.pickFoe(b, foes, reach, gun, skip, auto);
    assert.equal(got, want, `field ${f}, picker ${i}: a different foe than the plain choice`);
    count.asked++;
    if (want) count.found++;
    else count.none++;
    const e = some(foes);
    if (e) {
      assert.equal(world.canFireNow(b, e, gun), canFirePlain.call(world, a, e, gun), `field ${f}, picker ${i}: canFireNow differs`);
      count.fired++;
    }
  }
}
assert(count.found > count.asked * 0.3 && count.none > count.asked * 0.02, `foes found and not found (${count.found} of ${count.asked})`);
console.log(JSON.stringify({ checks: 'pickFoe and canFireNow against the plain versions', ...count }));

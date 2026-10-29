import { db } from '../gamedata.js';
import { fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';
import { simRandom } from './simrandom.js';

let defs = null;

export async function loadClashes() {
  if (defs) return defs;
  defs = [];
  const xml = await fetchText('Data/XML/HeroClash.xml').catch(() => null);
  if (!xml) return defs;
  const all = [];
  (function go(n) {
    all.push(n);
    for (const c of n.children || []) go(c);
  })(parseXML(xml));
  for (const n of all) {
    if ((n.tag || '').toLowerCase() !== 'hero_clash') continue;
    const val = k => {
      const c = n.children.find(x => x.tag.toLowerCase() === k.toLowerCase());
      return c ? String(c.text || '').trim() : '';
    };
    const num = (k, d = 0) => {
      const v = parseFloat(val(k));
      return Number.isFinite(v) ? v : d;
    };
    let win1 = num('First_Hero_Win_Exchange_Chance', 0.3),
      win2 = num('Second_Hero_Win_Exchange_Chance', 0.3);
    if (win1 + win2 > 1) {
      win1 = 0.3;
      win2 = 0.3;
    }
    const side = w => ({
      type: val(w + '_Hero_Type').toUpperCase(),
      mult: num(w + '_Hero_Damage_Multiplier', 1),
      win: val(w + '_Hero_Win_Anim_Type').toUpperCase(),
      lose: val(w + '_Hero_Lose_Anim_Type').toUpperCase(),
      draw: val(w + '_Hero_Draw_Anim_Type').toUpperCase(),
      speech: val(w + '_Hero_Win_Speech')
    });
    defs.push({
      name: n.attrs.Name || '',
      melee: /melee/i.test(val('Clash_Type')),
      range: num('Clash_Range', 0),
      apart: num('Combat_Distance', 18),
      amount: num('Damage_Amount', 0),
      part: num('Damage_Percentage', 0),
      chance: [win1, win2],
      first: side('First'),
      second: side('Second')
    });
  }
  return defs;
}

const fit = (world, u) => !u.dead && !u.inside && !u.clash && !u.flight && !(u.stunUntil > world.time);

export function tickClashes(world) {
  if (!defs || !defs.length || world.time < (world.clashAt || 0)) return;
  world.clashAt = world.time + 0.5;
  for (const d of defs) {
    if (!d.melee || !(d.range > 0)) continue;
    const of = T => world.units.filter(u => u.type.name.toUpperCase() === T && fit(world, u));
    const A = of(d.first.type);
    if (!A.length) continue;
    const B = of(d.second.type);
    for (const a of A)
      for (const b of B) {
        if (a.clash || b.clash || world.ally(a.side, b.side)) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)) > d.range) continue;
        const aims = (u, T) => !u.target || u.target.dead || u.target.type.name.toUpperCase() === T;
        if (!aims(a, d.second.type) || !aims(b, d.first.type)) continue;
        duel(world, d, a, b);
      }
  }
}

function duel(world, d, a, b) {
  const C = { def: d, a, b, state: 'approach', last: 0, healthA: a.health, healthB: b.health };
  a.clash = b.clash = C;
  const mx = (a.x + b.x) / 2,
    my = (a.y + b.y) / 2,
    half = d.apart / 2,
    sa = a.x >= mx ? 1 : -1;
  const spot = new Map([
    [a, { x: mx + sa * half, y: my }],
    [b, { x: mx - sa * half, y: my }]
  ]);
  const hold = u => {
    const q = u.squad;
    q.busy = true;
    q.foe = null;
    q.pending = null;
    q.march = null;
    q.post = null;
    q.legs = null;
    u.path = [];
    u.target = null;
  };
  const face = () => {
    a.heading = Math.atan2(b.y - a.y, b.x - a.x);
    b.heading = Math.atan2(a.y - b.y, a.x - b.x);
  };
  const end = () => {
    for (const u of [a, b]) {
      u.clash = null;
      u.squad.busy = false;
      if (!u.dead) {
        u.path = [];
        u.target = null;
        u.cast = 0;
        world.setAnim(u, 'idle');
      }
    }
    const won = a.dead && !b.dead ? d.second : b.dead && !a.dead ? d.first : null,
      who = a.dead ? b : a;
    if (won && won.speech && world.onSound) world.onSound(won.speech, who.x, who.y);
  };
  let until = 0,
    hurtAt = 0,
    loser = null,
    by = null,
    wait = 0;
  world.effects.push(dt => {
    if (a.dead || b.dead || a.inside || b.inside) {
      end();
      return true;
    }
    hold(a);
    hold(b);
    if (C.state === 'approach') {
      let there = true;
      for (const u of [a, b]) {
        const s = spot.get(u),
          dx = s.x - u.x,
          dy = s.y - u.y,
          dist = Math.hypot(dx, dy),
          step = (u.speed || 30) * dt;
        if (dist <= Math.max(0.5, step)) {
          u.x = s.x;
          u.y = s.y;
          world.setAnim(u, 'idle');
          continue;
        }
        there = false;
        u.heading = Math.atan2(dy, dx);
        u.x += (dx / dist) * step;
        u.y += (dy / dist) * step;
        world.setAnim(u, 'move');
      }
      if (there) {
        face();
        C.state = 'duel';
        until = 0;
      }
      return false;
    }
    face();
    if (loser && world.time >= hurtAt) {
      const base = (loser === a ? C.healthA : C.healthB) * d.part + d.amount;
      world.hurt(loser, Math.round(base * by.mult), loser === a ? b : a);
      loser = null;
      if (a.dead || b.dead) {
        end();
        return true;
      }
    }
    if (world.time < until) return false;
    const odds = [
      [1, d.chance[0]],
      [2, d.chance[1]],
      [3, Math.max(0, 1 - d.chance[0] - d.chance[1])]
    ].filter(o => o[0] !== C.last && o[1] > 0);
    let r = simRandom() * odds.reduce((n, o) => n + o[1], 0),
      out = odds.length ? odds[odds.length - 1][0] : 3;
    for (const o of odds) {
      if ((r -= o[1]) <= 0) {
        out = o[0];
        break;
      }
    }
    const ka = out === 1 ? d.first.win : out === 2 ? d.first.lose : d.first.draw,
      kb = out === 2 ? d.second.win : out === 1 ? d.second.lose : d.second.draw;
    const index = Math.floor(simRandom() * 8);
    a.cast = 0;
    b.cast = 0;
    const okA = world.cast(a, ka, 0, false, 1, index),
      okB = world.cast(b, kb, 0, false, 1, index);
    if ((!okA || !okB) && (wait += dt) < 2) {
      a.cast = 0;
      b.cast = 0;
      return false;
    }
    wait = 0;
    const secs = okA && okB ? Math.max(a.cast, b.cast) - world.time : 1.2;
    C.last = out;
    until = world.time + secs;
    hurtAt = world.time + secs * 0.8;
    loser = out === 1 ? b : out === 2 ? a : null;
    by = out === 1 ? d.first : d.second;
    return false;
  });
}

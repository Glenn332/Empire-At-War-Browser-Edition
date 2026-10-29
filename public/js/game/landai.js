import { Mind, target } from './landbrain.js';
import { garrison, bombingRun } from './landbase.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const MOST = { secure: 3, clear: 2, defend: 2, destroy: 1, scout: 1, garrison: 1, bomb: 1 };

function march(w, q, x, y) {
  const o = w.nearestOpen(x, y, Math.max(...q.members.map(u => u.need || 1))) || w.nearestOpen(x, y);
  if (!o) return;
  q.foe = null; q.post = null; q.legs = null;
  w.order(q, o.x, o.y);
  q.march = { x: o.x, y: o.y };
}

function marchAll(w, force, x, y) {
  for (const [q, p] of w.places(force, x, y)) march(w, q, p.x, p.y);
}

export function commandArmy(game, side) {
  const w = game.world, ai = game.ai[side], brain = game.brains[side] || null;
  const plans = (ai.plans ||= []);
  const own = w.squads.filter(q => q.side === side && q.members.length && !q.structure && !q.arriving && !q.native && !q.members[0].inside && !q.members[0].flies && !q.aiPlan && !q.noAI);
  const foe = u => !u.dead && u.side >= 0 && !w.ally(u.side, side) && !u.cloaked && !u.inside && !u.bomber;
  const mine = w.units.filter(u => u.structure && !u.dead && w.ally(u.side, side));
  const base = mine.find(u => u.isBase) || mine[0] || (own[0] && own[0].members[0]);
  if (!base) return;

  for (const p of plans) p.force = p.force.filter(q => q.members.length && q.side === side);
  for (let i = plans.length - 1; i >= 0; i--) if (!plans[i].force.length || plans[i].over(w)) plans.splice(i, 1);
  const taken = new Set(plans.flatMap(p => p.force));
  const free = () => own.filter(q => !taken.has(q) && !q.busy && !q.pending && !q.entering);
  const nearest = (list, at) => list.slice().sort((a, b) => dist(a.members[0], at) - dist(b.members[0], at));
  const start = (kind, tgt, force, fn) => { const p = { kind, target: tgt, force, born: w.time, ...fn }; plans.push(p); for (const q of force) taken.add(q); return p; };
  const running = (kind, tgt) => plans.some(p => p.kind === kind && p.target === tgt);

  const seenAt = (ai.seenAt ||= new Map());
  const mind = brain ? new Mind(brain, w, side, { difficulty: game.players[side].difficulty || 'Normal', seen: t => w.time - (seenAt.get(t.key) ?? 0) }) : null;
  const want = [];
  const ask = (kind, goals, tgt, thing) => { let d = mind ? -Infinity : 1, goal = goals[0]; if (mind) for (const g of goals) { const v = mind.desire(g, tgt); if (v > d) { d = v; goal = g; } } if (d > 0) want.push({ kind, d, thing, tgt, goal }); };
  for (const s of mine) ask('defend', ['Defend_Structure'], target.unit(s), s);
  for (const pt of w.points) {
    const place = target.place(pt.x, pt.y);
    if (own.some(q => dist(q.members[0], pt) < 500) || mine.some(s => dist(s, pt) < 400)) seenAt.set(place.key, w.time);
    if (!(pt.side >= 0 && w.ally(pt.side, side)) && !pt.locked) ask('secure', ['Secure_Contestable'], target.point(pt), pt);
    ask('scout', ['Land_Scout_Area'], place, pt);
  }
  const enemies = w.units.filter(foe);
  for (const u of enemies) {
    if (u.structure) { if (u.side < w.factions.length || u.house) ask('destroy', ['Destroy_Structure', 'Destroy_Turbolaser'], target.unit(u), u); }
    else if (u.squad.members[0] === u) { ask('clear', ['Clear_Infantry', 'Clear_Vehicles'], target.place(u.x, u.y), u); ask('clear', ['Destroy_Land_Unit'], target.unit(u), u); }
  }
  for (const s of mine) if (s.slots && s.ports) ask('garrison', ['Garrison_Bunker'], target.unit(s), s);
  if (mind && mind.see('Variable_Self.IsBombingRunAvailable', [], null)) for (const u of enemies) if (u.structure || u.squad.members[0] === u) ask('bomb', ['Land_Bombing_Run'], target.unit(u), u);
  want.sort((a, b) => b.d - a.d);
  ai.wants = want.slice(0, 12).map(x => [x.kind, x.thing.type ? x.thing.type.name : 'place', +x.d.toFixed(1)]);

  let secures = plans.filter(p => p.kind === 'secure').length, clears = plans.filter(p => p.kind === 'clear').length;
  const scripts = game.scripts && !game.scripts.off ? game.scripts : null, cmdr = scripts ? scripts.commanders[side] : null;
  if (cmdr) cmdr.look(mind, [...new Set(enemies.map(u => u.squad).filter(Boolean))]);
  for (const { kind, thing, goal } of want) {
    if (cmdr && mind && cmdr.plan(goal, scripts.thing(thing), MOST[kind] || 1)) continue;
    if (kind === 'bomb') { if (!ai.bombed || w.time - ai.bombed > 20) { if (!bombingRun(w, side, thing.x, thing.y)) ai.bombed = w.time; } continue; }
    if (running(kind, kind === 'clear' ? thing.squad : thing)) continue;

    if (kind === 'defend') {
      const s = thing, force = nearest(own.filter(q => dist(q.members[0], s) < 1400 && !plans.some(p => p.kind === 'defend' && p.force.includes(q))), s).slice(0, 20);
      if (!force.length) continue;
      for (const p of plans) p.force = p.force.filter(q => !force.includes(q));
      start('defend', s, force, {
        step() {
          const e = w.units.filter(u => foe(u) && dist(u, s) < 500).sort((a, b) => dist(a, s) - dist(b, s))[0];
          this.quiet = e ? w.time : (this.quiet ?? w.time);
          const go = e ? this.force.filter(q => q.foe !== e.squad && !q.members.some(u => u.target)) : [];
          for (const q of go) q.march = q.post = null;
          if (go.length > 1) w.attackGroup(go, e.squad); else if (go.length) w.attack(go[0], e.squad);
          for (const q of this.force) {
            if (e) continue;
            if (!q.post && !q.foe) { march(w, q, s.x, s.y); q.post = q.march ? { x: q.march.x, y: q.march.y } : null; q.march = null; }
          }
        },
        over() { return s.dead || (this.quiet !== undefined && w.time - this.quiet > 12 && !w.units.some(u => foe(u) && dist(u, s) < 500)); },
      });
    } else if (kind === 'secure') {
      if (secures >= 3) continue;
      const pt = thing, takers = nearest(free().filter(q => q.members[0].captures), pt);
      if (!takers.length) continue;
      const main = takers[0], spare = free().filter(q => q !== main);
      const escort = spare.length > 2 ? nearest(spare, pt)[0] : null, force = escort ? [main, escort] : [main];
      for (const q of force) march(w, q, pt.x + 25, pt.y);
      secures++;
      start('secure', pt, force, {
        step() {
          for (const q of this.force) {
            const lead = q.members[0];
            if (!q.post && dist(lead, pt) < 90 && !q.members.some(u => u.path.length)) q.post = { x: lead.x, y: lead.y };
            else if (!q.post && !q.foe && !q.members.some(u => u.path.length || u.target)) march(w, q, pt.x + 25, pt.y);
          }
          if (pt.side >= 0 && w.ally(pt.side, side)) this.held ??= w.time;
        },
        over() { return (this.held !== undefined && w.time - this.held > 30) || w.time - this.born > 240; },
      });
    } else if (kind === 'clear') {
      if (clears >= 2 || !free().length) continue;
      const prey = thing.squad, force = nearest(free(), thing).slice(0, 5);
      for (const q of force) q.post = null;
      marchAll(w, force, thing.x, thing.y);
      clears++;
      start('clear', prey, force, {
        step() {
          const m = prey.members[0];
          for (const q of this.force) if (m && !q.foe && !q.members.some(u => u.path.length || u.target)) (dist(q.members[0], m) < q.members[0].range * 1.2 ? w.attack(q, prey) : march(w, q, m.x, m.y));
        },
        over() { return !prey.members.length || w.time - this.born > 150; },
      });
    } else if (kind === 'destroy') {
      const attack = plans.find(p => p.kind === 'destroy'), fighters = free();
      if (attack) { if (attack.force.length < 10 && fighters.length >= 2) for (const q of fighters.slice(0, 10 - attack.force.length)) { attack.force.push(q); taken.add(q); march(w, q, attack.target.x, attack.target.y); } continue; }
      if (!(fighters.length >= 3 || own.length >= 8) || !fighters.length) continue;
      const tgt = thing, force = nearest(fighters, base).slice(0, 10);
      marchAll(w, force, tgt.x, tgt.y);
      start('destroy', tgt, force, {
        step() {
          for (const q of this.force) {
            if (q.foe || q.members.some(u => u.path.length || u.target)) continue;
            if (dist(q.members[0], tgt) < Math.max(q.members[0].range, 150) + tgt.hitRadius) w.attack(q, tgt.squad); else march(w, q, tgt.x, tgt.y);
          }
        },
        over() { return tgt.dead || !w.units.includes(tgt); },
      });
    } else if (kind === 'scout') {
      if (plans.some(p => p.kind === 'scout')) continue;
      const idle = nearest(free(), thing)[0];
      if (!idle) continue;
      march(w, idle, thing.x + 40, thing.y);
      start('scout', thing, [idle], { step() {}, over() { const q = this.force[0]; return !q || (!q.march && !q.foe && !q.members.some(u => u.path.length)) || w.time - this.born > 180; } });
    } else if (kind === 'garrison') {
      const q = nearest(free().filter(x => x.members[0].foot), thing)[0];
      if (q && !garrison(w, q, thing)) start('garrison', thing, [q], { step() {}, over() { return thing.dead || w.time - this.born > 60; } });
    }
  }

  for (const p of plans) p.step();
}

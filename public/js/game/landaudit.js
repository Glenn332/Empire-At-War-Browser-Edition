import { db } from '../gamedata.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function audit(game, side, { seconds = 14, only = null } = {}) {
  const g = game, W = g.world, H = g.scripts.host, P = H.plans, G = g.goalsOff || g.goals, b = g.brains[side], cmdr = g.scripts.commanders[side];
  g.goalsOff = G; g.goals = { tick: () => true, sides: G.sides };
  H.instances = H.instances.filter(i => !i.fs);
  for (const p of P.live.slice()) P.stop(p);
  W.popOverride = 200;
  const out = (window.AUDIT = { done: false, rows: [], spawned: [] });
  const goals = [...b.defs].filter(([n, d]) => (!d.mode || d.mode === 'LAND') && b.fnOf.has(n) && P.byGoal.has(n) && (!only || only.includes(n))).map(x => x[0]);
  const faction = (W.factions[side] || '').toUpperCase();
  const base = W.units.find(u => u.side === side && u.isBase) || W.units.find(u => u.side === side && u.structure);
  const want = new Set();
  for (const q of W.squads) if (q.side === side && q.structure && q.members[0]) for (const t of P.world.buildOptions(q, cmdr.player)) if (t.has('Company_Units')) want.add(t);
  const named = new Set();
  for (const name of goals) for (const key of P.byGoal.get(name) || []) for (const n of P.needs.get(key) || []) for (const t of n.types || []) named.add(t);
  const mine = t => { const a = t.str('Affiliation').toUpperCase(); return !a || a.includes(faction); };
  for (const t of named) {
    if (t.has('Company_Units')) { want.add(t); continue; }
    const comps = [...db.types.values()].filter(c => c.has('Company_Units') && (c.list('Company_Units').some(n => db.type(n) === t || (db.type(n) && db.type(n).parent === t)) || db.type(c.str('Create_Team_Type')) === t));
    const pick = comps.find(c => mine(c) && /_MP$|Land_MP/i.test(c.name)) || comps.find(mine) || comps[0];
    if (pick) want.add(pick); else out.spawned.push('no company for ' + t.name);
  }
  let k = 0;
  for (const t of want) {
    for (let n = 0; n < (/(Infantry|Stormtrooper|Trooper|Merc)_Squad|Plex|Tank_Buster/i.test(t.name) ? 2 : 1); n++) {
      try { await W.spawn(t.name, base.x + 150 + (k % 6) * 80, base.y - 250 + Math.floor(k / 6) * 80, 0, side); out.spawned.push(t.name); } catch (e) { out.spawned.push(t.name + ': ' + String(e.message).slice(0, 50)); }
      k++;
    }
  }
  await sleep(800);
  const spots = new Map();
  for (const q of W.squads) if (q.side === side && !q.structure && q.members[0]) spots.set(q, { x: q.members[0].x, y: q.members[0].y });
  const reset = () => {
    for (const p of P.live.slice()) P.stop(p);
    for (const u of W.units) if (u.side >= 0) { u.invulnUntil = Infinity; u.health = u.maxHealth; }
    for (const q of W.squads) {
      if (q.side !== side || q.structure || q.arriving) continue;
      if (q.members.some(m => !m || typeof m !== 'object')) { out.spawned.push('ODD SQUAD ' + q.type.name + ' members ' + JSON.stringify([...q.members].map(m => typeof m))); continue; }
      W.stop(q); q.aiPlan = null; q.fsKind = null; q.entering = null; q.busy = false; q.pending = null;
      const at = spots.get(q);
      for (const u of q.members) { if (u.inside) { u.inside = null; if (u.holder) u.holder.visible = true; } if (at && !u.flies) { u.x = at.x + (u.off ? u.off.x : 0); u.y = at.y + (u.off ? u.off.y : 0); u.path = []; u.target = null; } }
      if (q.box) { q.box.path.length = 0; if (at) { q.box.x = at.x; q.box.y = at.y; } q.box.lay = null; }
    }
    for (const u of W.units) if (u.holds) u.holds.length = 0;
    W.credits[side] = 500000;
  };
  const S = G.state(side);
  for (const name of goals) {
    if (W.loser >= 0) break;
    reset();
    await sleep(300);
    const def = b.defs.get(name), mind = G.mind(side, S);
    cmdr.look(mind, []);
    const ts = G.targets(side, def.bits);
    let best = ts[0], bd = -1e18;
    for (const t of ts) { const d = mind.desire(name, t); if (d > bd) { bd = d; best = t; } }
    if (!(bd > 0)) {
      const u = t => t && t.unit;
      if (/BUNKER/.test(name)) best = ts.find(t => u(t) && u(t).slots && u(t).structure) || best;
      else if (/TRANSPORT/.test(name)) best = ts.find(t => u(t) && u(t).slots && !u(t).structure) || best;
      else if (/TURBOLASER/.test(name)) best = ts.find(t => u(t) && /TURBO/i.test(u(t).type.name)) || best;
      const jobs = (P.byGoal.get(name) || []).flatMap(kk => P.builds.get(kk) || []).flatMap(j => j.types);
      if (jobs.length) best = ts.find(t => t && t.site && P.world.buildOptions(G.thingOf(t), cmdr.player).some(o => jobs.includes(o))) || best;
    }
    const r0 = H.report(), e0 = new Set(Object.keys(r0.errors)), m0 = new Set(Object.keys(r0.missing)), i0 = new Set(r0.inert);
    const count = () => ({ built: W.squads.filter(q => q.side === side && q.structure && q.members.length).length + W.sites.filter(s => s.building && s.building.side === side).length, troops: W.squads.filter(q => q.side === side && !q.structure && q.members.length).length + W.queues[side].units.length + W.ready[side].length, own: [...W.owned[side]].length, inside: W.units.filter(x => x.side === side && x.inside).length, abil: W.squads.filter(q => q.side === side).reduce((a, q) => a + (q.abilities || []).filter(s => s.active || s.cooldown > 0).length, 0) });
    const c0 = count();
    const thing = best === undefined ? undefined : G.thingOf(best), key = (P.byGoal.get(name) || [])[0];
    const row = { goal: name, plan: key, kind: P.buys.has(key) ? 'buy' : P.builds.has(key) ? 'build' : 'troops', targets: ts.length, tgt: best && best.type ? best.type.name : best && best.zone ? 'zone' : best === null ? 'global' : 'none', desire: +bd.toFixed(1) };
    row.staff = best === undefined ? false : P.staffable(cmdr, name, thing && thing.isSite ? thing : null, { mind, t: best });
    let inst = null;
    try { if (best !== undefined) inst = P.start(cmdr, name, thing, { mind, t: best }); } catch (e) { row.err = e.message; }
    row.started = !!inst;
    if (!inst) row.needs = (P.needs.get(key) || []).map(n => (n.cats || n.types.map(t => t.name)).join('|') + '>=' + n.min).join(' ; ');
    else {
      const orders = new Set(), t0 = W.time;
      let most = 0, overAt = null;
      while (W.time - t0 < seconds && W.loser < 0) {
        await sleep(250);
        let n = 0;
        for (const f of inst.forces || []) for (const q of f.units) { n++; orders.add(q.foe ? 'attack' : q.entering ? 'enter' : q.march ? 'march' : q.post ? 'guard' : q.members && q.members.some(u => u.path && u.path.length) ? 'move' : 'idle'); }
        most = Math.max(most, n);
        if (inst.state === 'over' && overAt === null) { overAt = +(W.time - t0).toFixed(1); break; }
      }
      const c1 = count(), r1 = H.report();
      Object.assign(row, { state: inst.state, overAt, units: most, forces: (inst.forces || []).map(f => f.name + (f.had ? '' : '(never)')).join(' '), threads: (inst.threads || []).length, result: inst.result, orders: [...orders].join(','),
        did: Object.entries(c1).filter(([kk, v]) => v !== c0[kk]).map(([kk, v]) => kk + (v > c0[kk] ? '+' : '') + (v - c0[kk])).join(' '),
        errors: Object.entries(r1.errors).filter(([kk]) => !e0.has(kk)).map(([kk, v]) => kk + ': ' + String(v).slice(0, 220)), missing: Object.keys(r1.missing).filter(kk => !m0.has(kk)), inert: r1.inert.filter(kk => !i0.has(kk)) });
    }
    out.rows.push(row);
  }
  reset();
  out.done = true;
  out.text = out.rows.map(r => [r.goal, r.kind, r.tgt, r.desire, r.started ? 'OK ' + r.state + (r.overAt !== null ? '@' + r.overAt : '') + ' units:' + r.units + ' [' + r.forces + '] res:' + r.result + ' ord:' + r.orders + (r.did ? ' did:' + r.did : '') : 'NOSTART staff:' + r.staff + ' ' + (r.err || '') + ' needs:' + r.needs, (r.errors || []).join(' || '), (r.missing || []).join(','), (r.inert || []).join(',')].filter((x, i) => i < 5 || x).join(' | '));
  return out;
}

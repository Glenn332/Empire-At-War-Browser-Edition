import { db } from '../gamedata.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const breath = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const isUpgrade = t => /UPGRADE/i.test(t.tag) || t.has('Tactical_Build_Increments_Tech_Level');

export async function audit(game, ai, { seconds = 10, only = null, near = false, pump = false } = {}) {
  const sleep = !pump ? wait : async ms => { const raf = window.requestAnimationFrame; for (let t = 0; t < ms; t += 25) { window.requestAnimationFrame = () => 0; try { game.frame(game.last + 25); } finally { window.requestAnimationFrame = raf; } await breath(); } };
  const W = game.world, H = W.scripts, P = H.plans, G = W.goalsOff || W.goals, b = ai.brain, p = ai.player;
  W.goalsOff = G; W.goals = { tick: () => true, sides: G.sides };
  H.instances = H.instances.filter(i => !i.fs);
  for (const x of P.live.slice()) P.stop(x);
  p.popCap = 500;
  const out = (window.AUDIT = { done: false, rows: [], spawned: [] });
  const goals = [...b.defs].filter(([n, d]) => (!d.mode || d.mode === 'SPACE') && b.fnOf.has(n) && P.byGoal.has(n) && (!only || only.includes(n))).map(x => x[0]);
  const st = p.station || W.units.find(u => u.player === p && u.isStructure);
  const want = new Set(), faction = (p.factionName || '').toUpperCase();
  for (const q of W.buildersOf(p)) for (const t of W.buildOptions(q, p)) if (!isUpgrade(t) && !t.has('Tactical_Buildable_Constructed')) want.add(t);
  const mine = t => { const a = t.str('Affiliation').toUpperCase(); return !a || a.includes(faction); };
  for (const name of goals) for (const key of P.byGoal.get(name) || []) for (const n of P.needs.get(key) || []) for (const t of n.types || []) {
    if (t.has('Tactical_Buildable_Constructed')) continue;
    const sq = [...db.types.values()].filter(c => c.list('Squadron_Units').some(x => db.type(x) === t));
    want.add(sq.find(mine) || sq[0] || t);
  }
  let k = 0;
  for (const t of want) {
    for (let n = 0; n < (t.has('Squadron_Units') ? 3 : 1); n++, k++) try { const e = W.spawn(t, p, st.x + 500 + (k % 6) * 260, st.y - 700 + Math.floor(k / 6) * 260, 0); out.spawned.push(e ? t.name : t.name + ': no'); } catch (e) { out.spawned.push(t.name + ': ' + String(e.message).slice(0, 50)); }
  }
  for (const u of W.units) if (!u.dead && u.isPad && !u.padChild && (!u.padOwner || u.padOwner.id < 0)) { try { u.padOwner = p; } catch { } }
  const foe = W.players.find(x => x.id >= 0 && x.team !== p.team);
  if (foe) {
    const ff = (foe.factionName || '').toUpperCase(), of = c => [...db.types.values()].find(t => t.str('Affiliation').toUpperCase().includes(ff) && new RegExp(c, 'i').test(t.str('CategoryMask')) && t.num('Tactical_Build_Cost_Multiplayer', 0) > 0 && t.bool('Has_Space_Evaluator') && !t.has('Squadron_Units') && !isUpgrade(t) && !t.has('Tactical_Buildable_Constructed'));
    const at = near ? { x: st.x - 1800, y: st.y + 600 } : { x: (W.min.x + W.max.x) / 2, y: (W.min.y + W.max.y) / 2 };
    for (const t of [of('Frigate'), of('Capital')]) { if (!t) continue; try { W.spawn(t, foe, at.x, at.y + out.spawned.length * 30, 0); out.spawned.push('foe ' + t.name); } catch (e) { out.spawned.push('foe ' + t.name + ': ' + e.message); } }
  }
  await sleep(800);
  const fleet = () => ai.mine();
  const spots = new Map(fleet().map(e => [e, { x: e.x, y: e.y }]));
  const heal = u => { u.health = u.maxHealth; if (u.maxShield) u.shield = u.maxShield; for (const h of u.hardpoints || []) if (h.alive && h.maxHealth) h.health = h.maxHealth; };
  const reset = () => {
    for (const x of P.live.slice()) P.stop(x);
    for (const u of W.units) if (!u.dead && u.player.id >= 0) heal(u);
    for (const e of fleet()) {
      e.aiPlan = null; e.fsKind = null; e.setOrder({ kind: 'idle' });
      const at = spots.get(e);
      if (!at) continue;
      const dx = at.x - e.x, dy = at.y - e.y;
      for (const u of e.isSquad ? e.fighters : [e]) { u.x += dx; u.y += dy; u.speed = 0; u.target = null; u.route = null; if (u.syncObj) u.syncObj(); }
      if (e.isSquad) { e.x = at.x; e.y = at.y; e.target = null; e.about = null; }
    }
    p.credits = 500000;
  };
  const S = G.state(ai);
  for (const name of goals) {
    if (p.defeated || W.over) break;
    reset();
    await sleep(300);
    const def = b.defs.get(name), mind = G.mind(ai, S);
    const ts = G.targets(ai, def.bits);
    let best = ts[0], bd = -1e18;
    for (const t of ts) { const d = mind.desire(name, t); if (d > bd) { bd = d; best = t; } }
    const jobs = (P.byGoal.get(name) || []).flatMap(kk => P.builds.get(kk) || []).flatMap(j => j.types);
    if (!(bd > 0) && jobs.length) best = ts.find(t => t && t.unit && t.unit.isPad && !t.unit.padChild && W.buildOptions(t.unit, p).some(o => jobs.includes(o))) || best;
    const r0 = H.report(), e0 = new Set(Object.keys(r0.errors)), m0 = new Set(Object.keys(r0.missing)), i0 = new Set(r0.inert);
    const count = () => ({ built: W.units.filter(u => !u.dead && u.player === p && u.isStructure && !u.isPad).length + W.units.filter(u => !u.dead && u.isPad && u.padOwner === p && u.padChild).length, ships: fleet().length + W.buildersOf(p).reduce((a, q) => a + W.queuesOf(q, p).reduce((c, [, l]) => c + l.length, 0), 0) + p.reinforcements.length, pads: W.units.filter(u => !u.dead && u.isPad && u.padOwner === p).length, abil: fleet().reduce((a, e) => a + (e.abilities || []).filter(s => s.active || s.cooldown > 0).length, 0), tech: p.techLevel });
    const c0 = count();
    const thing = best === undefined ? undefined : G.thingOf(best), key = (P.byGoal.get(name) || [])[0];
    const row = { goal: name, plan: key, kind: P.buys.has(key) ? 'buy' : P.builds.has(key) ? 'build' : 'ships', targets: ts.length, tgt: best && best.type ? best.type.name : best && best.rect ? 'region' : best === null ? 'global' : 'none', desire: +bd.toFixed(1) };
    row.staff = best === undefined ? false : P.staffable(ai, name, thing && thing.isPad ? thing : null, { mind, t: best });
    let inst = null;
    try { if (best !== undefined) inst = P.start(ai, name, thing, { mind, t: best }); } catch (e) { row.err = e.message; }
    row.started = !!inst;
    if (!inst) row.needs = (P.needs.get(key) || []).map(n => (n.cats || n.types.map(t => t.name)).join('|') + '>=' + n.min).join(' ; ');
    else {
      const orders = new Set(), t0 = W.time;
      let most = 0, overAt = null;
      while (W.time - t0 < seconds && !p.defeated) {
        await sleep(250);
        let n = 0;
        for (const f of inst.forces || []) for (const e of f.units) { n++; orders.add(e.order ? e.order.kind : '?'); }
        most = Math.max(most, n);
        if (inst.state === 'over' && overAt === null) { overAt = +(W.time - t0).toFixed(1); break; }
      }
      const c1 = count(), r1 = H.report();
      Object.assign(row, { state: inst.state, overAt, units: most, forces: (inst.forces || []).map(f => f.name + (f.had ? '' : '(never)')).join(' '), result: inst.result, orders: [...orders].join(','),
        did: Object.entries(c1).filter(([kk, v]) => v !== c0[kk]).map(([kk, v]) => kk + (v > c0[kk] ? '+' : '') + (v - c0[kk])).join(' ') + (p.credits < 499990 ? ' spent' : ''),
        errors: Object.entries(r1.errors).filter(([kk]) => !e0.has(kk)).map(([kk, v]) => kk + ': ' + String(v).slice(0, 220)), missing: Object.keys(r1.missing).filter(kk => !m0.has(kk)), inert: r1.inert.filter(kk => !i0.has(kk)) });
    }
    out.rows.push(row);
  }
  reset();
  out.done = true;
  out.text = out.rows.map(r => [r.goal, r.kind, r.tgt, r.desire, r.started ? 'OK ' + r.state + (r.overAt !== null ? '@' + r.overAt : '') + ' units:' + r.units + ' [' + r.forces + '] res:' + r.result + ' ord:' + r.orders + (r.did ? ' did:' + r.did : '') : 'NOSTART staff:' + r.staff + ' ' + (r.err || '') + ' needs:' + r.needs, (r.errors || []).join(' || '), (r.missing || []).join(','), (r.inert || []).join(',')].filter((x, i) => i < 5 || x).join(' | '));
  return out;
}

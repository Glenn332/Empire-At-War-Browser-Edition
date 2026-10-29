import { db } from '../gamedata.js';
import { bombingRun, garrison, ungarrison } from './landbase.js';
import { SILENT } from './landabilities.js';

export function executeLand(game, side, cmd) {
  const w = game.world;
  const squad = id => (id ? w.squads.find(q => q.id === id && !q.dead) || null : null);
  const own = () => (Array.isArray(cmd.u) ? cmd.u : []).map(squad).filter(q => q && q.side === side);
  const movers = () => own().filter(q => q.isMobile && !q.native);
  const num = v => (Number.isFinite(+v) ? +v : 0);
  switch (cmd.c) {
    case 'move': {
      const sel = movers();
      if (!sel.length) return {};
      const foe = cmd.t ? squad(cmd.t) : null,
        attack = !!(foe && !w.ally(foe.side, side));
      const g = cmd.x !== undefined ? { x: num(cmd.x), y: num(cmd.y) } : null,
        mode = cmd.mode || '';
      if (!attack && !g) return {};
      const at = !attack && g && mode !== 'waypoint' ? w.places(sel, g.x, g.y) : new Map();
      const together = attack && sel.length > 1;
      if (together) w.attackGroup(sel, foe);
      let why = null;
      for (const q of sel) {
        q.pending = null;
        q.busy = false;
        q.march = q.post = null;
        if (mode !== 'waypoint') q.legs = null;
        if (!attack && g && mode === 'attack' && q.members.some(u => u.needsDeploy && u.weapon)) {
          w.bombard(q, g.x, g.y);
          continue;
        }
        if (attack) {
          if (!together) w.attack(q, foe);
          const gun = q.members.find(u => u.minRange > 0),
            f = foe.members[0] || foe;
          if (gun && Math.hypot(gun.x - f.x, gun.y - f.y) < gun.minRange) why = 'Too close: the target is inside its minimum range';
        } else if (mode === 'waypoint') (q.legs ||= []).push({ x: g.x, y: g.y });
        else {
          const p = at.get(q) || { x: g.x, y: g.y, face: null };
          q.foe = null;
          w.order(q, p.x, p.y, p.face);
          if (mode === 'attackmove') q.march = { x: p.x, y: p.y };
          else if (mode === 'guard') q.post = { x: p.x, y: p.y };
        }
      }
      return why ? { why, soft: true, at } : { at };
    }
    case 'formmove': {
      const mode = cmd.mode || '';
      for (const [id, x, y] of Array.isArray(cmd.p) ? cmd.p : []) {
        const q = squad(id);
        if (!q || q.side !== side || q.structure || !q.members.length) continue;
        q.pending = null;
        q.busy = false;
        q.march = q.post = null;
        q.legs = null;
        q.foe = null;
        w.order(q, num(x), num(y), num(cmd.h));
        if (mode === 'attackmove') q.march = { x: num(x), y: num(y) };
      }
      return {};
    }
    case 'stop':
      for (const q of movers()) w.stop(q);
      return {};
    case 'garrison': {
      const host = squad(cmd.t)?.members[0];
      if (!host || !w.ally(host.side, side)) return {};
      let why = null,
        any = false;
      for (const q of movers()) {
        const no = garrison(w, q, host);
        if (no) why = no;
        else any = true;
      }
      return !any && why ? { why } : {};
    }
    case 'ungarrison': {
      for (const s of own()) {
        const u = s.structure && s.members[0];
        if (u && u.holds && u.holds.length) ungarrison(w, u, num(cmd.x), num(cmd.y));
      }
      return {};
    }
    case 'ability': {
      const users = own().filter(q => q.abilityState && q.abilityState(cmd.kind));
      if (!users.length) return {};
      const def = users[0].abilityState(cmd.kind).def;
      let why = null,
        done = false;
      if (def.aim === 'none') {
        for (const q of users) {
          if (cmd.on !== undefined && !!q.abilityState(cmd.kind).active === !!cmd.on) continue;
          why = w.useAbility(q, cmd.kind) || why;
        }
        return { done: true };
      }
      const tq = cmd.t ? squad(cmd.t) : null,
        tu = tq ? tq.members[num(cmd.m)] || tq.members[0] : null;
      for (const q of users) {
        if (q.dead) continue;
        const d = q.abilityState(cmd.kind).def,
          tgt = d.aim === 'point' ? (cmd.x !== undefined ? { x: num(cmd.x), y: num(cmd.y) } : null) : { unit: tu };
        if (!tgt || (d.aim !== 'point' && !tu)) continue;
        const no = w.useAbility(q, cmd.kind, tgt);
        if (no) why = no;
        else done = true;
      }
      return !done && why && why !== SILENT ? { why } : {};
    }
    case 'autofire': {
      (w.autofireSides ||= new Set())[cmd.on ? 'add' : 'delete'](side);
      for (const q of w.squads) if (q.side === side) for (const st of q.abilities) if (st.def?.autofire) st.auto = !!cmd.on;
      return {};
    }
    case 'auto': {
      for (const q of own())
        for (const f of [q, ...(q.members || [])]) {
          const a = f.abilities?.find?.(x => x.def?.kind === cmd.kind);
          if (a && a.def.autofire) a.auto = !!cmd.on;
        }
      return {};
    }
    case 'reinforce': {
      const x = num(cmd.x),
        y = num(cmd.y),
        i = w.ready[side].findIndex(t => t.name === cmd.type);
      if (i < 0) return {};
      const why = w.cantReinforce(side, cmd.type, x, y);
      if (why) return { why };
      const t = w.ready[side][i];
      w.ready[side].splice(i, 1);
      w.reinforce(side, t.name, x, y, num(cmd.h));
      return {};
    }
    case 'bomb': {
      const why = bombingRun(w, side, num(cmd.x), num(cmd.y));
      return why ? { why } : {};
    }
    case 'build': {
      const pad = typeof cmd.b === 'string' && cmd.b.startsWith('site') ? w.sites[+cmd.b.slice(4)] : null,
        b = pad ? null : squad(cmd.b),
        t = db.type(cmd.type);
      if ((!pad && !b) || !t) return {};
      if (b && !w.ally(b.side, side)) return {};
      const siteFor = () => {
        if (pad) return w.siteOptions(pad, side).includes(t) ? pad : null;
        let best = null,
          bd = Infinity;
        for (const s of w.sites) {
          if (!s.base || !w.siteOptions(s, side).includes(t)) continue;
          const d = Math.hypot(s.x - b.x, s.y - b.y);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        return best;
      };
      let why = null;
      const n = Math.max(1, Math.min(5, num(cmd.n) | 0));
      for (let i = 0; i < n && !why; i++) {
        const s = siteFor(),
          u = b && b.members[0];
        why = s ? w.startSite(s, t, side) : u ? w.buy(u, t, side) : 'Cannot be built there';
      }
      return why && n === 1 ? { why } : {};
    }
    case 'retreat':
      game.landRetreat?.request(side);
      return {};
    case 'cancel': {
      if (cmd.q === 'units' || cmd.q === 'upgrades') {
        const q = w.queues[side][cmd.q];
        if (!q[cmd.i] || (cmd.type && (q[cmd.i].type?.name ?? q[cmd.i].name) !== cmd.type)) return {};
        w.cancel(side, q, cmd.i);
      } else {
        const s = w.sites[+String(cmd.q).slice(4)];
        if (s && s.building && s.building.side === side) w.cancelSite(s);
      }
      return {};
    }
  }
  return {};
}

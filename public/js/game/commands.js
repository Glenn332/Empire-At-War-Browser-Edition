import { db } from '../gamedata.js';
import { orderMove, orderAttack, orderGuard, orderStop, orderPlaced } from './orders.js';
import { Beacons, beaconType } from './beacons.js';

export const ids = list => list.map(e => e.id);

function finder(world) {
  let map = null;
  return id => {
    if (!id) return null;
    if (!map) {
      map = new Map();
      for (const u of world.units) map.set(u.id, u);
      for (const s of world.squads) {
        map.set(s.id, s);
        for (const f of s.fighters) map.set(f.id, f);
      }
    }
    const e = map.get(id);
    return e && !e.dead ? e : null;
  };
}

export function execute(world, player, cmd) {
  const find = finder(world);
  const own = () => (Array.isArray(cmd.u) ? cmd.u : []).map(find).filter(e => e && e.player === player);
  const num = v => (Number.isFinite(+v) ? +v : 0);
  const clampX = x => Math.max(world.min.x, Math.min(world.max.x, num(x))),
    clampY = y => Math.max(world.min.y, Math.min(world.max.y, num(y)));
  switch (cmd.c) {
    case 'move': {
      const mine = own().filter(s => s.isSquad || s.isMobile || s.hasWeapons);
      if (mine.length) orderMove(mine, clampX(cmd.x), clampY(cmd.y), !!cmd.attack, !!cmd.waypoint);
      return {};
    }
    case 'formmove': {
      const placed = (Array.isArray(cmd.p) ? cmd.p : [])
        .map(([id, x, y]) => ({ e: find(id), x: clampX(x), y: clampY(y) }))
        .filter(o => o.e && o.e.player === player && !o.e.dead && (o.e.isSquad || o.e.isMobile));
      if (placed.length) orderPlaced(placed, num(cmd.h), !!cmd.attack);
      return {};
    }
    case 'attack': {
      const mine = own().filter(s => s.isSquad || s.isMobile || s.hasWeapons),
        t = find(cmd.t);
      if (!mine.length || !t || t.player.id < 0 || t.player.team === player.team || t.isPad) return {};
      const hp = cmd.hp >= 0 && t.hardpoints ? t.hardpoints[cmd.hp] || null : null;
      orderAttack(mine, t, hp);
      return {};
    }
    case 'guard': {
      const mine = own().filter(s => s.isSquad || s.isMobile || s.hasWeapons),
        t = cmd.t ? find(cmd.t) : null;
      if (!mine.length) return {};
      if (cmd.t && (!t || t.player.team !== player.team)) return {};
      orderGuard(mine, t, t ? t.x : clampX(cmd.x), t ? t.y : clampY(cmd.y));
      return {};
    }
    case 'stop':
      orderStop(own());
      return {};
    case 'ability': {
      const users = own().filter(s => s.abilityState && s.abilityState(cmd.kind));
      if (!users.length) return {};
      let target = null;
      if (cmd.t) {
        target = find(cmd.t);
        if (!target) return { why: 'Not a valid target' };
      } else if (cmd.x !== undefined) target = { x: clampX(cmd.x), y: clampY(cmd.y), z: num(cmd.z) };
      let why = null,
        ok = false;
      for (const s of users) {
        const r = world.useAbility(s, cmd.kind, !!cmd.on, target, !!target);
        if (r) why ||= r;
        else ok = true;
      }
      return ok ? { ok: true } : { why: why || 'Not ready' };
    }
    case 'auto': {
      for (const e of own())
        for (const f of e.isSquad ? e.fighters : [e]) {
          const a = f.abilities?.find(x => x.def.kind === cmd.kind);
          if (a && a.def.autofire) a.auto = !!cmd.on;
        }
      return {};
    }
    case 'beacon': {
      const b = (world.beacons ||= new Beacons()).place(
        player,
        beaconType(player.faction),
        clampX(cmd.x),
        clampY(cmd.y),
        num(cmd.z),
        world.time
      );
      if (b) world.onEvent('beacon', { beacon: b });
      return {};
    }
    case 'autofire': {
      player.autofire = !!cmd.on;
      for (const u of world.units) if (u.player === player) for (const a of u.abilities || []) if (a.def.autofire) a.auto = !!cmd.on;
      return {};
    }
    case 'build': {
      const b = find(cmd.b),
        type = db.type(cmd.type);
      if (!b || !type || !world.buildOptions(b, player).length) return {};
      let why = null;
      const n = Math.max(1, Math.min(5, num(cmd.n) | 0));
      for (let i = 0; i < n && !why; i++) why = world.startBuild(b, type, player);
      return why && n === 1 ? { why } : {};
    }
    case 'cancel': {
      const b = find(cmd.b),
        q = b && b.buildQueues && b.buildQueues.get(cmd.q);
      if (!q || !String(cmd.q).startsWith(player.id + ':')) return {};
      let i = num(cmd.i);
      if (!q[i] || q[i].type.name !== cmd.type) {
        i = -1;
        for (let k = q.length - 1; k >= 0; k--)
          if (q[k].type.name === cmd.type) {
            i = k;
            break;
          }
      }
      if (i >= 0) world.cancelBuild(b, cmd.q, i);
      return {};
    }
    case 'reinforce': {
      const type = player.reinforcements.find(t => t.name === cmd.type);
      if (!type) return {};
      const x = clampX(cmd.x),
        y = clampY(cmd.y);
      const why = world.cantReinforce(player, x, y) || world.deployReinforcement(player, type, x, y, num(cmd.h));
      return why ? { why } : {};
    }
    case 'special': {
      const mine = (world.specialWeapons || []).filter(w => w.player === player),
        sw = mine.find(w => w.charge >= 0.99) || mine[0],
        t = find(cmd.t);
      if (!sw) return {};
      if (!t || !sw.canTarget(t)) return { why: 'Not a valid target' };
      const why = sw.fire(t);
      return why ? { why } : {};
    }
    case 'retreat':
      world.retreat?.request(player);
      return {};
    case 'left':
      player.left = true;
      return {};
  }
  return {};
}

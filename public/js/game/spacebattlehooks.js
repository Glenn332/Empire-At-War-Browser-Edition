import { Player, Team, Unit, Squad } from './sim.js';
import { UNIT, SHOT, POINT, ABILITY } from './spacerecord.js';

const kept = new WeakSet();

export function plain(v, depth = 0, seen = new Set()) {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint' || kept.has(v)) return undefined;
  if (v instanceof Unit || v instanceof Squad) return { $u: v.id };
  if (v instanceof Player) return { $pl: v.id };
  if (v instanceof Team) return { $tm: v.id };
  if (v.isVector3 === true) return { $v: [v.x, v.y, v.z] };
  if (v.isColor === true) return { $c: v.getHex() };
  if (typeof v.str === 'function' && typeof v.name === 'string') return { $t: v.name };
  if (v.def && v.vx !== undefined && v.id) return { $p: v.id };
  if (ArrayBuffer.isView(v)) return Array.from(v);
  if (depth > 3 || seen.has(v)) return undefined;
  seen.add(v);
  if (Array.isArray(v)) return v.map(x => plain(x, depth + 1, seen));
  const o = {};
  for (const k in v) {
    const x = plain(v[k], depth + 1, seen);
    if (x !== undefined) o[k] = x;
  }
  return o;
}

export function keeper(to, events) {
  const call =
    name =>
    (...args) => {
      events.push([to, name, args.map(a => plain(a))]);
    };
  const p = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? call(k) : undefined) });
  kept.add(p);
  return p;
}

export function hookBattle(w, events, spawns) {
  w.onEvent = (kind, data) => {
    events.push(['world', 'onEvent', [kind, plain(data)]]);
  };
  const spawn = w.spawn.bind(w);
  w.spawn = (...a) => {
    const en = spawn(...a);
    if (en)
      spawns.push({
        wid: en.id,
        type: en.type.name,
        player: en.player.id,
        x: en.x,
        y: en.y,
        heading: en.heading || 0,
        fighters: en.isSquad ? en.fighters.map(f => f.id) : null
      });
    return en;
  };
  const play = Unit.prototype.playAnim;
  Unit.prototype.playAnim = function (kind, opts) {
    if (this.world === w) events.push(['unit', 'playAnim', [{ $u: this.id }, kind, plain(opts)]]);
    return play.call(this, kind, opts);
  };
  return () => {
    Unit.prototype.playAnim = play;
  };
}

export function stepRecord(w, rec, spawns, events) {
  rec.write();
  const units = rec.units.slice(0, rec.nUnits * UNIT),
    shots = rec.shots.slice(0, rec.nShots * SHOT),
    points = rec.points.slice(0, rec.nPoints * POINT),
    abilities = rec.abilities.slice(0, rec.nAbilities * ABILITY);
  return {
    message: {
      k: 'step',
      time: w.time,
      units,
      shots,
      points,
      abilities,
      beams: w.beams.length ? w.beams.map(b => [b.a.id, b.b.id, b.color, b.width, b.bone, b.kind]) : undefined,
      players: rec.players,
      queues: rec.queues,
      pads: rec.pads,
      props: rec.props,
      teams: rec.teams,
      state: rec.world_,
      fresh: rec.fresh.slice(),
      spawns: spawns.splice(0),
      events: events.splice(0)
    },
    transfer: [units.buffer, shots.buffer, points.buffer, abilities.buffer]
  };
}

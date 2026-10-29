import { db } from '../gamedata.js';
import { GoalSystem } from './landgoals.js';
import { target } from './spacebrain.js';

const FLAG = { GLOBAL: 0x10, FRIENDLY_UNIT: 0x20, ENEMY_UNIT: 0x40, FRIENDLY_STRUCTURE: 0x80, ENEMY_STRUCTURE: 0x100, TACTICAL_LOCATION: 0x200, FRIENDLY_BUILD_PAD: 0x400, ENEMY_BUILD_PAD: 0x800 };

export class SpaceGoals extends GoalSystem {
  constructor(world, ais) {
    super();
    this.world = world; this.ais = ais; this.mode = 'SPACE';
    const S = Math.max(200, db.constants.num('AI_SpaceEvaluatorRegionSize', 2000));
    const nx = Math.max(1, Math.ceil((world.max.x - world.min.x) / S)), ny = Math.max(1, Math.ceil((world.max.y - world.min.y) / S));
    this.regions = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x0 = world.min.x + i * S, y0 = world.min.y + j * S;
      const r = target.region(j * nx + i, x0, y0, Math.min(S, world.max.x - x0), Math.min(S, world.max.y - y0), S);
      r.r = S / 2;
      this.regions.push(r);
    }
  }

  env(ai) {
    const P = ai.scripted();
    if (!P) return null;
    return { w: this.world, brain: ai.brain, cmdr: ai, P, ais: this.ais().length };
  }

  newMind(ai) {
    ai.places = this.regions;
    ai.think();
    return ai.mind;
  }

  targets(ai, bits) {
    const w = this.world, p = ai.player, out = [];
    if (bits === FLAG.GLOBAL) return [null];
    if (bits & FLAG.TACTICAL_LOCATION) out.push(...this.regions);
    if (bits & ~(FLAG.GLOBAL | FLAG.TACTICAL_LOCATION)) {
      const known = new Set(ai.known());
      for (const u of w.units) {
        if (u.dead || u.hyper || u.suspended || !u.type.bool('Has_Space_Evaluator')) continue;
        const owner = u.isPad ? u.padOwner || (u.player.id >= 0 ? u.player : null) : u.player.id >= 0 ? u.player : null;
        const mine = !!owner && owner.team === p.team;
        if (!mine && !known.has(u) && !(u.seenBy & p.bit)) continue;
        const kind = u.isPad ? (mine ? FLAG.FRIENDLY_BUILD_PAD : FLAG.ENEMY_BUILD_PAD) : u.isStructure ? (mine ? FLAG.FRIENDLY_STRUCTURE : FLAG.ENEMY_STRUCTURE) : mine ? FLAG.FRIENDLY_UNIT : FLAG.ENEMY_UNIT;
        if (bits & kind) out.push(u.goalTarget && u.goalTarget.unit === u ? Object.assign(u.goalTarget, { x: u.x, y: u.y }) : (u.goalTarget = target.unit(u)));
      }
    }
    return out;
  }

  thingOf(t) { return !t ? null : t.unit ? t.unit : { x: t.x, y: t.y, key: t.key }; }
}

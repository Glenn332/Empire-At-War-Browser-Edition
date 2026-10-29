import { db } from '../gamedata.js';
import { loadALA, animName, AnimState } from '../ala.js';
import { FACING, animOverride } from './land.js';

const FPS = 30,
  DEG = Math.PI / 180;
const number = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const frame = world => Math.floor(world.time * FPS + 1e-6);

export function cinematicTransportRequest(typeName, playerId, at, zAngle, mode, delta, idle, persist, hint) {
  if (typeof typeName !== 'string' || !at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
  const type = db.type(typeName);
  if (
    !type ||
    type.bool('Has_Space_Evaluator') ||
    ![...type.list('Behavior'), ...type.list('LandBehavior')].some(k => k.toUpperCase() === 'TRANSPORT')
  )
    return null;
  return {
    type,
    side: Math.trunc(number(playerId, 0)),
    x: at.x,
    y: at.y,
    z: number(at.z, 0),
    heading: number(zAngle, 0) * DEG,
    mode: Math.trunc(number(mode, 1)),
    delta: number(delta, 0),
    idle: number(idle, 2),
    persist: number(persist, 0) > 0,
    hint: typeof hint === 'string' ? hint : null
  };
}

async function animation(type, kind) {
  for (const model of [animOverride(type), type.str('Land_Model_Name')]) {
    if (!model) continue;
    const clip = await Promise.resolve(loadALA(animName(model, kind))).catch(() => null);
    if (clip) return clip;
  }
  return null;
}

export class CinematicTransports {
  constructor(game, { loadAnimation = animation, onError = error => console.warn('cinematic transport', error) } = {}) {
    this.game = game;
    this.world = game.world;
    this.entries = [];
    this.loadAnimation = loadAnimation;
    this.onError = onError;
  }
  create(...args) {
    if (args.length < 8) return undefined;
    const request = cinematicTransportRequest(...args);
    if (!request) return undefined;
    const w = this.world,
      r = request,
      terrain = w.terrain;
    const water = number(terrain.water?.level, 0);
    const z = Math.max(w.groundZ(r.x, r.y), water) + r.type.num('Hover_Offset', 0);
    w.spawning = null;
    const loading = w.spawn(r.type.name, r.x, r.y, r.heading, r.side),
      q = w.spawning?.[0];
    if (!q) return undefined;
    q.scriptPosition = { x: r.x, y: r.y, z };
    q.scriptHeading = r.heading;
    q.craft = true;
    q.noAI = true;
    q.selectable = false;
    const entry = { request: r, q, ready: false, mode: r.mode, anim: null, land: null, takeoff: null, until: 0, at: w.time };
    this.entries.push(entry);
    if (r.hint !== null) (w.dynamicHints ||= []).push({ hint: r.hint, object: q });
    entry.loading = Promise.all([loading, this.loadAnimation(r.type, 'LAND'), this.loadAnimation(r.type, 'TAKEOFF')])
      .then(([, land, takeoff]) => {
        if (q.scriptDespawned || q.dead) return;
        entry.land = land;
        entry.takeoff = takeoff;
        entry.at = w.time;
        const position = q.scriptPosition || { x: r.x, y: r.y, z },
          heading = q.scriptHeading ?? r.heading;
        for (const u of q.members) {
          u.cinematicTransport = entry;
          u.scriptZ = position.z ?? z;
          u.z = u.scriptZ;
          u.x = position.x;
          u.y = position.y;
          u.heading = heading;
          u.path = [];
          u.target = null;
          u.holder.position.set(u.x, u.y, u.z);
          u.holder.rotation.z = heading + FACING;
        }
        entry.ready = true;
        if (r.mode === 2) {
          this.play(entry, land, 1);
          this.hold(entry);
          entry.until = frame(w) + Math.trunc(r.idle * FPS);
        } else if (r.mode === 3) {
          this.play(entry, takeoff, r.delta);
        } else if (r.mode === 0 || r.mode === 1 || r.mode === 4) {
          entry.mode = 1;
          this.play(entry, land, r.delta);
        }
      })
      .catch(error => {
        this.remove(entry);
        this.onError(error);
      });
    return q;
  }
  play(entry, clip, fraction = 0, speed = 1) {
    const u = entry.q.members[0];
    entry.anim =
      u && clip ? new AnimState(u.inst, clip, { loop: false, speed, time: Math.trunc((clip.frames - 1) * fraction) / clip.fps }) : null;
    if (u) {
      u.anim = entry.anim;
      u.animKind = '~cinematic';
    }
    entry.anim?.step(0);
  }
  hold(entry) {
    if (!entry.anim) return;
    entry.anim.done = false;
    entry.anim.time = (entry.anim.anim.frames - 1) / entry.anim.anim.fps;
    entry.anim.step(0);
  }
  remove(entry) {
    const w = this.world,
      q = entry.q;
    q.scriptDespawned = true;
    q.forming = false;
    for (const u of q.members) {
      u.dead = u.gone = true;
      u.health = 0;
      u.target = null;
      w.unstamp?.(u);
      w.scene.remove(u.holder);
    }
    q.members.length = 0;
  }
  update() {
    const w = this.world;
    let keep = 0;
    for (const entry of this.entries) {
      if (entry.q.scriptDespawned || entry.q.dead) continue;
      this.entries[keep++] = entry;
      if (!entry.ready) continue;
      const dt = Math.max(0, w.time - entry.at);
      entry.at = w.time;
      if (entry.mode === 1 || entry.mode === 3) {
        if (!entry.anim) continue;
        entry.anim.step(dt);
        if ((entry.anim.time * entry.anim.anim.fps) / entry.anim.anim.frames > 0.98) {
          if (entry.mode === 1) {
            entry.mode = 2;
            this.hold(entry);
            entry.until = frame(w) + Math.trunc(entry.request.idle * FPS);
          } else this.remove(entry);
        }
      } else if (entry.mode === 2) {
        this.hold(entry);
        if (!entry.request.persist && frame(w) >= entry.until) {
          entry.mode = 3;
          this.play(entry, entry.takeoff, 0, 1.15);
        }
      }
    }
    this.entries.length = keep;
    if (w.dynamicHints?.length) w.dynamicHints = w.dynamicHints.filter(item => !item.object.dead && !item.object.scriptDespawned);
  }
}

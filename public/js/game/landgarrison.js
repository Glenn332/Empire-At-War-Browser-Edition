import { db, spawnList } from '../gamedata.js';
import { planetAllowsCompany } from './invasion.js';
import { simRandom } from './simrandom.js';
import * as THREE from '../../vendor/three/build/three.module.js';

const spawners = new Map();
export const isSpawner = t => {
  let v = spawners.get(t);
  if (v === undefined) spawners.set(t, (v = /\bSPAWN_SQUADRON\b/i.test(t.str('LandBehavior') + ' ' + t.str('Behavior'))));
  return v;
};
const alive = group => group.some(q => q.forming || q.arriving || q.members.some(u => !u.dead));

export function sideTech(w, side) {
  let n = w.campaignTech?.[side] ?? 1;
  for (const name of w.owned[side] || []) {
    const t = db.type(name);
    if (t && t.bool('Tactical_Build_Increments_Tech_Level')) n++;
  }
  return n;
}

function attach(w, u, load) {
  if (!(u.side >= 0 && u.side < w.factions.length)) return null;
  const list = spawnList(u.type, sideTech(w, u.side)).filter(
    e => e.start > 0 && (!w.garrisonPlanet || planetAllowsCompany({ type: w.garrisonPlanet }, e.type))
  );
  const g = {
    entries: list.map(e => ({ type: e.type, start: e.start, remaining: e.remaining, out: [] })),
    timer: w.time,
    busy: false,
    load: load && w.campaign && u.type.bool('Spawn_Garrison_On_Load')
  };
  w.garrisons.set(u, g);
  return g;
}

export function adoptGarrisons(w) {
  for (const u of w.units) if (!u.dead && !u.inside && isSpawner(u.type) && !w.garrisons.has(u)) attach(w, u, false);
}

function exitPoint(w, u) {
  const names = u.type
      .list('Spawned_Squadron_Location_Bones')
      .flatMap(n => n.split(/[\s,]+/))
      .filter(Boolean),
    flyouts = u.type
      .list('Spawned_Squadron_Location_Flyout_Distances')
      .flatMap(n => n.split(/[\s,]+/))
      .filter(Boolean)
      .map(Number);
  const bones = u.inst?.bone ? names.map((n, k) => ({ bone: u.inst.bone(n), k })).filter(b => b.bone) : [];
  const reach = i => (Number.isFinite(flyouts[i]) ? flyouts[i] : u.radius || 110);
  if (!bones.length) return { x: u.x, y: u.y, angle: u.heading, distance: reach(-1) };
  const i = Math.min(bones.length - 1, Math.floor(simRandom() * bones.length)),
    { bone, k } = bones[i],
    at = new THREE.Vector3();
  u.holder?.updateMatrixWorld(true);
  w.boneAt(u, bone, at);
  const m = bone.matrixWorld?.elements,
    angle = m && (m[0] || m[1]) ? Math.atan2(m[1], m[0]) : u.heading;
  return { x: at.x, y: at.y, angle, distance: reach(k) };
}

async function letOut(w, u, entry, spot = exitPoint(w, u)) {
  const at = w.nearestOpen(spot.x + Math.cos(spot.angle) * spot.distance, spot.y + Math.sin(spot.angle) * spot.distance);
  if (!at) return null;
  if (entry.remaining > 0) entry.remaining--;
  const q = await w.spawn(entry.type.name, at.x, at.y, spot.angle, u.side, null, { x: spot.x, y: spot.y });
  if (!q?.members.length) return null;
  const group = q.mates || [q];
  entry.out.push(group);
  if (w.campaign) for (const s of group) w.campaignGarrison.add(s.company);
  return group;
}

export async function tickGarrisons(w, initial = false) {
  if (!initial && w.time < (w.garrisonAt || 0)) return;
  w.garrisonAt = w.time + 0.25;
  const list = [];
  for (const u of w.units) if (!u.dead && !u.inside && isSpawner(u.type)) list.push(u);
  for (const u of list) {
    const g = w.garrisons.get(u) || attach(w, u, true);
    if (!g || !g.entries.length || g.busy) continue;
    const delay = u.type.num('Spawned_Squadron_Delay_Seconds', 15);
    let full = true;
    for (const e of g.entries) {
      const n = e.out.length,
        was = n >= e.start;
      e.out = e.out.filter(alive);
      if (e.out.length < n && full && was) g.timer = w.time + delay;
      full = full && was && e.out.length === n;
    }
    if (u.noGarrison || (w.planetCorruption === 5 && !db.faction(w.factions[u.side])?.bool('Benefits_From_Corruption'))) continue;
    g.busy = true;
    w.garrisonBusy++;
    try {
      if (g.load) {
        g.load = false;
        const spot = exitPoint(w, u);
        for (const e of g.entries) for (let i = 0; i < e.start && e.remaining !== 0 && !u.dead; i++) await letOut(w, u, e, spot);
        g.timer = w.time + delay;
        continue;
      }
      if (w.time < g.timer) continue;
      const es = g.entries,
        first = Math.min(es.length - 1, Math.floor(simRandom() * es.length));
      for (let k = 0; k < es.length; k++) {
        const e = es[(first + k) % es.length];
        if (e.out.length >= e.start || e.remaining === 0) continue;
        await letOut(w, u, e);
        g.timer = w.time + delay;
        break;
      }
    } finally {
      g.busy = false;
      w.garrisonBusy--;
    }
  }
}

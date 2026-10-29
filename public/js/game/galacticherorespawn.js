import { db } from '../gamedata.js';
import { placeStartingForce } from './galaxy.js';
import { ownedTypes } from './galacticproduction.js';
const key = x => String(x || '').toUpperCase();
const member = t => db.type(t.list('Company_Units')[0] || t.list('Squadron_Units')[0]) || t;
export function scheduleHeroRespawn(game, record, p, owner, killer, time = 0, ability = false) {
  const type = record.carries || record.type,
    child = member(type),
    tied = child.str('Respawn_Tied_To_Structure');
  if (!ability && !child.bool('Is_Named_Hero') && !type.bool('Is_Named_Hero') && !tied) return false;
  const delay = time > 0 ? time : db.constants.num('Default_Hero_Respawn_Time', -1);
  if (delay < 0) return false;
  if (tied) {
    const types = ownedTypes(game.galaxy, owner),
      quota = types.filter(t => key(t.name) === key(tied)).length,
      alive = Math.max(0, types.filter(t => key(member(t).name) === key(child.name)).length - 1);
    if (quota <= alive) return false;
  }
  const entries = (p.killedHeroes ||= []);
  if (entries.some(e => key(e.type) === key(type.name) && key(e.owner) === key(owner))) return false;
  entries.push({
    type: type.name,
    owner,
    killer: killer || record.finalBlowOwner || null,
    startFrame: Math.floor((game.galaxy.time || 0) * 30),
    dueFrame: Math.floor((game.galaxy.time || 0) * 30) + Math.round(delay * 30)
  });
  game.galaxy.heroRespawnNext = Math.min(game.galaxy.heroRespawnNext ?? Infinity, entries.at(-1).dueFrame);
  return true;
}
export function stepHeroRespawns(game) {
  const g = game.galaxy,
    frame = Math.floor((g.time || 0) * 30);
  if (frame < (g.heroRespawnNext ?? 0)) return;
  let next = Infinity;
  for (const p of g.planets)
    for (const entry of [...(p.killedHeroes || [])]) {
      if (entry.dueFrame > frame) {
        next = Math.min(next, entry.dueFrame);
        continue;
      }
      const type = db.type(entry.type),
        child = type && member(type),
        tied = child?.str('Respawn_Tied_To_Structure');
      let planets = g.planets.filter(q => !q.background && key(q.owner) === key(entry.owner));
      const distance = q => q.pos.reduce((n, v, i) => n + (v - p.pos[i]) ** 2, 0);
      planets.sort((a, b) => distance(a) - distance(b));
      if (tied) {
        const types = ownedTypes(g, entry.owner),
          quota = types.filter(t => key(t.name) === key(tied)).length,
          alive = types.filter(t => key(member(t).name) === key(child.name)).length;
        planets =
          quota > alive
            ? planets.filter(
                q =>
                  key(q.politicalOwner ?? q.owner) === key(entry.owner) &&
                  [...q.groundStructures, ...q.orbitalStructures, ...q.garrison].some(
                    u => key(u.owner) === key(entry.owner) && key(u.type.name) === key(tied)
                  )
              )
            : [];
      }
      let spawned = false;
      for (const q of planets) {
        if (!type) break;
        const count = g.fleets.length,
          record = placeStartingForce(q, entry.owner, type, g.fleets);
        if (!record) continue;
        for (const fleet of g.fleets.slice(count)) {
          game.fleetView?.(fleet);
          game.battles?.arrive(fleet, q.index);
        }
        if (entry.owner === game.me) game.audio?.play(type.str('SFXEvent_Hero_Respawned') || child.str('SFXEvent_Hero_Respawned'));
        game.story && (game.story.objectCache = null);
        game.ai?.invalidate();
        spawned = true;
        break;
      }
      if (spawned) game.victory?.heroSpawned(type, entry.owner);
      if (spawned || tied || !planets.length || !type) p.killedHeroes.splice(p.killedHeroes.indexOf(entry), 1);
      else next = frame + 1;
    }
  g.heroRespawnNext = next;
}
export function forceHeroRespawn(game, typeName) {
  const g = game.galaxy,
    frame = Math.floor((g.time || 0) * 30);
  let any = false;
  for (const p of g.planets)
    for (const e of p.killedHeroes || [])
      if (key(e.type) === key(typeName)) {
        e.dueFrame = frame;
        any = true;
      }
  if (any) g.heroRespawnNext = 0;
  return any;
}

import { changeController } from './galacticpolitics.js';

const key = s => String(s || '').toUpperCase();

export function obliterate(game, planet, owner) {
  const g = game.galaxy,
    same = x => key(x) === key(owner),
    kill = list => list.filter(u => {
      if (!same(u.owner) || u.dead) return !u.dead;
      game.story?.despawn?.(u);
      u.dead = true;
      return false;
    });
  if (planet.station && same(planet.stationOwner || planet.owner)) {
    planet.orbitalStructures = kill(planet.orbitalStructures);
    if ((planet.spaceLevel || 0) > 0) game.story?.stationChanged?.(planet, planet.station, null, null);
    planet.station = null;
    planet.spaceLevel = 0;
    planet.stationOwner = null;
  }
  if (same(planet.groundBaseOwner ?? planet.owner)) planet.groundStructures = kill(planet.groundStructures);
  for (const f of g.fleets) if (f.planet === planet.index && !f.leg && same(f.owner)) f.units = kill(f.units);
  g.fleets = g.fleets.filter(f => f.units.length);
  planet.garrison = kill(planet.garrison);
}

export function planetFactionChange(game, planet, faction) {
  if (key(planet.owner) === key(faction)) return planet.owner;
  for (const u of planet.groundStructures) {
    game.story?.despawn?.(u);
    u.dead = true;
  }
  planet.groundStructures = [];
  if (planet.station && (planet.spaceLevel || 0) > 0) game.story?.stationChanged?.(planet, planet.station, null, null);
  planet.station = null;
  planet.spaceLevel = 0;
  planet.stationOwner = null;
  return changeController(planet, faction, game.galaxy);
}

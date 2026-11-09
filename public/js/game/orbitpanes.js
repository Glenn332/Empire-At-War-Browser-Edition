import { relation } from './galacticrelation.js';
import { intelligence, strategicStealth } from './galacticfog.js';

const same = (a, b) => String(a || '').toUpperCase() === String(b || '').toUpperCase();
const isSuper = t => !!t && t.list('CategoryMask').some(m => /^super$/i.test(m));

export const fleetStealthed = f => f.units.length > 0 && f.units.every(u => u.dead || strategicStealth(u, f.owner));

export function orbitController(g, p, fleets) {
  if (p.station && (p.spaceLevel || 0) > 0) return p.stationOwner || p.owner;
  const here = fleets.filter(f => f.units.length);
  return (here.find(f => !fleetStealthed(f)) || here[0])?.owner ?? null;
}

export function fleetsVisibleAt(g, p, viewer, fleets) {
  const v = intelligence(g, p);
  if (v?.fleetOverlay) return true;
  const station = p.station && (p.spaceLevel || 0) > 0 ? p.stationOwner || p.owner : null;
  if (p.type.bool('Planet_Starbase_Stealth') && station && relation(viewer, station) !== 0) return false;
  return fleets.some(f => f.units.some(u => !u.dead && isSuper(u.carries || u.type)));
}

export function orbitPanes(g, viewer) {
  const byPlanet = new Map();
  for (const f of g.fleets) {
    if (f.leg || f.planet < 0 || !g.planets[f.planet]) continue;
    let list = byPlanet.get(f.planet);
    if (!list) byPlanet.set(f.planet, (list = []));
    list.push(f);
  }
  const spots = [];
  for (const [index, fleets] of byPlanet) {
    const p = g.planets[index],
      visibleHere = fleetsVisibleAt(g, p, viewer, fleets);
    const shown = fleets.filter(
      f => f.units.length && (relation(viewer, f.owner) === 0 || (visibleHere && !fleetStealthed(f)))
    );
    if (!shown.length) continue;
    const own = shown.every(f => relation(viewer, f.owner) === 0) && same(orbitController(g, p, fleets), viewer);
    const panes = new Map();
    const put = (f, displaySlot, merge) => {
      const pane = panes.get(displaySlot);
      if (pane) {
        if (!merge) return;
        pane.units.push(...f.units);
        pane.fleets.push(f);
        return;
      }
      panes.set(displaySlot, { f, p: index, slot: f.slot ?? 0, displaySlot, units: [...f.units], fleets: [f] });
    };
    if (own) for (const f of shown) put(f, f.slot || 0, (f.slot || 0) === 0);
    else
      for (const slot of [0, 1, 2])
        for (const f of shown)
          if ((f.slot || 0) === slot) put(f, same(f.owner, viewer) ? (slot === 0 ? 2 : slot) : 0, true);
    for (const pane of [...panes.values()].sort((a, b) => a.displaySlot - b.displaySlot)) spots.push(pane);
  }
  return { spots };
}

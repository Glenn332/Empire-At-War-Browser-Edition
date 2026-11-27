import { db } from '../gamedata.js';
import { intelligence, visibleTransit, VIS } from './galacticfog.js';
import { fleetsVisibleAt, fleetStealthed } from './orbitpanes.js';
import { relation, hidden } from './galacticrelation.js';

// What the local player can actually see happen in the galaxy, for the recent events list of the planet search.
// Like that list, this is a view for one player only and never part of the simulated state.

const same = (a, b) => String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();
const factionName = f => db.t(db.faction(f)?.str('Text_ID')) || String(f ?? '');
const planetName = p => db.t(p.type?.str('Text_ID')) || p.name || '';

// whether the viewer has eyes on the planet: their own, its owner in sight, or fleets there shown on their map
export function witnessed(g, p, viewer) {
  if (!g || !p) return false;
  if (g.observer || same(p.owner, viewer)) return true;
  const v = intelligence(g, p);
  if (v?.ownerKnown || v?.mask & VIS.FLEET_PRESENCE) return true;
  return fleetsVisibleAt(
    g,
    p,
    viewer,
    (g.fleets || []).filter(f => f.planet === p.index && !f.leg)
  );
}

// a fleet the viewer's map shows in orbit of the planet, the same rule as the orbit panes
const shownAt = (g, p, viewer, f) => !!p && !fleetStealthed(f) && fleetsVisibleAt(g, p, viewer, [f]);

export const approachText = p => String(db.t('TEXT_ENEMY_FLEET_APPROACHING_LOCATION')).replace('##0', planetName(p));

// Compares the fleets with the last look and returns [planet, text, kind] for what the viewer saw change: another
// faction's fleet arriving at or leaving a planet in sight, and every enemy fleet that sets course for one of the
// viewer's planets, whether or not the viewer has a fleet there. Fleets already moving when it starts are not news.
export class FleetWatch {
  constructor() {
    this.galaxy = null;
    this.last = new WeakMap();
  }

  step(g, viewer) {
    if (!g) return [];
    const primed = this.galaxy === g;
    if (!primed) {
      this.galaxy = g;
      this.last = new WeakMap();
    }
    const out = [];
    for (const f of g.fleets || []) {
      const was = this.last.get(f),
        leg = f.leg || null;
      this.last.set(f, { planet: f.planet, leg });
      if (!primed || !was || same(f.owner, viewer) || !f.units?.length) continue;
      if (was.leg && !leg && f.planet === was.leg.b) {
        const p = g.planets[f.planet];
        if (shownAt(g, p, viewer, f)) out.push([p.index, `${factionName(f.owner)} fleet arrived`, 'fleet']);
        continue;
      }
      if (!leg || leg === was.leg) continue;
      const from = g.planets[leg.a],
        to = g.planets[leg.b];
      if (!was.leg && was.planet === leg.a && shownAt(g, from, viewer, f))
        out.push([
          from.index,
          to && visibleTransit(g, f, viewer)
            ? `${factionName(f.owner)} fleet left for ${planetName(to)}`
            : `${factionName(f.owner)} fleet left`,
          'fleet'
        ]);
      if (to && same(to.owner, viewer) && relation(f.owner, viewer) === 1 && !hidden(f)) out.push([to.index, approachText(to), 'approach']);
    }
    return out;
  }
}

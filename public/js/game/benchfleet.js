// The ten unit types a faction fields in the benchmark battles (play.html?benchmark=N and tools/bench-space.mjs).
import { db, skirmishStation } from '../gamedata.js';
import { buildListFor, isUpgradeType } from './sim.js';

const BENCH_FLEETS = {
  Empire: [
    'Star_Destroyer',
    'Victory_Destroyer',
    'Acclamator_Assault_Ship',
    'Tartan_Patrol_Cruiser',
    'Tartan_Patrol_Cruiser',
    'Broadside_Class_Cruiser',
    'TIE_Fighter_Squadron',
    'TIE_Fighter_Squadron',
    'TIE_Bomber_Squadron',
    'TIE_Bomber_Squadron'
  ],
  Rebel: [
    'Calamari_Cruiser',
    'Alliance_Assault_Frigate',
    'Nebulon_B_Frigate',
    'Corellian_Corvette',
    'Corellian_Corvette',
    'Corellian_Gunboat',
    'Rebel_X-Wing_Squadron',
    'Rebel_X-Wing_Squadron',
    'Y-Wing_Squadron',
    'Y-Wing_Squadron'
  ],
  Underworld: [
    'Kedalbe_Battleship',
    'Vengeance_Frigate',
    'Interceptor4_Frigate',
    'Crusader_Gunship',
    'Crusader_Gunship',
    'Crusader_Gunship',
    'StarViper_Squadron',
    'StarViper_Squadron',
    'Skipray_Squadron',
    'Skipray_Squadron'
  ]
};

export function benchFleet(faction, pads = false) {
  const can = [],
    seen = new Set(),
    builders = [];
  const builder = t => {
    if (t && !seen.has(t)) {
      seen.add(t);
      builders.push(t);
    }
  };
  for (let st = skirmishStation(faction), guard = 0; st && guard < 8; st = db.type(st.str('Next_Level_Base')), guard++) builder(st);
  if (!pads) {
    for (const st of builders)
      for (const t of buildListFor(st, faction))
        if (
          !isUpgradeType(t) &&
          !can.includes(t) &&
          (t.has('Space_Model_Name') || t.has('Squadron_Units')) &&
          t.tag.toLowerCase() !== 'starbase'
        )
          can.push(t);
  } else
    for (const t of db.types.values())
      if ((t.behaviors().has('TACTICAL_BUILD_OBJECTS') && !t.has('Tactical_Health')) || t.name.toUpperCase().endsWith('_PAD')) builder(t);
  for (let i = 0; pads && i < builders.length && i < 400; i++) {
    for (const t of buildListFor(builders[i], faction)) {
      if (isUpgradeType(t)) continue;
      if (t.has('Tactical_Buildable_Constructed')) {
        builder(db.type(t.str('Tactical_Buildable_Constructed')));
        continue;
      }
      if (
        !can.includes(t) &&
        (t.has('Space_Model_Name') || t.has('Squadron_Units')) &&
        t.tag.toLowerCase() !== 'starbase' &&
        !t.behaviors().has('TACTICAL_BUILD_OBJECTS')
      )
        can.push(t);
    }
  }
  const own = (BENCH_FLEETS[faction] || []).map(n => db.type(n));
  const kinds = [...new Set(own)];
  if (own.length && own.every(Boolean) && kinds.filter(t => can.includes(t)).length * 2 > kinds.length) return own;
  if (!can.length) return own.filter(Boolean);
  let seed = 2166136261;
  for (const ch of faction) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const draw = (from, n, out) => {
    const pool = from.slice();
    for (let k = 0; k < n; k++) {
      if (!pool.length) pool.push(...from);
      out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    }
    return out;
  };
  const ships = can.filter(t => !t.has('Squadron_Units')),
    wings = can.filter(t => t.has('Squadron_Units'));
  if (!pads || !ships.length || !wings.length) return draw(can, 10, []);
  return draw(wings, 4, draw(ships, 6, []));
}

import { db } from '../gamedata.js';
import { planetIncome } from './galacticeconomy.js';
import { intelligence } from './galacticfog.js';

export const canOpenPlanetInfo = (game, p) => !!p && !!intelligence(game.galaxy, p)?.discovered && !game.battle;

export function planetInfoContents(g, p) {
  const t = p.type,
    faction = db.faction(p.owner),
    describe = field => db.t(t.str('Describe_' + field));
  return {
    title: db.t('TEXT_BUTTON_PLANET_INFO') + ' ' + db.t(t.str('Text_ID')),
    faction: faction ? db.t(faction.str('Text_ID')) : '',
    color: faction?.vec('Color', [255, 255, 255, 255]) || [255, 255, 255, 255],
    income: (p.destroyed ? t.num('Planet_Destroyed_Credit_Value', 0) : planetIncome(g, p)).toFixed(0).padStart(4, ' '),
    population: describe('Population'),
    wildlife: describe('Wildlife'),
    terrain: describe('Terrain'),
    weather: describe('Weather'),
    tactical: describe('Tactical'),
    advantage: describe('Advantage'),
    history: describe('History'),
    weatherImage: 'load' + t.str('Encyclopedia_Weather_Icon').slice(4),
    nativeImage: t.str('Native_Icon_Name'),
    mapImage: t.str('Land_Tactical_Map').replace('.ted', '.tga'),
    overlayImage: 'load_overlay.tga'
  };
}

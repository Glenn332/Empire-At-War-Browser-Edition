import { db } from '../gamedata.js';

export function battlePlanetName(game) {
  const campaign = game.setup && game.setup.campaign, type = campaign && db.type(campaign.planetType);
  const own = type && (db.t(type.str('Text_ID')) || '');
  if (own) return own;
  return (db.t(game.map.textId) || game.map.planet || '').replace(/^.*?[-–:]\s*/, '');
}

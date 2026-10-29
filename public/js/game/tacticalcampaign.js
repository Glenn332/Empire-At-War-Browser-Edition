import { db } from '../gamedata.js';
import { linkedParent } from './linktactical.js';
import { loadCampaignData, startingGalaxy, applyGalaxy, snapshotGalaxy } from './galaxy.js';
import { GalacticVictory, currentOwner } from './galacticvictory.js';
import { destroyPlanet } from './planetdestruction.js';
const key = x => String(x || '').toUpperCase();
export class TacticalCampaign {
  static async create(game) {
    const cb = game.setup.campaign;
    if (!cb?.galaxy) return null;
    const data = await loadCampaignData(),
      campaign = data.campaigns.get(key(cb.campaignName || cb.galaxy.campaign));
    if (!campaign) return null;
    const g = startingGalaxy(data, campaign);
    applyGalaxy(g, cb.galaxy);
    return new TacticalCampaign(game, g);
  }
  constructor(game, galaxy) {
    this.game = game;
    this.galaxy = galaxy;
    this.planet = galaxy.planets[game.setup.campaign.planet];
    this.victory = new GalacticVictory(this);
    this.destroyedBy = null;
  }
  destroy(unit) {
    const p = this.planet;
    if (!p || p.destroyed) return false;
    const owner = unit.player.factionName,
      condition = this.victory.registered(7, owner),
      leader = db.faction(currentOwner(p))?.str('Faction_Leader');
    const match =
      !!condition &&
      !!leader &&
      (!condition.names.length || condition.names.includes(key(leader))) &&
      p.garrison.some(u => u.type.list('Company_Units').some(n => key(n) === key(leader)));
    const previous = linkedParent(this.game);
    if (match) (previous?.victory || this.victory).declareCondition(7, owner, 30);
    this.game.world.onEvent('storyDestroyPlanet', { planet: p, incoming: null });
    if (this.game.tacticalStory) this.story = this.game.tacticalStory;
    destroyPlanet(this, p, true);
    if (previous) destroyPlanet(previous, previous.galaxy.planets[p.index], false);
    this.destroyedBy = owner;
    return match;
  }
  result(book) {
    const manager = this.game.world.tacticalSuperweapons,
      weapons = [];
    for (const [gid, unit] of book.entity) if (manager.record(unit)) weapons.push({ gid, owner: unit.player.factionName });
    const galaxy = snapshotGalaxy(this.galaxy),
      view = this.game.setup.campaign?.galaxy?.view;
    if (view) galaxy.view = { ...view };
    return { galaxy, planetDestroyed: !!this.destroyedBy, planetDestroyedBy: this.destroyedBy, superweapons: weapons };
  }
}

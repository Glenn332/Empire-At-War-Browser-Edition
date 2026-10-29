import { db } from '../gamedata.js';
import { adjustCredits } from './galacticeconomy.js';
import { strategicStealth } from './galacticfog.js';

const key = s => String(s || '').trim().toUpperCase();
const same = (a, b) => key(a) === key(b);

export const canBribe = faction => !!db.faction(faction)?.bool('Benefits_From_Corruption');
const corrupted = p => (p.currentCorruption ?? -1) !== -1;
const playerOf = (galaxy, faction) => galaxy.players.find(p => same(p.faction, faction));
export const creditsOf = (galaxy, faction) => playerOf(galaxy, faction)?.credits ?? 0;

export function controllerOf(galaxy, index) {
  const planet = galaxy.planets[index];
  if (planet.station && (planet.spaceLevel || 0) > 0) return planet.stationOwner || planet.owner || null;
  const fleets = galaxy.fleets.filter(f => f.planet === index && !f.leg && f.units.length);
  const seen = fleets.find(f => !f.units.every(u => strategicStealth(u))) || fleets[0];
  return seen ? seen.owner : null;
}

const shipsPrice = (planet, units) => {
  const tag = db.faction(planet.owner)?.bool('Easily_Bribed') ? 'Cheap_Bribe_Cost' : 'Expensive_Bribe_Cost';
  let sum = 0;
  for (const u of units) if (!u.dead) sum += (u.carries || u.type).num(tag, 0);
  return sum;
};

const multiplied = (galaxy, faction, sum) => Math.trunc(sum * (playerOf(galaxy, faction)?.bribeMultiplier ?? 1));

export function orderCost(galaxy, fleet, index, human = true) {
  const planet = galaxy.planets[index];
  if (!canBribe(fleet.owner) || !planet) return 0;
  const ctl = controllerOf(galaxy, index);
  if (ctl && same(ctl, fleet.owner)) return 0;
  const sum = shipsPrice(planet, fleet.units);
  return human ? sum : multiplied(galaxy, fleet.owner, sum);
}

export function bribeRun(galaxy, fleet, path, human = true) {
  const nodes = [];
  for (const index of path.slice(0, -1)) {
    const cost = orderCost(galaxy, fleet, index, human);
    if (cost > 0) nodes.push({ planet: index, owner: galaxy.planets[index].owner, cost });
  }
  return { nodes, total: nodes.reduce((n, x) => n + x.cost, 0) };
}

export function payBribes(galaxy, fleet, run) {
  if (!(run.total > 0)) return true;
  if (creditsOf(galaxy, fleet.owner) < run.total) return false;
  adjustCredits(galaxy, fleet.owner, -run.total);
  for (const node of run.nodes) if (node.owner) adjustCredits(galaxy, node.owner, node.cost);
  return true;
}

export function hudQuote(galaxy, fleet, path, me) {
  if (!canBribe(me)) return 0;
  let total = 0;
  for (const index of path.slice(0, -1)) {
    const planet = galaxy.planets[index], ctl = controllerOf(galaxy, index);
    if (planet && ctl && !same(ctl, me) && corrupted(planet)) total += shipsPrice(planet, fleet.units);
  }
  return total;
}

export function passByBribe(galaxy, fleet, index) {
  const planet = galaxy.planets[index], ctl = controllerOf(galaxy, index);
  if (!planet || !canBribe(fleet.owner) || !corrupted(planet) || !ctl || same(ctl, fleet.owner)) return false;
  const cost = multiplied(galaxy, fleet.owner, shipsPrice(planet, fleet.units));
  if (cost > creditsOf(galaxy, fleet.owner)) return false;
  adjustCredits(galaxy, fleet.owner, -cost);
  return true;
}

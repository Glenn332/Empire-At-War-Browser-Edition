import { db } from '../gamedata.js';
import { carriedCompany, planetAllowsCompany } from './invasion.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const same = (a, b) => key(a) === key(b);
const friendly = (a, b) =>
  same(a, b) ||
  !!db
    .faction(a)
    ?.list('Allies')
    .some(n => same(n, b));
const names = tag =>
  String(db.constants.str(tag) || '')
    .split(/[|,\s]+/)
    .filter(Boolean)
    .map(key);
const masksOf = type => type.list('CategoryMask').map(key);
const overlaps = (mask, wanted) => mask.some(n => wanted.includes(n));

function describe(record) {
  const company = carriedCompany(record),
    type = company || record.type;
  if (!type) return { mask: [], hero: false, empty: true };
  let mask = masksOf(type);
  const members = type
    .list('Company_Units')
    .map(n => db.type(n))
    .filter(Boolean);
  if (!mask.length && members.length) mask = masksOf(members[0]);
  return { mask, hero: [type, ...members].some(t => t.bool('Is_Named_Hero') || t.bool('Is_Generic_Hero')), empty: false };
}

export function isRaidForce(fleet) {
  const units = (fleet.units || []).filter(u => !u.dead);
  if (!units.length) return false;
  const required = db.constants.str('Raid_Force_Required_Faction').trim();
  if (required && !same(fleet.owner, required)) return false;
  const limited = names('Raid_Force_Limited_Object_Category_Mask'),
    free = names('Raid_Force_Free_Object_Category_Mask');
  const maxLimited = db.constants.num('Raid_Force_Max_Limited_Objects', 0),
    maxHeroes = db.constants.num('Raid_Force_Max_Heros', 0);
  let heroes = 0,
    count = 0;
  for (const u of units) {
    if (!carriedCompany(u)) return false;
    const { mask, hero } = describe(u);
    if (hero && ++heroes > maxHeroes) return false;
    if (overlaps(mask, free)) continue;
    if (!overlaps(mask, limited) || ++count > maxLimited) return false;
  }
  return count !== 0;
}

export function raidCapable(galaxy, fleet, p) {
  const planet = galaxy.planets[p];
  if (!planet || planet.background || planet.destroyed || fleet.planet === p || !isRaidForce(fleet)) return false;
  if (!planet.type.bool('Planet_Surface_Accessible', true)) return false;
  if (planet.owner && friendly(fleet.owner, planet.owner)) return false;
  return fleet.units.every(u => {
    const company = carriedCompany(u);
    return !company || planetAllowsCompany(planet, company);
  });
}

export const RAID_SLOT = () => ({ code: 0, text: 'TEXT_ABILITY_SLOT_RAID', label: db.t('TEXT_ABILITY_SLOT_RAID') });

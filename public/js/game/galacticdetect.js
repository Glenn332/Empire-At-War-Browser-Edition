import { db } from '../gamedata.js';
import { simRandom } from './simrandom.js';
import { strategicStealth } from './galacticfog.js';
import { scheduleHeroRespawn, abilityRespawnTime } from './galacticherorespawn.js';
import { clearSiphon } from './galacticcorruption.js';

const key = s => String(s || '').toUpperCase();
const yes = v => /^(yes|true|1)$/i.test(String(v ?? '').trim());
const allied = (a, b) =>
  key(a) === key(b) ||
  !!db
    .faction(a)
    ?.list('Allies')
    .some(n => key(n) === key(b));

const members = record => {
  const t = record.carries || record.type,
    list = [...t.list('Company_Units'), ...t.list('Squadron_Units')].map(n => db.type(n)).filter(Boolean);
  return list.length ? [t, ...list] : [t];
};
const heroOf = record => members(record).find(t => t.bool('Is_Named_Hero') || t.bool('Is_Generic_Hero')) || null;
const abilities = (record, tag) =>
  members(record).flatMap(t =>
    t
      .sub('Abilities')
      .flatMap(n => n.children)
      .filter(a => key(a.tag) === tag && yes(a.val('Initially_Enabled', 'Yes')))
  );
const style = a => key(a.val('Activation_Style', '')).trim();

function onPlanet(g, p) {
  const out = [];
  for (const u of p.garrison) if (!u.dead) out.push({ record: u, owner: u.owner, fleet: null });
  for (const f of g.fleets)
    if (f.planet === p.index && !f.leg) for (const u of f.units) if (!u.dead) out.push({ record: u, owner: f.owner, fleet: f });
  return out;
}

export function antiStealth(g, p, viewer, hostile) {
  let keep = 1;
  for (const o of onPlanet(g, p)) {
    if (!hostile(o.owner, viewer)) continue;
    let best = 0;
    for (const a of abilities(o.record, 'DETECT_HERO_ABILITY')) best = Math.max(best, a.num('Detection_Chance', 0));
    keep *= 1 - Math.min(1, Math.max(0, best));
  }
  return 1 - keep;
}

function evade(target) {
  let best = 0;
  for (const a of members(target.record).flatMap(t => t.sub('Abilities').flatMap(n => n.children)))
    best = Math.max(best, a.num('Evade_Detection_Chance', 0));
  return best;
}

function eliminators(detector) {
  return abilities(detector.record, 'ELIMINATE_HERO_ABILITY').filter(a => style(a) === 'HERO_DETECTED');
}

function eliminateHero(game, p, detector, target) {
  const g = game.galaxy,
    user = heroOf(detector.record),
    victim = heroOf(target.record);
  if (!victim || allied(detector.owner, target.owner)) return false;
  if (user?.bool('Is_Named_Hero') && victim.bool('Is_Generic_Hero')) return false;
  let fired = false;
  for (const a of eliminators(detector)) {
    if (target.record.dead) break;
    game.story?.despawn?.(target.record);
    target.record.dead = true;
    scheduleHeroRespawn(game, target.record, p, target.owner, null, 0, true);
    if (yes(a.val('Causes_Despawn'))) {
      game.story?.despawn?.(detector.record);
      scheduleHeroRespawn(game, detector.record, p, detector.owner, null, abilityRespawnTime(a), true);
    }
    fired = true;
  }
  if (fired) {
    p.garrison = p.garrison.filter(u => !u.dead);
    for (const f of g.fleets) f.units = f.units.filter(u => !u.dead);
    g.fleets = g.fleets.filter(f => f.units.length);
  }
  return fired;
}

function eliminateSiphon(game, p, detector) {
  let fired = false;
  for (const a of eliminators(detector)) {
    if (!p.creditSiphonOwner || p.creditSiphonOwner === -1) break;
    clearSiphon(p);
    if (yes(a.val('Causes_Despawn'))) {
      game.story?.despawn?.(detector.record);
      scheduleHeroRespawn(game, detector.record, p, detector.owner, null, abilityRespawnTime(a), true);
    }
    fired = true;
  }
  return fired;
}

export function stepDetection(game, random = simRandom) {
  const g = game.galaxy,
    now = g.time || 0;
  for (const p of g.planets) {
    if (p.background || p.destroyed) continue;
    const here = onPlanet(g, p);
    for (const detector of here) {
      const detects = abilities(detector.record, 'DETECT_HERO_ABILITY');
      if (!detects.length || detector.record.dead) continue;
      for (const a of detects) {
        const interval = a.num('Detect_Interval_In_Seconds', 0);
        if (!(interval > 0)) continue;
        const marks = (detector.record.detectNext ||= {}),
          id = key(a.attrs?.Name);
        if (marks[id] === undefined) marks[id] = now + interval;
        if (now < marks[id]) continue;
        marks[id] = now + interval;
        const chance = a.num('Detection_Chance', 0),
          user = heroOf(detector.record);
        for (const target of here) {
          if (detector.record.dead) break;
          if (target === detector || target.record.dead || allied(detector.owner, target.owner)) continue;
          const victim = heroOf(target.record);
          if (!victim || !strategicStealth(target.record)) continue;
          if (user?.bool('Is_Named_Hero') && victim.bool('Is_Generic_Hero')) continue;
          const sure = !!user?.bool('Is_Generic_Hero') && victim.bool('Is_Named_Hero');
          if (!sure && !(random() < chance && !(random() < evade(target)))) continue;
          eliminateHero(game, p, detector, target);
        }
        if (
          !detector.record.dead &&
          yes(a.val('Detect_Credit_Siphon_Effects')) &&
          p.creditSiphonOwner &&
          p.creditSiphonOwner !== -1 &&
          allied(p.politicalOwner ?? p.owner, detector.owner) &&
          random() < chance
        ) {
          p.creditSiphonFound = true;
          eliminateSiphon(game, p, detector);
        }
      }
    }
  }
}

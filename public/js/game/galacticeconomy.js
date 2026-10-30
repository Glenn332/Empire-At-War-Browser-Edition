import { simRandom } from './simrandom.js';
import { db } from '../gamedata.js';
import { stepGambling } from './planetabilities.js';

const bonuses = new WeakMap();
function incomeBonuses(type) {
  let list = bonuses.get(type);
  if (!list) {
    list = type.sub('Abilities').flatMap(a => a.all('Planet_Income_Bonus_Ability'));
    bonuses.set(type, list);
  }
  return list;
}

export function fiscalCycleSeconds() {
  return Math.max(1, Math.round(db.constants.num('Fiscal_Cycle_Time_In_Secs', 45) * 30)) / 30;
}

function politicalFactor(control) {
  const curve = db.constants.vec('Political_Income_Curve', [0, 0, 1, 1, 5, 1]);
  if (control <= curve[0]) return curve[1];
  for (let i = 2; i + 1 < curve.length; i += 2)
    if (control <= curve[i]) {
      const span = curve[i] - curve[i - 2];
      return span > 0 ? curve[i - 1] + ((curve[i + 1] - curve[i - 1]) * (control - curve[i - 2])) / span : curve[i + 1];
    }
  return curve[curve.length - 1];
}

export function orbitFleets(g) {
  const by = new Map();
  for (const f of g.fleets)
    if (f.planet >= 0 && !f.leg) {
      let list = by.get(f.planet);
      if (!list) by.set(f.planet, (list = []));
      list.push(f);
    }
  return by;
}

export function planetIncome(g, p, owner = p.owner, orbit = null, terms = null) {
  const term = (label, value) => {
    if (terms && value) terms.push({ label, value });
    return value;
  };
  if (!p.owner || p.incomeHalted || (p.incomeHaltUntil && (p.incomeHaltUntil < 0 || p.incomeHaltUntil > (g.time || 0)))) return 0;
  const base = (p.destroyed ? p.type.num('Planet_Destroyed_Credit_Value', 0) : p.type.num('Planet_Credit_Value', 0)) * (p.incomeMult ?? 1);
  let total = term('TEXT_ECONOMY_BASE_INCOME', base + base * (p.gambling?.mod || 0));
  const politicalOwner = p.politicalOwner || p.owner;
  const alignment = db.faction(politicalOwner)?.str('Force_Alignment', 'Neutral').toUpperCase(),
    strength = p.type.num('Force_Strength', 0);
  if (alignment && alignment !== 'NEUTRAL' && strength > 0) {
    const matches = alignment === p.type.str('The_Force', 'Neutral').toUpperCase();
    total += term(
      matches ? 'TEXT_INCOME_FORCE_ALIGNMENT' : 'TEXT_INCOME_FORCE_OPPOSITION',
      base *
        strength *
        db.constants.num(matches ? 'MaxCreditIncomeAlignmentBonus' : 'MaxCreditIncomeAlignmentPenalty', 0.5) *
        (matches ? 1 : -1)
    );
  }
  const factor = p.politicalValue === undefined ? 1 : politicalFactor(p.politicalValue);
  if (!db.faction(politicalOwner)?.bool('Is_Neutral') && factor > 0) total += term('TEXT_INCOME_POLITICAL_CONTROL', base * (factor - 1));
  for (const r of g.routes)
    if (r.a === p.index || r.b === p.index) {
      const other = g.planets[r.a === p.index ? r.b : r.a];
      if ((other.politicalOwner || other.owner) === politicalOwner && !db.faction(politicalOwner)?.bool('Is_Neutral'))
        total += term('TEXT_ECONOMY_TRADE_ROUTES', base * Math.max(0, r.type.num('Credit_Gain_Factor', 0)));
    }
  const bonus = (type, by) => {
    if (by !== owner) return;
    for (const a of incomeBonuses(type)) {
      const mining = p.type.bool('Planet_Is_Mining_Colony') ? a.num('Additional_Multiplier_On_Mining_Colonies', 1) : 1;
      total += term(
        type.str('Text_ID') || type.name,
        (base * a.num('Percentage_Income_Modifier', 0) + a.num('Absolute_Income_Modifier', 0)) * mining
      );
    }
  };
  for (const u of p.groundStructures) bonus(u.type, u.owner);
  for (const u of p.orbitalStructures) bonus(u.type, u.owner);
  for (const u of p.garrison) bonus(u.type, u.owner);
  if (p.station) bonus(p.station, p.stationOwner || p.owner);
  for (const f of orbit ? orbit.get(p.index) || [] : g.fleets)
    if (f.planet === p.index && !f.leg && f.owner === owner) for (const u of f.units) bonus(u.carries || u.type, f.owner);
  return Math.fround(total);
}

export function netIncome(g, p, owner = p.owner, orbit = null) {
  const gross = planetIncome(g, p, owner, orbit),
    siphoner = p.creditSiphonOwner;
  if (!siphoner || siphoner === -1) return gross;
  if ((p.currentCorruption ?? -1) === -1 && (p.creditSiphonEnd || 0) < (g.time || 0)) {
    p.creditSiphonOwner = -1;
    p.creditSiphonPct = 0;
    p.creditSiphonAmount = 0;
    return gross;
  }
  const pct = p.creditSiphonPct ?? 0;
  p.creditSiphonAmount = pct >= 0 && pct <= 1 ? Math.fround(gross * pct) : 0;
  return Math.fround(gross - p.creditSiphonAmount);
}

const corruptionShare = type => (type >= 0 && type < 8 ? db.constants.vec('Corruption_Choice_Income_Percentage', [])[type] || 0 : 0);

export function playerIncome(g, owner, commit = false) {
  let total = 0,
    orbitIndex = null;
  const benefit = !!db.faction(owner)?.bool('Benefits_From_Corruption'),
    orbit = () => (orbitIndex ||= orbitFleets(g));
  for (const p of g.planets) {
    if (p.owner === owner) total = Math.fround(total + netIncome(g, p, owner, orbit()));
    else if (benefit && p.owner && (p.currentCorruption ?? -1) !== -1) {
      const share = corruptionShare(p.currentCorruption),
        gain = Math.fround(planetIncome(g, p, p.owner, orbit()) * share);
      if (share > 0 && gain > 0) total = Math.fround(total + gain);
    }
    if (p.creditSiphonOwner === owner && p.owner !== owner) {
      netIncome(g, p, p.owner, orbit());
      if (p.creditSiphonOwner === owner) total = Math.fround(total + (p.creditSiphonAmount || 0));
    }
    if (benefit && p.piracy > 0) {
      total = Math.fround(total + p.piracy);
      if (commit) p.piracy = 0;
    }
  }
  return total;
}

export function incomeBreakdown(g, owner) {
  const sums = new Map(),
    add = (label, value) => {
      if (value) sums.set(label, (sums.get(label) || 0) + value);
    },
    orbit = orbitFleets(g);
  const benefit = !!db.faction(owner)?.bool('Benefits_From_Corruption');
  let corruption = 0;
  for (const p of g.planets) {
    if (p.owner === owner) {
      const terms = [];
      planetIncome(g, p, owner, orbit, terms);
      for (const t of terms) add(t.label, t.value);
      netIncome(g, p, owner, orbit);
      if (p.creditSiphonOwner && p.creditSiphonOwner !== -1) add('TEXT_ECONOMY_SMUGGLING', -(p.creditSiphonAmount || 0));
    } else if (benefit && p.owner && !db.faction(p.owner)?.bool('Benefits_From_Corruption') && (p.currentCorruption ?? -1) !== -1) {
      const share = corruptionShare(p.currentCorruption);
      if (share > 0) corruption += planetIncome(g, p, p.owner, orbit) * share;
    }
    if (p.creditSiphonOwner === owner && p.owner !== owner) {
      netIncome(g, p, p.owner, orbit);
      add('TEXT_INCOME_SMUGGLER', p.creditSiphonAmount || 0);
    }
  }
  return { rows: [...sums].map(([label, value]) => ({ label, value })), corruption: benefit ? corruption : null };
}

export function planetBreakdown(g, p, viewer, tint = null) {
  const orbit = orbitFleets(g),
    terms = [],
    benefit = !!db.faction(viewer)?.bool('Benefits_From_Corruption');
  planetIncome(g, p, p.owner, orbit, terms);
  const rows = terms.map(t => ({ label: t.label, value: t.value }));
  if (benefit && p.owner !== viewer && (p.currentCorruption ?? -1) !== -1) {
    const gain = planetIncome(g, p, p.owner, orbit) * corruptionShare(p.currentCorruption);
    if (gain > 0) rows.push({ label: 'TEXT_ENCYCLOPEDIA_PLANET_CORRUPTION_INCOME', value: gain, tint });
  }
  if (benefit && p.piracy > 0) rows.push({ label: 'TEXT_INCOME_PIRACY', value: p.piracy, tint });
  netIncome(g, p, p.owner, orbit);
  if (p.creditSiphonOwner && p.creditSiphonOwner !== -1 && p.creditSiphonAmount)
    rows.push({ label: 'TEXT_INCOME_SMUGGLER', value: -p.creditSiphonAmount });
  return rows;
}

export function creditCap(g, owner) {
  if (g.creditCapOverride) return g.creditCapOverride;
  const perPlanet = db.constants.num('Credit_Cap_Per_Planet', 40000);
  return perPlanet < 0 ? Infinity : Math.max(1, g.planets.filter(p => p.owner === owner && !p.background).length) * perPlanet;
}

export function adjustCredits(g, owner, amount) {
  const p = g.players.find(p => p.faction === owner);
  if (p) {
    p.credits = Math.max(0, Math.min(creditCap(g, owner), Math.fround(p.credits + amount)));
    g.victoryCreditChange?.(owner);
  }
}

export const cycleNumber = g => (g.fiscal?.cycle || 0) + 1;

export function stepIncome(g, seconds) {
  const interval = fiscalCycleSeconds();
  const fiscal = g.fiscal || (g.fiscal = { cycle: 0, previous: 0, next: interval });
  g.time = (g.time || 0) + seconds;
  stepGambling(g, g.time);
  for (const p of g.players) p.credits = Math.min(p.credits, creditCap(g, p.faction));
  if (g.time + 1e-7 < fiscal.next) return [];
  const payments = [];
  for (const player of g.players) {
    const amount = playerIncome(g, player.faction, true);
    adjustCredits(g, player.faction, amount);
    payments.push({ owner: player.faction, amount });
  }
  const lo = db.constants.num('Black_Market_Income_Mult_Min', 1),
    hi = db.constants.num('Black_Market_Income_Mult_Max', 1);
  for (const p of g.planets)
    p.incomeMult = p.type.bool('Planet_Black_Market_Influences') && !p.destroyed ? lo + simRandom() * (hi - lo) : 1;
  fiscal.previous = fiscal.next;
  fiscal.next += interval;
  fiscal.cycle++;
  g.victoryCycle?.();
  return payments;
}

import { db, ObjType, loadFileList } from '../gamedata.js';
import { fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';
import { advisorHintFlags } from './advisorhints.js';
import { retreatDisabledList, setRetreatDisabledList } from './retreat.js';

const XML = 'Data/XML/';

async function readNamed(files) {
  const out = new Map();
  const texts = await Promise.all(files.map(f => fetchText(XML + f).catch(() => null)));
  for (const txt of texts) {
    if (!txt) continue;
    for (const top of parseXML(txt).children) for (const node of top.children) {
      const name = node.attrs.Name;
      if (!name) continue;
      const t = new ObjType(node.tag, name);
      for (const c of node.children) {
        const key = c.tag.toLowerCase();
        if (c.children.length) { let a = t.subs.get(key); if (!a) t.subs.set(key, (a = [])); a.push(c); continue; }
        let a = t.props.get(key); if (!a) t.props.set(key, (a = [])); a.push(c.text.trim());
      }
      out.set(name.toUpperCase(), t);
    }
  }
  return out;
}

let loaded = null;

export function loadCampaignData() {
  return (loaded ||= (async () => {
    const [campFiles, routeFiles] = await Promise.all([loadFileList('CampaignFiles.xml'), loadFileList('TradeRouteFiles.xml')]);
    const [campaigns, routes, lines] = await Promise.all([readNamed(campFiles), readNamed(routeFiles), readNamed(['TradeRouteLines.xml'])]);
    return { campaigns, routes, lines };
  })());
}

const same = (a, b) => String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
const vec3 = (t, k) => { const v = t.vec(k, [0, 0, 0]); return [v[0] || 0, v[1] || 0, v[2] || 0]; };

export const PLANET_RADIUS = 4.92;

const FORCE_KINDS = [['DUMMY_GROUND_BASE', 'skip'], ['DUMMY_STAR_BASE', 'station'], ['DUMMY_GROUND_STRUCTURE', 'ground structure'],
  ['DUMMY_ORBITAL_STRUCTURE', 'orbital structure'], ['DUMMY_GROUND_COMPANY', 'company'], ['DUMMY_SPACE_FIGHTER_SQUADRON', 'squadron'], ['DUMMY_STARSHIP', 'starship']];
const forceKinds = new WeakMap();
export function forceKind(type) {
  let kind = forceKinds.get(type);
  if (kind === undefined) {
    const b = new Set(type.list('Behavior').map(x => x.toUpperCase()));
    kind = null;
    for (const [flag, k] of FORCE_KINDS) if (b.has(flag)) { kind = k; break; }
    forceKinds.set(type, kind);
  }
  return kind;
}

function newFleet(fleets, planet, owner) {
  const f = { owner, units: [], planet, pos: null, path: [], dest: -1, leg: null };
  fleets.push(f);
  return f;
}

export function placeStartingForce(p, owner, type, fleets, depth = 0, seen = new Set()) {
  const kind = forceKind(type), open = !p.destroyed&&p.type.bool('Planet_Surface_Accessible', true);
  if(seen.has(type)||!open&&['skip','station','ground structure'].includes(kind))return undefined;
  seen.add(type);
  let record;
  if (kind === 'station') { p.station = type; p.stationOwner = owner; p.spaceLevel = type.num('Base_Level', 0); }
  else if (kind === 'ground structure') { if (open && !(p.groundLevel > 5)) p.groundStructures.push(record = { type, owner }); }
  else if (kind === 'orbital structure') { if (!(p.spaceLevel > 5)) p.orbitalStructures.push(record = { type, owner }); }
  else if (kind === 'company') {
    const transport = db.type(type.list('Company_Transport_Unit')[0]);
    const units = type.list('Company_Units').map(n => db.type(n)).filter(Boolean);
    const orbit = units.some(u => u.bool('Always_Spawn_In_Orbit'));
    if (open && !orbit && p.garrison.length < db.constants.num('Max_Ground_Forces_On_Planet', 10)) p.garrison.push(record = { type, owner });
    else newFleet(fleets, planetIndexOf(p), owner).units.push(record = { type: transport || type, carries: type });
  } else if (kind === 'squadron' || kind === 'starship') newFleet(fleets, planetIndexOf(p), owner).units.push(record = { type });
  const extra = db.type(type.str('Create_Additional_Object'));
  if (extra) placeStartingForce(p, owner, extra, fleets, depth + 1, seen);
  return record;
}
const planetIndexOf = p => p.index;

export function startingGalaxy(data, campaign) {
  const c = campaign;
  const planets = [], byName = new Map();
  for (const n of c.list('Locations')) {
    const type = db.type(n);
    if (!type || byName.has(type.name.toUpperCase())) continue;
    const p = {
      type, name: type.name, pos: vec3(type, 'Galactic_Position'),
      background: type.bool('In_Background'), selectable: type.list('Behavior').some(b => same(b, 'SELECTABLE')),
      owner: null, forces: [], index: planets.length,
      revealed:false,restricted:false,
      currentCorruption:-1,creditSiphonOwner:-1,
    };
    byName.set(type.name.toUpperCase(), planets.length);
    planets.push(p);
  }
  const at = n => byName.get(String(n).trim().toUpperCase());
  for(const [name,value]of c.tuples('Corruption_Level_Override')){const p=planets[at(name)];if(p)p.currentCorruption=+value>=1?3:-1;}

  const routes = [];
  for (const n of c.list('Trade_Routes')) {
    const r = data.routes.get(n.toUpperCase());
    if (!r) continue;
    const a = at(r.str('Point_A')), b = at(r.str('Point_B'));
    if (a === undefined || b === undefined) continue;
    routes.push({ type: r, a, b });
  }

  const perFaction = k => new Map(c.tuples(k).map(t => [t[0].toUpperCase(), t.slice(1)]));
  const credits = perFaction('Starting_Credits'), tech = perFaction('Starting_Tech_Level'), maxTech = perFaction('Max_Tech_Level');
  const ai = perFaction('AI_Player_Control'), home = perFaction('Home_Location');

  const neutral = [...db.factions.values()].find(f => f.bool('Is_Neutral'));
  for (const p of planets) {
    p.owner = neutral ? neutral.name : null;
    p.station = null; p.groundStructures = []; p.orbitalStructures = []; p.garrison = [];
    p.production = { space: [], ground: [] };
    p.radius = p.type.num('Scale_Factor', 1) * PLANET_RADIUS;
  }
  const fleets = [];
  for (const [f, pl, typeName] of c.tuples('Starting_Forces')) {
    const p = planets[at(pl)], type = db.type(typeName), fac = db.faction(f);
    if (!p || !type || !fac) continue;
    p.forces.push({ faction: fac.name, type });
    p.owner = fac.name;
    placeStartingForce(p, fac.name, type, fleets, 0);
  }
  const factions = new Set([...credits.keys(), ...ai.keys(), ...home.keys()]);
  const players = [...factions].filter(f => db.faction(f)).map(f => ({
    faction: db.faction(f).name,
    ai: ai.has(f) ? ai.get(f)[0] : null,
    credits: +(credits.get(f) || [0])[0] || 0,
    tech: +(tech.get(f) || [0])[0] || 0,
    maxTech: +(maxTech.get(f) || [0])[0] || 0,
    home: home.has(f) ? at(home.get(f)[0]) ?? -1 : -1,
    unlockedTypes: [], lockedTypes: [], disabledTypes: [], builtCounts: {}, blackMarket: [], corruptionMissions: Array(8).fill(0),
    advisorHints: advisorHintFlags(), advisorHintIndex: 0, advisorHintFrame: 90,
  }));
  const reach = db.constants.num('MaximumFleetMovementDistance', 100);
  const links = planets.map(() => []);
  const dist = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
  for (let i = 0; i < planets.length; i++) for (let j = i + 1; j < planets.length; j++) {
    if (planets[i].background || planets[j].background) continue;
    const route = routes.find(r => (r.a === i && r.b === j) || (r.a === j && r.b === i)) || null, d = dist(planets[i], planets[j]);
    if (!route && d > reach) continue;
    const cost = route ? d / (route.type.num('HS_Speed_Factor', 1) || 1) : d;
    links[i].push({ to: j, route, cost }); links[j].push({ to: i, route, cost });
  }
  for (const p of planets) if (p.owner && db.faction(p.owner)?.bool('Benefits_From_Corruption') && (p.currentCorruption ?? -1) === -1) p.currentCorruption = 3;
  return { campaign: c, planets, routes, links, fleets, players, active: c.str('Starting_Active_Player'), autoReveal:c.has('Planet_Auto_Reveal')?c.bool('Planet_Auto_Reveal'):undefined,time: 0, fiscal: null };
}

export function isHumanFaction(g, faction) {
  const id = String(faction || '').toUpperCase();
  return !!id && (g.humans ? g.humans.includes(id) : id === String(g.active || '').toUpperCase());
}

export function snapshotGalaxy(g) {
  const n = t => (t ? t.name : null), list = l => l.map(x => [x.type.name, x.owner, x.markerId ?? -1,{checkContestedSpace:x.checkContestedSpace}]);
  return {
    campaign: g.campaign.name, ...(g.humans ? { humans: g.humans.slice() } : {}), time: g.time || 0, sabotageOff: !!g.sabotageOff, fiscal: g.fiscal ? { ...g.fiscal } : null,
    ai:g.aiSnapshot?.()??g.aiSaved??null, story:g.storySnapshot?.()??g.storySaved??null, storyLua:g.storyLuaSnapshot?.()??g.storyLuaSaved??null, scriptUI:g.scriptUISnapshot?.()??g.scriptUISaved??null, hostState:g.hostSnapshot?.()??g.hostSaved??null, storyFlags:g.storyFlagSnapshot?.()??g.storyFlagsSaved??null, retreatDisabled:retreatDisabledList(), victory:g.victorySnapshot?.()??g.victorySaved??null,
    log: g.log ? structuredClone(g.log) : null,
    displayFilters: g.displayFilters || 0, autoReveal: g.autoReveal, visibility: g.visibility ? { viewer: g.visibility.viewer, clock: g.visibility.clock,
      planets: g.visibility.planets.map(v => ({ discovered: v.discovered, revealFrames: v.revealFrames, rememberedOwner: v.rememberedOwner, mask: v.mask || 0 })) } : null,
    players: g.players.map(p => ({ faction: p.faction, ai:p.ai,credits: p.credits, tech: p.tech, maxTech: p.maxTech, bribeMultiplier: p.bribeMultiplier, tutorial: !!p.tutorial, bounty: p.bounty || 0, captureRewards: (p.captureRewards || []).slice(),
      lastSpaceDefense:p.lastSpaceDefense,lastGroundDefense:p.lastGroundDefense,
      advisorHints: advisorHintFlags(p.advisorHints), advisorHintIndex: p.advisorHintIndex || 0, advisorHintFrame:p.advisorHintFrame??90,
      unlockedTypes: (p.unlockedTypes || []).slice(), lockedTypes: (p.lockedTypes || []).slice(), disabledTypes: (p.disabledTypes || []).slice(), builtCounts: { ...p.builtCounts }, blackMarket: (p.blackMarket || []).slice(), corruptionMissions: (p.corruptionMissions || Array(8).fill(0)).slice() })),
    planets: g.planets.map(p => ({ owner: p.owner, revealed:!!p.revealed,restricted:!!p.restricted,marketRestricted:!!p.marketRestricted,invasionEnabled:p.invasionEnabled!==false,currentCorruption:p.currentCorruption??-1,creditSiphonOwner:p.creditSiphonOwner??-1,corruption:{kind:p.corruptionKind||null,pending:p.corruptionPending??-1,start:p.corruptionStart||0,end:p.corruptionEnd||0,last:p.corruptionLast||0,hologram:p.showCorruptionHologram!==false,restricted:!!p.corruptionRestricted,abilities:!!p.abilitiesRestricted,sabotage:!!p.sabotageRestricted},siphon:{pct:p.creditSiphonPct||0,end:p.creditSiphonEnd||0,amount:p.creditSiphonAmount||0,found:!!p.creditSiphonFound},piracy:p.piracy||0,sabotageCount:p.sabotageCount||0,incomeHaltUntil:p.incomeHaltUntil||0,incomeMult:p.incomeMult??1,gambling:p.gambling?{...p.gambling}:null,station: n(p.station), stationOwner: p.stationOwner || null, spaceLevel: p.spaceLevel || 0,
      lastSpaceConflict:p.lastSpaceConflict,destroyed:!!p.destroyed,killedHeroes:structuredClone(p.killedHeroes||[]),
      extra:{ finalBlowOwner:p.finalBlowOwner, ownerSeen:p.ownerSeen, conversionTime:p.conversionTime, lastGroundConflict:p.lastGroundConflict, groundBaseOwner:p.groundBaseOwner, structureSlots:p.structureSlots, groundLevel:p.groundLevel, corruptionOwner:p.corruptionOwner, incomeHalted:p.incomeHalted },
      politicalOwner:p.politicalOwner,politicalTargetOwner:p.politicalTargetOwner,politicalValue:p.politicalValue,
      tacticalStructures:(p.tacticalStructures||[]).map(u=>({type:u.type.name,owner:u.owner,position:u.position.slice(),baseLevel:u.baseLevel})),
      ground: list(p.groundStructures), orbital: list(p.orbitalStructures), garrison: list(p.garrison),
      visibilityModifiers: p.visibilityModifiers?.map(m => ({ ...m })),
      production: Object.fromEntries(['space', 'ground'].map(k => [k, p.production[k].map(q => ({ ...q, type: n(q.type) }))])) })),
    fleets: g.fleets.map(f => ({ owner: f.owner, planet: f.planet, ...(f.slot!==undefined?{slot:f.slot}:{}), ...(f.destinationSlot!==undefined?{destinationSlot:f.destinationSlot}:{}), ...(f.humanOrder?{humanOrder:true}:{}), ...(f.aiStatus!==undefined?{aiStatus:f.aiStatus}:{}), ...(f.raid!==undefined?{raid:f.raid}:{}), ...(f.departSlot!==undefined?{departSlot:f.departSlot}:{}), units: f.units.map(u => [u.type.name, n(u.carries), u.markerId ?? -1,{checkContestedSpace:u.checkContestedSpace,...(u.raiding?{raiding:true}:{}),...(u.pendingAbility!==undefined?{pendingAbility:u.pendingAbility}:{})}]), path: f.path.slice(), dest: f.dest,
      leg: f.leg ? { a: f.leg.a, b: f.leg.b, from: f.leg.from, to: f.leg.to, dir: f.leg.dir, speed: f.leg.speed } : null, pos: f.pos ? f.pos.slice() : null })),
  };
}

export function applyGalaxy(g, s) {
  const t = name => (name ? db.type(name) || null : null), list = l => l.map(([n, owner, markerId = -1,flags={}]) => ({ type: t(n), owner, markerId,...flags })).filter(x => x.type);
  g.time = s.time || 0; g.sabotageOff = !!s.sabotageOff;
  if (s.humans) g.humans = s.humans.slice();
  g.aiSaved=s.ai||null;
  g.storySaved=s.story||null;g.storyLuaSaved=s.storyLua||null;g.scriptUISaved=s.scriptUI||null;g.hostSaved=s.hostState||null;
  g.storyFlagsSaved=s.storyFlags||null;
  setRetreatDisabledList(s.retreatDisabled);
  g.victorySaved=s.victory||null;
  g.fiscal = s.fiscal ? { ...s.fiscal } : null;
  g.log = s.log ? structuredClone(s.log) : null;
  g.displayFilters = s.displayFilters || 0;
  if(Object.hasOwn(s,'autoReveal'))g.autoReveal = s.autoReveal;
  g.visibility = s.visibility ? { viewer: s.visibility.viewer, clock: s.visibility.clock || 0, planets: s.visibility.planets.map(v => ({ ...v })) } : null;
  for (const saved of s.players || []) {
    const player = g.players.find(p => p.faction === saved.faction);
    if (player) {
      if(Object.hasOwn(saved,'ai'))player.ai=saved.ai;
      player.lastSpaceDefense=saved.lastSpaceDefense??undefined;player.lastGroundDefense=saved.lastGroundDefense??undefined;
      player.advisorHints = advisorHintFlags(saved.advisorHints);player.advisorHintIndex = saved.advisorHintIndex || 0;player.advisorHintFrame=saved.advisorHintFrame??90;
      player.credits = saved.credits; player.captureRewards = (saved.captureRewards || []).slice();
      if (saved.tech !== undefined) { player.maxTech = saved.maxTech; player.tech = saved.tech; }
      if (saved.bribeMultiplier !== undefined) player.bribeMultiplier = saved.bribeMultiplier;
      player.tutorial = !!saved.tutorial; player.bounty = saved.bounty || 0;
      player.unlockedTypes = (saved.unlockedTypes || []).slice(); player.lockedTypes = (saved.lockedTypes || []).slice(); player.disabledTypes = (saved.disabledTypes || []).slice(); player.builtCounts = { ...saved.builtCounts }; player.blackMarket = (saved.blackMarket || []).slice(); player.corruptionMissions = (saved.corruptionMissions || Array(8).fill(0)).slice();
    }
  }
  s.planets.forEach((sp, i) => {
    const p = g.planets[i];
    if (!p) return;
    p.owner = sp.owner; p.station = t(sp.station); p.stationOwner = sp.stationOwner; p.spaceLevel = sp.spaceLevel;
    p.lastSpaceConflict=sp.lastSpaceConflict??undefined;p.destroyed=!!sp.destroyed;p.killedHeroes=structuredClone(sp.killedHeroes||[]);
    for (const [k, v] of Object.entries(sp.extra || {})) { if (v !== undefined) p[k] = v; else delete p[k]; }
    p.politicalOwner=sp.politicalOwner;p.politicalTargetOwner=sp.politicalTargetOwner;p.politicalValue=sp.politicalValue;p.politicalChecked=-1;
    p.tacticalStructures=(sp.tacticalStructures||[]).flatMap(u=>{const type=t(u.type);return type?[{...u,type,position:u.position.slice()}]:[];});
    p.revealed=!!sp.revealed;p.restricted=!!sp.restricted;p.marketRestricted=!!sp.marketRestricted;p.invasionEnabled=sp.invasionEnabled!==false;
    p.currentCorruption=sp.currentCorruption??-1;p.creditSiphonOwner=sp.creditSiphonOwner??-1;p.corruptionKind=sp.corruption?.kind||null;p.corruptionPending=sp.corruption?.pending??-1;p.corruptionStart=sp.corruption?.start||0;p.corruptionEnd=sp.corruption?.end||0;p.corruptionLast=sp.corruption?.last||0;p.showCorruptionHologram=sp.corruption?.hologram!==false;p.corruptionRestricted=!!sp.corruption?.restricted;p.abilitiesRestricted=!!sp.corruption?.abilities;p.sabotageRestricted=!!sp.corruption?.sabotage;p.creditSiphonPct=sp.siphon?.pct||0;p.creditSiphonEnd=sp.siphon?.end||0;p.creditSiphonAmount=sp.siphon?.amount||0;p.creditSiphonFound=!!sp.siphon?.found;p.piracy=sp.piracy||0;p.sabotageCount=sp.sabotageCount||0;p.incomeHaltUntil=sp.incomeHaltUntil||0;p.incomeMult=sp.incomeMult??1;p.gambling=sp.gambling?{...sp.gambling}:null;
    p.visibilityModifiers = sp.visibilityModifiers?.map(m => ({ ...m }));
    p.groundStructures = list(sp.ground); p.orbitalStructures = list(sp.orbital); p.garrison = list(sp.garrison);
    p.production = Object.fromEntries(['space', 'ground'].map(k => [k, (sp.production?.[k] || []).map(q => ({ ...q, type: t(q.type) })).filter(q => q.type)]));
  });
  g.fleets = s.fleets.map(f => ({ owner: f.owner, planet: f.planet, ...(f.slot!==undefined?{slot:f.slot}:{}), ...(f.destinationSlot!==undefined?{destinationSlot:f.destinationSlot}:{}), ...(f.humanOrder?{humanOrder:true}:{}), ...(f.aiStatus!==undefined?{aiStatus:f.aiStatus}:{}), ...(f.raid!==undefined?{raid:f.raid}:{}), ...(f.departSlot!==undefined?{departSlot:f.departSlot}:{}), units: f.units.map(([a, b, markerId = -1,flags={}]) => ({ type: t(a), carries: t(b) || undefined, markerId,...flags })).filter(u => u.type),
    path: f.path || [], dest: f.dest ?? -1, leg: f.leg, pos: f.pos })).filter(f => f.units.length);
}

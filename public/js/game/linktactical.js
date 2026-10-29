import { retreatDestination } from './fleetretreat.js';
import { db, autoColors } from '../gamedata.js';
import { snapshotGalaxy } from './galaxy.js';
import { carriedCompany } from './invasion.js';
import { destroyPlanet } from './planetdestruction.js';
import { StoryFlags } from './storyflags.js';
import { adjustCredits } from './galacticeconomy.js';
import { missionResult } from './galacticcorruption.js';
import { defeatHeroStory } from './galacticbattleevents.js';
import { orderMove } from './fleets.js';
const key = s => String(s || '').toUpperCase();
const integer = (s, d = 0) => (s === undefined || s === '' ? d : parseInt(s, 10) || 0);
export function readLinkedTactical(game, params) {
  if (params.slice(0, 5).length < 5 || [0, 1, 2, 3, 4].some(i => !params[i])) return null;
  const g = game.galaxy,
    planet = g.planets.find(p => key(p.name) === key(params[0]));
  const attacker = g.players.find(p => key(p.faction) === key(params[2]))?.faction;
  if (!planet || !attacker) return null;
  if (params[1] === 'EITHER') return null;
  const mode = params[1] === 'SPACE' ? 'space' : 'land';
  let defender = g.players.find(p => key(p.faction) === key(params[4]))?.faction;
  if (!defender)
    defender =
      mode === 'space'
        ? g.fleets.find(f => f.planet === planet.index && !f.leg && key(f.owner) !== key(attacker) && f.units.some(u => !u.dead))?.owner ||
          planet.stationOwner ||
          planet.owner
        : planet.owner;
  if (!defender || key(defender) === key(attacker)) return null;
  return {
    planet: planet.index,
    mode,
    attacker,
    defender,
    map: params[3],
    hero: db.type(params[5])?.name || '',
    plot: params[6] || '',
    sandbox: !!integer(params[7]),
    cinematic: integer(params[8], 1),
    faded: !!integer(params[9]),
    letterbox: !!integer(params[10]),
    resolution: { RETREAT_PLAYER: 1, RETREAT_AI: 2, DESTROY_AI: 3 }[params[11]] || 3,
    pending: !!integer(params[12], 1),
    pathfinder: !!integer(params[13], 1)
  };
}

export function linkedTacticalSetup(game, request) {
  const g = game.galaxy,
    p = g.planets[request.planet],
    space = request.mode === 'space',
    owners = [request.attacker, request.defender];
  const teamFactions = owners.slice();
  if (!teamFactions.includes(game.me)) teamFactions.push(game.me);
  const order = [game.me, ...teamFactions.filter(n => n !== game.me)],
    players = order.map((f, i) => ({
      human: i === 0,
      team: teamFactions.indexOf(f),
      auto: true,
      color: i ? '#e0352b' : '#3686f2',
      difficulty: game.setup.difficulty || 'medium'
    }));
  const side = owner => order.indexOf(owner),
    participants = new Map();
  const add = (gid, record, owner, kind) => {
    participants.set(gid, { record, owner, kind });
    return {
      gid,
      type: (space ? record.type : carriedCompany(record) || record.type).name,
      markerId: record.markerId ?? -1,
      pathfinder: !!record.pathfinder
    };
  };
  const units = (owner, defender = false) => {
    if (!request.sandbox || owner !== game.me) return [];
    if (!space && defender)
      return p.garrison.flatMap((u, i) => (u.owner === owner && !u.dead ? [add('g:' + i, u, owner, 'garrison')] : []));
    return g.fleets.flatMap((f, fi) =>
      f.planet === p.index && !f.leg && f.owner === owner
        ? f.units.flatMap((u, ui) => (!u.dead && (space || carriedCompany(u)) ? [add(fi + ':' + ui, u, owner, 'fleet')] : []))
        : []
    );
  };
  const attacker = { team: 0, side: side(owners[0]), units: units(owners[0]) },
    defender = {
      team: 1,
      side: side(owners[1]),
      units: units(owners[1], true),
      structures: [],
      orbital: [],
      station: null,
      tech: g.players.find(p => p.faction === owners[1])?.tech || 0
    };
  if (request.sandbox && owners[1] === game.me) {
    if (space) {
      defender.station = p.station?.name || null;
      defender.orbital = p.orbitalStructures.filter(u => u.owner === game.me).map(u => u.type.name);
    } else {
      defender.structures = p.groundStructures.flatMap((u, i) => (u.owner === game.me ? [add('s:' + i, u, game.me, 'structure')] : []));
      defender.tacticalStructures = (p.tacticalStructures || [])
        .filter(u => u.owner === game.me)
        .map(u => ({ ...u, type: u.type.name, position: u.position.slice() }));
    }
  }
  const context = space ? game.story?.battleContext(p, owners) : null;
  const storyPlots = [];
  const setup = {
    mode: request.mode,
    mapFile: request.map,
    credits: 0,
    popCap: 0,
    fog: true,
    preBuilt: false,
    teamFactions,
    players,
    linkedTactical: { ...request },
    tacticalStoryPlot: request.plot,
    campaign: {
      planet: p.index,
      planetType: p.type.name,
      campaignName: g.campaign.name,
      galaxy: snapshotGalaxy(g),
      sides: owners,
      storyPlots,
      linked: request,
      attacker,
      defender
    }
  };
  return { setup, participants, context, request };
}

export function linkedMapLoaded(host, request) {
  if (!host) return;
  const planet = host.game.galaxy.planets[request.planet];
  for (const e of host.eventTypes.get('STORY_LOAD_TACTICAL_MAP') || []) {
    const names = String(e.params[0] || '')
      .split(',')
      .map(n => key(n.trim()));
    if (!names.includes(key(planet.name))) continue;
    const heroes = String(e.params[1] || '')
      .split(',')
      .map(n => key(n.trim()))
      .filter(Boolean);
    if (heroes.length && !heroes.includes(key(request.hero))) continue;
    if ((e.params[2] === 'SPACE') !== (request.mode === 'space')) continue;
    host.fire(e);
  }
}

function removeRecord(game, p, record, owner, killer, refund = false) {
  if (record.dead) return;
  const type = record.carries || record.type;
  game.victory?.heroKilled(record, p, owner, killer);
  const members = [
    type,
    ...type
      .list('Company_Units')
      .map(n => db.type(n))
      .filter(Boolean),
    ...type
      .list('Squadron_Units')
      .map(n => db.type(n))
      .filter(Boolean)
  ];
  for (const t of new Set(members)) defeatHeroStory(game.story, t, p);
  if (refund) refundType(game, type, owner);
  record.dead = true;
  const object = game.story?.objectWrappers?.get(record)?.__object;
  if (object) object.dead = true;
}
function refundType(game, type, owner) {
  const amount = type.num('Build_Cost_Credits', 0),
    adjust = game.ai?.controllers?.get(key(owner))?.adjustment?.credit ?? 1;
  if (amount > 0) adjustCredits(game.galaxy, owner, amount * adjust);
}
function retreatGround(game, p, owner, forced = false) {
  const units = [];
  for (const u of p.garrison)
    if (!u.dead && u.owner === owner) {
      const t = db.type(u.type.list('Company_Transport_Unit')[0]);
      if (t) {
        u.carries = u.type;
        u.type = t;
        units.push(u);
      }
    }
  if (!units.length) return false;
  p.garrison = p.garrison.filter(u => !units.includes(u));
  const g = game.galaxy,
    fleet = { owner, planet: p.index, units, path: [], dest: -1, leg: null, pos: null };
  g.fleets.push(fleet);
  const dest = retreatDestination(g, p, owner, true, forced);
  if (dest !== p) orderMove(g, fleet, dest.index, null, 0, { free: true });
  return true;
}
export function finishLinkedTactical(game, session, result) {
  const g = game.galaxy,
    request = session.request,
    p = g.planets[request.planet],
    space = request.mode === 'space',
    owners = [request.attacker, request.defender];
  const winner = result.winner === 'attacker' ? 0 : 1,
    winning = owners[winner],
    losing = owners[1 - winner],
    humanWin = winning === game.me;
  if (request.corruption) {
    session.popped = true;
    if (game.story && (result.storyFlags || result.galaxy?.storyFlags))
      game.story.flags = new StoryFlags(result.storyFlags || result.galaxy.storyFlags);
    game.battle = null;
    missionResult(game, request, winner === 0);
    if (game.story) {
      game.story.objectCache = null;
      game.story.reasonCache.clear();
    }
    game.ai?.invalidate();
    game.battles?.dirty.add(p.index);
    game.lastResult = result;
    return { winning, losing };
  }
  if (space) {
    const combat = { ...result, sides: owners };
    game.victory?.superweaponBattle(combat);
    result = { ...result, alive: combat.alive, superweaponDestroyed: combat.superweaponDestroyed };
  }
  if (game.story && (result.storyFlags || result.galaxy?.storyFlags))
    game.story.flags = new StoryFlags(result.storyFlags || result.galaxy.storyFlags);
  const alive = new Set(result.alive || []),
    marked = new Set(result.markedDead || []);
  if (space && Object.hasOwn(result, 'linkedStation')) {
    const level = Math.min(p.spaceLevel || p.station?.num('Base_Level', 0) || 0, result.linkedStation?.level || 0);
    let type = level ? db.type(result.linkedStation.type) : null;
    const seen = new Set();
    while (type && type.num('Base_Level', 0) > level && !seen.has(type)) {
      seen.add(type);
      type = db.type(type.str('Prev_Level_Base'));
    }
    game.story?.stationChanged(p, p.station, type, winning);
    p.station = type;
    p.spaceLevel = level;
    if (!level) {
      p.stationOwner = null;
      for (const u of p.orbitalStructures) removeRecord(game, p, u, u.owner, winning);
    }
    if (winner === 0) p.production.space = [];
  } else if (!space) {
    if (winner === 0) {
      for (const u of p.groundStructures) removeRecord(game, p, u, u.owner, winning);
      p.groundLevel = 0;
      p.tacticalStructures = [];
      p.production.ground = [];
      if (p.station && (p.stationOwner || p.owner) !== winning) {
        game.story?.stationChanged(p, p.station, null, winning);
        p.station = null;
        p.stationOwner = null;
        p.spaceLevel = 0;
        for (const u of p.orbitalStructures) removeRecord(game, p, u, u.owner, winning);
        p.production.space = [];
      }
    }
    p.groundBaseOwner = winning;
  }
  session.popped = true;
  for (const [gid, { record, owner }] of session.participants)
    if (!alive.has(gid) || marked.has(gid)) removeRecord(game, p, record, owner, winning);
  let retreating = null;
  const retire = (owner, forced = false) => {
    const present = space
      ? g.fleets.some(f => f.planet === p.index && !f.leg && f.owner === owner && f.units.some(u => !u.dead))
      : p.garrison.some(u => u.owner === owner && !u.dead);
    if (!present) return;
    if (space) game.battles?.retreat(p.index, owner);
    else retreatGround(game, p, owner, forced);
    retreating = owner;
  };
  if (humanWin) {
    if (request.resolution === 1) for (const owner of owners) if (owner === game.me) retire(owner);
    if (request.resolution === 2) for (const owner of owners) if (owner !== game.me) retire(owner);
    if (request.resolution === 3) {
      if (space) {
        for (const f of g.fleets)
          if (f.planet === p.index && !f.leg && f.owner !== game.me)
            for (const u of f.units) removeRecord(game, p, u, f.owner, winning, true);
      } else {
        for (const u of p.garrison) if (u.owner !== game.me) removeRecord(game, p, u, u.owner, winning, true);
      }
    }
    const controller = space ? p.stationOwner || p.owner : p.owner,
      clear = request.resolution === 1 ? controller === game.me : controller !== game.me;
    if (clear) {
      if (space) {
        if (p.station) {
          const old = p.station;
          game.story?.stationChanged(p, old, null, winning);
          if (request.resolution !== 1) refundType(game, old, controller);
          p.station = null;
          p.stationOwner = null;
          p.spaceLevel = 0;
        }
        for (const u of p.orbitalStructures) removeRecord(game, p, u, u.owner, winning, request.resolution !== 1);
        p.production.space = [];
      } else {
        for (const u of p.groundStructures) removeRecord(game, p, u, u.owner, winning, request.resolution !== 1);
        p.groundLevel = 0;
        p.tacticalStructures = [];
        p.production.ground = [];
      }
    }
  } else retire(losing, true);
  g.fleets = g.fleets.filter(f => {
    f.units = f.units.filter(u => !u.dead);
    return f.units.length;
  });
  p.garrison = p.garrison.filter(u => !u.dead);
  p.groundStructures = p.groundStructures.filter(u => !u.dead);
  p.orbitalStructures = p.orbitalStructures.filter(u => !u.dead);
  if (result.planetDestroyed) destroyPlanet(game, p, false);
  game.battle = null;
  if (game.story) {
    game.story.objectCache = null;
    game.story.reasonCache.clear();
    game.story.battleFinished(p, owners, [], winner, space, session.context);
  }
  if (retreating)
    for (const e of game.story?.eventTypes.get('STORY_RETREAT') || []) {
      const friendly = e.params[0] === 'FRIENDLY' && key(e.plot.owner) === key(retreating),
        enemy =
          e.params[0] === 'ENEMY' &&
          db
            .faction(retreating)
            ?.list('Enemies')
            .some(n => key(n) === key(e.plot.owner));
      if (friendly || enemy) game.story.fire(e);
    }
  game.ai?.invalidate();
  game.battles?.dirty.add(p.index);
  game.lastResult = result;
  return { winning, losing };
}

export function linkedParent(game) {
  if (!game.setup.linkedTactical || typeof window === 'undefined' || window.parent === window) return null;
  const parent = window.parent.game;
  return parent?.linkedMission?.frame.contentWindow === window ? parent : null;
}
export function reportLinkedVictory(game, winner) {
  const parent = linkedParent(game);
  if (!parent) return;
  const flags = parent.linkedMissionVictory(winner, game.tacticalStory?.flags.snapshot() || []);
  if (flags && game.tacticalStory) game.tacticalStory.flags = new StoryFlags(flags);
}
let factionOrder = null,
  factionDatabase = null;
export function authoredMapOwner(setup, object) {
  if (!setup.linkedTactical || object.owner == null || object.owner < 0) return null;
  if (factionDatabase !== db.factions) {
    factionDatabase = db.factions;
    factionOrder = [...db.factions.values()];
  }
  return factionOrder[object.owner]?.name || null;
}
export function missionMapActor(setup, object) {
  const type = object.type,
    beh =
      setup.mode === 'land'
        ? (type._landBeh ||= new Set([...type.list('Behavior'), ...type.list('LandBehavior')].map(n => n.toUpperCase())))
        : type.behaviors();
  return (
    !type.bool('Is_Marker') &&
    !beh.has('MARKER') &&
    (beh.has('SELECTABLE') ||
      type.list('Company_Units').length > 0 ||
      type.list('Squadron_Units').length > 0 ||
      (setup.mode === 'land' && beh.has('WALK_LOCOMOTOR')))
  );
}
export function ensureMissionPlayers(setup, map) {
  if (!setup.linkedTactical) return;
  for (const o of map.objects) {
    const owner = authoredMapOwner(setup, o);
    if (!owner || db.faction(owner)?.bool('Is_Neutral') || setup.teamFactions.includes(owner) || !missionMapActor(setup, o)) continue;
    const team = setup.teamFactions.length;
    setup.teamFactions.push(owner);
    setup.players.push({ team, human: false, auto: true, color: '#f7c90d', difficulty: 'medium' });
  }
  autoColors(setup.players, setup.teamFactions, ['#3686f2', '#e0352b', '#f7c90d', '#3fc45a', '#b05cf0', '#ff8a1f', '#27c9c9', '#f06aa8']);
}

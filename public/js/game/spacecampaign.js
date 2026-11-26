// The rules of a campaign space battle that act on the battle itself: retreat, auto resolve, the victory check and
// the result handed back to the galaxy. They run wherever the battle is stepped (the page, or the battle thread),
// against `game`, which supplies world, setup, campaignBook, tacticalVictory, tacticalStory, tacticalCampaign and
// human. Anything seen or heard goes through game methods (retreatCameraStart, retreatCameraFrame,
// retreatCameraEnd, retreatLine, audio), which the battle thread passes on to the page.
import { db } from '../gamedata.js';
import { RetreatCoordinator, hasRetreatPrevention } from './retreat.js';
import { isTacticalSuperweapon } from './tacticalsuperweapon.js';
import { sideBeaten, battleResult } from './campaignbattle.js';
import { resolveTactical, spaceRosters } from './tacticalautoresolve.js';

export function spaceRetreat(game, cb) {
  const w = game.world,
    sides = [cb.attacker.team, cb.defender.team];
  const going = p =>
    [...w.units, ...w.squads].filter(
      e =>
        e.player === p &&
        !e.dead &&
        !e.isStructure &&
        !e.isPad &&
        !e.isStation &&
        !e.underConstruction &&
        !e.hyper &&
        // a squadron's own type usually has no Hyperspace tag, its fighters do: it leaves with them
        (e.type?.bool('Hyperspace') ||
          !!e.squad?.type?.bool('Hyperspace') ||
          !!e.fighters?.some(f => !f.dead && f.type?.bool('Hyperspace'))) &&
        !(
          e.hardpoints &&
          e.hardpoints.some(h => h.kind === 'HARD_POINT_ENGINE') &&
          e.hardpoints.filter(h => h.kind === 'HARD_POINT_ENGINE').every(h => !h.alive)
        )
    );
  w.defenderTeam = cb.defender.team;
  return (w.retreat = new RetreatCoordinator({
    prefix: 'Space',
    campaign: !!cb && !game.setup.linkedTactical,
    skirmishRules: () => !!cb?.skirmishRules || !!game.skirmishRules,
    principals: cb?.sides || null,
    time: () => w.time,
    generic: name => game.tacticalStory?.generic(name),
    players: () => w.players.filter(p => p.id >= 0),
    factionOf: p => p.factionName,
    teamOf: p => p.team,
    isLocal: p => (game.setup.net ? !!p.human : p === game.human),
    isSide: p => p.id >= 0 && sides.includes(w.teams.indexOf(p.team)),
    units: going,
    everything: p => [...w.units, ...w.squads].filter(e => e.player === p && !e.dead),
    blocker: p =>
      w.interdictors.some(i => i.team !== p.team)
        ? 3
        : w.units.some(u => !u.dead && u.player === p && hasRetreatPrevention(u.type))
          ? 4
          : w.units.some(u => !u.dead && u.player === p && isTacticalSuperweapon(u.type))
            ? 6
            : 0,
    begin: state => {
      w.retreatState = state;
      for (const e of state.list)
        for (const u of e.fighters || [e]) {
          if (u.retreatTarget === undefined) u.retreatTarget = u.targetableUnit;
          u.holdFire = true;
          u.targetableUnit = false;
          u.setOrder?.({ kind: 'idle' });
        }
    },
    cancelled: state => {
      for (const e of state.list)
        for (const u of e.fighters || [e]) {
          u.holdFire = undefined;
          u.targetableUnit = u.retreatTarget ?? u.targetableUnit;
          u.retreatTarget = undefined;
        }
      w.retreatState = null;
    },
    flightStart: (state, list) => {
      const d = w.retreatDir || { x: -1, y: 0 };
      for (const e of list)
        for (const u of e.fighters || [e]) {
          u.retreatFlight = true;
          u.heading = Math.atan2(d.y, d.x);
        }
    },
    move: (e, distance) => {
      if (e.isSquad || e.fighters) return;
      const d = w.retreatDir || { x: -1, y: 0 };
      e.x += d.x * distance;
      e.y += d.y * distance;
      e.syncObj?.();
    },
    // The wait before the jump depends only on what is leaving; the camera itself is the page's.
    cameraStart: (state, list) => {
      const station = state.player.station && !state.player.station.dead ? state.player.station : null,
        flyers = list.length > 0;
      if (!station && !flyers) return 0;
      game.retreatCameraStart?.(station, flyers, w.retreatDir || null, w.retreatMarker || null);
      return flyers ? (station ? 450 : 150) : 300;
    },
    cameraFrame: frame => game.retreatCameraFrame?.(frame),
    cameraEnd: () => game.retreatCameraEnd?.(),
    released: e => {
      const u = e.fighters?.[0] || e,
        sfx = e.type?.str('SFXEvent_Retreat_Engines_Jump').trim() || e.player?.faction?.str('SFXEvent_Exit_Into_Hyperspace').trim();
      if (sfx) game.audio.play(sfx, u.x, u.y);
    },
    explode: p => {
      const st = p.station;
      if (!st || st.dead) return;
      const blast = db.type(st.type.str('Retreat_Self_Destruct_Explosion').trim());
      if (blast) w.detonate(blast, p, st.x, st.y, (st.z || 0) + st.type.num('Ranged_Target_Z_Adjust', 0), 1, true);
      w.kill(st, null);
    },
    flightEnd: () => {
      w.retreatState = null;
    },
    remove: (e, lost) => {
      if (e.isSquad || e.fighters) {
        e.dead = true;
        if (!lost) e.retreated = true;
        return;
      }
      if (!lost) e.retreated = true;
      w.removeUnit(e);
    },
    end: enemy => game.tacticalVictory.request(enemy.team, 12, 210),
    play: (sfx, p) => {
      if (p === game.human && sfx) game.audio.play(sfx);
    },
    show: (...a) => game.retreatLine?.(...a)
  }));
}

export function startCinematicRetreat(game, id, seconds) {
  const w = game.world,
    p = w.players.find(q => q.id === id);
  if (!p || !(seconds >= 0)) return;
  const wait = db.faction(p.factionName)?.num('Space_Retreat_Unit_Increment_Wait_Frames', 1) ?? 1;
  const list = [...w.units, ...w.squads].filter(e => e.player === p && !e.dead && !e.isStructure && !e.isPad && !e.isStation && !e.underConstruction);
  (game.cinematicJumps ||= []).push(...list.map((e, i) => ({ e, at: w.time + (seconds * 30 + i * wait) / 30, left: 90 })));
}

export function stepCinematicJumps(game, dt) {
  const jumps = game.cinematicJumps,
    w = game.world;
  if (!jumps?.length) return;
  for (const j of jumps) {
    if (j.done) continue;
    const e = j.e;
    if (e.dead) {
      j.done = true;
      continue;
    }
    const jumping = w.time >= j.at,
      fast = e.player?.faction?.num('Space_Retreat_Flight_Move_Increment', 500) ?? 500;
    if (jumping && !j.started) {
      j.started = true;
      for (const u of e.fighters || [e]) u.retreatFlight = true;
      const sfx = e.type?.str('SFXEvent_Retreat_Engines_Jump').trim() || e.player?.faction?.str('SFXEvent_Exit_Into_Hyperspace').trim(),
        u0 = e.fighters?.[0] || e;
      if (sfx) game.audio.play(sfx, u0.x, u0.y);
    }
    if (!e.isSquad && !e.fighters) {
      const h = e.heading || 0,
        step = jumping ? fast : 8.125;
      e.x += Math.cos(h) * step * dt * 30;
      e.y += Math.sin(h) * step * dt * 30;
      e.syncObj?.();
    }
    if (!jumping) continue;
    j.left -= dt * 30;
    if (j.left <= 0) {
      j.done = true;
      if (e.isSquad || e.fighters) e.dead = true;
      else w.removeUnit(e);
    }
  }
  game.cinematicJumps = jumps.filter(j => !j.done);
}

// Settles the battle by auto resolve for `player` (the one who asked). Returns false when it was refused.
export function autoResolveBattle(game, player) {
  const w = game.world,
    cb = game.setup.campaign;
  const code = game.retreat.canRetreat(player);
  if (code) {
    const sfx = game.retreat.refusal(player, code);
    if (sfx && player === game.human) game.audio.play(sfx);
    return false;
  }
  const rosters = spaceRosters(w, cb),
    { winner, doomed } = resolveTactical(rosters, cb, { space: true });
  const lose = e => {
    if (e.reserve) {
      if (e.dead) return;
      e.dead = true;
      const at = e.reserve.reinforcements.indexOf(e.type);
      if (at >= 0) e.reserve.reinforcements.splice(at, 1);
    } else if (!e.dead) w.kill(e, null);
  };
  for (const e of doomed) lose(e);
  const [won, lost] = winner === 0 ? [cb.attacker.team, cb.defender.team] : [cb.defender.team, cb.attacker.team];
  const loser = w.players.find(p => p.id >= 0 && p.team === w.teams[lost]);
  if (loser && game.retreat.canRetreat(loser) !== 0) {
    for (const c of rosters[1 - winner]) lose(c.entity);
    return true;
  }
  if (!sideBeaten(w, w.teams[lost])) game.tacticalVictory.request(w.teams[won], 12, 210);
  return true;
}

export function campaignCheck(game) {
  const w = game.world,
    cb = game.setup.campaign;
  if (!cb || game.over || game.tacticalVictory.winner) return;
  const station = game.campaignBook?.station;
  if (db.constants.bool('Space_Station_Destruction_Forces_Retreat') && station && station.dead) {
    game.tacticalVictory.request(w.teams[cb.attacker.team], 15, 210);
    return;
  }
  for (const s of [cb.attacker, cb.defender]) {
    const team = w.teams[s.team];
    if (!sideBeaten(w, team)) continue;
    const other = w.teams[s === cb.attacker ? cb.defender.team : cb.attacker.team];
    game.tacticalVictory.request(other, 11, 210);
    return;
  }
}

// One battle step of the campaign victory check. Returns the outcome once the battle is decided.
export function campaignVictoryStep(game) {
  if (!game.campaignBook || game.over) return null;
  const result = game.tacticalVictory.update(game.world.tacticalSuperweapons.disableDepth, () => campaignCheck(game));
  if (!result) return null;
  game.world.winner = result.team;
  return {
    ...battleResult(game.world, game.campaignBook, game.setup.campaign, result.team.id),
    ...game.tacticalCampaign?.result(game.campaignBook),
    sides: game.setup.teamFactions.slice(),
    victoryType: result.type
  };
}

// What each campaign treasury gets back after the battle.
export function tacticalCredits(world) {
  const out = {};
  for (const p of world.players) {
    const s = p.id >= 0 && world.tacticalSessions?.[p.id];
    if (!s) continue;
    const id = String(p.factionName).toUpperCase(),
      left = p.credits || 0;
    if (!s.ai) {
      out[id] = { credits: Math.max(0, left), ai: false };
      continue;
    }
    const delta = left - s.released;
    out[id] = { credits: Math.max(0, s.reserve + (delta > 0 ? delta * s.adjust : delta)), ai: true, delta, parts: s.parts };
  }
  return out;
}

// The world fields the page's campaign set-up leaves that a save does not carry, to hand to the battle thread.
export function campaignWorldState(game) {
  const w = game.world;
  return {
    retreatDir: w.retreatDir || null,
    retreatMarker: w.retreatMarker || null,
    overrunSides: (w.overrunSides || []).map(t => w.teams.indexOf(t)),
    market: w.market || null,
    tacticalSessions: w.tacticalSessions || null,
    reinforcementsOff: w.reinforcementsOff ? [...w.reinforcementsOff] : null
  };
}

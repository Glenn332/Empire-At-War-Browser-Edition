import { db } from '../gamedata.js';
import { forceKind, placeStartingForce } from './galaxy.js';
import { BenchOverlay } from '../benchoverlay.js';
import { onControllerChange } from './galacticpolitics.js';

const key = s => String(s || '').toUpperCase();

const tallies = game => ({ ...(game.ai?.plans?.counts || {}) });
const COMMANDS = ['moves', 'builds', 'landings', 'invasions', 'abilities'];
const fmtCount = n => (n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : String(n));

export function aiActivity(game) {
  const counted = tallies(game);
  return () => {
    const now = tallies(game),
      d = {};
    for (const k of ['plans', ...COMMANDS]) d[k] = (now[k] || 0) - (counted[k] || 0);
    return d;
  };
}
export const commandCount = d => COMMANDS.reduce((n, k) => n + d[k], 0);
export const activityText = d => fmtCount(d.plans) + '/' + fmtCount(commandCount(d));

export const unitCount = g => g.fleets.reduce((n, f) => n + f.units.length, 0) + g.planets.reduce((n, p) => n + p.garrison.length, 0);

function roster(faction, maxTech, kinds) {
  const mine = t => t.list('Affiliation').some(a => key(a) === key(faction)),
    dummy = t => key(t.tag) === 'TECHBUILDING' || /DUMMY_/i.test(t.str('Behavior'));
  return [...db.types.values()]
    .filter(
      t =>
        kinds.includes(forceKind(t)) &&
        mine(t) &&
        !dummy(t) &&
        t.num('Build_Cost_Credits', 0) > 0 &&
        !t.bool('Is_Named_Hero') &&
        t.num('Tech_Level', 0) <= maxTech
    )
    .sort((a, b) => b.num('Build_Cost_Credits', 0) - a.num('Build_Cost_Credits', 0))
    .slice(0, 6);
}

function observe(game) {
  const g = game.galaxy,
    played = g.players.find(p => key(p.faction) === key(game.me));
  if (played) played.ai = played.ai && !/human/i.test(played.ai) ? played.ai : db.faction(played.faction)?.str('Basic_AI') || played.ai;
  const neutral = [...db.factions.values()].find(f => f.bool('Is_Neutral'));
  game.observer = true;
  g.observer = true;
  game.me = neutral?.name || game.me;
  game.storyDialog?.close?.();
  game.pendingBattle?.close?.();
  game.planetInfo?.close?.();
  game.pauseGalactic = () => {};
  game.galacticPauseCount = 0;
  game.userPaused = false;
  game.paused = false;
  game.showStoryDialog = () => {};
  game.showScreenText = () => {};
}

function supply(game, { credits, ships, companies }) {
  const g = game.galaxy,
    placed = [];
  g.creditCapOverride = Infinity;
  for (const player of g.players) {
    const faction = db.faction(player.faction);
    if (!faction || faction.bool('Is_Neutral') || !faction.bool('Is_Playable')) continue;
    player.credits = credits;
    const home =
      g.planets[player.home] && key(g.planets[player.home].owner) === key(player.faction)
        ? g.planets[player.home]
        : g.planets.find(p => key(p.owner) === key(player.faction) && !p.destroyed && !p.background);
    if (!home) continue;
    const maxTech = player.maxTech ?? 5,
      warships = roster(player.faction, maxTech, ['starship']),
      troops = roster(player.faction, maxTech, ['company']);
    for (let i = 0; i < ships && warships.length; i++) placeStartingForce(home, player.faction, warships[i % warships.length], g.fleets);
    for (let i = 0; i < companies && troops.length; i++) placeStartingForce(home, player.faction, troops[i % troops.length], g.fleets);
    placed.push({ faction: player.faction, planet: home.name, ships: warships.map(t => t.name), companies: troops.map(t => t.name) });
  }
  game.mergeFleets?.();
  game.galacticBattleChanged?.();
  return placed;
}

export function galacticBenchmark(game, { seconds = 120, credits = 500000, ships = 20, companies = 8, speed = 1, popCap = 100000 } = {}) {
  if (game.benchmarkRun) return game.benchmarkRun;
  const g = game.galaxy;
  observe(game);
  const placed = (game.benchmarkPlaced ||= supply(game, { credits, ships, companies }));
  g.popCapOverride = popCap;
  game.setSpeed?.(speed);
  const ai = { ms: 0, calls: 0 },
    aiUpdate = game.ai?.update?.bind(game.ai);
  if (aiUpdate)
    game.ai.update = dt => {
      const t = performance.now();
      try {
        return aiUpdate(dt);
      } finally {
        ai.ms += performance.now() - t;
        ai.calls++;
      }
    };
  let changes = 0;
  onControllerChange((planet, old, now, bonus) => {
    changes++;
    if (!game.over) game.planetChangedHands?.(planet, old, now, bonus);
  });
  const since = aiActivity(game),
    commands = commandCount;
  let last = since();
  const startTime = g.time || 0,
    unitsStart = unitCount(g),
    factions = placed.map(p => p.faction);
  game.bench?.dispose();
  const bench = (game.bench = new BenchOverlay({
    label: `galaxy · ${factions.length} AI factions`,
    seconds,
    renderer: game.renderer,
    parent: document.getElementById('hud') || document.body,
    result: { galaxy: g.campaign?.name || 'campaign', factions: factions.join(' '), credits, ships, companies, speed, popCap },
    shotsLabel: 'dec/cmd',
    count: () => {
      const d = (last = since());
      return { units: unitCount(g), shots: activityText(d) };
    }
  }));
  console.log('galactic benchmark: started', JSON.stringify({ seconds, credits, ships, companies, speed, popCap, placed }));
  return (game.benchmarkRun = new Promise(resolve => {
    const timer = setInterval(() => {
      if (!bench.done) return;
      clearInterval(timer);
      const result = {
        ...bench.result,
        galaxySeconds: +((g.time || 0) - startTime).toFixed(1),
        aiMsPerFrame: +(ai.ms / Math.max(1, ai.calls)).toFixed(2),
        aiMsTotal: Math.round(ai.ms),
        planetsChangedHands: changes,
        unitsStart,
        unitsEnd: unitCount(g),
        aiPlans: game.ai?.plans?.live?.length ?? 0,
        ...(d => ({ aiDecisions: d.plans, aiCommands: commands(d), aiCommandsBy: Object.fromEntries(COMMANDS.map(k => [k, d[k]])) }))(last),
        aiErrors: Object.keys(Object.fromEntries(game.ai?.errors || [])).length
      };
      window.benchmarkResult = result;
      console.log('galactic benchmark', JSON.stringify(result));
      game.benchmarkRun = null;
      resolve(result);
    }, 250);
  }));
}

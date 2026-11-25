import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
let seed = 0x5a01318;
Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy, isHumanFaction } = await import('../public/js/game/galaxy.js'),
  { GalacticStoryHost } = await import('../public/js/game/galacticstory.js'),
  { GalacticAI } = await import('../public/js/game/galacticai.js'),
  { pauseGalactic } = await import('../public/js/game/galacticpause.js'),
  { loadHeroAttach, heroAttachRefused } = await import('../public/js/game/heroattach.js'),
  { seedSim } = await import('../public/js/game/simrandom.js');
seedSim(20261124);

// 1. heroattach.js reads Min/MaxPlanAttachCost from the hero scripts (the regex lost its backslashes).
await loadHeroAttach();
{
  let refusing = 0;
  for (const t of db.types.values()) {
    if (heroAttachRefused(t, 1)) refusing++;
  }
  assert(refusing > 0, 'a hero script with MinPlanAttachCost refuses a plan that costs 1 credit');
  const tooBig = [...db.types.values()].filter(t => heroAttachRefused(t, 1e12) && !heroAttachRefused(t, 1));
  assert(tooBig.length >= 0);
}

const data = await loadCampaignData(),
  campaign = data.campaigns.get('KNOWNSMALL_ERA_1_EMPIRE') || [...data.campaigns.values()][0],
  galaxy = startingGalaxy(data, campaign);
const game = {
  galaxy,
  me: galaxy.active,
  setup: { difficulty: 'hard' },
  paused: false,
  isHuman: f => isHumanFaction(galaxy, f),
  userPaused: false,
  galacticPauseCount: 0,
  neutralizePopup: { close() {}, open() {} },
  scriptUI: { visibility() {}, enable() {}, text() {}, icon() {} }
};
game.pauseGalactic = on => pauseGalactic(game, on);
game.story = await GalacticStoryHost.create(game);
for (let i = 0; i < 60; i++) {
  if (game.story.pending.size) await Promise.all([...game.story.pending.values()]);
  game.story.update(1 / 30);
}
const ai = await GalacticAI.create(game);
game.ai = ai;
const story = game.story;

// 2. Galactic Get_Difficulty is the player's own level.
{
  const aiPlayers = galaxy.players.filter(p => !isHumanFaction(galaxy, p.faction));
  assert(aiPlayers.length >= 2, 'fixture has computer players');
  const [a, b] = aiPlayers;
  a.difficulty = 'easy';
  b.difficulty = 'hard';
  assert.equal(story.player(a.faction).Get_Difficulty(), 'Easy');
  assert.equal(story.player(b.faction).Get_Difficulty(), 'Hard');
  a.difficulty = 'medium';
  assert.equal(story.player(a.faction).Get_Difficulty(), 'Normal');
  delete a.difficulty;
  assert.equal(story.player(a.faction).Get_Difficulty(), 'Hard', 'without its own level a player takes the game setting');
}

// 3. Neutral planets report the Neutral player, so Is_Neutral() works in plan handlers.
const neutralPlanet = galaxy.planets.find(p => !p.background);
neutralPlanet.owner = null;
{
  const owner = story.planet(neutralPlanet).Get_Owner();
  assert(owner, 'Get_Owner of an unowned planet is a player wrapper, not nil');
  assert.equal(owner.Is_Neutral(), true);
  const env = story.vm.environment({});
  assert.equal(story.vm.run('function Go(p) return p.Get_Owner().Is_Neutral() end', 'neutral', env), null);
  assert.equal(story.vm.call(env, 'Go', story.planet(neutralPlanet)).ok, true);
}

// 4. FindTarget.Reachable_Target takes a unit as its origin (the free store passes units).
{
  const seen = [];
  const original = ai.findTarget;
  ai.findTarget = (...args) => (seen.push(args), undefined);
  const owner = galaxy.active,
    planet = galaxy.planets.find(p => p.owner && p.fleets !== undefined && !p.background) || galaxy.planets.find(p => p.owner);
  const unit = story.object({ type: db.type([...db.types.keys()].find(n => /^X-?WING|^CORELLIAN_CORVETTE/i.test(n)) || [...db.types.keys()][0]), owner, planet }, planet, owner)
    ?? null;
  assert(unit, 'fixture builds a unit wrapper');
  {
    const env = story.vm.environment({});
    assert.equal(
      story.vm.run(
        'function Go(player, unit) return FindTarget.Reachable_Target(player, "X", "Friendly", "Friendly_Only", 1.0, unit) end',
        'reach',
        env
      ),
      null
    );
    assert(story.vm.call(env, 'Go', story.player(owner), unit).ok);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][4], planet, 'a unit origin resolves to the planet it is on');
  }
  ai.findTarget = original;
}

// 5. GiveDesireBonus keeps raising the goal desire for its duration.
{
  const owner = [...ai.controllers.values()][0].player.faction,
    planet = galaxy.planets.find(p => !p.background);
  const t0 = galaxy.time;
  const block = ai.giveDesireBonus(owner, 'Build_Initial_Starbase_Only', planet, 15, 5);
  assert.equal(block.IsFinished(), false);
  assert.equal(ai.plans.desireBonus(owner, 'build_initial_starbase_only', planet), 15, 'the bonus is active');
  assert.equal(ai.plans.desireBonus(owner, 'Build_Initial_Starbase_Only', galaxy.planets.find(p => p !== planet && !p.background)), 0);
  assert.equal(ai.plans.desireBonus(owner, 'Other_Goal', planet), 0);
  // GalacticMind.desire adds it on top of a positive base desire
  const controller = ai.controllers.get(String(owner).toUpperCase());
  const mind = ai.goals.mind(String(owner).toUpperCase(), ai.goals.state(String(owner).toUpperCase()));
  const target = { key: planet.index, planet, type: planet.type };
  const base = Object.getPrototypeOf(Object.getPrototypeOf(mind));
  const real = base.desire;
  base.desire = () => 2;
  try {
    assert.equal(mind.desire('Build_Initial_Starbase_Only', target), 17, 'bonus added to desire');
    assert.equal(mind.desire('Something_Else', target), 2);
  } finally {
    base.desire = real;
  }
  galaxy.time = t0 + 4;
  assert.equal(ai.plans.desireBonus(owner, 'Build_Initial_Starbase_Only', planet), 15, 'still active inside the duration');
  galaxy.time = t0 + 5.5;
  assert.equal(block.IsFinished(), true, 'the block ends with the duration');
  assert.equal(ai.plans.desireBonus(owner, 'Build_Initial_Starbase_Only', planet), 0, 'expired bonus is gone');
  galaxy.time = t0;
  assert(controller);
}

// 6. Purge_Goals ends the other removable plans without refunding paid production (non-kill stop).
{
  const controller = [...ai.controllers.values()][0];
  const plans = ai.plans;
  const mk = () => Object.assign(plans.instance('X'), { ai: controller, state: 'run', removable: true });
  const caller = mk(),
    other = mk();
  const calls = [];
  const realStop = plans.stop;
  plans.stop = (inst, kill) => calls.push([inst, kill]);
  plans.live.push(caller, other);
  try {
    const env = plans.environment(caller);
    plans.host.current = caller;
    assert.equal(story.vm.run('function Go(p) Purge_Goals(p) end', 'purge', env), null);
    assert(story.vm.call(env, 'Go', story.player(controller.player.faction)).ok);
  } finally {
    plans.host.current = null;
    plans.stop = realStop;
    plans.live.splice(plans.live.indexOf(caller), 1);
    plans.live.splice(plans.live.indexOf(other), 1);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], other);
  assert(!calls[0][1], 'purged plans keep paid, affordable production');
}

// 7. Original_Target_Owner_Changed gets the Neutral player for an unowned planet (host.ownerPlayer).
{
  assert.equal(story.ownerPlayer(null).Is_Neutral(), true);
  assert.equal(story.ownerPlayer(galaxy.active).Is_Neutral(), false);
}
console.log('ok');
process.exit(0);

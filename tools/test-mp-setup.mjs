import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const key = archive.resolve(decodeURIComponent(String(input).replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
Object.assign(globalThis, { innerWidth: 1024, innerHeight: 768 });
const { loadCampaignData, startingGalaxy } = await import('../public/js/game/galaxy.js');
const { GalacticGame } = await import('../public/js/game/galactic.js');

const data = await loadCampaignData();
const campaign = [...data.campaigns.values()].find(c => /^MULTIPLAYER_SANDBOX/i.test(c.name));
assert(campaign, 'a multiplayer sandbox campaign');
const P = GalacticGame.prototype;

const galaxyFor = players => {
  const game = { setup: { net: { me: 0 }, options: {}, players } },
    g = startingGalaxy(data, campaign),
    warned = [],
    warn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    P.multiplayerGalaxy.call(game, g);
  } finally {
    console.warn = warn;
  }
  return { game, g, warned };
};
const factions = startingGalaxy(data, campaign).players.map(p => p.faction);
assert(factions.length >= 2, 'the sandbox has two factions');
const [a, b] = factions;
{
  const { g, warned } = galaxyFor([
    { human: true, peer: 0, faction: a },
    { human: true, peer: 1, faction: b }
  ]);
  assert.equal(warned.length, 0);
  assert.deepEqual(g.humans.sort(), [a, b].map(f => f.toUpperCase()).sort());
}
{
  const { g, warned } = galaxyFor([
    { human: true, peer: 0, faction: a },
    { human: false, faction: a, difficulty: 'hard' },
    { human: true, peer: 1, faction: b }
  ]);
  assert.equal(warned.length, 1, 'a computer slot on a human side is reported');
  assert.equal(g.players.find(p => p.faction.toUpperCase() === a.toUpperCase()).ai, 'Human', 'the human keeps the side');
}

// a lone human side against the AI is a battle that can be fought; nobody left is not
const playable = (players, humans, extra = {}) => P.playable.call({ setup: { players, ...extra } }, humans);
const lone = [
  { human: true, peer: 0, faction: a },
  { human: true, peer: 1, faction: b }
];
assert.equal(playable(lone, [a]), true);
assert.equal(playable(lone, []), false);
assert.equal(playable([{ ...lone[0], left: true }, lone[1]], [a]), false);
assert.equal(playable(lone, [a, b]), true);
console.log('ok');

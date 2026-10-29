import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) { const re = new RegExp(decodeURIComponent(path.slice(11)), 'i'); return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n)))); }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])), data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js'); await loadGameData();
const C = await import('../public/js/game/galacticcorruption.js');
const E = await import('../public/js/game/galacticeconomy.js');
const F = await import('../public/js/game/fleets.js');
const planetTypes = [...db.types.values()].filter(t => t.tag.toLowerCase() === 'planet' && C.choicesOf(t).length);
if (!planetTypes.length) { console.log('no corruption offers in this data: skipped'); process.exit(0); }

const withMission = planetTypes.find(t => C.choicesOf(t).some(c => c.map && c.mode)), choices = C.choicesOf(withMission);
assert(choices.length >= 1 && choices.length <= 3 && choices.every(c => c.type >= 0 && c.type < 8), 'up to three offers, each a type 0..7');
assert.equal(C.typeNamed('Corruption_Racketeering'), 3); assert.equal(C.typeNamed('Corruption_Black_Market'), 6); assert.equal(C.typeNamed('nonsense'), -1);
assert(C.choicesOf(withMission).find(c => c.map && c.mode).script, 'a mission offer names its map, script and mode');

const factions = [...db.factions.values()], uw = factions.find(f => f.bool('Benefits_From_Corruption')), plain = factions.filter(f => f.bool('Is_Playable') && !f.bool('Benefits_From_Corruption'));
if (!uw || plain.length < 2) { console.log('no corruption faction in this data: skipped'); process.exit(0); }
const [A, B] = plain;
const mk = (type, owner) => ({ index: 0, type, name: type.name, owner, currentCorruption: -1, garrison: [], groundStructures: [], orbitalStructures: [], production: { ground: [], space: [] }, killedHeroes: [] });
const noop = () => {};
const world = planet => {
  const players = [{ faction: A.name, ai: null, credits: 5000, tech: 0, builtCounts: {}, unlockedTypes: [], corruptionMissions: Array(8).fill(0) }, { faction: B.name, ai: 'Easy', credits: 5000, tech: 0, unlockedTypes: [] },
    { faction: uw.name, ai: 'Easy', credits: 5000, tech: 0, unlockedTypes: [], corruptionMissions: Array(8).fill(0) }];
  const signals = [], despawned = [];
  return { galaxy: { planets: [planet], fleets: [], routes: [], players, time: 0 }, me: A.name, signals, despawned, audio: { play: noop, speech: { replace: noop } },
    story: { signalCorruption: (e, p, v) => signals.push([e, v]), despawn: o => despawned.push(o), signal: noop, planetCaptured: noop } };
};

const plan = planetTypes.find(t => C.choicesOf(t).some(c => c.bonus > 0)) || planetTypes[0], choice = C.choicesOf(plan).find(c => c.bonus > 0) || C.choicesOf(plan)[0];
{
  const p = mk(plan, A.name), game = world(p), ben = game.galaxy.players[2], before = ben.credits;
  assert(C.startCorruption(game, p, choice.type, 5)); assert.equal(C.startCorruption(game, p, 1, 5), false, 'one transition at a time'); assert.equal(C.startRemoval(game, p, 5), false);
  assert.equal(C.corruptionOf(p), -1, 'while it is being corrupted the planet still counts as clean');
  game.galaxy.time = 4.9; C.stepCorruption(game); assert.equal(C.corruptionOf(p), -1);
  game.galaxy.time = 5; C.stepCorruption(game);
  assert.equal(C.corruptionOf(p), choice.type); assert.deepEqual(game.signals.at(-1), ['STORY_CORRUPTION_CHANGED', choice.type]);
  if (choice.bonus > 0) assert(ben.credits >= before + choice.bonus - 1e-6, 'the Success_Credit_Bonus is paid to the Underworld');
  const unlock = db.type(choice.unlock);
  if (unlock && unlock.num('Build_Cost_Credits', 0) > 0) assert(ben.unlockedTypes.includes(unlock.name), 'the unit is unlocked');
  assert.equal(C.startCorruption(game, p, 1, 5), false, 'a corrupted planet cannot be corrupted again'); assert(C.startRemoval(game, p, 3));
  assert.equal(C.corruptionOf(p), choice.type, 'while it is being cleaned it still counts as corrupted');
  game.galaxy.time = 8; C.stepCorruption(game); assert.equal(C.corruptionOf(p), -1); assert.deepEqual(game.signals.at(-1), ['STORY_CORRUPTION_CHANGED', -1]);
  if (unlock) assert(!ben.unlockedTypes.includes(unlock.name), 'and the unit locked again');
}

{
  const p = mk(plan, A.name), game = world(p);
  C.ownerChanged(game, p, A.name, uw.name); assert.equal(p.corruptionKind, 'corrupt'); assert.equal(p.corruptionPending, 3); assert.equal(p.corruptionEnd, 10, 'Racketeering over ten seconds');
  game.galaxy.time = 10; C.stepCorruption(game); assert.equal(C.corruptionOf(p), 3);
  C.ownerChanged(game, p, uw.name, B.name); assert.equal(p.corruptionKind, 'remove'); game.galaxy.time = 20; C.stepCorruption(game); assert.equal(C.corruptionOf(p), -1);
  C.ownerChanged(game, p, A.name, B.name); assert(!p.corruptionKind, 'between factions that do not benefit nothing happens');
}

const saboteur = [...db.types.values()].find(t => t.sub('Abilities').some(n => n.children.some(a => a.tag.toUpperCase() === 'CORRUPTION_ABILITY')));
assert(saboteur, 'a hero carries the Corruption_Ability');
{
  const p = mk(plan, A.name), game = world(p), actor = { owner: uw.name, type: saboteur, record: { type: saboteur, owner: uw.name }, dead: false, planet: p };
  assert(C.canCorrupt(game, actor, p)); p.owner = uw.name; assert.equal(C.canCorrupt(game, actor, p), false, 'not on its own planet'); p.owner = A.name;
  p.corruptionRestricted = true; assert.equal(C.canCorrupt(game, actor, p), false, 'a restricted planet'); p.corruptionRestricted = false;
  { const h = world(p); h.me = uw.name; h.galaxy.players[2].ai = null; let shown = null; h.openCorruptionDialog = r => { shown = r; };
    assert.equal(C.activateCorruption(h, actor, p), false); assert(shown && shown.choices.length === C.choicesOf(plan).length && shown.planet === p, 'the dialog gets the offers'); assert.equal(h.despawned.length, 0); assert.equal(h.galaxy.players[2].credits, 5000); }
  const uwp = game.galaxy.players[2];
  for (const c of C.choicesOf(plan)) { const r = C.requirements(game, uwp, c); assert.equal(typeof r.credits, 'boolean'); }
  const easy = { type: 2, cost: 0, units: [], unitCount: 0, missionType: -1, missionCount: 0, planets: [], map: '', mode: null }, hard = { ...easy, type: 5, missionType: 1, missionCount: 2 };
  assert.equal(C.aiPick(game, uwp, [hard, easy], () => 0.1), easy, 'a choice whose missions are not done is not picked'); uwp.corruptionMissions[1] = 2; assert.equal(C.aiPick(game, uwp, [hard], () => 0.1), hard);
  const poor = { ...easy, cost: 99999 }; assert.equal(C.aiPick(game, uwp, [poor]), null, 'too dear');
  const instant = { ...easy, type: 3, cost: 700, slot: 1 };
  assert.equal(C.executeCorruption(game, actor, p, instant), true);
  assert.equal(uwp.credits, 5000 - 700); assert.equal(uwp.corruptionMissions[3], 1, 'its count of the type goes up'); assert.equal(p.corruptionKind, 'corrupt'); assert.equal(p.corruptionEnd, 5, 'five seconds');
  assert.equal(game.despawned.length, 1, 'the saboteur leaves'); assert.equal(p.killedHeroes.length, 1, 'and is queued to come back');
  const p2 = mk(plan, A.name), g2 = world(p2), a2 = { owner: uw.name, record: { type: saboteur, owner: uw.name }, dead: false, planet: p2 };
  assert.equal(C.executeCorruption(g2, a2, p2, { ...easy, cost: 99999 }), false); assert.equal(g2.galaxy.players[2].credits, 5000);
  const merc = [...db.types.values()].find(t => t.list('Company_Units').length && t.list('Affiliation').includes(uw.name));
  if (merc) { assert.equal(C.executeCorruption(g2, a2, p2, { ...easy, cost: 100, units: [merc], unitCount: 1 }), false, 'no unit'); assert.equal(g2.galaxy.players[2].credits, 4900, 'the credits are not given back'); }
}

const remover = [...db.types.values()].find(t => t.sub('Abilities').some(n => n.children.some(a => a.tag.toUpperCase() === 'REMOVE_CORRUPTION_ABILITY')));
{
  const ability = remover.sub('Abilities').flatMap(n => n.children).find(a => a.tag.toUpperCase() === 'REMOVE_CORRUPTION_ABILITY');
  const p = mk(plan, A.name); p.currentCorruption = 1; const game = world(p), actor = { owner: A.name, type: remover, record: {}, dead: false, planet: p };
  const cost = p.type.num('Planet_Corruption_Removal_Base_Cost', 2000) * Math.max(0, ability.num('Corruption_Removal_Cost_Multiplier', 1)), time = ability.num('Corruption_Removal_Time_In_Secs', 10);
  assert.equal(C.canRemove(game, { ...actor, owner: B.name }, p), false, 'only the owner');
  game.galaxy.players[0].credits = cost - 1; assert.equal(C.activateRemoval(game, actor, p, ability), false); assert(!p.corruptionKind);
  game.galaxy.players[0].credits = cost + 10; assert.equal(C.activateRemoval(game, actor, p, ability), true); assert(Math.abs(game.galaxy.players[0].credits - 10) < 0.01, 'the cost');
  assert.equal(p.corruptionKind, 'remove'); assert.equal(p.corruptionEnd, time > 0 ? time : 10);
}

{
  const p = mk(plan, A.name); p.currentCorruption = 3; const game = world(p), g = game.galaxy;
  const gross = E.planetIncome(g, p, p.owner), share = db.constants.vec('Corruption_Choice_Income_Percentage', [])[3];
  assert(gross > 0, 'the planet pays'); assert(Math.abs(E.playerIncome(g, A.name) - gross) < 0.01, 'the owner is paid in full'); assert(Math.abs(E.playerIncome(g, uw.name) - gross * share) < 0.01, 'the Underworld gets the share');
  p.currentCorruption = -1; assert.equal(E.playerIncome(g, uw.name), 0);
  const hero = { owner: B.name, record: { type: saboteur, owner: B.name }, dead: false, planet: p }, ability = { num: (k, d) => ({ Min_Siphon_Percentage: 0.5, Max_Siphon_Percentage: 0.5, Siphon_Duration_In_Cycles: 5 })[k] ?? d };
  g.time = 0; assert(C.activateSiphon(game, hero, p, ability)); assert.equal(C.activateSiphon(game, hero, p, ability), false, 'one siphon on a planet');
  assert(Math.abs(E.playerIncome(g, A.name) - gross / 2) < 0.01, 'the owner keeps what is left'); assert(Math.abs(E.playerIncome(g, B.name) - gross / 2) < 0.01, 'the siphoner is paid its share');
  g.time = 45 * 5 + 1; assert(Math.abs(E.playerIncome(g, A.name) - gross) < 0.01, 'it ends after its cycles'); assert.equal(p.creditSiphonOwner, -1);
  C.activateSiphon(game, hero, p, ability); p.currentCorruption = 2; g.time = 1e6; assert(E.playerIncome(g, A.name) < gross, 'a corrupted planet does not end the siphon'); p.currentCorruption = -1;
}

{
  const p = mk(plan, A.name), q = mk(plan, A.name); q.index = 1; p.currentCorruption = 1; q.currentCorruption = 1; p.pos = [0, 0, 0]; q.pos = [100, 0, 0];
  const ship = [...db.types.values()].find(t => t.num('Piracy_Value_Credits', 0) > 0 && t.num('Hyperspace_Speed', 0) > 0);
  const game = world(p), g = game.galaxy; g.planets = [p, q]; g.links = [[{ to: 1, route: null, cost: 100 }], [{ to: 0, route: null, cost: 100 }]];
  const fleet = { owner: B.name, planet: 0, units: [{ type: ship }], path: [], dest: -1, leg: null };
  assert(F.orderMove(g, fleet, 1)); assert.equal(p.piracy, ship.num('Piracy_Value_Credits'), 'the tariff waits on the planet');
  assert.equal(F.legFactor(g, 0, 1, B.name), 1); assert.equal(F.legFactor(g, 0, 1, uw.name), db.constants.num('Corruption_Hyperspace_Bonus', 1), 'faster between corrupted planets for the Underworld');
  q.currentCorruption = -1; assert.equal(F.legFactor(g, 0, 1, uw.name), 1);
  const income = E.playerIncome(g, uw.name, true); assert(income >= ship.num('Piracy_Value_Credits')); assert.equal(p.piracy, 0, 'paid once');
}
console.log('ok', planetTypes.length, 'planets with offers,', uw.name, 'benefits');

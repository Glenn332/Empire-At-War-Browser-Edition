// Save/load round trips of state the scripts set once and never set again: tactical unit flags,
// who attacks a planet, story speech still playing, story handles and per-unit galaxy flags.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), []);
globalThis.fetch = async input => {
  const path = String(input);
  if (path.startsWith('api/find?q=')) {
    const re = new RegExp(decodeURIComponent(path.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => re.test(n))));
  }
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    bytes = key && archive.read(key);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
let seed = 12345;
Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const { loadGameData, db } = await import('../public/js/gamedata.js');
await loadGameData();
const { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy } = await import('../public/js/game/galaxy.js');
const { stepVisibility } = await import('../public/js/game/galacticfog.js');
const { GalacticStoryHost } = await import('../public/js/game/galacticstory.js');
const { GalacticBattles } = await import('../public/js/game/galacticbattles.js');
const { scriptFlags, applyScriptFlags } = await import('../public/js/game/tacticalsave.js');
const json = v => JSON.parse(JSON.stringify(v));

// tactical: flags set by Set_Cannot_Be_Killed, Make_Invulnerable, Hide... survive JSON, Infinity included
{
  const u = { cannotDie: true, invulnerable: true, holdFire: true, suspended: true, scriptHidden: true, scriptNoAI: true, scriptSelectable: false, invulnUntil: Infinity };
  const back = {};
  applyScriptFlags(back, json(scriptFlags(u, 10)));
  assert.deepEqual(
    back,
    { cannotDie: true, invulnerable: true, holdFire: true, suspended: true, scriptHidden: true, scriptNoAI: true, noAI: true, selectable: false, scriptSelectable: false, invulnUntil: Infinity },
    'every scripted flag comes back'
  );
  const timed = {};
  applyScriptFlags(timed, json(scriptFlags({ invulnUntil: 12.5 }, 10)));
  assert.equal(timed.invulnUntil, 12.5, 'a timed invulnerability keeps its end');
  assert.equal(scriptFlags({ invulnUntil: 5, noAI: true, selectable: false }, 10), null, 'expired or engine-set state is not written');
  const land = scriptFlags({ scriptHidden: true, cannotDie: true }, 0, false);
  assert.deepEqual(land, { cd: 1 }, 'a land member hidden by an ability is not saved as hidden');
}

const data = await loadCampaignData();
const campaign = data.campaigns.get('SANDBOX_EQUAL_FOOTING_EMPIRE');
assert(campaign);

// galactic: the arriving fleet stays the attacker after a load, with or without the battle prompt up
{
  const g = startingGalaxy(data, campaign);
  const tgt = g.fleets.find(f => f.owner.toUpperCase() === 'REBEL' && !f.leg),
    mine = g.fleets.filter(f => f.owner.toUpperCase() === 'EMPIRE' && !f.leg).pop();
  assert(tgt && mine);
  mine.planet = tgt.planet;
  g.fleets.splice(g.fleets.indexOf(mine), 1);
  g.fleets.push(mine);
  const make = (galaxy, request = null) => {
    const calls = [],
      game = {
        galaxy,
        paused: false,
        busy: false,
        isHuman: f => f.toUpperCase() === 'EMPIRE',
        ai: { plans: {} },
        pendingBattle: {
          request,
          begin: r => {
            calls.push([r.attacker, r.defender, r.mode]);
            return true;
          }
        }
      };
    const battles = (game.battles = new GalacticBattles(game));
    galaxy.hostSnapshot = () => ({ battles: battles.snapshot() });
    if (galaxy.hostSaved?.battles) battles.restore(galaxy.hostSaved.battles);
    return { battles, calls, game };
  };
  const reload = g => {
    const g2 = startingGalaxy(data, campaign);
    applyGalaxy(g2, json(snapshotGalaxy(g)));
    return g2;
  };
  const live = make(g);
  live.battles.dirty.clear();
  live.battles.arrive(mine, tgt.planet);
  const waiting = reload(g);
  live.battles.update();
  assert.deepEqual(live.calls, [[mine.owner, tgt.owner, 'space']], 'the arriving fleet attacks');
  const loaded = make(waiting);
  loaded.battles.update();
  assert.deepEqual(loaded.calls, live.calls, 'an arrival not yet handled keeps its attacker after a load');
  const prompt = make(g, { p: tgt.planet, attacker: mine.owner, defender: tgt.owner, mode: 'space' });
  const again = make(reload(g));
  again.battles.update();
  assert.deepEqual(again.calls, live.calls, 'a save at the battle prompt asks for the same battle again');
  assert(prompt);
}

// galactic story: a line still playing, Prevent_AI_Usage, created and company-member handles, speed overrides
{
  const makeGame = restore => {
    const galaxy = startingGalaxy(data, campaign);
    if (restore) applyGalaxy(galaxy, restore);
    stepVisibility(galaxy, galaxy.active);
    return {
      galaxy,
      me: galaxy.active,
      setup: restore ? { restore: true } : {},
      scriptUI: { visibility() {}, enable() {}, text() {}, icon() {}, click() {} },
      neutralizePopup: { open() {}, close() {} },
      onLoadCampaign() {},
      showStoryDialog() {},
      showScreenText() {},
      audio: { speech: { replace() {}, stopActive() {} } },
      movies: { play() {}, stop() {} }
    };
  };
  const gameA = makeGame(null),
    hostA = await GalacticStoryHost.create(gameA),
    gA = gameA.galaxy;
  assert(hostA);
  for (let i = 0; i < 20; i++) hostA.update(0.2);
  hostA.speechQueued('TEST_LINE_STILL_PLAYING');
  hostA.speechQueued('TEST_LINE_FINISHED');
  hostA.speechFinished('test_line_finished');
  const fleetRecord = gA.fleets.find(f => f.units.length).units[0];
  hostA.object(fleetRecord).Prevent_AI_Usage(true);
  const holderPlanet = gA.planets.find(p => p.garrison.some(r => hostA.membersOf(r).length));
  assert(holderPlanet, 'a garrison company with members');
  const holder = holderPlanet.garrison.find(r => hostA.membersOf(r).length);
  holder.speedScale = 0.25;
  const member = hostA.membersOf(holder)[0];
  const made = hostA.createGeneric(hostA.type(db.type(fleetRecord.type.name)), hostA.planet(holderPlanet), hostA.player(gA.active));
  assert(made, 'a story object was created');
  hostA.values.set('made', made);
  hostA.values.set('member', hostA.object(member, holderPlanet, holder.owner));
  hostA.bountyOn = false;

  const snap = json(snapshotGalaxy(gA));
  assert(snap.storyLua, 'the story was written: ' + (hostA.saveError || ''));
  const gameB = makeGame(snap),
    hostB = await GalacticStoryHost.create(gameB),
    gB = gameB.galaxy;
  assert(!hostB.suspended, 'the story runs after the load');
  const fleetB = gB.fleets.find(f => f.units.length).units[0];
  assert.equal(hostB.object(fleetB).__object.noAI, true, 'Prevent_AI_Usage survives without a saved handle');
  const holderB = gB.planets[holderPlanet.index].garrison[holderPlanet.garrison.indexOf(holder)];
  assert.equal(holderB.speedScale, 0.25, 'a ground company keeps its speed override');
  const madeB = hostB.values.get('made');
  assert(madeB?.__object && madeB.__object === hostB.created[0], 'a created object handle resolves to the restored object');
  assert(madeB.Is_Valid(), 'the created object is alive');
  const memberB = hostB.values.get('member');
  assert(memberB?.__object && memberB.Is_Valid(), 'a company member handle is restored alive');
  assert.equal(memberB.__object.record.memberOf, holderB, 'the member belongs to the restored company');
  assert.equal(hostB.bountyOn, false, 'bounty collection stays off');
  const signals = [];
  const signal = hostB.signal.bind(hostB);
  hostB.signal = (kind, ...args) => {
    if (kind === 'STORY_SPEECH_DONE') signals.push(args[0]);
    return signal(kind, ...args);
  };
  hostB.update(0.2);
  assert.deepEqual(signals, ['TEST_LINE_STILL_PLAYING'], 'a line cut off by the save ends after the load');
  hostA.dispose();
  hostB.dispose();
}
// browser storage: overlapping saves to one slot, and a write that runs out of room
{
  const files = new Map(),
    tick = () => new Promise(r => setTimeout(r, 1));
  let clock = 1,
    full = false;
  const handle = name => ({
    kind: 'file',
    getFile: async () => new File([files.get(name).data], name, { lastModified: files.get(name).at }),
    createWritable: async () => {
      let data = null;
      return {
        write: async d => {
          await tick();
          if (full) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
          data = d;
        },
        close: async () => {
          await tick();
          files.set(name, { data, at: clock++ });
        },
        abort: async () => {}
      };
    }
  });
  const dir = {
    getFileHandle: async (name, { create = false } = {}) => {
      if (!files.has(name)) {
        if (!create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        files.set(name, { data: '', at: clock++ });
      }
      return handle(name);
    },
    removeEntry: async name => {
      await tick();
      if (!files.delete(name)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
    },
    async *entries() {
      for (const name of [...files.keys()]) yield [name, handle(name)];
    }
  };
  globalThis.FileSystemFileHandle = class {
    createWritable() {}
  };
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: { getDirectory: async () => ({ getDirectoryHandle: async () => dir }) },
    configurable: true
  });
  const { putSave, getSave, listSaves } = await import('../public/js/game/savegame.js');
  const save = (name, size) => ({ format: 'sw-revival-save', version: 2, name, saved: name, summary: {}, pad: 'x'.repeat(size) });
  await Promise.all([putSave(save('first', 300000), 'slot'), putSave(save('second', 10), 'slot')]);
  assert.equal((await getSave('slot'))?.name, 'second', 'the later of two overlapping saves is the one kept');
  assert.deepEqual(
    (await listSaves()).map(m => m.name),
    ['second'],
    'the list shows that save'
  );
  assert.deepEqual([...files.keys()].sort(), ['slot.json', 'slot.meta'], 'no payload of the other write is left behind');
  full = true;
  await assert.rejects(putSave(save('big', 10), 'fresh'), /no room/);
  assert(![...files.keys()].some(n => n.startsWith('fresh')), 'a failed first save leaves no empty file');
  await assert.rejects(putSave(save('third', 10), 'slot'), /no room/);
  full = false;
  assert.equal((await getSave('slot'))?.name, 'second', 'a failed overwrite keeps the old save');
  assert.deepEqual(
    (await listSaves()).map(m => m.name),
    ['second'],
    'and lists it under its own name'
  );
}
console.log('ok save round trips');

// What a hosted game runs, on the game list: edition class, the join hash that mirrors the admission check, the
// ordered mod-list hash, the privacy rule for local mods, and the lobby worker's validation of all of it.
import assert from 'node:assert/strict';

class FakeSocket {
  constructor() {
    this.sent = [];
    this.closed = null;
    this.att = null;
  }
  accept() {}
  send(s) {
    this.sent.push(JSON.parse(s));
  }
  close(code, why) {
    this.closed = { code, why };
  }
  serializeAttachment(a) {
    this.att = structuredClone(a);
  }
  deserializeAttachment() {
    return this.att && structuredClone(this.att);
  }
}
globalThis.WebSocketPair = class {
  constructor() {
    this[0] = { client: true };
    this[1] = new FakeSocket();
  }
};
globalThis.WebSocketRequestResponsePair = class {};
const RealResponse = Response;
globalThis.Response = class extends RealResponse {
  constructor(body, init = {}) {
    super(body, init.status === 101 ? {} : init);
    if (init.status === 101) this.socket = init.webSocket;
  }
};
const { Registry, Lobby } = await import('../lobby/src/index.js');
const { cleanContent } = await import('../lobby/src/content.js');
const C = await import('../public/js/game/lobbycontent.js');

class Storage {
  constructor() {
    this.m = new Map();
  }
  async get(k) {
    return structuredClone(this.m.get(k));
  }
  async put(k, v) {
    this.m.set(k, structuredClone(v));
  }
  async delete(k) {
    this.m.delete(k);
  }
  async list({ prefix }) {
    return new Map([...this.m].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]));
  }
  async setAlarm() {}
}
const ctxFor = () => {
  const sockets = [];
  return {
    storage: new Storage(),
    sockets,
    setWebSocketAutoResponse() {},
    acceptWebSocket(ws) {
      sockets.push(ws);
    },
    getWebSockets() {
      return sockets.filter(ws => !ws.closed);
    }
  };
};
const hostIn = async (id, ip) => {
  const reg = new Registry(ctxFor());
  const env = { REGISTRY: { idFromName: () => 0, get: () => ({ fetch: (u, init) => reg.fetch(new Request(u, init)) }) } };
  const room = new Lobby(ctxFor(), env);
  await room.fetch(new Request(`https://lobby/lobby/${id}?role=host&lobby=${id}&name=H`, { headers: { 'CF-Connecting-IP': ip } }));
  const list = async () => (await reg.fetch(new Request('https://registry/list'))).json();
  const meta = meta => room.webSocketMessage(room.ctx.sockets[0], JSON.stringify({ t: 'meta', meta }));
  return { list, meta };
};

const workshop = (id, name, version) => ({ name, source: 'mounted', workshop: id, ...(version ? { version } : {}) });
const local = (name, version) => ({ name, source: 'added', ...(version ? { version } : {}) });
const trw = workshop('1125571106', "Thrawn's Revenge", '3.5');
const ror = workshop('1397421866', 'Republic at War');
const mine = local('C:\\Users\\Alice\\Desktop\\secret mod');

// ---- edition classification ----
assert.equal(C.editionKind({ edition: 'eaw', mods: [] }), 'eaw');
assert.equal(C.editionKind({ edition: 'foc', mods: [] }), 'foc');
assert.equal(C.editionKind({ edition: 'eaw', mods: [ror] }), 'eaw+mods');
assert.equal(C.editionKind({ edition: 'foc', mods: [mine] }), 'foc+mods', 'a local mod is a mod too');
assert.equal(C.editionKind(null), 'foc', 'nothing recorded is the default game');
assert.deepEqual(Object.values(C.EDITION_LABELS), ['Vanilla EaW', 'FoC', 'EaW + mods', 'FoC + mods']);

// ---- mod list hash: stable, ordered, version-aware ----
const h = mods => C.modListHash({ edition: 'foc', mods });
assert.match(h([trw, ror]), /^[0-9a-f]{8}$/);
assert.equal(h([trw, ror]), h([{ ...trw }, { ...ror }]), 'stable for the same list');
assert.notEqual(h([trw, ror]), h([ror, trw]), 'load order matters');
assert.notEqual(h([trw]), h([{ ...trw, version: '3.6' }]), 'the mod version matters');
assert.notEqual(h([trw]), h([ror]));
assert.notEqual(h([]), h([mine]), 'a local mod changes the hash');
assert.equal(h([trw, ror]), h([{ ...trw, name: 'renamed' }, ror]), 'a workshop mod is identified by its id, not its label');
assert.equal(h([]), C.modListHash(null));

// ---- join hash mirrors the admission check (same version and same data fingerprint) ----
assert.equal(C.contentHash('1.2', 'abc:10'), C.contentHash('1.2', 'abc:10'));
assert.notEqual(C.contentHash('1.2', 'abc:10'), C.contentHash('1.3', 'abc:10'), 'a different game version cannot join');
assert.notEqual(C.contentHash('1.2', 'abc:10'), C.contentHash('1.2', 'abd:10'), 'different game data cannot join');
assert.notEqual(C.contentHash('1', '2x'), C.contentHash('12', 'x'), 'the pair is not just concatenated');
{
  // the very test multiplayer.js applies when joining: picked.version !== version || picked.mod !== data
  const joinable = (g, me) => g.version === me.version && g.mod === me.data;
  const cases = [
    [{ version: 'v1', mod: 'aa:5' }, { version: 'v1', data: 'aa:5' }],
    [{ version: 'v1', mod: 'aa:5' }, { version: 'v2', data: 'aa:5' }],
    [{ version: 'v1', mod: 'aa:5' }, { version: 'v1', data: 'ab:5' }],
    [{ version: 'v1', mod: 'aa:5' }, { version: 'v1', data: 'aa:6' }]
  ];
  for (const [g, me] of cases) {
    const shown = C.describeListing(g, me);
    assert.equal(shown.can, joinable(g, me), 'the badge agrees with the join check');
    assert.equal(shown.hash === C.contentHash(me.version, me.data), joinable(g, me), 'equal hash means joinable');
  }
}

// ---- what is published: privacy for local mods ----
{
  const all = [trw, mine, local('Another Folder'), ror];
  const l = C.listingContent({ edition: 'foc', mods: all });
  assert.deepEqual(l.mods, [
    { id: '1125571106', name: "Thrawn's Revenge", v: '3.5' },
    { id: '1397421866', name: 'Republic at War', v: '' }
  ]);
  assert.equal(l.local, 2, 'local mods are only counted');
  assert.equal(l.names, undefined, 'and not named by default');
  const text = JSON.stringify(l);
  assert.ok(!text.includes('secret') && !text.includes('Alice') && !text.includes('Another'));
  assert.equal(l.mh, C.modListHash({ mods: all }), 'but they count toward the hash');
  const opted = C.listingContent({ edition: 'foc', mods: [mine] }, { listLocal: true });
  assert.deepEqual(opted.names, [mine.name], 'the host can opt in to naming them');
  assert.equal(C.listingContent({ edition: 'eaw', mods: [] }).ed, 'eaw');
  assert.equal(C.listingContent(null).ed, 'foc');
  assert.equal(C.listingContent({ mods: [{ name: 'x', workshop: 'my mod' }] }).local, 1, 'a non-numeric workshop label is not an id');
  const many = C.listingContent({ mods: Array.from({ length: 100 }, (_, i) => workshop(String(1000 + i), 'm' + i)) });
  assert.equal(many.mods.length, C.MAX_MODS);
  const lines = C.detailLines({ name: 'G', version: 'v', mod: 'm', content: l }, { version: 'v', data: 'm' });
  assert.match(lines[0], /FoC \+ mods \(4\)/);
  assert.match(lines[0], /you can join/);
  assert.ok(lines.some(x => /workshop 1125571106/.test(x)));
  assert.ok(lines.some(x => /2 local mods \(names not shared/.test(x)));
  assert.ok(!lines.join('\n').includes('secret'));
  assert.match(C.describeListing({ version: 'v', mod: 'm' }).label, /unknown/, 'an old host without content is still listed');
}

// ---- server validation ----
{
  assert.equal(cleanContent(null), null);
  assert.equal(cleanContent('x'), null);
  assert.equal(cleanContent([]), null);
  const c = cleanContent({
    ed: 'evil',
    mods: [
      { id: '123', name: 'ok\u0000\n' + 'x'.repeat(200), v: 'v'.repeat(100) },
      { id: 'abc', name: 'not numeric' },
      { id: 456, name: 'num id' },
      null,
      'str',
      { id: '1'.repeat(30), name: 'too long id' },
      ...Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: 'n' }))
    ],
    local: 9999,
    names: Array.from({ length: 50 }, (_, i) => 'name' + i + 'x'.repeat(100)),
    mh: 'NOTHEX!!',
    extra: 'dropped'
  });
  assert.equal(c.ed, 'foc');
  assert.equal(c.mods.length, 32, 'the mod list is capped');
  assert.equal(c.mods[0].id, '123');
  assert.equal(c.mods[0].name.length, 64);
  assert.ok(!/[\u0000-\u001f]/.test(c.mods[0].name));
  assert.equal(c.mods[0].v.length, 24);
  assert.ok(c.mods.every(m => /^\d{1,20}$/.test(m.id)), 'only numeric workshop ids pass');
  assert.equal(c.mods[1].id, '456');
  assert.equal(c.local, 64);
  assert.equal(c.names.length, 16);
  assert.ok(c.names.every(n => n.length <= 48));
  assert.equal(c.mh, '');
  assert.ok(!('extra' in c));
  assert.deepEqual(cleanContent({ ed: 'eaw', mods: 'x', local: -4, names: 'no', mh: 'abcdef01' }), { ed: 'eaw', mods: [], local: 0, mh: 'abcdef01' });
  assert.equal(cleanContent({ names: ['a'], local: 0 }).names, undefined, 'names without local mods are dropped');
  assert.deepEqual(cleanContent({ names: ['a', 'b', 'c'], local: 2 }).names, ['a', 'b'], 'never more names than local mods');
  const sent = C.listingContent({ edition: 'foc', mods: [trw, ror, mine] }, { listLocal: true });
  assert.deepEqual(cleanContent(sent), sent, 'what the client sends passes through unchanged');
}

// ---- through the lobby worker: the listing the registry serves ----
{
  const host = await hostIn('abcdefg', '1.1.1.1');
  const huge = {
    ed: 'foc',
    mods: Array.from({ length: 200 }, (_, i) => ({ id: String(i), name: 'n'.repeat(120), v: 'v'.repeat(60) })),
    local: 1e9,
    names: ['z'.repeat(9000), 'y', 'x'],
    mh: 'ffffffff'
  };
  await host.meta({ name: 'mine', version: 'v1', mod: 'aa:5', content: huge });
  const [g] = await host.list();
  assert.equal(g.content.mods.length, 32);
  assert.ok(JSON.stringify(g.content).length < 4000, 'a listing stays small: ' + JSON.stringify(g.content).length);
  assert.equal(g.content.local, 64);
  assert.ok(g.content.names.length <= 3 && g.content.names.every(n => n.length <= 48));
}
{
  const host = await hostIn('abcdefj', '3.3.3.3');
  await host.meta({ name: 'mine', content: 'junk' });
  const [g] = await host.list();
  assert.equal(g.content, null, 'junk content is dropped, the listing stays');
  assert.equal(g.name, 'mine');
}
{
  const host = await hostIn('abcdefh', '2.2.2.2');
  await host.meta({ name: 'old host', version: 'v', mod: 'm' });
  assert.equal((await host.list())[0].content, null, 'a listing without content is accepted as unknown');
}

console.log('lobby mod hash ok');

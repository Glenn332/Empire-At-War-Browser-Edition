// The lobby worker: origins fail closed, one address can't fill the hall, the game list or a game,
// a host can lock its game and drop a peer's socket. Durable Objects are stood in for by small fakes.
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

const { default: worker, Registry, Hall, Lobby } = await import('../lobby/src/index.js');

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
  async deleteAll() {
    this.m.clear();
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
const req = (url, ip = '1.2.3.4', headers = {}) => new Request(url, { headers: { 'CF-Connecting-IP': ip, ...headers } });
const socketOf = async p => {
  const r = await p;
  return r.socket || null;
};

// origins: no ALLOWED_ORIGINS means no other site, not every site
{
  const lobbies = { fetch: async () => new RealResponse('[]') };
  const env = { REGISTRY: { idFromName: () => 0, get: () => lobbies } };
  const from = origin => worker.fetch(new Request('https://lobby/lobbies', { headers: { Origin: origin } }), env);
  assert.equal((await from('https://evil.example')).status, 403, 'an unconfigured worker refuses other sites');
  assert.equal((await from('http://localhost:8080')).status, 200, 'local development still works');
  assert.equal(
    (await worker.fetch(new Request('https://lobby/lobbies'), env)).status,
    200,
    'a request with no Origin is not a browser page'
  );
  const open = { ...env, ALLOWED_ORIGINS: '*' };
  assert.equal(
    (await worker.fetch(new Request('https://lobby/lobbies', { headers: { Origin: 'https://evil.example' } }), open)).status,
    200
  );
  const listed = { ...env, ALLOWED_ORIGINS: 'https://playeaw.com' };
  assert.equal(
    (await worker.fetch(new Request('https://lobby/lobbies', { headers: { Origin: 'https://playeaw.com' } }), listed)).status,
    200
  );
}

// the hall: a few sockets per address
{
  const hall = new Hall(ctxFor());
  const opened = [];
  for (let i = 0; i < 8; i++) opened.push(await hall.fetch(req('https://lobby/hall?name=a' + i)));
  const accepted = hall.ctx.getWebSockets().length;
  assert.equal(accepted, 6, 'one address gets six hall sockets');
  await hall.fetch(req('https://lobby/hall?name=b', '5.6.7.8'));
  assert.equal(hall.ctx.getWebSockets().length, 7, 'another address still gets in');
  // chat and renames are rate limited per socket
  const ws = hall.ctx.getWebSockets()[0],
    other = hall.ctx.getWebSockets()[1];
  other.sent.length = 0;
  for (let i = 0; i < 100; i++) await hall.webSocketMessage(ws, JSON.stringify({ t: 'name', name: 'n' + i }));
  assert.ok(other.sent.length <= 20, 'a socket renaming itself in a loop is cut off: ' + other.sent.length);
}

// the game list: a few listings per address, and the host is told when its listing was refused
{
  const reg = new Registry(ctxFor());
  const put = (id, ip) =>
    reg
      .fetch(new Request('https://registry/put', { method: 'POST', body: JSON.stringify({ id, meta: { name: id }, ip }) }))
      .then(r => r.json());
  for (let i = 0; i < 4; i++) assert.equal((await put('g' + i, '9.9.9.9')).ok, true);
  const refused = await put('g4', '9.9.9.9');
  assert.equal(refused.ok, false, 'a fifth listing from one address is refused');
  assert.match(refused.why, /address/);
  assert.equal((await put('g0', '9.9.9.9')).ok, true, 'an existing listing can still be refreshed');
  assert.equal((await put('h0', '8.8.8.8')).ok, true);
  const list = await (await reg.fetch(new Request('https://registry/list'))).json();
  assert.equal(list.length, 5);
  assert.ok(
    list.every(e => !('ip' in e)),
    'addresses are not listed'
  );

  const env = { REGISTRY: { idFromName: () => 0, get: () => ({ fetch: (u, init) => reg.fetch(new Request(u, init)) }) } };
  const room = new Lobby(ctxFor(), env);
  const host = await socketOf(room.fetch(req('https://lobby/lobby/abcdefg?role=host&lobby=abcdefg&name=H', '9.9.9.9')));
  assert.ok(host, 'host socket accepted');
  const hws = room.ctx.sockets[0];
  await room.webSocketMessage(hws, JSON.stringify({ t: 'meta', meta: { name: 'mine' } }));
  assert.deepEqual(
    hws.sent.find(m => m.t === 'listing'),
    { t: 'listing', ok: false, why: 'Too many games are listed from this address.' },
    'the host hears its listing was refused'
  );
}

// a game: seats per address, lock, kick
{
  const reg = new Registry(ctxFor());
  const env = { REGISTRY: { idFromName: () => 0, get: () => ({ fetch: (u, init) => reg.fetch(new Request(u, init)) }) } };
  const room = new Lobby(ctxFor(), env);
  await room.fetch(req('https://lobby/lobby/abcdefg?role=host&lobby=abcdefg&name=H', '1.1.1.1'));
  const hws = room.ctx.sockets[0];
  for (let i = 0; i < 20; i++) await room.fetch(req('https://lobby/lobby/abcdefg?role=join&name=J', '2.2.2.2'));
  assert.equal(room.ctx.getWebSockets().length, 1 + 16, 'one address takes at most 16 seats in a game');
  const friend = await room.fetch(req('https://lobby/lobby/abcdefg?role=join&name=F', '3.3.3.3'));
  assert.equal(room.ctx.getWebSockets().length, 18);
  assert.ok(friend);
  const fws = room.ctx.sockets.at(-1),
    fid = fws.deserializeAttachment().id;

  // relayed messages are rate limited per socket
  hws.sent.length = 0;
  for (let i = 0; i < 2500; i++) await room.webSocketMessage(fws, JSON.stringify({ t: 'to', to: 0, d: { m: 'x' } }));
  assert.ok(hws.sent.length >= 2000 && hws.sent.length < 2100, 'a joiner flooding the relay is cut off: ' + hws.sent.length);

  // a joiner can't lock or kick
  await room.webSocketMessage(fws, JSON.stringify({ t: 'lock', on: true }));
  assert.equal(await room.ctx.storage.get('locked'), undefined);
  await room.webSocketMessage(hws, JSON.stringify({ t: 'lock', on: true }));
  const late = room.ctx.sockets.length;
  await room.fetch(req('https://lobby/lobby/abcdefg?role=join&name=L', '4.4.4.4'));
  assert.deepEqual(room.ctx.sockets.length, late, 'a locked game takes no new players');
  await room.webSocketMessage(hws, JSON.stringify({ t: 'lock', on: false }));
  await room.fetch(req('https://lobby/lobby/abcdefg?role=join&name=L', '4.4.4.4'));
  assert.equal(room.ctx.sockets.length, late + 1, 'and takes them again once unlocked');

  await room.webSocketMessage(hws, JSON.stringify({ t: 'kick', id: fid }));
  assert.deepEqual(fws.closed, { code: 4003, why: 'removed by the host' }, 'the host can drop a peer');
  assert.equal(await room.ctx.storage.get('tok:' + fid), undefined, 'and it cannot resume');
}
{
  const reg = new Registry(ctxFor());
  const env = { REGISTRY: { idFromName: () => 0, get: () => ({ fetch: (u, init) => reg.fetch(new Request(u, init)) }) } };
  const room = new Lobby(ctxFor(), env);
  await room.fetch(req('https://lobby/lobby/abcdefg?role=host&lobby=abcdefg&name=H', '1.1.1.1'));
  let refused = null;
  for (let i = 0; i < 30; i++) {
    const before = room.ctx.sockets.length;
    const r = await room.fetch(req('https://lobby/lobby/abcdefg?role=join&name=G', '6.6.6.6'));
    if (room.ctx.sockets.length === before) {
      refused = { at: i, closed: r.socket && r.socket.closed };
      break;
    }
    room.ctx.sockets.at(-1).close(1000, 'bye');
  }
  assert.equal(refused?.at, 20, 'one address can try to join a game 20 times in a row, then has to wait');
  const other = room.ctx.sockets.length;
  await room.fetch(req('https://lobby/lobby/abcdefg?role=join&name=O', '7.7.7.7'));
  assert.equal(room.ctx.sockets.length, other + 1, 'another address still gets in');
}
console.log('lobby limits ok');

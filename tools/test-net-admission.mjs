// A gated host session: a peer that has not passed hello/password hears nothing and is heard only for 'hello'.
import assert from 'node:assert/strict';

globalThis.RTCPeerConnection = class {
  close() {}
};
globalThis.addEventListener ||= () => {};
globalThis.removeEventListener ||= () => {};
const { NetSession } = await import('../public/js/net.js');

const host = (gated, sent = []) => {
  const s = new NetSession();
  s.host = true;
  s.gated = gated;
  s.out = m => sent.push(m);
  return s;
};
const sent = [],
  s = host(true, sent),
  heard = [],
  got = { 1: [], 2: [] };
s.on('message', (from, m) => heard.push(from + ':' + m.k));
for (const id of [1, 2]) {
  s.control({ t: 'join', id, name: 'P' + id });
  s.links.get(id).send = m => got[id].push(m.k);
}

s.receive(1, { k: 'chat', text: 'hi' });
s.receive(1, { k: 'ack', n: 10, h: 1, e: 0 });
s.receive(1, { _part: 1, i: 0, n: 2, s: '{"k":' });
assert.deepEqual(heard, [], 'nothing but hello is heard from a peer not let in');
assert.equal(s.pieces.size, 0, 'its split messages are not even kept');
s.receive(1, { k: 'hello', name: 'P1' });
assert.deepEqual(heard, ['1:hello']);

s.broadcast({ k: 'state' });
assert.deepEqual(got, { 1: [], 2: [] }, 'no broadcast reaches a peer not let in');
s.admit(1);
s.broadcast({ k: 'state' });
s.broadcast({ k: 'turn' });
assert.deepEqual(got, { 1: ['state', 'turn'], 2: [] });
s.receive(1, { k: 'chat', text: 'hi' });
assert.deepEqual(heard, ['1:hello', '1:chat'], 'an admitted peer is heard');
s.send(2, { k: 'password', wrong: false });
assert.deepEqual(got[2], ['password'], 'the host can still answer a peer directly');

// wrong passwords: a few tries, then the peer is sent away
got[2].length = 0;
for (let i = 0; i < 5; i++) s.askPassword(2, true);
assert.deepEqual(got[2], ['password', 'password', 'password', 'password', 'refuse']);
await new Promise(r => setTimeout(r, 600));
assert.equal(s.links.has(2), false, 'and its link is closed');
assert.deepEqual(sent.at(-1), { t: 'kick', id: 2 }, 'and the lobby is told to drop its socket');

// a peer that leaves is forgotten
s.lost(1);
assert.equal(s.admitted.has(1), false);
s.lock(true);
assert.deepEqual(sent.at(-1), { t: 'lock', on: true });
s.close();

// an ungated host (drop-in shooter rooms) hears everyone, as before
const open = host(false),
  any = [];
open.on('message', (from, m) => any.push(m.k));
open.control({ t: 'join', id: 3 });
open.links.get(3).send = m => any.push('to3:' + m.k);
open.receive(3, { k: 'sh-hello' });
open.broadcast({ k: 'x' });
assert.deepEqual(any, ['sh-hello', 'to3:x']);
open.close();

// a ?lobby= link: kept on a local page, asked about anywhere else
const { LOBBY } = await import('../public/js/deploy.js');
let asked = 0;
const lobbyWith = async (search, hostname, answer, n) => {
  globalThis.location = { search, hostname };
  globalThis.confirm = () => (asked++, answer);
  return (await import('../public/js/net.js?case=' + n)).lobbyUrl();
};
assert.equal(await lobbyWith('?lobby=https://evil.example', 'playeaw.com', false, 1), LOBBY, 'a declined lobby server is not used');
assert.equal(asked, 1);
assert.equal(await lobbyWith('?lobby=https://mine.example/', 'playeaw.com', true, 2), 'https://mine.example', 'an accepted one is');
assert.equal(
  await lobbyWith('?lobby=http://localhost:8787', 'localhost', false, 3),
  'http://localhost:8787',
  'local development asks nothing'
);
assert.equal(await lobbyWith('?lobby=javascript:alert(1)', 'playeaw.com', true, 4), LOBBY, 'only http(s) lobby servers');
assert.equal(asked, 2);
console.log('net admission ok');

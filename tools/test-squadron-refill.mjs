import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod = process.argv.indexOf('--mod');
const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)), mod < 0 ? [] : [process.argv[mod + 1]]);
globalThis.fetch = async input => {
  const path = String(input);
  const key = archive.resolve(decodeURIComponent(path.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { battleResult } = await import('../public/js/game/campaignbattle.js');
const squadron = [...db.types.values()].find(t => t.list('Squadron_Units').length >= 2);
const refill = db.constants.num('Squadron_Refill_Threshold', 0.5);
const teams = [{ players: [] }, { players: [] }];
const w = { teams };
const make = alive => {
  const members = squadron.list('Squadron_Units');
  return { type: squadron, player: { team: teams[0] }, dead: alive === 0, members, fighters: members.map((m, i) => ({ member: i, dead: i >= alive })) };
};
const n = squadron.list('Squadron_Units').length;
const book = { absent: [], waiting: [], entity: new Map([['0:0', make(1)], ['0:1', make(n - 1)], ['0:2', make(1)]]) };
const cb = { attacker: { team: 0, units: [{ gid: '0:0' }, { gid: '0:1' }, { gid: '0:2' }] }, defender: { team: 1, units: [] } };
const alive = battleResult(w, book, cb, 0).alive.filter(g => g.startsWith('0:'));
const total = n + 1,
  expect = [];
let left = total;
for (const g of ['0:0', '0:1', '0:2']) {
  const c = Math.min(n, left);
  left -= c;
  if (c > 0 && c / n >= refill) expect.push(g);
}
assert.deepEqual(alive, expect, 'survivors of one type merge into the earlier squadrons, a remnant under the refill share is disbanded');
console.log('ok', squadron.name, n, refill, alive);

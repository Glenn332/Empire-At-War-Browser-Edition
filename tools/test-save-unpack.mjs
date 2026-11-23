// Saves from other players (start, resync, desync reports) are unpacked with a size limit.
import assert from 'node:assert/strict';
const { packSave, unpackSave } = await import('../public/js/game/savegame.js');

const snap = { version: 2, mode: 'space', name: 'ok', units: Array.from({ length: 200 }, (_, i) => ({ id: i, t: 'X_Wing' })) };
assert.deepEqual((await unpackSave(await packSave(snap))).units, snap.units, 'a normal save goes through');
assert.equal((await unpackSave({ json: JSON.stringify(snap) })).name, 'ok');

// 64 MB of spaces packs to a few dozen KB
const bomb = await packSave({ pad: ' '.repeat(64 * 1024 * 1024) });
assert.ok(bomb.gz.length < 1e6);
await assert.rejects(unpackSave(bomb, 8 * 1024 * 1024), /too large/, 'a gzip bomb stops at the limit');
await assert.rejects(unpackSave({ gz: 'A'.repeat(4096) }, 1024), /too large/, 'packed text over the limit is not decoded');
await assert.rejects(unpackSave({ json: ' '.repeat(2048) }, 1024), /too large/);
await assert.rejects(unpackSave(null), /could not be read/);
await assert.rejects(unpackSave({ gz: 5 }), /could not be read/);
console.log('save unpack ok');

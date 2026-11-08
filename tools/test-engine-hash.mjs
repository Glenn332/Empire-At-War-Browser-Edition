import assert from 'node:assert/strict';
const { EngineHash, crc32 } = await import('../public/js/game/enginehash.js');

assert.equal(crc32('ABC'), 0xa3830348, 'zlib crc32');
assert.equal(crc32(''), 0);

const h = new EngineHash();
const names = Array.from({ length: 70 }, (_, i) => 'EVENT_' + i);
const sizes = [];
names.forEach(n => {
  h.add(n, crc32(n));
  sizes.push(h.buckets);
});
assert.equal(sizes[7], 8);
assert.equal(sizes[8], 64, 'the ninth element grows the table to 64 buckets');
assert.equal(sizes[64], 512, 'the 65th grows it to 512');
assert.equal(h.add('EVENT_3', 0), false, 'a duplicate keeps its place');

const order = h.order(),
  bucket = n => h.bucket(h.ids.get(n));
const seen = new Set();
let prev = -1;
for (let i = 0; i < order.length; i++) {
  const b = bucket(order[i]);
  if (b !== prev) {
    assert.ok(!seen.has(b), 'each bucket is one contiguous run');
    seen.add(b);
  } else assert.ok(h.ids.get(order[i - 1]).crc < h.ids.get(order[i]).crc, 'a run is in ascending CRC order');
  prev = b;
}
const again = new EngineHash();
again.buckets = h.buckets;
for (const n of order) again.add(n, crc32(n));
assert.deepEqual(again.order(), order, 're-inserting the list order into a table of the same size keeps it, as a load does');
h.delete('EVENT_10');
assert.ok(!h.order().includes('EVENT_10'));
console.log('ok');

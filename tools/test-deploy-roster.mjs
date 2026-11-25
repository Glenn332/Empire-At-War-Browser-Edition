import assert from 'node:assert/strict';
import { cardGroup, groupRoster } from '../public/js/game/deploy-roster.js';
const label = c => c.label,
  scout = { name: 'Scout_Trooper' },
  company = { name: 'Scout_Trooper_Company' };
const first = { label: 'Scout Trooper', unit: scout, company, gid: 41, spare: 3, cost: 0 },
  second = { ...first, gid: 42, spare: 2 };
const a = { label: 'Speeder Bike', unit: { name: 'Speeder_Bike' }, vehicle: { id: 1 } },
  b = { ...a, vehicle: { id: 2 } };
const recruit = { label: 'Boba Fett', unit: { name: 'Boba_Fett' }, heroSpawn: true, cost: 0 },
  living = { ...recruit, heroSpawn: false, hero: {} };
const raw = [first, second, a, b, recruit, living],
  cards = (list, selected) => groupRoster(list, label, selected);
assert.deepEqual(cards(raw), [first, a, living]);
assert.deepEqual(cards(raw, second), [second, a, living]);
assert.equal(cards(raw, b)[1], b);
const survivors = cards([{ ...first, spare: 0 }, second, b, recruit], first);
assert.deepEqual(survivors, [second, b, recruit]);
assert.equal(cardGroup(first, label), cardGroup(second, label));
assert.equal(cardGroup(a, label), cardGroup(b, label));
assert.equal(
  cards([
    { ...first, cost: 35 },
    { ...second, cost: 15 }
  ])[0].gid,
  42
);
assert.equal(raw.length, 6);
assert.equal(first.spare, 3);
console.log('PASS: one card per unit, unchanged sources, eligible replacement pool/seat, live hero and price');

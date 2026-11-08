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
const { loadGameData } = await import('../public/js/gamedata.js');
await loadGameData();
const { arrange, smallCraftOrder } = await import('../public/js/game/campaignbattle.js');
const T = (name, cls) => ({
  name,
  has: k => k === 'Ship_Class' || k === 'Space_Model_Name',
  str: k => (k === 'Ship_Class' ? cls : k === 'Space_Model_Name' ? 'NO_SUCH_MODEL.ALO' : ''),
  num: (k, d) => d,
  list: () => [],
  tuples: () => []
});
const cap = T('Cap', 'Capital'),
  frig = T('Frig', 'Frigate'),
  fight = T('Fight', 'Fighter'),
  bomb = T('Bomb', 'Bomber'),
  trans = T('Trans', 'Transport');
const near = (a, b) => Math.abs(a - b) < 1e-3;
const at = { x: 0, y: 0 };
const of = (list, u) => list.find(o => o.u === u);

{
  const c = { type: cap };
  const out = arrange([c], at, 0);
  assert(near(of(out, c).x, 0) && near(of(out, c).y, 0), 'a single capital sits on the anchor');
}
{
  const caps = [1, 2, 3].map(() => ({ type: cap }));
  const out = arrange(caps, at, 0);
  assert(near(of(out, caps[0]).x, 30) && near(of(out, caps[2]).x, -30), 'three capitals: two rows (2 + 1), the rows a cell apart along the heading');
  assert(near(of(out, caps[0]).y, 30) && near(of(out, caps[1]).y, -30), 'the first row is centred across');
  assert(near(of(out, caps[2]).y, 0), 'the shorter row is centred');
}
{
  const c = { type: cap },
    f = { type: frig };
  const out = arrange([c, f], at, 0);
  const p = of(out, f);
  assert(near(p.y, 0) && p.x > 0, 'a single screen ship goes straight ahead');
  assert(near(p.x, Math.SQRT2 * 30 + Math.SQRT2 * 30), 'at the grid radius plus half the length of its group size');
}
{
  const c = { type: cap },
    f = { type: frig },
    s = { type: fight };
  const out = arrange([c, f, s], at, 0);
  const p = of(out, s);
  assert(near(p.y, 0) && p.x > of(out, f).x, 'a single lead ship also goes straight ahead, farther out');
}
{
  const c = { type: cap },
    frigs = [1, 2, 3].map(() => ({ type: frig }));
  const out = arrange([c, ...frigs], at, 0);
  const a = of(out, frigs[0]),
    b = of(out, frigs[2]);
  assert(near(a.x, b.x) && near(a.y, -b.y), 'the screen arc is symmetric about the heading');
  assert(a.x < 0, 'its ends reach behind the anchor (225 degrees)');
}
{
  const c = { type: cap },
    t = [1, 2, 3].map(() => ({ type: trans }));
  const out = arrange([c, ...t], at, 0);
  assert(t.every(u => of(out, u).x < -200), 'transports sit 200 behind the first group');
  assert(near(of(out, t[0]).x, of(out, t[1]).x) && of(out, t[2]).x < of(out, t[0]).x, 'rows of two (at least two, about the square root)');
}
{
  const F = n => [...Array(n)].map((_, i) => ({ type: fight, i: 'F' + i })),
    B = n => [...Array(n)].map((_, i) => ({ type: bomb, i: 'B' + i }));
  const names = list => smallCraftOrder(list).map(u => u.i).join(' ');
  assert.equal(names([...F(1), ...B(4)]), 'B0 B1 F0 B2 B3', 'more bombers: half the excess first, then pairs, then the rest');
  assert.equal(names([...F(4), ...B(2)]), 'B0 F0 F1 F2 B1 F3', 'more fighters: pairs for half the bombers, the extra fighters, then the other pairs');
  assert.equal(names(F(3)), 'F0 F1 F2', 'one kind only keeps its order');
}
{
  const c = { type: cap };
  const out = arrange([c, { type: frig }], { x: 100, y: 50 }, Math.PI / 2);
  const f = out[1];
  assert(near(f.x, 100) && f.y > 50, 'the layout turns with the facing');
}
console.log('ok');

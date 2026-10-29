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
const { TooltipGate } = await import('../public/js/game/tooltipgate.js');
assert.equal(db.constants.num('Encyclopedia_Delay', 0), 750); assert.equal(db.constants.num('Long_Encyclopedia_Delay', 0), 4000);
assert.equal(db.constants.num('Encyclopedia_Fade_Rate', 0), 4); assert.equal(db.constants.num('Encyclopedia_Min_Display_Time', 0), 1);

const make = (delayed = false) => {
  const e = { shown: null, root: { style: {} }, hide() { this.shown = null; this.hidden = (this.hidden || 0) + 1; }, hideLinked() {} };
  const game = { delayTooltips: delayed }, gate = new TooltipGate(game, e); let builds = 0;
  const target = (id, key = id) => ({ id, key, show: () => { builds++; } });
  let now = 0; const step = ms => { for (let t = 0; t < ms; t += 10) { now += 10; gate.update(now); } };
  gate.update(now);
  return { e, gate, target, step, builds: () => builds };
};

{
  const t = make(); t.gate.moved(); t.gate.hover(t.target('a')); assert.equal(t.builds(), 0, 'not yet');
  t.step(700); t.gate.hover(t.target('a')); assert.equal(t.builds(), 0, '700 ms is not 750');
  t.step(100); t.gate.hover(t.target('a')); assert.equal(t.builds(), 1, 'built after the delay'); assert(t.gate.popup && t.gate.fadeIn);
  t.step(120); assert(t.gate.alpha > 0.4 && t.gate.alpha < 0.6, 'fading in: ' + t.gate.alpha); t.step(200); assert.equal(t.gate.alpha, 1); assert(!t.gate.fadeIn);
  t.gate.hover(t.target('a')); assert.equal(t.builds(), 1, 'the same content is not built again');
  t.gate.hover(t.target('a', 'a2')); assert.equal(t.builds(), 2, 'built again when what it says changes');
}
{
  const t = make(); t.step(1000); t.gate.hover(t.target('a')); assert.equal(t.builds(), 1, 'a long rest: at once'); t.step(500);
  t.gate.moved(); assert(!t.gate.popup && t.e.hidden === 1, 'gone with no fade'); t.gate.hover(t.target('a')); assert.equal(t.builds(), 1); t.step(760); t.gate.hover(t.target('a')); assert.equal(t.builds(), 2);
}
{
  const t = make(); t.step(1000); t.gate.hover(t.target('a')); t.step(400); assert.equal(t.gate.alpha, 1);
  t.gate.hover(null); assert(t.gate.fadeOut); t.step(300); assert.equal(t.gate.alpha, 1, 'held to the minimum time (about 700 ms more)');
  t.step(500); assert(t.gate.alpha < 1 && t.gate.alpha > 0, 'fading out: ' + t.gate.alpha); t.step(300); assert(!t.gate.popup, 'destroyed'); assert.equal(t.e.root.style.opacity, '');
}
{
  const t = make(); t.step(1000); t.gate.hover(t.target('a')); t.step(500);
  t.gate.hover(t.target('b')); assert.equal(t.builds(), 1, 'b is not taken yet'); assert(t.gate.fadeOut && t.gate.target === 'a');
  for (let i = 0; i < 125 && t.gate.popup; i++) { t.step(10); t.gate.hover(t.target('b')); }
  assert(!t.gate.popup, 'a is gone'); t.gate.hover(t.target('b')); assert.equal(t.builds(), 1, 'the cooldown was re-armed');
  t.step(800); t.gate.hover(t.target('b')); assert.equal(t.builds(), 2, 'b is built'); assert.equal(t.gate.target, 'b');
}
{
  const t = make(true); t.gate.moved(); t.step(3000); t.gate.hover(t.target('a')); assert.equal(t.builds(), 0); t.step(1100); t.gate.hover(t.target('a')); assert.equal(t.builds(), 1);
}
{
  const t = make(); t.step(1000); t.gate.hover(t.target('a')); t.e.shown = null; t.step(20); assert(!t.gate.popup && t.e.root.style.opacity === '');
}
console.log('ok');

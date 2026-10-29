import path from 'node:path';
import { openGame } from './megfs.mjs';
import { parseALO } from '../public/js/alo.js';

const game = path.resolve(import.meta.dirname, '../../Star Wars Empire at War');
const mods = process.argv.slice(2);
const vfs = openGame(game, mods), base = openGame(game);
const fromMod = e => mods.some(m => (e.file || e.meg || '').toLowerCase().startsWith(path.resolve(m).toLowerCase()));

const SKIP = /collision|shadowvolume|lightvisualize|meshheat/, ADDITIVE = /additive|nebula|meshshield/;
const ALPHA = /alpha|tree\.fx|grass/, UNLIT = /skydome|nebula/;
const OWN = new Set(['planet.fx', 'meshshield.fx', 'meshadditive.fx', 'meshadditivevcolor.fx', 'rskinadditive.fx', 'rskinadditivevcolor.fx', 'nebula.fx']);
function handling(s) {
  if (SKIP.test(s)) return 'not drawn';
  if (OWN.has(s)) return 'own program';
  const additive = ADDITIVE.test(s), alpha = !additive && ALPHA.test(s);
  const unlit = additive || UNLIT.test(s) || s === 'meshalpha.fx' || s === 'batchmeshalpha.fx';
  const f = [additive && 'additive', alpha && 'alpha', unlit && 'unlit', s.includes('colorize') && 'colorize',
    s.includes('bump') && 'bump', s.includes('gloss') && 'gloss'].filter(Boolean);
  return 'by name: ' + (f.join(' ') || 'plain lit');
}

const fxo = s => 'DATA\\ART\\SHADERS\\' + s.replace(/\.fx$/, '.FXO').toUpperCase();
const baseShaders = new Set([...base.index.keys()].filter(k => /^DATA\\ART\\SHADERS\\[^\\]+\.FXO$/.test(k)).map(k => path.win32.basename(k).toLowerCase().replace(/\.fxo$/, '.fx')));

const use = new Map();
let models = 0, failed = 0;
for (const [key, e] of vfs.index) {
  if (!/^DATA\\ART\\MODELS\\.*\.ALO$/.test(key)) continue;
  const b = vfs.read(key);
  let m;
  try { m = parseALO(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); } catch { failed++; continue; }
  models++;
  const name = path.win32.basename(key);
  for (const mesh of m.meshes || []) for (const sub of mesh.subs || []) {
    const s = sub.material?.shader || '(none)';
    const u = use.get(s) || use.set(s, { meshes: 0, models: new Set(), modModels: new Set() }).get(s);
    u.meshes++; u.models.add(name); if (fromMod(e)) u.modModels.add(name);
  }
}

const rows = [...use].sort((a, b) => b[1].models.size - a[1].models.size).map(([s, u]) => {
  const k = fxo(s), inBase = baseShaders.has(s), file = vfs.index.get(k);
  let fx = inBase ? 'game' : 'MOD-ONLY';
  if (!file) fx = 'MISSING';
  else if (inBase && fromMod(file) && !vfs.read(k).equals(base.read(k))) fx = 'mod changed';
  return { shader: s, models: u.models.size, modModels: u.modModels.size, meshes: u.meshes, fxo: fx, drawn: handling(s), example: [...(u.modModels.size ? u.modModels : u.models)][0] };
});
console.log(`${models} models read (${failed} unreadable), ${mods.length ? 'mod: ' + mods.join(', ') : 'base game'}\n`);
console.table(rows);

if (mods.length) {
  const changed = [...vfs.index].filter(([k, e]) => /^DATA\\ART\\SHADERS\\.*\.FXO$/.test(k) && fromMod(e) && base.index.has(k) && !vfs.read(k).equals(base.read(k))).map(([k]) => path.win32.basename(k));
  const added = [...vfs.index].filter(([k, e]) => /^DATA\\ART\\SHADERS\\.*\.FXO$/.test(k) && fromMod(e) && !base.index.has(k)).map(([k]) => k.replace('DATA\\ART\\SHADERS\\', ''));
  console.log('\nmod .fxo files whose code differs from the game\'s:', changed.join(', ') || 'none');
  console.log('mod .fxo files the game does not have:', added.join(', ') || 'none');
}

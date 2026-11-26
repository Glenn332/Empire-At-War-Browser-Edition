// Read-only check against your own mounted retail data; no models or game data are exported.
// SWR_GAME=<Gold Pack directory> node tools/test-deploy-disc-catalog.mjs [--base]
import assert from 'node:assert/strict';
import { openGame } from './megfs.mjs';
import { fitSpawnDisc, projectDisc, DISC_EDGE } from '../public/js/game/deploy-disc.js';
assert(process.env.SWR_GAME, 'Set SWR_GAME to the Gold Pack install');
const expansion = !process.argv.includes('--base');
const archive = openGame(process.env.SWR_GAME, [], { expansion });
globalThis.fetch = async input => {
  const p = String(input);
  if (p.startsWith('api/find?q=')) {
    const rx = new RegExp(decodeURIComponent(p.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(n => rx.test(n))));
  }
  const k = archive.resolve(decodeURIComponent(p.replace(/^asset\//, '').split('?')[0])),
    bytes = k && archive.read(k);
  return new Response(bytes ? new Uint8Array(bytes) : null, { status: bytes ? 200 : 404 });
};
const { loadGameData } = await import('../public/js/gamedata.js');
const { skirmishMaps, parseTED } = await import('../public/js/ted.js');
await loadGameData();
const { land } = await skirmishMaps();
assert(land.length >= (expansion ? 24 : 15), 'incomplete stock land skirmish catalog');
let count = 0;
for (const name of land) {
  const bytes = archive.read(archive.resolve('Data/Art/Maps/' + name));
  const m = parseTED(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const pts = m.objects
    .filter(
      o =>
        /SPAWN_POINT_MARKER$/i.test(o.type.name) ||
        [...o.type.list('Behavior'), ...o.type.list('LandBehavior')].some(b => b.toUpperCase() === 'REINFORCEMENT_POINT')
    )
    .map(o => ({ x: o.pos[0], y: o.pos[1] }));
  assert(pts.length > 1, name + ': expected authored markers');
  const view = fitSpawnDisc(pts, m.playMin, m.playMax),
    f = projectDisc(view, 520, 0);
  for (const p of pts) assert(Math.hypot(f.X(p.x) - 260, f.Y(p.y) - 260) + 25 < 520 * DISC_EDGE, name + ': clipped marker/label');
  count += pts.length;
}
archive.close();
console.log(
  `${expansion ? 'FoC' : 'EaW'}: ${land.length}/${land.length} stock land skirmish maps fit; ${count} authored spawn/reinforcement markers including label clearance.`
);

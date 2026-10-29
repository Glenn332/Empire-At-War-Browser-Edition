import { parseALO } from '../public/js/alo.js';
const [, , model, ...filters] = process.argv;
const r = await fetch(`${process.env.SWR_URL || 'http://localhost:8377/'}asset/Data/Art/Models/${model}`);
if (!r.ok) {
  console.error('missing', model);
  process.exit(1);
}
const m = parseALO(await r.arrayBuffer());
const mul = (a, b) => {
  const o = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++)
      o[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + (j === 3 ? a[i * 4 + 3] : 0);
  }
  return o;
};
const world = [];
m.bones.forEach((b, i) => {
  const w = b.parent < 0 ? b.matrix : mul(world[b.parent], b.matrix);
  world.push(w);
  if (!filters.length || filters.some(f => b.name.toLowerCase().includes(f.toLowerCase()))) {
    const f = v => v.map(x => x.toFixed(2).padStart(8)).join('');
    console.log(
      b.name.padEnd(26),
      'pos',
      f([w[3], w[7], w[11]]),
      ' X',
      f([w[0], w[4], w[8]]),
      ' Y',
      f([w[1], w[5], w[9]]),
      ' Z',
      f([w[2], w[6], w[10]]),
      b.billboard ? 'bb' + b.billboard : '',
      b.visible ? '' : 'hidden'
    );
  }
});
console.log(
  'meshes:',
  m.meshes
    .map(
      x =>
        `${x.name}${x.hidden ? '(h)' : ''}[${x.subs.map(s => s.material?.shader.replace('.fx', '') + ':' + s.geometry.format.replace('alD3dVert', '')).join(',')}]@${m.bones[x.bone]?.name}`
    )
    .join('  ')
);
console.log('proxies:', m.proxies.map(p => `${p.name}@${m.bones[p.bone]?.name}${p.hidden ? '(h)' : ''}`).join('  '));

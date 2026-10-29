import { parseALO } from '../public/js/alo.js';
const base = process.env.SWR_URL || 'http://localhost:8377/';
const [, , model, pattern] = process.argv;
const m = parseALO(await (await fetch(`${base}asset/Data/Art/Models/${model}`)).arrayBuffer());
const rx = new RegExp(pattern || '.', 'i');
for (const mesh of m.meshes) {
  if (!rx.test(mesh.name)) continue;
  const b = m.bones[mesh.bone];
  for (const sub of mesh.subs) {
    const g = sub.geometry,
      { pos, uv } = g.vertices || { pos: [], uv: [] };
    const vs = [];
    for (let i = 0; i < Math.min(g.nVerts, 12); i++)
      vs.push([pos[i * 3], pos[i * 3 + 1], uv[i * 2], uv[i * 2 + 1]].map(f => +f.toFixed(3)).join(','));
    console.log(
      mesh.name,
      mesh.hidden ? '(h)' : '',
      'bone',
      b?.name,
      'at',
      [b?.matrix[3], b?.matrix[7]].map(Math.round).join(','),
      sub.material.shader,
      JSON.stringify(sub.material.params.BaseTexture),
      'verts',
      g.nVerts,
      'tris',
      g.nPrims,
      '\n   xyuv:',
      vs.join(' | ')
    );
  }
}

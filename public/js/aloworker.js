import { parseALO } from './alo.js';

// Pure parsing only: Three.js objects and GPU resources stay on the rendering thread.
onmessage = ({ data: { id, buffer, outline } }) => {
  try {
    const model = parseALO(buffer, { outline }),
      transfer = [];
    for (const mesh of model.meshes)
      for (const sub of mesh.subs) {
        const g = sub.geometry;
        for (const value of [g?.indices, g?.boneMap, g?.vertices?.pos, g?.vertices?.nrm, g?.vertices?.uv, g?.vertices?.tan, g?.vertices?.bin, g?.vertices?.col, g?.vertices?.skinIndex, g?.vertices?.skinWeight])
          if (value?.buffer && !transfer.includes(value.buffer)) transfer.push(value.buffer);
      }
    postMessage({ id, model }, transfer);
  } catch (error) {
    postMessage({ id, error: String(error?.message || error) });
  }
};

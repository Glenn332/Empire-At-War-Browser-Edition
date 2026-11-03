import { decodeDXT } from './ddsdecode.js';
import { buildMips } from './ddsmips.js';
import { decodePNG } from './png.js';

onmessage = async ({ data: m }) => {
  if (m.png) {
    let png = null;
    try {
      png = await decodePNG(m.src.buffer);
    } catch {}
    if (png) postMessage({ id: m.id, png }, [png.data.buffer]);
    else postMessage({ id: m.id });
    return;
  }
  if (m.mips) {
    let mips = null;
    try {
      mips = buildMips(m.src, m.width, m.height, m.kind);
    } catch {
      postMessage({ id: m.id });
      return;
    }
    postMessage(
      { id: m.id, mips },
      mips.map(l => l.data.buffer)
    );
    return;
  }
  let rgba = null;
  try {
    rgba = decodeDXT(m.src, m.width, m.height, m.kind);
  } catch {
    postMessage({ id: m.id });
    return;
  }
  if (m.rgba) {
    postMessage({ id: m.id, rgba }, [rgba.buffer]);
    return;
  }
  try {
    const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.buffer), m.width, m.height), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none'
    });
    postMessage({ id: m.id, bitmap }, [bitmap]);
  } catch {
    postMessage({ id: m.id, rgba }, [rgba.buffer]);
  }
};

export function binkHeader(buffer) {
  if (buffer.byteLength < 44) throw Error('Truncated Bink header');
  const d = new DataView(buffer),
    magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (!/^BIK[bdfghik]$/.test(magic)) throw Error('Unsupported Bink movie ' + magic);
  const frames = d.getUint32(8, true),
    width = d.getUint32(20, true),
    height = d.getUint32(24, true);
  const fps = d.getUint32(28, true) / d.getUint32(32, true),
    alpha = !!(d.getUint32(36, true) & 0x100000);
  if (!frames || !width || !height || width > 8192 || height > 8192 || !Number.isFinite(fps) || fps <= 0)
    throw Error('Invalid Bink dimensions or rate');
  return { frames, width, height, fps, alpha };
}

export function binkChunkSize(header) {
  return Math.max(1, Math.min(30, Math.floor((8 * 1024 * 1024) / (header.width * header.height * 4))));
}
export const NATIVE_BINK_FPS = 30;

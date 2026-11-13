import assert from 'node:assert/strict';
import { playableWave } from '../public/js/wavadpcm.js';

function adpcmFile(samplesPerBlock, header, nibbles) {
  const align = 7 + Math.ceil(nibbles.length / 2),
    fmtSize = 20 + 4 * 7,
    size = 12 + 8 + fmtSize + 8 + align,
    b = new ArrayBuffer(size),
    v = new DataView(b);
  let p = 0;
  const tag = s => {
    for (const ch of s) v.setUint8(p++, ch.charCodeAt(0));
  };
  tag('RIFF');
  v.setUint32(p, size - 8, true);
  p += 4;
  tag('WAVE');
  tag('fmt ');
  v.setUint32(p, fmtSize, true);
  p += 4;
  v.setUint16(p, 2, true);
  v.setUint16(p + 2, 1, true);
  v.setUint32(p + 4, 22050, true);
  v.setUint32(p + 8, 11155, true);
  v.setUint16(p + 12, align, true);
  v.setUint16(p + 14, 4, true);
  v.setUint16(p + 16, 32, true);
  v.setUint16(p + 18, samplesPerBlock, true);
  v.setUint16(p + 20, 7, true);
  const coef = [256, 0, 512, -256, 0, 0, 192, 64, 240, 0, 460, -208, 392, -232];
  coef.forEach((c, i) => v.setInt16(p + 22 + i * 2, c, true));
  p += fmtSize;
  tag('data');
  v.setUint32(p, align, true);
  p += 4;
  v.setUint8(p++, header.predictor);
  v.setInt16(p, header.delta, true);
  v.setInt16(p + 2, header.s1, true);
  v.setInt16(p + 4, header.s2, true);
  p += 6;
  for (let i = 0; i < nibbles.length; i += 2) v.setUint8(p++, (nibbles[i] << 4) | (nibbles[i + 1] ?? 0));
  return b;
}

const pcm16 = b => {
  const v = new DataView(b);
  assert.equal(v.getUint16(20, true), 1, 'converted to PCM');
  assert.equal(v.getUint16(34, true), 16);
  return [...new Int16Array(b, 44)];
};

{
  const out = pcm16(playableWave(adpcmFile(4, { predictor: 0, delta: 16, s1: 100, s2: 50 }, [0, 0])));
  assert.deepEqual(out, [50, 100, 100, 100], 'predictor 0 holds the last sample when the nibble is 0');
}
{
  const out = pcm16(playableWave(adpcmFile(4, { predictor: 1, delta: 16, s1: 100, s2: 50 }, [1, 15])));
  assert.equal(out[2], 150 + 16, 'predictor 1 extrapolates and adds nibble times delta');
  assert.equal(out[3], ((2 * 166 - 100) | 0) + -1 * Math.max(16, (230 * 16) >> 8), 'the delta adapts and a negative nibble subtracts');
}
{
  const pcm = new ArrayBuffer(48),
    v = new DataView(pcm);
  v.setUint32(0, 0x52494646, false);
  v.setUint32(8, 0x57415645, false);
  assert.equal(playableWave(pcm), pcm, 'anything that is not MS ADPCM passes through unchanged');
}
console.log('PASS: MS ADPCM wave conversion');

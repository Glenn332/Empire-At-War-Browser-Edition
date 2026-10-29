let a = 0, b = 0, c = 0, d = 0;

export function simRandom() {
  a |= 0; b |= 0; c |= 0; d |= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  return (t >>> 0) / 4294967296;
}

export function seedSim(seed) {
  a = 0x9e3779b9; b = 0x243f6a88; c = 0xb7e15162; d = seed >>> 0;
  for (let i = 0; i < 15; i++) simRandom();
}

export const simRandomState = () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
export function setSimRandomState(s) { [a, b, c, d] = s; }

seedSim((Math.random() * 4294967296) >>> 0);

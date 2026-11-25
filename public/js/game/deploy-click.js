// Original, short mechanical latch cues. A dull impact, a second metal contact
// and a damped housing resonance; no sustained electronic confirmation tone.
const variants = {
  unit: [115, 0.02, 0.095],
  post: [99, 0.026, 0.106],
  spawn: [83, 0.033, 0.14]
};
const buffers = new WeakMap();
function clickBuffer(ctx, kind) {
  let cache = buffers.get(ctx);
  if (!cache) buffers.set(ctx, (cache = new Map()));
  if (cache.has(kind)) return cache.get(kind);
  const [base, catchAt, length] = variants[kind],
    rate = 22050;
  const buf = ctx.createBuffer(1, Math.ceil(length * rate), rate),
    out = buf.getChannelData(0);
  let seed = 123456,
    noise = 0,
    damped = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate,
      s = Math.max(0, t - catchAt);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noise += 0.23 * (seed / 2147483648 - 1 - noise);
    damped += 0.23 * (noise - damped);
    const impact = x => Math.exp(-x * 63) * Math.sin(2 * Math.PI * (base * x + 0.25 * (1 - Math.exp(-85 * x))));
    const metal = x => Math.exp(-x * 105) * (Math.sin(x * base * 2.74 * 2 * Math.PI) + 0.6 * Math.sin(x * base * 4.31 * 2 * Math.PI));
    const strike = Math.exp(-t * 170) + (s > 0 ? 0.72 * Math.exp(-s * 140) : 0);
    out[i] =
      Math.tanh(impact(t) + 0.68 * impact(s) + 0.38 * metal(t) + 0.24 * metal(s) + 1.8 * damped * strike) *
      Math.min(1, t / 0.0015, (length - t) / 0.01);
  }
  cache.set(kind, buf);
  return buf;
}
export function playDeployClick(audio, kind) {
  if (!audio || !audio.sfxVolume || !audio.masterVolume || !variants[kind]) return;
  if (!audio.ctx && !(globalThis.AudioContext || globalThis.webkitAudioContext)) return;
  if (audio.ctx?.state !== 'running') audio.unlock();
  const ctx = audio.ctx,
    source = ctx.createBufferSource(),
    gain = ctx.createGain();
  source.buffer = clickBuffer(ctx, kind);
  gain.gain.value = audio.ducked(0.7 * audio.sfxVolume);
  source.connect(gain);
  gain.connect(audio.master);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  source.start();
  return source;
}

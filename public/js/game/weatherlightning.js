export const LIGHTNING_FRAME = 1 / 30;

export function lightningState() {
  return { L: 0, wait: 0, flash: 0, step: 0, light: null };
}

export function lightningFrame(s, L, rnd = Math.random) {
  if (L !== s.L) {
    s.L = L;
    s.wait = s.flash = 0;
  }
  if (!L) return null;
  if (s.flash < 1) {
    if (s.wait > 0) s.wait--;
    else {
      s.wait = Math.trunc(rnd() * 500 * L);
      s.flash = Math.trunc(rnd() * 30 * L);
    }
    return null;
  }
  s.flash--;
  const x = rnd() * 2 - 1,
    y = rnd() * 2 - 1,
    z = rnd() * 2 - 1,
    n = Math.hypot(x, y, z) || 1;
  return { dir: [x / n, y / n, z / n], strength: rnd() * 0.5 * L };
}

export function stepLightning(s, L, seconds, rnd = Math.random) {
  if (L !== s.L) {
    s.L = L;
    s.wait = s.flash = 0;
  }
  s.step = Math.min(s.step + Math.max(0, seconds), 0.5);
  while (s.step >= LIGHTNING_FRAME) {
    s.step -= LIGHTNING_FRAME;
    s.light = lightningFrame(s, L, rnd);
  }
  if (!L) s.light = null;
  return s.light;
}

// Times the methods of a land battle's objects, tick by tick, to show where a slow tick went.
// test-lockstep-land.mjs --probe uses it; the wrappers cost time themselves, so compare ticks with each other and
// not with an unprobed run.
export function installProbe(objects, keep = 14) {
  const now = new Map(),
    depth = new Map();
  for (const [label, obj] of Object.entries(objects)) {
    if (!obj) continue;
    const proto = Object.getPrototypeOf(obj);
    for (const k of Object.getOwnPropertyNames(proto)) {
      const f = Object.getOwnPropertyDescriptor(proto, k).value;
      if (k === 'constructor' || typeof f !== 'function' || f.constructor.name === 'AsyncFunction') continue;
      const name = label + '.' + k;
      proto[k] = function (...args) {
        const d = depth.get(name) || 0;
        depth.set(name, d + 1);
        const t0 = performance.now();
        try {
          return f.apply(this, args);
        } finally {
          depth.set(name, d);
          if (!d) {
            const e = now.get(name) || now.set(name, [0, 0]).get(name);
            e[0] += performance.now() - t0;
            e[1]++;
          }
        }
      };
    }
  }
  const ticks = [];
  return {
    ticks,
    // closes a tick: its time, and the methods that took most of it as [name, ms, calls]
    end(ms) {
      ticks.push({
        ms,
        top: [...now]
          .map(([k, v]) => [k, +v[0].toFixed(2), v[1]])
          .sort((a, b) => b[1] - a[1])
          .slice(0, keep)
      });
      now.clear();
    }
  };
}

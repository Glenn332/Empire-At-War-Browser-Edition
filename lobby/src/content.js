// The content description a host attaches to its listing (what game and mods it runs). Everything is
// re-validated here: a host can send anything, and the registry stores and serves whatever comes out.
const MAX_MODS = 32;
const MAX_LOCAL = 64;
const MAX_NAMES = 16;

const text = (v, n) =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, n)
    : '';
const hex8 = v => (typeof v === 'string' && /^[0-9a-f]{8}$/.test(v) ? v : '');

export function cleanContent(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const mods = [];
  if (Array.isArray(c.mods))
    for (const m of c.mods.slice(0, MAX_MODS * 4)) {
      if (mods.length >= MAX_MODS) break;
      if (!m || typeof m !== 'object') continue;
      const id = typeof m.id === 'string' || typeof m.id === 'number' ? String(m.id) : '';
      if (!/^\d{1,20}$/.test(id)) continue;
      mods.push({ id, name: text(m.name, 64), v: text(m.v, 24) });
    }
  const names = Array.isArray(c.names) ? c.names.slice(0, MAX_NAMES).map(n => text(n, 48)).filter(Boolean) : [];
  const out = {
    ed: c.ed === 'eaw' ? 'eaw' : 'foc',
    mods,
    local: Math.max(0, Math.min(MAX_LOCAL, Math.floor(Number(c.local) || 0))),
    mh: hex8(c.mh)
  };
  // local mod names are only kept when the host chose to list them, and never more than the declared count
  if (names.length && out.local) out.names = names.slice(0, out.local);
  return out;
}

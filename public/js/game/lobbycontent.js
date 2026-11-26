// What a hosted game runs, as shown on the game list. The identity that decides whether a player may join is
// the pair (game version, data fingerprint) compared in multiplayer.js (`version` and `dataFingerprint()`);
// contentHash() is a short form of exactly that pair, so equal hashes mean the join check passes.
// The mod list only describes the content: workshop mods by id and public name, local mods as a count.

export const MAX_MODS = 32;
export const MAX_LOCAL = 64;
export const MAX_NAMES = 16;
const LOCAL_KEY = 'swr.lobby.listlocal';

const fnv = parts => {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const t = String(part) + '|';
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const plain = (v, n) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, n);
export const isWorkshopId = v => /^\d{1,20}$/.test(String(v ?? ''));

// the part of the join check the list can show: same game version and same data fingerprint
export const contentHash = (version, data) => fnv(['join', version, data]);

export function editionKind(content) {
  const foc = content?.edition !== 'eaw';
  const mods = (content?.mods?.length || 0) > 0;
  return (foc ? 'foc' : 'eaw') + (mods ? '+mods' : '');
}

export const EDITION_LABELS = {
  eaw: 'Vanilla EaW',
  foc: 'FoC',
  'eaw+mods': 'EaW + mods',
  'foc+mods': 'FoC + mods'
};

// hash of the ordered mod list; a local mod contributes a hash of its name and version, never the name itself
export function modListHash(content) {
  return fnv(
    (content?.mods || []).map(m =>
      isWorkshopId(m.workshop) ? `w:${m.workshop}@${m.version || ''}` : `l:${String(m.name || '').toLowerCase()}@${m.version || ''}`
    )
  );
}

export const listLocalPref = () => {
  try {
    return localStorage.getItem(LOCAL_KEY) === '1';
  } catch {
    return false;
  }
};
export const setListLocalPref = on => {
  try {
    if (on) localStorage.setItem(LOCAL_KEY, '1');
    else localStorage.removeItem(LOCAL_KEY);
  } catch {}
};

// the object sent to the lobby server inside the game's listing
export function listingContent(content, { listLocal = false } = {}) {
  const mods = content?.mods || [];
  const shared = [];
  let local = 0;
  const names = [];
  for (const m of mods) {
    if (isWorkshopId(m.workshop)) {
      if (shared.length < MAX_MODS) shared.push({ id: String(m.workshop), name: plain(m.name, 64), v: plain(m.version, 24) });
    } else {
      local++;
      if (listLocal && names.length < MAX_NAMES) names.push(plain(m.name, 48));
    }
  }
  const out = { ed: content?.edition === 'eaw' ? 'eaw' : 'foc', mods: shared, local: Math.min(local, MAX_LOCAL), mh: modListHash(content) };
  if (names.length) out.names = names;
  return out;
}

// what the list shows for a game, from its listing (version, mod = data fingerprint, content)
export function describeListing(g, ours = {}) {
  const c = g?.content;
  const hash = contentHash(g?.version, g?.mod);
  const mods = (c?.mods?.length || 0) + (c?.local || 0);
  const kind = (c?.ed === 'eaw' ? 'eaw' : 'foc') + (mods ? '+mods' : '');
  const label = c ? EDITION_LABELS[kind] + (mods ? ` (${mods})` : '') : 'unknown content';
  const can = ours.version !== undefined && g?.version === ours.version && g?.mod === ours.data;
  return { label, hash, can, mods: c?.mods || [], local: c?.local || 0, names: c?.names || [], mh: c?.mh || '' };
}

export function detailLines(g, ours = {}) {
  const d = describeListing(g, ours);
  const lines = [`${g.name}: ${d.label}, content #${d.hash}${d.can ? ' (matches yours, you can join)' : ' (differs from yours)'}`];
  if (d.mods.length) lines.push('Workshop mods needed: ' + d.mods.map(m => `${m.name || 'mod'} (workshop ${m.id}${m.v ? ' ' + m.v : ''})`).join(', '));
  if (d.local) lines.push(d.names.length ? `Local mods (listed by the host): ${d.names.join(', ')}` : `${d.local} local mod${d.local > 1 ? 's' : ''} (names not shared by the host)`);
  if (d.mh) lines.push(`Mod list #${d.mh}`);
  return lines;
}

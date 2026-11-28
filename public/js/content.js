import { edition, EDITIONS } from './edition.js';

let gathered = null;
let current = null;

async function mountedMods() {
  try {
    const response = await fetch((globalThis.SWR_BASE || '') + 'api/mounted');
    if (!response.ok) return [];
    const list = await response.json();
    return Array.isArray(list) ? list.map(mod => ({ ...mod, source: 'mounted' })) : [];
  } catch {
    return [];
  }
}

async function overlayMods() {
  try {
    const overlay = await (await import('./vfs.js')).pageOverlay();
    return (overlay?.layers || []).map(mod => ({ ...mod, source: 'added' }));
  } catch {
    return [];
  }
}

function cleanMod(mod) {
  const out = { name: mod.name || mod.folder || 'unnamed mod', source: mod.source };
  if (mod.workshop) out.workshop = String(mod.workshop);
  if (mod.version) out.version = String(mod.version);
  if (mod.files) out.files = mod.files;
  return out;
}

const modKey = mod => (mod.workshop ? 'workshop ' + mod.workshop : String(mod.name).toLowerCase());

export function loadContent() {
  gathered ||= Promise.all([mountedMods(), overlayMods()]).then(([mounted, added]) => {
    // In the app the same mod can be mounted by the app itself (the launcher's turned-on mods,
    // which the game is opened with) and read again by the page's overlay. It is one mod, so it
    // is described once.
    const mods = [];
    const seen = new Set();
    for (const mod of [...mounted, ...added]) {
      const key = modKey(mod);
      if (seen.has(key)) continue;
      seen.add(key);
      mods.push(cleanMod(mod));
    }
    current = { edition: edition(), mods };
    return current;
  });
  return gathered;
}

export const contentNow = () => current;

if (typeof document !== 'undefined') loadContent();

const EDITION_NAMES = Object.fromEntries(EDITIONS.map(entry => [entry.id, entry.name]));

export function describeMod(mod) {
  return `${mod.name}${mod.workshop && mod.workshop !== mod.name ? ` (workshop ${mod.workshop})` : ''}${mod.version ? ` version ${mod.version}` : ''}`;
}

export function describeContent(content) {
  if (!content) return 'not recorded';
  const game = EDITION_NAMES[content.edition] || content.edition || 'unknown game';
  return content.mods?.length ? `${game} with ${content.mods.map(describeMod).join(' + ')}` : `${game}, no mods`;
}

export function contentDifferences(saved, running) {
  if (!saved || !running) return [];
  const out = [];
  if (saved.edition && running.edition && saved.edition !== running.edition)
    out.push(`${EDITION_NAMES[saved.edition] || saved.edition} save, running ${EDITION_NAMES[running.edition] || running.edition}`);
  const savedMods = saved.mods || [],
    runningMods = running.mods || [];
  const runningByKey = new Map(runningMods.map(mod => [modKey(mod), mod]));
  const savedKeys = new Set(savedMods.map(modKey));
  for (const mod of savedMods) {
    const here = runningByKey.get(modKey(mod));
    if (!here) out.push(`missing ${mod.name}${mod.version ? ' ' + mod.version : ''}`);
    else if (mod.version && here.version && mod.version !== here.version)
      out.push(`${mod.name} ${mod.version} save, running ${here.version}`);
    else if (mod.files && here.files && mod.files !== here.files) out.push(`${mod.name} changed since the save`);
  }
  for (const mod of runningMods) if (!savedKeys.has(modKey(mod))) out.push(`${mod.name} is loaded but was not in the save`);
  const sameSet = savedMods.length === runningMods.length && savedMods.every(mod => runningByKey.has(modKey(mod)));
  if (sameSet && savedMods.some((mod, i) => modKey(mod) !== modKey(runningMods[i]))) out.push('mods in a different order');
  return out;
}

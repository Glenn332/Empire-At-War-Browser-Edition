import { db } from '../gamedata.js';

// Double-clicking a planet's name in the galactic logs, story popups and the location log brings that planet into
// view and selects it. Local view only: it calls GalacticGame.focusPlanet, which selects through the same path as a
// click on the planet, so nothing here is a lockstep command.

const isWord = ch => !!ch && /[\p{L}\p{N}]/u.test(ch);
const MARKS = /[̀-ͯ]/g;

// folded text (accents and case removed) with, for every folded character, the index it came from
function foldMap(s) {
  const src = String(s ?? ''),
    map = [];
  let text = '';
  for (let i = 0; i < src.length; i++) {
    const piece = src[i].normalize('NFKD').replace(MARKS, '').toLowerCase();
    for (const ch of piece) {
      text += ch;
      map.push(i);
    }
  }
  return { text, map };
}
const fold = s => foldMap(s).text.replace(/[_\s]+/g, ' ').trim();

const labelOf = (game, p) => game.planetViews?.[p.index]?.name || db.t(p.type?.str?.('Text_ID')) || p.name || '';

// every planet that can be linked, with the names it answers to: its displayed (localized) name first, then its type name
function candidates(game) {
  const out = [];
  for (const p of game?.galaxy?.planets || []) {
    if (!p || p.background || game.planetViews?.[p.index]?.show === false) continue;
    const names = [];
    const shown = fold(labelOf(game, p));
    if (shown) names.push({ name: shown, rank: 0 });
    const type = fold(p.type?.name);
    if (type && type !== shown) names.push({ name: type, rank: 1 });
    const own = fold(p.name);
    if (own && own !== shown && own !== type) names.push({ name: own, rank: 1 });
    if (names.length) out.push({ index: p.index, names });
  }
  return out;
}

const valid = (game, i) => {
  const p = Number.isInteger(i) ? game?.galaxy?.planets?.[i] : null;
  return p && !p.background && game.planetViews?.[i]?.show !== false ? i : -1;
};

// A planet from a log entry's own reference (the planet object or its index) or from a name; -1 when there is none.
export function resolvePlanet(game, ref) {
  try {
    if (ref && typeof ref === 'object') {
      const i = Number.isInteger(ref.index) ? ref.index : game?.galaxy?.planets?.indexOf(ref);
      return valid(game, i);
    }
    if (typeof ref === 'number') return valid(game, ref);
    const want = fold(ref);
    if (!want) return -1;
    const all = candidates(game);
    for (const rank of [0, 1]) {
      const hit = all.find(c => c.names.some(n => n.rank === rank && n.name === want));
      if (hit) return hit.index;
    }
    // no exact match: a single planet with the text as whole words of its name ("Calamari" for "Mon Calamari")
    const loose = all.filter(c => c.names.some(n => (' ' + n.name + ' ').includes(' ' + want + ' ')));
    return loose.length === 1 ? loose[0].index : -1;
  } catch {
    return -1;
  }
}

// The planet whose name is written in `text` around the character at `offset`; the longest name wins, a displayed
// name beats a type name, and a name inside a longer word is not a match.
export function planetAtOffset(game, text, offset) {
  try {
    const { text: flat, map } = foldMap(text);
    if (!flat) return -1;
    const at = Number.isInteger(offset) ? Math.max(0, Math.min(String(text).length, offset)) : -1;
    let best = null;
    for (const c of candidates(game))
      for (const { name, rank } of c.names) {
        for (let from = flat.indexOf(name); from >= 0; from = flat.indexOf(name, from + 1)) {
          const end = from + name.length;
          if (isWord(flat[from - 1]) || isWord(flat[end])) continue;
          const lo = map[from],
            hi = (map[end - 1] ?? lo) + 1;
          const hit = at < 0 || (at >= lo && at <= hi);
          if (!hit) continue;
          const score = [name.length, -rank, -c.index];
          if (!best || wins(score, best.score)) best = { index: c.index, score };
        }
      }
    return best ? best.index : -1;
  } catch {
    return -1;
  }
}
const wins = (a, b) => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k];
  return false;
};

// the text and character offset under a point: a native bitmap label keeps its text on the element, other text is
// read with the browser's caret lookup
export function textAt(el, x, y, doc = globalThis.document) {
  let native = el;
  while (native && !native._nativeLabel) native = native.parentElement;
  const n = native?._nativeLabel;
  if (native && n) {
    const text = String(n.text ?? ''),
      canvas = native.querySelector?.('canvas'),
      r = (canvas || native).getBoundingClientRect();
    const total = n.f?.bitmap?.measure?.(text, n.f.padding);
    if (!total || !r.width) return { text, offset: -1 };
    const target = Math.max(0, Math.min(1, (x - r.left) / r.width)) * total;
    let i = 0;
    while (i < text.length && n.f.bitmap.measure(text.slice(0, i + 1), n.f.padding) <= target) i++;
    return { text, offset: Math.min(i, Math.max(0, text.length - 1)) };
  }
  let node = null,
    offset = 0;
  const pos = doc?.caretPositionFromPoint?.(x, y);
  if (pos) ({ offsetNode: node, offset } = pos);
  else {
    const range = doc?.caretRangeFromPoint?.(x, y);
    if (range) ({ startContainer: node, startOffset: offset } = range);
  }
  if (node?.nodeType === 3) return { text: node.data, offset };
  return { text: el?.textContent || '', offset: -1 };
}

// The planet a double-click landed on: the planet name written under the pointer; failing that, the planet the entry
// itself carries (data-planet) when the click was on its place label or the position in the text could not be told.
export function planetFromEvent(game, e, read = textAt) {
  try {
    const el = e?.target;
    const { text, offset } = read(el, e.clientX, e.clientY) || {};
    const named = planetAtOffset(game, text, offset);
    if (named >= 0) return named;
    const tagged = el?.closest?.('[data-planet]');
    if (tagged && (tagged.dataset.planetLabel !== undefined || !(offset >= 0))) return valid(game, Number(tagged.dataset.planet));
    return -1;
  } catch {
    return -1;
  }
}

// double-click handler for a container of log text; returns a function that removes it
export function linkPlanets(root, game, read) {
  if (!root?.addEventListener) return () => {};
  const on = e => {
    const i = planetFromEvent(game, e, read);
    if (i >= 0 && game.focusPlanet?.(i)) {
      e.preventDefault?.();
      e.stopPropagation?.();
      globalThis.getSelection?.()?.removeAllRanges?.();
    }
  };
  root.addEventListener('dblclick', on);
  return () => root.removeEventListener('dblclick', on);
}

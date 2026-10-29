import { fetchBinary, fetchGameFile, findFiles, modInfo, modRank } from './vfs.js';
import { fontPolicy } from './fontpolicy.js';
import { fontInfo, fontFileFace } from './fontname.js';

const STYLES = ['Medium', 'Bold', 'Light', 'Stencil'];
const faces = new Map();
const originals = new Map();
let done = null;

async function fontFiles() {
  const list = await findFiles('^DATA\\\\FONTS\\\\[^\\\\]+\\.(TTF|OTF)$').catch(() => null);
  return list && list.length ? list.map(k => k.replace(/\\/g, '/')) : STYLES.map(s => `Data/Fonts/EmpireAtWar-${s}.ttf`);
}

export function loadGameFonts() {
  if (!done) done = (async () => {
    const files = (await Promise.all((await fontFiles()).map(async path => {
      try {
        const buf = await fetchBinary(path), info = buf && fontInfo(buf);
        return info ? { path, buf, info, rank: await modRank(path), mod: await modInfo(path) } : null;
      } catch { return null; }
    }))).filter(Boolean);
    const order = r => (r < 0 ? Infinity : r), claims = [];
    for (const f of files) [fontFileFace(f.path), f.info.full, f.info.family].forEach((name, kind) => name && claims.push({ f, name, kind }));
    claims.sort((a, b) => order(a.f.rank) - order(b.f.rank) || a.kind - b.kind);
    for (const { f, name } of claims) if (!faces.has(name.toUpperCase())) faces.set(name.toUpperCase(), { name, ...f });
    const ownSign = f => [true, 'true'].includes(f.mod && f.mod.includes_credit_symbol);
    const same = (a, b) => { if (a.byteLength !== b.byteLength) return false; const x = new Uint8Array(a), y = new Uint8Array(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
    await Promise.all(STYLES.map(async s => {
      const name = 'EmpireAtWar-' + s;
      try {
        const buf = await fetchGameFile(`Data/Fonts/Game/${name}.ttf`) || await fetchGameFile(`Data/Fonts/${name}.ttf`), info = buf && fontInfo(buf);
        if (!info) return;
        const face = new FontFace('swr-game-' + s, buf); await face.load(); document.fonts.add(face);
        originals.set(s, { name: 'swr-game-' + s, info, buf });
      } catch { }
    }));
    for (const e of faces.values()) if (originals.size && !ownSign(e) && ![...originals.values()].some(o => same(o.buf, e.buf))) e.credit = originals.get(creditStyle(e.name)) || originals.get('Medium') || [...originals.values()][0];
    const have = await Promise.all([...faces.values()].map(async e => {
      try {
        const face = new FontFace(e.name, e.buf); await face.load(); document.fonts.add(face);
        if (e.credit) { const sign = new FontFace(e.name, e.credit.buf, { unicodeRange: 'U+24' }); await sign.load(); document.fonts.add(sign); }
        return e.name;
      } catch { return null; }
    }));
    for (const e of [...faces.values(), ...originals.values()]) delete e.buf;
    if (faces.has('EMPIREATWAR-MEDIUM') || faces.has('EMPIREATWAR-BOLD')) document.body.classList.add('game-fonts');
    return have.filter(Boolean);
  })();
  return done;
}

export function modFace(name) {
  const e = faces.get((name || '').trim().toUpperCase());
  return e && e.rank >= 0 ? e : null;
}

function creditStyle(name) {
  const m = /^EmpireAtWar-(\w+)/i.exec(name), style = m && STYLES.find(s => s.toUpperCase() === m[1].toUpperCase());
  return style || (/bold|black|heavy/i.test(name) ? 'Bold' : 'Medium');
}

export function creditFont(name) {
  return faces.get(fontPolicy((name || '').trim()).face.toUpperCase())?.credit || null;
}

export function fontFamily(name) {
  const n = fontPolicy((name || '').trim()).face;
  const m = /^EmpireAtWar-(\w+)/i.exec(n);
  const FALL = '"Eurostile", "Bank Gothic", "Segoe UI", Arial, sans-serif';
  if (m) return `"EmpireAtWar-${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}", ${FALL}`;
  const own = faces.get(n.toUpperCase());
  if (own) return `${JSON.stringify(own.name)}, Arial, sans-serif`;
  if (/^arial unicode ms/i.test(n)) return '"Arial Unicode MS", Arial, Helvetica, sans-serif';
  if (/^arial black/i.test(n)) return '"Arial Black", Arial, sans-serif';
  if (/^arial/i.test(n)) return 'Arial, Helvetica, sans-serif';
  return n ? `${JSON.stringify(n)}, Arial, sans-serif` : 'Arial, sans-serif';
}

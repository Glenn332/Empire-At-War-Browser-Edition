import fs from 'node:fs';
import path from 'node:path';
import { languageName } from '../public/js/localizedmedia.js';
import { languageId } from '../public/js/language.js';

function megList(root, language) {
  const data = path.join(root, 'Data');
  const out = [];
  const xml = fs.readFileSync(path.join(data, 'megafiles.xml'), 'latin1');
  for (const m of xml.matchAll(/<File>\s*([^<]+?)\s*<\/File>/g)) out.push(m[1].replace(/\\/g, '/'));
  out.push('Data/Patch.meg', 'Data/Patch2.meg', 'Data/64Patch.meg');
  for (const f of ['sfx2d_non_localized', 'sfx3d_non_localized', 'sfx2d_' + languageName(language).toLowerCase()])
    out.push(`Data/Audio/SFX/${f}.meg`);
  return out;
}

function findCaseInsensitive(root, rel) {
  let cur = root;
  for (const part of rel.split('/')) {
    let hit;
    try {
      hit = fs.readdirSync(cur).find(e => e.toLowerCase() === part.toLowerCase());
    } catch {
      return null;
    }
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

export function openGame(gameDir, mods = [], { language = 0, expansion = true } = {}) {
  language = languageId(language) ?? 0;
  const languages = new Map();
  const layers = [];
  const index = new Map();
  const fds = new Map();

  function readMegIndex(file) {
    const entries = new Map(),
      fd = fds.get(file) ?? fs.openSync(file, 'r');
    fds.set(file, fd);
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    const nNames = head.readUInt32LE(0),
      nFiles = head.readUInt32LE(4);
    const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 64 + nNames * 300 + nFiles * 20));
    fs.readSync(fd, buf, 0, buf.length, 0);
    let p = 8;
    const names = [];
    for (let i = 0; i < nNames; i++) {
      const len = buf.readUInt16LE(p);
      p += 2;
      names.push(buf.toString('latin1', p, p + len));
      p += len;
    }
    for (let i = 0; i < nFiles; i++, p += 20) {
      entries.set(names[buf.readUInt32LE(p + 16)].toUpperCase(), {
        meg: file,
        off: buf.readUInt32LE(p + 12),
        size: buf.readUInt32LE(p + 8)
      });
    }
    return entries;
  }

  const apply = (target, entries) => {
    for (const [key, value] of entries)
      if (value) target.set(key, value);
      else target.delete(key);
  };
  const mount = entries => {
    layers.push({ entries });
    apply(index, entries);
  };
  function indexLoose(root, dir = 'Data', entries = new Map()) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) indexLoose(root, rel, entries);
      else if (!/\.meg$/i.test(e.name)) {
        const file = path.join(root, rel),
          size = fs.statSync(file).size,
          key = rel.replace(/\//g, '\\').toUpperCase();
        entries.set(key, size ? { file, size } : null);
      }
    }
    return entries;
  }

  for (const root of [path.join(gameDir, 'GameData'), ...(expansion ? [path.join(gameDir, 'corruption')] : [])]) {
    if (!fs.existsSync(path.join(root, 'Data', 'megafiles.xml'))) continue;
    const archives = megList(root, language);
    for (const [position, rel] of archives.entries()) {
      const f = findCaseInsensitive(root, rel);
      if (position === archives.length - 1) {
        const entries = f ? readMegIndex(f) : new Map();
        layers.push({ root, entries });
        apply(index, entries);
      } else if (f) mount(readMegIndex(f));
    }
    mount(indexLoose(root));
  }

  for (const root of mods) {
    const list = findCaseInsensitive(root, 'Data/megafiles.xml');
    if (list)
      for (const m of fs.readFileSync(list, 'latin1').matchAll(/<File>\s*([^<]+?)\s*<\/File>/g)) {
        const f = findCaseInsensitive(root, m[1].replace(/\\/g, '/'));
        if (f && !fds.has(f)) mount(readMegIndex(f));
      }
    mount(indexLoose(root, path.basename(findCaseInsensitive(root, 'Data') || 'Data')));
  }

  for (const root of expansion ? ['corruption', 'GameData'] : ['GameData']) {
    const exe = findCaseInsensitive(gameDir, root + '/StarWarsG.exe');
    if (!exe) continue;
    const d = fs.readFileSync(exe);
    for (let i = d.indexOf('\x00\x01\x00\x00', 0, 'latin1'); i >= 0; i = d.indexOf('\x00\x01\x00\x00', i + 4, 'latin1')) {
      const n = d.readUInt16BE(i + 4);
      if (n < 8 || n > 40 || i + 12 + n * 16 > d.length) continue;
      let end = 0,
        nameAt = 0,
        ok = true;
      for (let k = 0; k < n && ok; k++) {
        const o = i + 12 + k * 16,
          tag = d.toString('latin1', o, o + 4),
          off = d.readUInt32BE(o + 8),
          len = d.readUInt32BE(o + 12);
        if (!/^[ -~]{4}$/.test(tag) || i + off + len > d.length) ok = false;
        if (tag === 'name') nameAt = i + off;
        end = Math.max(end, off + len);
      }
      if (!ok || !nameAt) continue;
      let ps = '';
      const count = d.readUInt16BE(nameAt + 2),
        strings = nameAt + d.readUInt16BE(nameAt + 4);
      for (let k = 0; k < count && !ps; k++) {
        const o = nameAt + 6 + k * 12;
        if (d.readUInt16BE(o + 6) !== 6) continue;
        const raw = d.subarray(strings + d.readUInt16BE(o + 10), strings + d.readUInt16BE(o + 10) + d.readUInt16BE(o + 8));
        ps = d.readUInt16BE(o) === 1 ? raw.toString('latin1') : raw.toString('latin1').replace(/\0/g, '');
      }
      const fontKey = ('Data\\Fonts\\' + ps + '.ttf').toUpperCase();
      if (!/^EmpireAtWar-\w+$/.test(ps)) continue;
      if (!index.has(fontKey)) index.set(fontKey, { file: exe, off: i, size: end });
      index.set(('Data\\Fonts\\Game\\' + ps + '.ttf').toUpperCase(), { file: exe, off: i, size: end });
    }
    break;
  }

  const fonts = [...index].filter(([key, e]) => key.startsWith('DATA\\FONTS\\') && e.off !== undefined && e.file);
  function forLanguage(value) {
    const id = languageId(value) ?? 0;
    if (!languages.has(id)) {
      const selected = new Map();
      for (const layer of layers) {
        if (!layer.root) {
          apply(selected, layer.entries);
          continue;
        }
        const file = findCaseInsensitive(layer.root, `Data/Audio/SFX/sfx2d_${languageName(id).toLowerCase()}.meg`);
        if (file) apply(selected, readMegIndex(file));
      }
      for (const [key, font] of fonts) if (!selected.has(key)) selected.set(key, font);
      languages.set(id, view(selected));
    }
    return languages.get(id);
  }
  function view(index) {
    return {
      index,
      forLanguage,
      close() {
        for (const fd of fds.values()) fs.closeSync(fd);
        fds.clear();
        languages.clear();
      },
      resolve(key) {
        key = key.replace(/\//g, '\\').toUpperCase();
        if (index.has(key)) return key;
        if (key.endsWith('.TGA') && index.has(key.slice(0, -4) + '.DDS')) return key.slice(0, -4) + '.DDS';
        return null;
      },
      read(key) {
        const e = index.get(key);
        if (!e) return null;
        if (e.file && e.off !== undefined) {
          const fd = fs.openSync(e.file, 'r'),
            b = Buffer.allocUnsafe(e.size);
          fs.readSync(fd, b, 0, e.size, e.off);
          fs.closeSync(fd);
          return b;
        }
        if (e.file) return fs.readFileSync(e.file);
        const buf = Buffer.allocUnsafe(e.size);
        fs.readSync(fds.get(e.meg), buf, 0, e.size, e.off);
        return buf;
      },
      readPart(key, start, len) {
        const e = index.get(key);
        if (!e) return null;
        len = Math.max(0, Math.min(len, e.size - start));
        const buf = Buffer.allocUnsafe(len),
          at = (e.off || 0) + start;
        if (e.file) {
          const fd = fs.openSync(e.file, 'r');
          fs.readSync(fd, buf, 0, len, at);
          fs.closeSync(fd);
        } else fs.readSync(fds.get(e.meg), buf, 0, len, at);
        return buf;
      }
    };
  }
  const result = view(index);
  languages.set(language, result);
  return result;
}

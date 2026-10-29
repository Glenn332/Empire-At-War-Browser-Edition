export function fontInfo(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (d.length < 12) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), tag = dv.getUint32(0);
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;
  const tables = {}, n = dv.getUint16(4);
  for (let k = 0; k < n && 12 + k * 16 + 16 <= d.length; k++) {
    const o = 12 + k * 16;
    tables[String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3])] = dv.getUint32(o + 8);
  }
  if (tables.name === undefined) return null;
  const names = {}, at = tables.name, count = dv.getUint16(at + 2), strings = at + dv.getUint16(at + 4);
  for (const [want, english] of [[3, true], [3, false], [0, false], [1, false]]) for (let k = 0; k < count; k++) {
    const o = at + 6 + k * 12, platform = dv.getUint16(o), id = dv.getUint16(o + 6);
    if (platform !== want || (id !== 1 && id !== 4) || names[id]) continue;
    if (platform === 3 && (![0, 1, 10].includes(dv.getUint16(o + 2)) || (english && dv.getUint16(o + 4) !== 0x409))) continue;
    const len = dv.getUint16(o + 8), from = strings + dv.getUint16(o + 10);
    if (from + len > d.length) continue;
    let s = '';
    if (platform === 1) for (let i = 0; i < len; i++) s += String.fromCharCode(d[from + i]);
    else for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(dv.getUint16(from + i));
    if (s.trim()) names[id] = s.trim();
  }
  const os2 = tables['OS/2'], head = tables.head;
  return {
    family: names[1] || names[4] || '', full: names[4] || names[1] || '',
    unitsPerEm: head !== undefined ? dv.getUint16(head + 18) || 1000 : 1000,
    winAscent: os2 !== undefined ? dv.getUint16(os2 + 74) : 0, winDescent: os2 !== undefined ? dv.getUint16(os2 + 76) : 0,
    notdef: tables.hmtx !== undefined ? dv.getUint16(tables.hmtx) : 0,
  };
}

export const fontFileFace = path => path.replace(/^.*[\\/]/, '').replace(/\.(ttf|otf)$/i, '');

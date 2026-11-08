export function crc32(str) {
  let c,
    crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    c = (crc ^ str.charCodeAt(i)) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function scramble(crc) {
  const h = ((crc ^ 0xdeadbeef) & 0x7fffffff) >>> 0;
  let t = (h % 127773) * 16807 - Math.floor(h / 127773) * 2836;
  if (t < 0) t += 0x7fffffff;
  return t;
}

export class EngineHash {
  constructor() {
    this.buckets = 8;
    this.list = [];
    this.ids = new Map();
  }
  bucket(entry) {
    return entry.mix & (this.buckets - 1);
  }
  place(entry) {
    const b = this.bucket(entry),
      list = this.list;
    let lo = -1,
      hi = -1;
    for (let i = 0; i < list.length; i++)
      if (this.bucket(list[i]) === b) {
        if (lo < 0) lo = i;
        hi = i;
      } else if (lo >= 0) break;
    if (lo < 0) {
      list.push(entry);
      return;
    }
    let at = hi + 1;
    while (at > lo && list[at - 1].crc > entry.crc) at--;
    list.splice(at, 0, entry);
  }
  grow(size) {
    const old = this.buckets;
    let want = Math.max(8, size);
    if (old < 512 && old * 8 >= want) want = old * 8;
    let n = 1;
    while (n < want) n *= 2;
    this.buckets = n;
    const before = this.list;
    this.list = [];
    for (const entry of before) this.place(entry);
  }
  add(id, crc) {
    if (this.ids.has(id)) return false;
    const entry = { id, crc: crc >>> 0, mix: scramble(crc >>> 0) };
    if ((this.list.length + 1) / this.buckets > 1) this.grow(this.list.length + 1);
    this.place(entry);
    this.ids.set(id, entry);
    return true;
  }
  delete(id) {
    const entry = this.ids.get(id);
    if (!entry) return false;
    this.ids.delete(id);
    this.list.splice(this.list.indexOf(entry), 1);
    return true;
  }
  order() {
    return this.list.map(e => e.id);
  }
}

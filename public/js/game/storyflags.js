const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const flagKey = (name, limit) => {
  const bytes = new TextEncoder().encode(String(name || '').toUpperCase());
  let crc = 0xffffffff;
  for (const b of limit ? bytes.subarray(0, 31) : bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
export class StoryFlags {
  constructor(saved = []) {
    this.values = new Map(saved || []);
  }
  get(name) {
    return this.values.get(flagKey(name));
  }
  set(name, value) {
    this.values.set(flagKey(name, true), (parseInt(value, 10) || 0) | 0);
  }
  increment(name, amount) {
    const old = this.get(name);
    if (old === undefined) return false;
    this.values.set(flagKey(name), (old + (parseInt(amount, 10) || 0)) | 0);
    return true;
  }
  snapshot() {
    return [...this.values];
  }
}

import { ChunkReader, fetchBinary, fetchHead, findFiles } from './vfs.js';
import { db } from './gamedata.js';
import { loadTextureCanvas, decodeTGA } from './dds.js';

export function parseMapMarkerHeader(buffer) {
  const r = new ChunkReader(buffer),
    markers = [];
  for (const c of r.chunks()) {
    if (c.type === 2 && c.container)
      for (const child of r.chunks(c.start, c.end)) {
        if (child.type !== 0xb) continue;
        const m = { id: -1, crc: 0, type: null, x: 0, y: 0 };
        for (const k of r.minis(child)) {
          if (k.size !== 4) continue;
          if (k.type === 0xc) m.id = r.u32(k.start);
          else if (k.type === 0xd) m.crc = r.u32(k.start);
          else if (k.type === 0xe) m.x = r.f32(k.start);
          else if (k.type === 0xf) m.y = r.f32(k.start);
        }
        m.type = db.typesByCrc.get(m.crc) || null;
        if (m.id >= 0 && m.type && Number.isFinite(m.x) && Number.isFinite(m.y)) markers.push(m);
      }
    else if (c.type !== 0 && c.type !== 3) break;
  }
  return markers;
}

export function parseMapPlayers(buffer) {
  const dv = new DataView(buffer);
  if (dv.byteLength < 8 || dv.getUint32(0, true) !== 0) return null;
  const raw = dv.getUint32(4, true);
  if (raw & 0x80000000) return null;
  const end = Math.min(dv.byteLength, 8 + raw);
  for (let p = 8; p + 2 <= end; ) {
    const t = dv.getUint8(p),
      n = dv.getUint8(p + 1);
    if (t === 2 && n === 4 && p + 6 <= end) return dv.getInt32(p + 2, true);
    p += 2 + n;
  }
  return null;
}
export function parseMapHeader(buffer) {
  const h = { kind: -1, players: 1, f3: 0, textId: '', planet: '', tag: '', custom: 0 };
  const dv = new DataView(buffer);
  if (dv.byteLength < 8 || dv.getUint32(0, true) !== 0) return h;
  const end = Math.min(dv.byteLength, 8 + (dv.getUint32(4, true) & 0x7fffffff));
  const wide = (p, n) => {
    let s = '';
    for (let i = 0; i + 1 < n; i += 2) {
      const c = dv.getUint16(p + i, true);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  for (let p = 8; p + 2 <= end; ) {
    const t = dv.getUint8(p),
      n = dv.getUint8(p + 1),
      at = p + 2;
    if (at + n > end) break;
    if (n === 4 && t === 1) h.kind = dv.getInt32(at, true);
    else if (n === 4 && t === 2) h.players = dv.getInt32(at, true);
    else if (n === 4 && t === 3) h.f3 = dv.getInt32(at, true);
    else if (t === 8) h.textId = wide(at, n);
    else if (t === 9) h.planet = wide(at, n);
    else if (t === 10) h.tag = wide(at, n).toUpperCase();
    else if (t === 11 && n >= 1) h.custom = dv.getUint8(at);
    p = at + n;
  }
  return h;
}
const mapHeaders = new Map();
const mapDirs = new Map();
const mapPath = name => (mapDirs.get(String(name).toUpperCase()) || 'Data/Art/Maps/') + name;
export function loadMapHeader(name) {
  const key = name.toUpperCase();
  if (!mapHeaders.has(key))
    mapHeaders.set(
      key,
      fetchHead(mapPath(name), 4096)
        .then(b => (b ? parseMapHeader(b) : null))
        .catch(() => null)
    );
  return mapHeaders.get(key);
}
const listed = new Map();
export async function skirmishMaps() {
  const names = list => list.map(n => n.split('\\').pop());
  const art = names(await findFiles('ART\\\\MAPS\\\\[^\\\\]*\\.TED$').catch(() => []));
  const own = names(await findFiles('^DATA\\\\CUSTOMMAPS\\\\[^\\\\]*\\.TED$').catch(() => [])).filter(
    f => !art.some(a => a.toUpperCase() === f.toUpperCase())
  );
  for (const f of own) mapDirs.set(f.toUpperCase(), 'Data/CustomMaps/');
  const files = [...art, ...own];
  const heads = await Promise.all(files.map(loadMapHeader));
  const out = { space: [], land: [], custom: { space: [], land: [] } };
  files.forEach((f, i) => {
    const h = heads[i];
    if (!h || h.players < 2 || h.f3 < 0 || (i >= art.length && h.custom !== 1)) return;
    const into = h.custom === 1 ? out.custom : h.custom === 0 ? out : null;
    if (!into) return;
    if (h.kind === 2) into.space.push(f);
    else if (h.kind === 1) into.land.push(f);
    else return;
    listed.set(f.toUpperCase(), h);
  });
  return out;
}
export const mapHeader = name => listed.get(String(name).toUpperCase()) || null;
export const controlMap = name => !!mapHeader(name)?.tag.includes('CONTROL');
export function mapTitle(name) {
  const h = mapHeader(name),
    s = h && h.textId ? db.text.get(h.textId.trim().toUpperCase()) : null;
  return (
    s ||
    String(name)
      .replace(/^_MP_(SPACE|LAND)_/i, '')
      .replace(/\.TED$/i, '')
      .replace(/_/g, ' ')
  );
}
const mapPlayerCounts = new Map();
export function loadMapPlayers(name) {
  const key = name.toUpperCase();
  if (!mapPlayerCounts.has(key))
    mapPlayerCounts.set(
      key,
      fetchHead(mapPath(name), 4096)
        .then(b => (b ? parseMapPlayers(b) : null))
        .catch(() => null)
    );
  return mapPlayerCounts.get(key);
}

export async function loadMapPicture(name) {
  const at = async (off, end) => {
    const b = await fetchHead(mapPath(name), end);
    return b && b.byteLength >= end ? b : null;
  };
  for (let off = 0, i = 0; i < 8; i++) {
    const b = await at(off, off + 8);
    if (!b) return null;
    const dv = new DataView(b),
      type = dv.getUint32(off, true),
      size = dv.getUint32(off + 4, true) & 0x7fffffff;
    if (type === 0x13) {
      const all = await at(off, off + 8 + size);
      return all ? all.slice(off + 8, off + 8 + size) : null;
    }
    if (type === 1) return null;
    off += 8 + size;
  }
  return null;
}

const markerHeaders = new Map();
export function parseMapLayoutHeader(buffer) {
  const markers = parseMapMarkerHeader(buffer),
    r = new ChunkReader(buffer);
  let extent = 0;
  for (const root of r.chunks())
    if (root.type === 1 && root.container)
      for (const c of r.chunks(root.start, root.end)) {
        if (c.type !== 0x101 || !c.container) continue;
        for (const child of r.chunks(c.start, c.end))
          if (child.type === 0 && !child.container) {
            for (const k of r.minis(child)) if (k.type === 0 && k.size === 4) extent = r.u32(k.start) * 20;
            break;
          }
      }
  return { markers, extent };
}

export function loadMapLayoutHeader(name) {
  const key = name.toUpperCase();
  if (!markerHeaders.has(key))
    markerHeaders.set(
      key,
      fetchBinary(mapPath(name)).then(b => (b ? parseMapLayoutHeader(b) : { markers: [], extent: 0 }))
    );
  return markerHeaders.get(key);
}

function utf16(r, start, size) {
  let s = '';
  for (let i = 0; i + 1 < size; i += 2) {
    const c = r.dv.getUint16(start + i, true);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function lightDir(zAngle, tilt) {
  return [Math.cos(tilt) * Math.cos(zAngle), Math.cos(tilt) * Math.sin(zAngle), Math.sin(tilt)];
}

function parseEnvironment(r, c) {
  const m = new Map();
  const strings = [];
  for (const k of r.minis(c)) {
    m.set(k.type, k);
    if (k.size > 3 && k.size !== 4 && k.size !== 12) strings.push(r.str(k.start, k.start + k.size));
  }
  const v3 = id => (m.has(id) && m.get(id).size === 12 ? r.vec(m.get(id).start, 3) : null);
  const f = (id, d) => (m.has(id) && m.get(id).size === 4 ? r.f32(m.get(id).start) : d);
  const name = m.get(0x14);
  const env = { name: name ? r.str(name.start, name.start + name.size) : '', lights: [], ambient: v3(4) || [0, 0, 0], skydomes: [] };
  env.fog = { on: m.has(16) && r.dv.getUint8(m.get(16).start) !== 0, start: f(17, 0), end: f(18, 0), color: v3(15) || [0.8, 0.8, 0.8] };
  env.weather = m.has(41) ? r.str(m.get(41).start, m.get(41).start + m.get(41).size) : '';
  for (let i = 0; i < 3; i++) {
    const color = v3(i) || [1, 1, 1],
      intensity = f(5 + i, 0.5);
    const yaw = f(8 + i, 0),
      pitch = f(11 + i, 0.7);
    env.lights.push({
      color: color.map(x => x * intensity),
      dir: lightDir(yaw, pitch),
      intensity,
      specular: i === 0 ? v3(3) || [1, 1, 1] : [1, 1, 1],
      nativeDir: [Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)]
    });
  }
  for (const s of strings) if (db.type(s)?.has('Space_Model_Name')) env.skydomes.push(db.type(s));
  env.skyAngles = {};
  for (const [name, x, z] of [
    [25, 29, 31],
    [26, 30, 32]
  ]) {
    const k = m.get(name);
    if (k && k.size > 1) env.skyAngles[r.str(k.start, k.start + k.size).toUpperCase()] = [f(x, 0), f(z, 0)];
  }
  env.landSkies = strings.map(s => db.type(s)).filter(t => t && !t.has('Space_Model_Name') && t.has('Land_Model_Name'));
  return env;
}

export function parseTED(buffer) {
  const r = new ChunkReader(buffer);
  const map = {
    textId: '',
    planet: '',
    objects: [],
    environment: null,
    terrain: null,
    min: [-5000, -5000],
    max: [5000, 5000],
    playMin: null,
    playMax: null
  };
  const visit = (start, end, depth) => {
    for (const c of r.chunks(start, end)) {
      if (depth === 0 && c.type === 0 && !c.container) {
        for (const k of r.minis(c)) {
          if (k.type === 8) map.textId = utf16(r, k.start, k.size);
          else if (k.type === 9) map.planet = utf16(r, k.start, k.size);
        }
      } else if (c.type === 0x103 && !c.container) {
        for (const k of r.minis(c)) {
          if (k.size !== 12) continue;
          const v = r.vec(k.start, 2);
          if (k.type === 4) map.min = v;
          else if (k.type === 5) map.max = v;
          else if (k.type === 7) map.playMin = v;
          else if (k.type === 8) map.playMax = v;
          if (k.type === 5) landMin = v;
          else if (k.type === 6) landMax = v;
        }
      } else if (c.type === 0x06 && !c.container && depth >= 2 && c.end - c.start > 100) {
        envs.push(parseEnvironment(r, c));
        if (!map.environment) map.environment = envs[0];
      } else if (c.type === 0x08 && !c.container && depth === 2 && activeEnv < 0) {
        for (const k of r.minis(c)) if (k.type === 37 && k.size === 4) activeEnv = r.dv.getInt32(k.start, true);
      } else if (c.type === 0x101 && c.container && depth === 1) {
        map.terrain = parseTerrain(r, c);
      } else if (c.type === 0x10a && !c.container && depth === 1) {
        passability = c;
      } else if (c.type === 0x10b && c.container && depth === 1) {
        map.zones = parseZones(r, c);
      } else if (c.type === 0x44c && c.container) {
        const o = parseObject(r, c);
        if (o) map.objects.push(o);
      } else if (c.container) visit(c.start, c.end, depth + 1);
    }
  };
  let passability = null,
    landMin = null,
    landMax = null,
    activeEnv = -1;
  const envs = [];
  visit(0, buffer.byteLength, 0);
  if (map.terrain && passability && passability.end - passability.start >= map.terrain.size ** 2 * 4) {
    const n = map.terrain.size,
      raw = new Uint32Array(buffer.slice(passability.start, passability.start + n * n * 4)),
      grid = new Uint32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) grid[y * n + x] = raw[x * n + y];
    map.terrain.passability = grid;
  }
  if (map.terrain && envs[activeEnv]) map.environment = envs[activeEnv];
  map.environments = envs;
  map.activeEnvironment = envs.indexOf(map.environment);
  if (map.terrain) {
    const side = (map.terrain.size - 1) * 20;
    map.min = [0, 0];
    map.max = [side, side];
    map.playMin = landMin || map.min;
    map.playMax = landMax || map.max;
  }
  map.playMin ??= map.min;
  map.playMax ??= map.max;
  return map;
}

function parseZones(r, c) {
  const dv = r.dv,
    zones = [],
    ids = new Map();
  const text = k => {
    let t = '';
    for (let i = 0; i < k.size; i++) {
      const ch = dv.getUint8(k.start + i);
      if (!ch) break;
      t += String.fromCharCode(ch);
    }
    return t;
  };
  for (const z of r.chunks(c.start, c.end)) {
    if (z.type !== 0 || !z.container) continue;
    const o = { index: zones.length, name: '', x: 0, y: 0, z: 0, cells: new Uint32Array(0), props: {}, links: [] };
    let id = -1,
      prop = null;
    for (const k of r.chunks(z.start, z.end)) {
      if (k.type === 0 && !k.container) {
        for (const m of r.minis(k)) {
          if (m.type === 1) o.name = text(m);
          else if (m.type === 2 && m.size >= 4) id = dv.getUint32(m.start, true);
          else if (m.type === 5 && m.size >= 12) {
            o.x = dv.getFloat32(m.start, true);
            o.y = dv.getFloat32(m.start + 4, true);
            o.z = dv.getFloat32(m.start + 8, true);
          } else if (m.type === 8) prop = text(m);
          else if (m.type === 9 && prop !== null && m.size >= 4) {
            o.props[prop] = dv.getInt32(m.start, true);
            prop = null;
          } else if (m.type === 0xd && m.size >= 4) o.index = dv.getInt32(m.start, true);
        }
      } else if (k.type === 7 && k.container) {
        const cells = [];
        for (const cell of r.chunks(k.start, k.end))
          for (const m of r.minis(cell)) if (m.type === 1 && m.size >= 4) cells.push(dv.getUint32(m.start, true));
        o.cells = Uint32Array.from(cells);
      } else if (k.type === 0xe && k.container) {
        for (const l of r.chunks(k.start, k.end)) {
          const e = { id: -1, flags: 0 };
          for (const m of r.minis(l)) {
            if (m.type === 1 && m.size >= 4) e.id = dv.getUint32(m.start, true);
            else if (m.type === 2 && m.size >= 4) e.flags = dv.getUint32(m.start, true);
          }
          o.links.push(e);
        }
      }
    }
    ids.set(id, o);
    zones.push(o);
  }
  for (const o of zones)
    o.links = o.links.map(l => ({ to: ids.get(l.id) ? ids.get(l.id).index : -1, flags: l.flags })).filter(l => l.to >= 0);
  return zones;
}

function parseTerrain(r, c) {
  const t = { size: 0, heights: null, layerIndex: null, shade: null, layers: [], water: null, passability: null };
  let grid = null;
  const ripples = [];
  for (const k of r.chunks(c.start, c.end)) {
    if (k.type === 0 && !k.container) {
      const head = new Map();
      for (const m of r.minis(k)) head.set(m.type, m);
      if (head.has(0)) t.size = r.dv.getUint32(head.get(0).start, true);
      const str = id => (head.has(id) ? r.str(head.get(id).start, head.get(id).start + head.get(id).size) : '');
      const f = (id, d) => (head.has(id) && head.get(id).size === 4 ? r.f32(head.get(id).start) : d);
      const mode = head.has(22) ? r.dv.getUint32(head.get(22).start, true) : 0,
        v3 = id => (head.has(id) && head.get(id).size === 12 ? r.vec(head.get(id).start, 3) : [1, 1, 1]);
      t.water = {
        mode,
        on: mode === 1,
        level: f(21, 0),
        reflect: f(23, 0.5),
        bend: f(24, 0.5),
        tint: v3(26),
        glint: v3(27),
        textures: [str(29), str(30), head.has(31) && head.get(31).size > 4 ? str(31) : ''],
        fade: f(33, 10),
        least: f(34, 0),
        ripples: []
      };
      t.clouds = {
        texture: str(14),
        tile: f(15, 500),
        drift: head.has(16) && head.get(16).size === 12 ? r.vec(head.get(16).start, 3) : [5, 5, 0]
      };
    } else if ((k.type === 7 || k.type === 8) && k.container) {
      for (const l of r.chunks(k.start, k.end)) {
        const m = new Map();
        for (const x of r.minis(l)) m.set(x.type, x);
        const f = (id, d) => (m.has(id) && m.get(id).size === 4 ? r.f32(m.get(id).start) : d);
        ripples.push({ tile: f(0, 150), turn: f(1, 0), speed: f(2, 0.05), heading: f(3, 0) });
      }
    } else if (k.type === 5 && !k.container) grid = k;
    else if (k.type === 2 && k.container) {
      for (const l of r.chunks(k.start, k.end)) {
        if (l.type !== 3) continue;
        const L = { texture: '', bump: '', tile: 215, shininess: 64, turn: 0, tilt: 0, diffuse: [1, 1, 1], specular: [1, 1, 1], kind: 0 };
        for (const m of r.minis(l)) {
          if (m.type === 6 && m.size === 4) L.shininess = r.f32(m.start);
          else if (m.type === 7 && m.size === 4) L.tile = r.f32(m.start);
          else if (m.type === 8 && m.size === 4) L.turn = r.f32(m.start);
          else if (m.type === 9 && m.size === 4) L.tilt = r.f32(m.start);
          else if (m.type === 10 && m.size === 12) L.diffuse = r.vec(m.start, 3);
          else if (m.type === 11 && m.size === 12) L.specular = r.vec(m.start, 3);
          else if (m.type === 20 && m.size === 4) L.kind = r.dv.getUint32(m.start, true);
          else if (m.type === 12) L.texture = r.str(m.start, m.start + m.size);
          else if (m.type === 19) L.bump = r.str(m.start, m.start + m.size);
          else if (m.type === 35 && m.size >= 1) L.hole = r.dv.getUint8(m.start) !== 0;
        }
        t.layers.push(L);
      }
    }
  }
  if (t.water) t.water.ripples = ripples;
  const n = t.size;
  if (!grid || !n || grid.end - grid.start < n * n * 4) return null;
  t.heights = new Float32Array(n * n);
  t.layerIndex = new Uint8Array(n * n);
  t.shade = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const p = grid.start + i * 4;
    t.heights[i] = (r.dv.getInt16(p, true) * 25) / 512;
    t.layerIndex[i] = r.dv.getUint8(p + 2);
    t.shade[i] = r.dv.getUint8(p + 3);
  }
  if (!t.shade.some(s => s !== 0 && s !== 255)) t.shade.fill(254);
  return t;
}

function parseObject(r, c) {
  let hint = '';
  for (const a of r.chunks(c.start, c.end)) {
    if (a.type !== 0x482) continue;
    for (const b of r.chunks(a.start, a.end))
      for (const k of r.minis(b))
        if (k.type === 1 && k.size > 1) {
          let s = '';
          for (let i = 0; i < k.size; i++) {
            const ch = r.dv.getUint8(k.start + i);
            if (!ch) break;
            s += String.fromCharCode(ch);
          }
          hint = s;
        }
  }
  for (const a of r.chunks(c.start, c.end)) {
    if (a.type !== 0x459) continue;
    for (const b of r.chunks(a.start, a.end)) {
      if (b.type !== 0x4b0) continue;
      const o = { id: 0, crc: 0, owner: -1, type: null, pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, hint };
      for (const k of r.minis(b)) {
        if (k.type === 0) o.id = r.u32(k.start);
        else if (k.type === 1) o.crc = r.u32(k.start);
        else if (k.type === 2) o.owner = r.dv.getInt32(k.start, true);
        else if (k.type === 3) o.scale = r.f32(k.start);
        else if (k.type === 4) o.pos = r.vec(k.start, 3);
        else if (k.type === 5) o.rot = r.vec(k.start, 3);
      }
      o.type = db.typesByCrc.get(o.crc) || null;
      return o.type ? o : null;
    }
  }
  return null;
}

export const environmentRoll = seed => (Math.imul((seed >>> 0) ^ 0x5bd1e995, 2654435761) >>> 0) / 4294967296;
export function pickEnvironment(map, r) {
  const envs = map.environments || [],
    n = envs.length;
  if (n < 2) return;
  let i = Math.min(n - 1, Math.floor(r * n));
  if (envs[i].name === 'Cinematic') i++;
  if (i >= n) i = 0;
  map.environment = envs[i];
  map.activeEnvironment = i;
}

export async function loadMap(name) {
  const buf = await fetchBinary(mapPath(name));
  if (!buf) throw new Error('map not found: ' + name);
  const map = parseTED(buf);
  map.file = name;
  return map;
}

export async function loadMapPreview(name) {
  const loose = await loadTextureCanvas(name.replace(/\.TED$/i, '.tga')).catch(() => null);
  if (loose) return loose;
  const buf = await loadMapPicture(name);
  if (!buf) return null;
  const p = decodeTGA(buf),
    cv = document.createElement('canvas');
  cv.width = p.width;
  cv.height = p.height;
  cv.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(p.data.buffer, p.data.byteOffset, p.width * p.height * 4), p.width, p.height),
    0,
    0
  );
  return cv;
}

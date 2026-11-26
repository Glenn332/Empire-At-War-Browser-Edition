import { fetchText } from '../vfs.js';
import { loadTextureCanvas } from '../dds.js';

let defs = null;
const DEFAULT = { texture: 'DEFAULTPOINTER_00.TGA', x: 0, y: 0, delay: 5 };
const made = new Map();

async function readDefs() {
  const out = new Map();
  const list = (await fetchText('Data/XML/MousePointerFiles.xml').catch(() => null)) || '<File>MousePointers.xml</File>';
  for (const m of list.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<File>\s*([^<]+?)\s*<\/File>/gi)) {
    const xml = await fetchText('Data/XML/' + m[1]).catch(() => null);
    if (!xml) continue;
    for (const p of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<MousePointer\s+Name="([^"]+)"\s*>([\s\S]*?)<\/MousePointer>/gi)) {
      const tag = t => {
        const r = new RegExp('<' + t + '>\\s*([^<]*?)\\s*</' + t + '>', 'i').exec(p[2]);
        return r ? r[1] : '';
      };
      const delay = tag('Anim_Frame_Delay');
      out.set(p[1].toUpperCase(), {
        texture: tag('Base_Texture') || DEFAULT.texture,
        x: +tag('Hot_X') || 0,
        y: +tag('Hot_Y') || 0,
        delay: delay === '' ? DEFAULT.delay : +delay || 0
      });
    }
  }
  return out;
}

// Each frame is decoded into an image the page keeps, before the pointer is used: a cursor whose url the browser
// still has to load shows the fallback system arrow meanwhile, so swapping animation frames that were not ready
// flashed the normal pointer between the attack pointer frames.
async function ready(url) {
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {}
  return img;
}

// The frame number is the two digits at the end of the texture name (ATTACKPOINTER_00 is followed by _01, _02 ...).
export function pointerFrameName(base, i) {
  const m = /^(.*)(\d\d)$/.exec(base);
  return m ? m[1] + String(i).padStart(2, '0') : i ? null : base;
}

const loaded = new Map();
export async function pointer(name) {
  const key = String(name).toUpperCase();
  if (made.has(key)) return made.get(key);
  const job = (async () => {
    defs ||= readDefs();
    const d = (await defs).get(key) || DEFAULT;
    const base = d.texture.replace(/\.\w+$/, '');
    const urls = [];
    for (let i = 0; i < 100; i++) {
      const file = pointerFrameName(base, i);
      if (!file) break;
      const cv = await loadTextureCanvas(file).catch(() => null);
      if (!cv) break;
      urls.push(cv.toDataURL());
    }
    if (!urls.length) return null;
    const images = await Promise.all(urls.map(ready));
    return { frames: urls.map(u => `url(${u}) ${d.x} ${d.y}, default`), images, delay: ((d.delay + 1) * 1000) / 60 };
  })();
  made.set(key, job);
  job.then(
    p => loaded.set(key, p),
    () => loaded.set(key, null)
  );
  return job;
}

export class Pointers {
  constructor(el) {
    this.el = el;
    this.name = null;
    this.timer = null;
  }
  // Sets the pointer at once when it is loaded; the first use of a pointer waits for its frames.
  set(name) {
    if (name === this.name || !this.el?.style) return;
    this.name = name;
    clearInterval(this.timer);
    this.timer = null;
    if (!name) {
      this.el.style.cursor = '';
      return;
    }
    const key = String(name).toUpperCase();
    if (loaded.has(key)) return this.show(loaded.get(key));
    return pointer(name).then(p => {
      if (this.name === name) this.show(p);
    });
  }
  show(p) {
    if (!p) {
      this.el.style.cursor = '';
      return;
    }
    let i = 0;
    this.el.style.cursor = p.frames[0];
    if (p.frames.length > 1)
      this.timer = setInterval(() => {
        i = (i + 1) % p.frames.length;
        this.el.style.cursor = p.frames[i];
      }, p.delay);
  }
}

export function tacticalPointer(f) {
  if (f.turning) return 'POINTER_MAP_ROTATING_MODE';
  if (f.direct) return f.direct === 'in' ? 'POINTER_ATTACK' : 'POINTER_NORMAL';
  if (f.box) return 'POINTER_DRAG_SELECT_MODE';
  const a = f.armed;
  if (a && a.startsWith('ability:'))
    return (
      'POINTER_TARGET_SPECIAL_ABILITY_TO_' +
      (f.hover === 'enemy' ? 'ENEMY_OBJECT' : f.hover === 'own' ? 'FRIENDLY_OBJECT' : f.land ? 'PASSABLE_TERRAIN' : 'SPACE_POSITION')
    );
  if (a === 'bombing') return 'POINTER_BOMBING_RUN_TARGET';
  if (a === 'beacon') return 'POINTER_PLACE_BEACON';
  if (a === 'orbital') return 'POINTER_NORMAL';
  if (a === 'attackmove') return 'POINTER_ATTACK_MOVE';
  if (a === 'waypoint') return 'POINTER_WAYPOINT_PLACEMENT';
  if (a === 'guard') return 'POINTER_GUARD';
  if (a === 'move') return 'POINTER_MOVE';
  if (a === 'attack') return f.hover === 'enemy' ? 'POINTER_ATTACK' : 'POINTER_CANT_ATTACK';
  if (f.placing) return 'POINTER_REINFORCEMENTS_LANDING_POINT';
  if (f.garrison === 'out') return 'POINTER_GARRISON_OUT';
  if (f.garrison === 'in') return 'POINTER_GARRISON_IN';
  if (f.hover === 'enemy' && f.attack) return 'POINTER_ATTACK';
  if (f.hover) return 'POINTER_SELECT';
  if (f.act) return f.force && f.attack ? 'POINTER_ATTACK_MOVE' : 'POINTER_MOVE';
  return 'POINTER_NORMAL';
}

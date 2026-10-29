import { fetchText, fetchBinary } from './vfs.js';
import { parseXML } from './xml.js';
import { languageId, resolveLanguageText, setActiveLanguage, activeLanguage, refreshLanguageViews } from './language.js';

const XML = 'Data/XML/';

let sealed = false;
const typeNames = new Map(),
  factionNames = new Map();
function sealedLookup(names, map, name) {
  if (!sealed) return map.get(name.trim().toUpperCase());
  let v = names.get(name);
  if (v === undefined && !names.has(name)) {
    v = map.get(name.trim().toUpperCase());
    if (names.size < 50000) names.set(name, v);
  }
  return v;
}
const baseLevelKeys = new Set(['Required_Ground_Base_Level', 'Required_Star_Base_Level']);

export class ObjType {
  constructor(tag, name) {
    this.tag = tag;
    this.name = name;
    this.props = new Map();
    this.subs = new Map();
    this.parent = null;
  }
  raw(k) {
    if (sealed) {
      let c = this._raw || (this._raw = new Map());
      let v = c.get(k);
      if (v === undefined) {
        v = this.lookup(k) || null;
        c.set(k, v);
      }
      return v || undefined;
    }
    return this.lookup(k);
  }
  lookup(k) {
    const v = this.props.get(k.toLowerCase());
    if (v) return v;
    return this.parent ? this.parent.lookup(k) : undefined;
  }
  has(k) {
    const v = this.raw(k);
    return !!v && v.some(s => s !== '');
  }
  baseLevels() {
    if (this._levels) return this._levels;
    const n = k => {
      const v = parseFloat(this.str(k));
      return Number.isFinite(v) ? v : NaN;
    };
    let ground = n('Required_Ground_Base_Level'),
      star = n('Required_Star_Base_Level');
    const cost = n('Build_Cost_Credits'),
      structure = this.str('Behavior')
        .split(/[\s,]+/)
        .some(b => b.toUpperCase() === 'DUMMY_GROUND_STRUCTURE');
    const named = /^(yes|true|1)$/i.test(this.str('Is_Named_Hero').trim());
    if (!(n('Base_Level') > 0) && (cost > 0 || cost === -1) && !named && !structure) {
      if (!(ground > 0) && !(star > 0)) ground = 1;
      else if (ground > 0) star = 0;
    }
    return (this._levels = { Required_Ground_Base_Level: ground, Required_Star_Base_Level: star });
  }
  str(k, def = '') {
    const v = this.raw(k);
    return v && v.length ? v[v.length - 1] : def;
  }
  num(k, def = 0) {
    if (sealed) {
      const c = this._num || (this._num = new Map());
      let v = c.get(k);
      if (v === undefined) {
        v = baseLevelKeys.has(k) ? this.baseLevels()[k] : parseFloat(this.str(k));
        c.set(k, v);
      }
      return Number.isFinite(v) ? v : def;
    }
    const v = parseFloat(this.str(k));
    return Number.isFinite(v) ? v : def;
  }
  bool(k, def = false) {
    if (sealed) {
      const c = this._bool || (this._bool = new Map());
      let v = c.get(k);
      if (v === undefined) {
        v = this.str(k).toLowerCase();
        c.set(k, v);
      }
      if (!v) return def;
      return v === 'yes' || v === 'true' || v === '1';
    }
    const v = this.str(k).toLowerCase();
    if (!v) return def;
    return v === 'yes' || v === 'true' || v === '1';
  }
  list(k) {
    if (sealed) {
      const c = this._list || (this._list = new Map());
      let v = c.get(k);
      if (v === undefined) {
        const r = this.raw(k);
        v = r ? r.flatMap(s => s.split(/[\s,|]+/)).filter(Boolean) : [];
        c.set(k, v);
      }
      return v.slice();
    }
    const v = this.raw(k);
    if (!v) return [];
    return v.flatMap(s => s.split(/[\s,|]+/)).filter(Boolean);
  }
  tuples(k) {
    const v = this.raw(k);
    if (!v) return [];
    return v
      .map(s =>
        s
          .split(',')
          .map(x => x.trim())
          .filter(x => x !== '')
      )
      .filter(t => t.length);
  }
  vec(k, def = [0, 0, 0]) {
    const v = this.str(k);
    if (!v) return def;
    const n = v
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(parseFloat);
    return n.length ? n : def;
  }
  sub(k) {
    const v = this.subs.get(k.toLowerCase());
    if (v) return v;
    return this.parent ? this.parent.sub(k) : [];
  }
  behaviors() {
    if (!this._beh) this._beh = new Set([...this.list('Behavior'), ...this.list('SpaceBehavior')].map(s => s.toUpperCase()));
    return this._beh;
  }
  categories() {
    if (!this._cat) this._cat = new Set(this.list('CategoryMask').map(s => s.toUpperCase()));
    return this._cat;
  }
}

function crc32(str) {
  let c,
    crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    c = (crc ^ str.charCodeAt(i)) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export const SPAWN_TIERS = 6;
const tierRows = (type, prefix, tech) => {
  if (!(tech >= 0 && tech < SPAWN_TIERS)) return [];
  for (let n = Math.floor(tech); n >= 0; n--) {
    const rows = type.tuples(prefix + n);
    if (rows.length) return rows;
  }
  return [];
};
const pairs = rows =>
  rows.flatMap(row => {
    const out = [];
    for (let i = 0; i + 1 < row.length; i += 2) out.push([row[i], parseInt(row[i + 1], 10)]);
    return out;
  });
export function spawnList(type, tech) {
  const reserves = pairs(tierRows(type, 'Reserve_Spawned_Units_Tech_', tech)),
    out = [];
  for (const [name, n] of pairs(tierRows(type, 'Starting_Spawned_Units_Tech_', tech))) {
    const t = db.type(name);
    if (!t) continue;
    const start = Number.isFinite(n) ? n : 1,
      r = reserves.find(e => e[0].toUpperCase() === name.toUpperCase()),
      reserve = r && Number.isFinite(r[1]) ? r[1] : 0;
    out.push({ type: t, start, remaining: reserve < 0 ? -1 : reserve + start });
  }
  return out;
}

export function skirmishStation(faction, marker = null) {
  const m = marker || db.type('Team_00_Space_Station');
  const f = (faction || '').toUpperCase();
  for (const n of m ? m.list('Marker_For_Specific_Object_Type') : []) {
    const t = db.type(n);
    if (t && t.list('Affiliation').some(a => a.toUpperCase() === f)) return t;
  }
  return null;
}

export function factionColor(name) {
  const f = db.faction(name),
    m = f && /(\d+)\D+(\d+)\D+(\d+)/.exec(f.str('Color'));
  return m ? '#' + [1, 2, 3].map(i => Math.min(255, +m[i]).toString(16).padStart(2, '0')).join('') : null;
}

export function autoColors(players, teamFactions, palette) {
  const used = new Set(players.filter(p => !p.auto && p.color).map(p => String(p.color).toLowerCase()));
  for (const p of players) {
    if (!p.auto && p.color) continue;
    const own = factionColor(teamFactions[p.team]);
    p.color = own && !used.has(own) ? own : palette.find(c => !used.has(c.toLowerCase())) || p.color || palette[0];
    used.add(String(p.color).toLowerCase());
  }
  return players;
}

export function skirmishFactions() {
  const marked = !!db.type('Team_00_Space_Station');
  return [...db.factions.values()]
    .filter(f => /^(yes|true)$/i.test(f.str('Is_Playable')) && (!marked || skirmishStation(f.name)))
    .map(f => f.name);
}

export const db = {
  types: new Map(),
  typesByCrc: new Map(),
  hardpoints: new Map(),
  factions: new Map(),
  constants: null,
  armorMod: new Map(),
  sfx: new Map(),
  music: new Map(),
  text: new Map(),
  type(name) {
    return name ? sealedLookup(typeNames, this.types, name) : undefined;
  },
  hardpoint(name) {
    return name ? this.hardpoints.get(name.trim().toUpperCase()) : undefined;
  },
  faction(name) {
    return name ? sealedLookup(factionNames, this.factions, name) : undefined;
  },
  t(id) {
    if (!id) return '';
    const s = this.text.get(id.trim().toUpperCase());
    return s ?? id.replace(/^TEXT_/, '').replace(/_/g, ' ');
  },
  damageMod(damageType, armorType) {
    const v = this.armorMod.get((damageType + '|' + armorType).toUpperCase());
    return v === undefined ? 1 : v;
  }
};

function readObjects(root, into, pendingVariants) {
  for (const top of root.children) {
    for (const node of top.children) {
      const name = node.attrs.Name;
      if (!name) continue;
      const t = new ObjType(node.tag, name);
      for (const c of node.children) {
        const key = c.tag.toLowerCase();
        if (c.children.length) {
          let arr = t.subs.get(key);
          if (!arr) t.subs.set(key, (arr = []));
          arr.push(c);
        } else {
          let arr = t.props.get(key);
          if (!arr) t.props.set(key, (arr = []));
          arr.push(c.text.trim());
        }
      }
      into.set(name.toUpperCase(), t);
      if (pendingVariants && t.props.has('variant_of_existing_type')) pendingVariants.push(t);
    }
  }
}

export async function loadFileList(manifest) {
  const txt = await fetchText(XML + manifest);
  if (!txt) return [];
  const out = [];
  const walk = n => {
    for (const c of n.children) {
      if (c.tag.toLowerCase() === 'file') out.push(c.text.trim());
      else walk(c);
    }
  };
  walk(parseXML(txt));
  return out;
}

async function loadText(language) {
  if (language === undefined) language = new URLSearchParams(globalThis.location?.search || '').get('language');
  const resolved = await resolveLanguageText(fetchBinary, language);
  applyText(resolved);
}

function parseText(buf) {
  const text = new Map();
  if (!buf) return text;
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  if (n > Math.floor((buf.byteLength - 4) / 12)) throw new Error('Truncated text DAT index');
  let vp = 4 + n * 12;
  const lens = [];
  for (let i = 0; i < n; i++) lens.push([dv.getUint32(8 + i * 12, true), dv.getUint32(12 + i * 12, true)]);
  if (lens.reduce((bytes, [vl, kl]) => bytes + vl * 2 + kl, vp) > buf.byteLength) throw new Error('Truncated text DAT values');
  const values = [];
  const u16 = new TextDecoder('utf-16le');
  for (const [vl] of lens) {
    values.push(u16.decode(new Uint8Array(buf, vp, vl * 2)));
    vp += vl * 2;
  }
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < n; i++) {
    let k = '';
    for (let j = 0; j < lens[i][1]; j++) k += String.fromCharCode(bytes[vp + j]);
    vp += lens[i][1];
    text.set(k.toUpperCase(), values[i]);
  }
  return text;
}
function applyText(resolved) {
  const text = parseText(resolved.bytes);
  setActiveLanguage(resolved.language);
  db.text.clear();
  for (const [key, value] of text) db.text.set(key, value);
}

let languageQueue = Promise.resolve();
export function switchLanguage(value) {
  const requested = languageId(value);
  if (requested === null) return Promise.reject(new RangeError('Unknown language: ' + value));
  const work = languageQueue.then(async () => {
    const resolved = await resolveLanguageText(fetchBinary, requested),
      previous = activeLanguage;
    applyText(resolved);
    await refreshLanguageViews({ previous, language: activeLanguage, requested });
    return activeLanguage;
  });
  languageQueue = work.catch(() => {});
  return work;
}

function acyclic(t, parent) {
  for (let p = parent; p; p = p.parent) if (p === t) return null;
  return parent || null;
}

export async function loadGameData(onProgress = () => {}, { language } = {}) {
  typeNames.clear();
  factionNames.clear();
  onProgress('Reading object manifest');
  const [objFiles, hpFiles, sfxFiles] = await Promise.all([
    loadFileList('GameObjectFiles.xml'),
    loadFileList('HardPointDataFiles.xml'),
    loadFileList('SFXEventFiles.xml')
  ]);
  const variants = [];
  let done = 0;
  const total = objFiles.length + hpFiles.length + sfxFiles.length + 4;
  const tick = label => onProgress(`${label} (${++done}/${total})`, done / total);

  const objTexts = await Promise.all(objFiles.map(f => fetchText(XML + f).then(t => (tick('Units'), t))));
  for (const txt of objTexts) if (txt) readObjects(parseXML(txt), db.types, variants);
  for (const t of variants) t.parent = acyclic(t, db.type(t.str('Variant_Of_Existing_Type')));
  for (const t of db.types.values()) db.typesByCrc.set(crc32(t.name.toUpperCase()), t);

  const hpTexts = await Promise.all(hpFiles.map(f => fetchText(XML + f).then(t => (tick('Hardpoints'), t))));
  for (const txt of hpTexts) if (txt) readObjects(parseXML(txt), db.hardpoints, null);

  const sfxTexts = await Promise.all(sfxFiles.map(f => fetchText(XML + f).then(t => (tick('Sound events'), t))));
  for (const txt of sfxTexts) if (txt) readObjects(parseXML(txt), db.sfx, null);
  for (const e of db.sfx.values()) e.parent = acyclic(e, db.sfx.get(e.str('Use_Preset').toUpperCase()));

  const factionFiles = await loadFileList('FactionFiles.xml').then(l => (l.length ? l : ['Factions.xml', 'Expansion_Factions.xml']));
  const [gc, music, ...fs] = await Promise.all(
    ['GameConstants.xml', 'MusicEvents.xml', ...factionFiles].map(f => fetchText(XML + f).then(t => (tick('Rules'), t)))
  );
  const constants = new ObjType('GameConstants', 'GameConstants');
  for (const c of parseXML(gc).children[0].children) {
    const key = c.tag.toLowerCase();
    let arr = constants.props.get(key);
    if (!arr) constants.props.set(key, (arr = []));
    arr.push(c.text.trim());
  }
  db.constants = constants;
  for (const [dmg, armor, mod] of constants.tuples('Damage_To_Armor_Mod')) {
    if (armor) db.armorMod.set((dmg + '|' + armor).toUpperCase(), parseFloat(mod));
  }
  for (const txt of fs) if (txt) readObjects(parseXML(txt), db.factions, null);
  if (music) readObjects(parseXML(music), db.music, null);

  onProgress('Text');
  await loadText(language);
  sealed = true;
  return db;
}

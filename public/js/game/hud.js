import { FAST_FORWARD } from './galacticspeed.js';
import { db, loadFileList } from '../gamedata.js';
import { fetchText, fetchBinary } from '../vfs.js';
import { BinkPlayer } from '../bink.js';
import { movieDefinitions } from './galacticmovies.js';
import { parseXML } from '../xml.js';
import { loadALO, parseALO } from '../alo.js';
import { loadTextureCanvas } from '../dds.js';
import { iconUrl, iconCanvasRect, warmIcons, iconAdditiveUrl } from '../icons.js';
import { fontFamily } from '../fonts.js';
import { buildCost, isUpgradeType, companySpaceUnits, spacePop } from './sim.js';
import { parseAbilities } from './abilities.js';
import { layoutSelectionPanels, slotClickSelection } from './commandbargroups.js';
import { abilityLocked } from './blackmarket.js';
import { battlePlanetName } from './battleplanet.js';
import { playerSpecial } from './superweapon.js';
import { withKey, keysOf, keyName, onBindingsChange } from './keybinds.js';
import { TooltipGate } from './tooltipgate.js';
import { loadBarSkins, textureKey, decodeSkinIcons } from './barskins.js';

const BAR_H = 330,
  BAR_W = 1080;
const PT = 1.5;
const PT_OWN = 1.6;
const el = (cls, parent) => {
  const d = document.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
};
const css = url => (url ? `url("${url}")` : 'none');
// a selection only losing units (deaths) keeps its place; any unit added makes it a new selection
const addsUnits = (previous, units) => !previous || units.some(unit => !previous.has(unit));
// Blank_Texture_Name on the unit/build slots lists a ground pad then a space pad, the same pairing the
// galactic build bar uses per tab.
export const selectPadIndex = game => (game?.land === true ? 0 : 1);
let tipBar = null;
if (typeof addEventListener === 'function')
  addEventListener('mousemove', e => {
    if (tipBar && !e.buttons && e.target instanceof HTMLCanvasElement && !tipBar.root.contains(e.target)) tipBar.tips.moved();
  });

export function iconNameFor(type) {
  let name = type.str('Icon_Name');
  if (!name)
    for (const k of ['Squadron_Units', 'Company_Units']) {
      const t = db.type(type.list(k)[0]);
      if (t) {
        name = t.str('Icon_Name');
        break;
      }
    }
  if (!name && type.has('Company_Units')) {
    const t = companySpaceUnits(type)[0];
    if (t) name = t.str('Icon_Name');
  }
  if (!name) {
    const t = db.type(type.str('Tactical_Buildable_Constructed'));
    if (t) name = t.str('Icon_Name');
  }
  if (!name) name = memberIcons().get(type.name.toUpperCase()) || '';
  return name;
}

const memberIconCache = new WeakMap();
function memberIcons() {
  let m = memberIconCache.get(db.types);
  if (m) return m;
  memberIconCache.set(db.types, (m = new Map()));
  for (const t of db.types.values()) {
    const icon = t.has('Company_Units') && t.str('Icon_Name');
    if (icon) for (const n of t.list('Company_Units')) if (!m.has(n.toUpperCase())) m.set(n.toUpperCase(), icon);
  }
  return m;
}

const ABILITY_ICONS = {
  TURBO: 'i_sa_power_to_engines',
  DEFEND: 'i_sa_defend_mode',
  SPOILER_LOCK: 'i_sa_s_foil_mode',
  FOW_REVEAL_PING: 'i_sa_sensor_ping',
  BARRAGE: 'i_sa_barrage_area',
  ENERGY_WEAPON: 'i_sa_fire_energy_weapon',
  INVULNERABILITY: 'i_sa_evasive_maneuvers',
  MISSILE_SHIELD: 'i_sa_missile_jammer',
  CONCENTRATE_FIRE: 'i_sa_all_ships_concentrate_fire'
};
const abilityIcon = (kind, override) =>
  (override && iconUrl(override)) ||
  iconUrl((ABILITY_ICONS[kind] || 'i_sa_' + kind.toLowerCase()) + '.tga') ||
  iconUrl('i_sa_blank_button.tga');

export function uiBoneTransforms(model) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    world = new Array(model.bones.length),
    active = new Set();
  const resolve = i => {
    if (world[i]) return world[i];
    const bone = model.bones[i];
    if (!bone || active.has(i)) return identity;
    active.add(i);
    const local = bone.matrix || identity,
      parent = resolve(bone.parent),
      matrix = new Float64Array(12);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 4; col++) {
        const r = row * 4;
        matrix[r + col] =
          parent[r] * local[col] + parent[r + 1] * local[4 + col] + parent[r + 2] * local[8 + col] + (col === 3 ? parent[r + 3] : 0);
      }
    active.delete(i);
    world[i] = matrix;
    return matrix;
  };
  model.bones.forEach((_, i) => resolve(i));
  return world;
}

function reinforceGrid(shell) {
  const x = [],
    y = [];
  for (let c = 0; shell.get('R_00' + String(c).padStart(2, '0')); c++) x.push(shell.get('R_00' + String(c).padStart(2, '0')).origin.x);
  for (let r = 0; shell.get('R_' + String(r).padStart(2, '0') + '00'); r++) y.push(shell.get('R_' + String(r).padStart(2, '0') + '00').origin.y);
  let rows = 0;
  while (shell.get('REINFORCEMENT_WINDOW_ALT' + rows)) rows++;
  if (!x.length) for (let c = 0; c < 4; c++) x.push(32 + 43 * c);
  if (!y.length) for (let r = 0; r < 5; r++) y.push(-(49 + 46 * r));
  rows = Math.max(1, Math.min(rows || 5, y.length));
  const close = shell.get('R_CLOSE');
  return {
    x,
    y,
    cols: x.length,
    rows,
    closeX: close ? close.origin.x : x[0] + (x[x.length - 1] - x[0]) / 2,
    closeDrop: close ? y[rows - 1] - close.origin.y : 37,
    wide: 186
  };
}

export function uiMeshes(model) {
  const out = new Map(),
    transforms = uiBoneTransforms(model);
  for (const [order, mesh] of model.meshes.entries()) {
    const matrix = transforms[mesh.bone] || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    const bx = matrix[3],
      by = matrix[7];
    for (const sub of mesh.subs) {
      const g = sub.geometry;
      if (!g.vertices) continue;
      const { pos, uv } = g.vertices;
      const verts = [];
      for (let i = 0; i < g.nVerts; i++) {
        const x = pos[i * 3],
          y = pos[i * 3 + 1],
          z = pos[i * 3 + 2];
        verts.push({
          x: bx + matrix[0] * x + matrix[1] * y + matrix[2] * z,
          y: by + matrix[4] * x + matrix[5] * y + matrix[6] * z,
          z: matrix[11] + matrix[8] * x + matrix[9] * y + matrix[10] * z,
          u: uv[i * 2],
          v: uv[i * 2 + 1]
        });
      }
      const xs = verts.map(p => p.x),
        ys = verts.map(p => p.y);
      out.set(mesh.name.toUpperCase(), {
        verts,
        indices: g.indices,
        texture: sub.material.params.BaseTexture || '',
        shader: String(sub.material.shader || '').toLowerCase(),
        params: sub.material.params,
        hidden: mesh.hidden,
        collision: mesh.collision,
        order,
        bone: mesh.bone,
        depth: Math.max(...verts.map(v => v.z)),
        origin: { x: bx, y: by, z: matrix[11] },
        rect: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
      });
    }
  }
  return out;
}

export function meshShade(mesh) {
  const p = mesh.params || {},
    rate = p.UVScrollRate,
    additive = /additive/.test(mesh.shader || '');
  const scroll = rate && (rate[0] || rate[1]) && (/scroll/.test(mesh.shader || '') || additive) ? [rate[0] || 0, rate[1] || 0] : null;
  let mult = [1, 1, 1];
  if (mesh.shader === 'meshadditiveemissive.fx') {
    const level = Math.min(1, Math.max(0, 1 + (Number(p.Emissive) || 0)));
    mult = [level, level, level];
  } else if (additive && Array.isArray(p.Color)) mult = p.Color.slice(0, 3);
  else if (!additive && (Array.isArray(p.Emissive) || Array.isArray(p.Diffuse))) {
    const e = Array.isArray(p.Emissive) ? p.Emissive : [0, 0, 0],
      d = Array.isArray(p.Diffuse) ? p.Diffuse : [0, 0, 0];
    mult = [0, 1, 2].map(i => Math.min(1, 2 * e[i] + d[i]));
  }
  return { mult, additive, scroll };
}

const shadedImages = new WeakMap();
export function shadedImage(img, mult) {
  if (mult.every(v => v >= 0.999)) return img;
  let byMult = shadedImages.get(img);
  if (!byMult) shadedImages.set(img, (byMult = new Map()));
  const id = mult.map(v => v.toFixed(3)).join();
  let out = byMult.get(id);
  if (!out) {
    out = document.createElement('canvas');
    out.width = img.width;
    out.height = img.height;
    const c = out.getContext('2d');
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = `rgb(${mult.map(v => Math.round(Math.max(0, v) * 255)).join(',')})`;
    c.fillRect(0, 0, out.width, out.height);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(img, 0, 0);
    byMult.set(id, out);
  }
  return out;
}

export function uiMeshDepthAt(mesh, x, y) {
  let depth = -Infinity;
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const a = mesh.verts[mesh.indices[i]],
      b = mesh.verts[mesh.indices[i + 1]],
      c = mesh.verts[mesh.indices[i + 2]];
    const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(den) < 1e-10) continue;
    const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / den;
    const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / den;
    if (u >= 0 && v >= 0 && u + v <= 1) depth = Math.max(depth, u * a.z + v * b.z + (1 - u - v) * c.z);
  }
  return depth;
}

export function uiMeshClipPath(mesh) {
  const r = mesh.rect,
    paths = [];
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const points = [0, 1, 2].map(n => mesh.verts[mesh.indices[i + n]]);
    paths.push(points.map((p, n) => `${n ? 'L' : 'M'}${p.x - r.x} ${r.y + r.h - p.y}`).join('') + 'Z');
  }
  return `path("${paths.join('')}")`;
}

export function commandButtonArt(mesh, component, image, offset = 'Icon_Offset') {
  const off = (component?.val(offset) || '0 0').split(/[\s,]+/).map(Number),
    scale = component?.num('Scale', 1) ?? 1;
  return {
    x: mesh.origin.x + (off[0] || 0) - mesh.rect.x,
    y: mesh.rect.y + mesh.rect.h - mesh.origin.y - (off[1] || 0),
    w: image.w * scale,
    h: image.h * scale
  };
}

export function drawMesh(ctx, img, mesh, map) {
  const { verts, indices } = mesh,
    W = img.width,
    H = img.height;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = verts[indices[i]],
      b = verts[indices[i + 1]],
      c = verts[indices[i + 2]];
    const [x0, y0] = map(a.x, a.y),
      [x1, y1] = map(b.x, b.y),
      [x2, y2] = map(c.x, c.y);
    const fu = Math.floor(Math.min(a.u, b.u, c.u) + 1e-6),
      fv = Math.floor(Math.min(a.v, b.v, c.v) + 1e-6);
    const nu = Math.min(8, Math.max(1, Math.ceil(Math.max(a.u, b.u, c.u) - fu - 1e-6))),
      nv = Math.min(8, Math.max(1, Math.ceil(Math.max(a.v, b.v, c.v) - fv - 1e-6)));
    const u0 = (a.u - fu) * W,
      v0 = (a.v - fv) * H,
      u1 = (b.u - fu) * W,
      v1 = (b.v - fv) * H,
      u2 = (c.u - fu) * W,
      v2 = (c.v - fv) * H;
    const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(det) < 1e-6) continue;
    const m11 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det,
      m12 = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
    const m21 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det,
      m22 = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
    const cx = (x0 + x1 + x2) / 3,
      cy = (y0 + y1 + y2) / 3,
      grow = (x, y) => {
        const dx = x - cx,
          dy = y - cy,
          l = Math.hypot(dx, dy) || 1;
        return [x + (dx / l) * 0.7, y + (dy / l) * 0.7];
      };
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...grow(x0, y0));
    ctx.lineTo(...grow(x1, y1));
    ctx.lineTo(...grow(x2, y2));
    ctx.closePath();
    ctx.clip();
    ctx.transform(m11, m21, m12, m22, x0 - m11 * u0 - m12 * v0, y0 - m21 * u0 - m22 * v0);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) ctx.drawImage(img, i * W, j * H);
    ctx.restore();
  }
}

async function tacticalShell(model, comps) {
  const shell = uiMeshes(model);
  const dsName = comps.get('DS_SHELL')?.val('Model_Name');
  const ds = !shell.has('DEATHSTAR_SWITCH') && dsName ? await loadALO(dsName).catch(() => null) : null;
  const matrices = uiBoneTransforms(model),
    timer = model.bones.findIndex(b => b.name.toUpperCase() === 'DS_COUNTDOWN_TIMER'),
    movieBone = model.bones.findIndex(b => b.name.toUpperCase() === 'MOVIE_TACTICAL'),
    helpBone = model.bones.findIndex(b => b.name.toUpperCase() === 'TEXT_TACTICAL_HELP');
  return {
    shell,
    movieAt: movieBone < 0 ? null : { x: matrices[movieBone][3], y: matrices[movieBone][7] },
    helpAt: helpBone < 0 ? null : { x: matrices[helpBone][3], y: matrices[helpBone][7] },
    superweapon: {
      shell: ds ? uiMeshes(ds) : shell,
      centered: !!ds,
      timer: timer < 0 ? null : { x: matrices[timer][3], y: matrices[timer][7] }
    }
  };
}

export async function loadFactionModel(base, faction, name) {
  const file = base?.skins?.get(String(faction || '').toUpperCase())?.models.get(name.toUpperCase());
  const buf = file ? await fetchBinary('Data/Art/Models/' + file, { keep: false }).catch(() => null) : null;
  return buf ? parseALO(buf) : null;
}

const variants = new Map();
export async function loadHudAssets(faction = '') {
  const base = await loadBaseHud();
  const key = String(faction || '').toUpperCase(),
    skin = base?.skins?.get(key);
  if (!skin || (!skin.models.size && !skin.xml.length)) return base;
  if (!variants.has(key))
    variants.set(
      key,
      (async () => {
        const comps = new Map(base.comps);
        for (const xml of await Promise.all(skin.xml.map(f => fetchText('Data/XML/' + f).catch(() => null))))
          if (xml)
            for (const top of parseXML(xml).children) for (const c of top.children) if (c.attrs.Name) comps.set(c.attrs.Name.toUpperCase(), c);
        const named = [];
        for (const c of comps.values())
          for (const k of c.children) if (/Texture_Name|Overlay_Name/i.test(k.tag)) named.push(...k.text.trim().split(/\s+/));
        await decodeSkinIcons(skin, named);
        const [shell, reinforce] = await Promise.all([
          loadFactionModel(base, key, 'I_TACTICAL_CONTROLS'),
          loadFactionModel(base, key, 'I_MAIN_REINFORCE')
        ]);
        return {
          ...base,
          comps,
          ...(shell ? await tacticalShell(shell, comps) : {}),
          ...(reinforce ? { reinforce: uiMeshes(reinforce) } : {}),
          faction: key
        };
      })().catch(e => {
        console.warn('command bar of', faction, e);
        return base;
      })
    );
  return variants.get(key);
}

let pending = null;
function loadBaseHud() {
  if (!pending)
    pending = buildBaseHud().then(
      a => {
        if (!a) pending = null;
        return a;
      },
      e => {
        pending = null;
        throw e;
      }
    );
  return pending;
}

let assets = null;
export async function loadShellModel(comps, component, fallback) {
  const file = comps?.get(component)?.val?.('Model_Name')?.trim();
  return (file && (await loadALO(file).catch(() => null))) || loadALO(fallback);
}
async function buildBaseHud() {
  if (assets) return assets;
  const barFiles = await loadFileList('CommandBarComponentFiles.xml')
    .then(l => (l.length ? l : ['CommandBarComponents.xml']))
    .catch(() => ['CommandBarComponents.xml']);
  const xmls = await Promise.all(barFiles.map(f => fetchText('Data/XML/' + f)));
  const comps = new Map();
  for (const xml of xmls)
    if (xml)
      for (const top of parseXML(xml).children) for (const c of top.children) if (c.attrs.Name) comps.set(c.attrs.Name.toUpperCase(), c);
  const [shell, reinforce, evil, good, evilTex, goodTex] = await Promise.all([
    loadShellModel(comps, 'I_MAIN_SKIRMISH', 'i_tactical_controls.alo'),
    loadShellModel(comps, 'I_MAIN_REINFORCE', 'i_main_reinforce.alo'),
    loadALO('i_main_hero_frame_empire.alo').catch(() => null),
    loadALO('i_main_hero_frame_rebel.alo').catch(() => null),
    loadTextureCanvas('i_main_hero_frame_empire.dds').catch(() => null),
    loadTextureCanvas('i_main_hero_frame_rebel.dds').catch(() => null)
  ]);
  if (!shell || !reinforce || !comps.size) return null;
  assets = { comps, reinforce: uiMeshes(reinforce), ...(await tacticalShell(shell, comps)) };
  const padShell = await loadShellModel(comps, 'I_BUILD_BUTTONS', 'i_build_buttons.alo').catch(() => null);
  if (padShell) assets.padMenu = uiMeshes(padShell);
  if (evil && good && evilTex && goodTex)
    assets.heroes = { evil: { meshes: uiMeshes(evil), tex: evilTex }, good: { meshes: uiMeshes(good), tex: goodTex } };
  const names = [];
  for (const c of comps.values())
    for (const k of c.children) if (/Texture_Name|Overlay_Name/i.test(k.tag)) names.push(...k.text.trim().split(/\s+/));
  for (const t of db.types.values()) {
    const n = t.str('Icon_Name');
    if (n) names.push(n);
  }
  for (const n of Object.values(ABILITY_ICONS)) names.push(n + '.tga');
  await warmIcons(names);
  assets.skins = await loadBarSkins().catch(() => new Map());
  return assets;
}

function keyBadge(b, id, fixed = null) {
  if (!b) return;
  const k = fixed || (id ? keysOf(id)[0] : null);
  let tag = b._keyBadge;
  if (!k) {
    if (tag) tag.hidden = true;
    return;
  }
  if (!tag) tag = b._keyBadge = el('hb-key', b);
  tag.hidden = false;
  tag.textContent = keyName(k);
  const art = [...(b._nativeButton?.layers?.values() || [])].filter(l => !l.hidden && l.style.left);
  tag.style.left = art.length ? Math.min(...art.map(l => parseFloat(l.style.left))) + 2 + 'px' : '';
  tag.style.top = art.length ? Math.min(...art.map(l => parseFloat(l.style.top))) + 1 + 'px' : '';
}

export class CommandBar {
  constructor(game, ui, data) {
    this.game = game;
    this.ui = ui;
    this.world = game.world;
    this.player = game.human;
    this.comps = data.comps;
    this.shell = data.shell;
    this.helpAt = data.helpAt || { x: 65, y: 310 };
    this.movieAt = data.movieAt || null;
    this.movieAt = data.movieAt || null;
    this.rshell = data.reinforce;
    this.padShell = data.padMenu || null;
    this.heroShells = data.heroes || null;
    this.skin = data.skins?.get(String(this.player?.factionName || '').toUpperCase()) || null;
    this.root = document.getElementById('cmdbar');
    this.root.replaceChildren();
    this.sig = '';
    this.abilityKey = '';
    this.queueSig = '';
    this.sideSig = '';
    this.reinSig = '';
    this.buildScroll = 0;
    this.buildKey = null;
    this.heroBars = {};
    for (const side of ['evil', 'good']) {
      const old = document.getElementById('hero_' + side);
      if (old) old.remove();
      const d = document.createElement('div');
      d.id = 'hero_' + side;
      d.className = 'heroframe';
      document.getElementById('sidebar').parentNode.appendChild(d);
      this.heroBars[side] = { el: d, sig: '' };
    }
    this.reinforceOpen = false;
    this.scale = Math.min(innerHeight / 768, innerWidth / 1024);
    this.build();
    this.makePadMenu();
    this.resize();
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
  }

  destroy() {
    if (tipBar === this) tipBar = null;
    const mm = document.getElementById('minimap');
    if (mm && this.minimapHome) {
      const [parent, next, style] = this.minimapHome;
      parent.insertBefore(mm, next?.parentNode === parent ? next : null);
      if (style === null) mm.removeAttribute('style');
      else mm.setAttribute('style', style);
      delete mm.dataset.component;
    }
    this.offKeys?.();
    for (const off of this.windowWheelOffs || []) off();
    this.padMenu?.root.remove();
    removeEventListener('resize', this.onResize);
    for (const ev of ['pointermove', 'pointerdown']) removeEventListener(ev, this.onPoint, true);
  }

  comp(name) {
    return this.comps.get(name.toUpperCase());
  }
  textureName(name, prop, index = 0) {
    const c = this.comp(name);
    const list = c
      ? c
          .all(prop)
          .map(n => n.text.trim())
          .filter(Boolean)
          .join(' ')
          .split(/\s+/)
          .filter(Boolean)
      : [];
    return list[Math.min(index, list.length - 1)] || '';
  }
  tex(name, prop, index = 0) {
    const n = this.textureName(name, prop, index);
    return this.skinIcon(n) || iconUrl(n);
  }
  skinIcon(name) {
    return (name && this.skin?.icons.get(textureKey(name))) || '';
  }
  skinTexture(name) {
    return this.skin?.files.get(textureKey(name)) || name.replace(/\.tga$/i, '.dds');
  }
  rect(name) {
    const m = this.shell.get(name.toUpperCase());
    if (!m) return null;
    if (m.verts.length === 4) return m.rect;
    const like = this.shell.get('B_STORY_ARC_T');
    const w = like ? like.rect.w : 24,
      h = like ? like.rect.h : 24;
    return { x: m.origin.x - w / 2, y: m.origin.y - h / 2, w, h };
  }

  resize() {
    const s = Math.min(innerHeight / 768, innerWidth / 1024);
    this.scale = s;
    this.root.style.transform = `scale(${s})`;
    const win = document.getElementById('reinforceWin'),
      side = document.getElementById('sidebar');
    win.style.transform = side.style.transform = `scale(${s})`;
    win.style.left = 7 * s + 'px';
    win.style.top = 106 * s + 'px';
    const info = document.getElementById('encyc'),
      help = this.helpAt;
    info.style.transform = `scale(${s})`;
    info.style.left = help.x * s + 'px';
    info.style.bottom = help.y * s + 'px';
    info.style.setProperty('--encyc-max', Math.max(80, innerHeight / s - help.y - 4) + 'px');
    side.style.right = 2 * s + 'px';
    side.style.top = 61 * s + 'px';
    for (const b of Object.values(this.heroBars)) b.el.style.transform = `scale(${s})`;
  }

  place(node, name, pad = 0) {
    const r = this.rect(name);
    if (name) node.dataset.component = String(name).toUpperCase();
    if (!r) {
      node.style.display = 'none';
      return node;
    }
    node.style.left = r.x - pad + 'px';
    node.style.bottom = r.y - pad + 'px';
    node.style.width = r.w + pad * 2 + 'px';
    node.style.height = r.h + pad * 2 + 'px';
    return node;
  }

  scrollBar(names, onScroll) {
    const rs = names.map(n => this.rect(n)).filter(Boolean);
    if (!rs.length) return null;
    const x0 = Math.min(...rs.map(r => r.x)),
      x1 = Math.max(...rs.map(r => r.x + r.w)),
      y1 = Math.max(...rs.map(r => r.y + r.h));
    const track = el('hscroll', this.root),
      thumb = el('hscroll-thumb', track);
    track.style.cssText = `left:${x0}px;bottom:${y1 - 1}px;width:${x1 - x0}px;height:8px;display:none`;
    const bar = { track, total: 0, visible: 0, offset: 0 };
    const to = offset => {
      const o = Math.max(0, Math.min(bar.total - bar.visible, Math.round(offset)));
      if (o === bar.offset) return;
      bar.offset = o;
      onScroll(o);
    };
    track.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      const box = track.getBoundingClientRect(),
        at = x => ((x - box.left) / box.width) * bar.total - bar.visible / 2;
      to(at(e.clientX));
      const move = ev => to(at(ev.clientX)),
        up = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
        };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
    bar.set = (total, visible, offset) => {
      Object.assign(bar, { total, visible, offset });
      track.style.display = total > visible ? '' : 'none';
      thumb.style.left = (offset / Math.max(1, total)) * 100 + '%';
      thumb.style.width = (visible / Math.max(1, total)) * 100 + '%';
    };
    // the wheel scrolls anywhere over the slots, the borders, the ability buttons and the scroll bar itself,
    // in the gaps too, before the camera can take it as a zoom
    bar.wheelArea = nodesOf => {
      const onWheel = e => {
        if (bar.total <= bar.visible || track.closest('[hidden]') || !track.isConnected) return;
        let left = Infinity,
          right = -Infinity,
          top = Infinity,
          bottom = -Infinity;
        for (const node of [track, ...nodesOf()]) {
          const box = node.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          left = Math.min(left, box.left);
          right = Math.max(right, box.right);
          top = Math.min(top, box.top);
          bottom = Math.max(bottom, box.bottom);
        }
        if (e.clientX < left || e.clientX > right || e.clientY < top || e.clientY > bottom) return;
        e.preventDefault();
        e.stopPropagation();
        to(bar.offset + Math.sign(e.deltaY || e.deltaX));
      };
      addEventListener('wheel', onWheel, { capture: true, passive: false });
      (this.windowWheelOffs ||= []).push(() => removeEventListener('wheel', onWheel, { capture: true }));
    };
    return bar;
  }

  thin(node, name) {
    const r = this.rect(name);
    if (!r) {
      node.style.display = 'none';
      return node;
    }
    node.style.cssText = `left:${r.x}px;bottom:${r.y + r.h / 2 - 1.5}px;width:${r.w}px;height:3px`;
    return node;
  }

  button(name, { icon = null, iconName = '', onClick = null, title = '', nativeArtwork = true } = {}) {
    const b = this.place(el('hb', this.root), name);
    const blank = this.tex(name, 'Blank_Texture_Name');
    const ic = icon || iconUrl(iconName) || this.tex(name, 'Icon_Texture_Name') || this.tex(name, 'Icon_Alternate_Texture_Name');
    b.style.setProperty('--blank', css(blank));
    b.style.setProperty('--icon', css(ic));
    b.style.setProperty('--over', css(this.tex(name, 'Mouse_Over_Texture_Name')));
    b.style.setProperty('--sel', css(this.tex(name, 'Selected_Texture_Name')));
    b.style.setProperty('--dis', css(this.tex(name, 'Disabled_Texture_Name')));
    const c = this.comp(name);
    if (/^(true|yes|1)$/i.test(c?.val('Swap_Texture') || '')) b.classList.add('hb-swap');
    if (nativeArtwork) {
      b.classList.add('hb-native');
      b.style.background = 'none';
      b._nativeButton = { name, component: c, mesh: this.shell.get(name.toUpperCase()), layers: new Map() };
      for (const [kind, prop] of [
        ['blank', 'Blank_Texture_Name'],
        ['icon', 'Icon_Texture_Name'],
        ['sel', 'Selected_Texture_Name'],
        ['over', 'Mouse_Over_Texture_Name'],
        ['dis', 'Disabled_Texture_Name']
      ]) {
        const layer = el('hb-art hb-art-' + kind, b);
        layer.style.backgroundImage = `var(--${kind})`;
        const swap = /^(true|yes|1)$/i.test(c?.val('Swap_Texture') || '');
        if (!swap && (kind === 'over' || (kind === 'sel' && !/^(true|yes|1)$/i.test(c?.val('Selected_Alpha') || '')))) {
          layer.style.mixBlendMode = 'plus-lighter';
          layer._additive = true;
        }
        b._nativeButton.layers.set(kind, layer);
        this.setButtonImage(
          b,
          kind,
          (kind === 'icon' && iconName) ||
            this.textureName(name, prop) ||
            (kind === 'icon' ? this.textureName(name, 'Icon_Alternate_Texture_Name') : '')
        );
      }
    }
    const tipId = c
      ? c
          .all('Tooltip_Text')
          .map(n => n.text.trim())
          .filter(Boolean)
          .join(' ')
          .split(/\s+/)[0]
      : '';
    b.title = title || (tipId && db.t(tipId)) || '';
    b.onmouseenter = () => {
      if (!b.classList.contains('dis')) this.game.audio.play(c ? c.val('Mouse_Over_SFX') : '');
    };
    b.onclick = () => {
      if (b.classList.contains('dis')) return;
      this.game.audio.play((c && c.val('Click_SFX')) || 'GUI_Button_Press_2_SFX');
      if (onClick) onClick();
    };
    return b;
  }

  abilityAt(n) {
    const kinds = this.abilityKinds(),
      kind = kinds[n - 1];
    if (!kind) return null;
    return { kind, units: (this.abilityButtons || []).filter(r => r.def.kind === kind).flatMap(r => r.units) };
  }
  abilityKinds() {
    return [...new Set((this.abilityButtons || []).map(r => r.def.kind))];
  }
  abilityTips() {
    const kinds = this.abilityKinds();
    for (const r of this.abilityButtons || []) {
      const n = kinds.indexOf(r.def.kind) + 1;
      r.hint = (n && n <= 5 ? withKey(r.def.label, 'ABILITY_' + n) : r.def.label) + r.rest;
      r.b.setAttribute('aria-label', r.hint);
      keyBadge(r.b, n && n <= 5 ? 'ABILITY_' + n : null);
    }
  }

  setButtonImage(button, kind, texture) {
    const own = this.skinIcon(texture);
    button.style.setProperty('--' + kind, css(own || iconUrl(texture)));
    const state = button._nativeButton,
      image = (own && this.skin.rects.get(textureKey(texture))) || iconCanvasRect(texture);
    if (!state?.mesh) return;
    const layer = state.layers.get(kind);
    if (layer) layer.hidden = !image;
    if (layer?._additive) layer.style.backgroundImage = css(own || iconAdditiveUrl(texture));
    if (!image) return;
    const offset = kind === 'over' ? 'Mouse_Over_Offset' : kind === 'dis' ? 'Disabled_Offset' : kind === 'icon' ? 'Icon_Offset' : '';
    const r = commandButtonArt(
      { origin: state.mesh.origin, rect: this.rect(state.name) || state.mesh.rect },
      state.component,
      image,
      offset
    );
    if (layer) Object.assign(layer.style, { left: r.x - r.w / 2 + 'px', top: r.y - r.h / 2 + 'px', width: r.w + 'px', height: r.h + 'px' });
  }

  fit(t, text, room = () => t.clientWidth - (parseFloat(t.style.paddingLeft) || 0)) {
    if (t.textContent === text) return;
    t.textContent = text;
    const base = (t._fs ||= parseFloat(t.style.fontSize) || parseFloat(getComputedStyle(t).fontSize) || 12);
    t.style.fontSize = base + 'px';
    const have = room(),
      need = this.textWidth(t);
    if (have > 0 && need > have) t.style.fontSize = Math.max(base * 0.55, ((base * have) / need) * 0.97) + 'px';
  }

  textWidth(t) {
    const r = document.createRange();
    r.selectNodeContents(t);
    return r.getBoundingClientRect().width / (this.scale || 1);
  }

  text(name, { align = 'center' } = {}) {
    const t = this.place(el('ht', this.root), name);
    const c = this.comp(name);
    if (c) {
      const col = c.val('Text_Color').split(/\s+/).map(Number);
      if (col.length >= 3) t.style.color = `rgb(${col[0]},${col[1]},${col[2]})`;
      const fname = c.val('Font_Name'),
        own = /^EmpireAtWar/i.test(fname) && document.body.classList.contains('game-fonts');
      t.style.fontSize = c.num('Font_Point_Size', 7) * (own ? PT_OWN : PT) + 'px';
      if (own) t.style.fontFamily = fontFamily(fname);
      else if (/bold/i.test(fname)) t.style.fontWeight = '700';
      if (/arial/i.test(fname)) t.classList.add('arial');
      if (/true/i.test(c.val('Text_Outline'))) t.classList.add('outline');
      if (/true/i.test(c.val('Right_Justified'))) align = 'right';
      if (/true/i.test(c.val('Left_Justified'))) align = 'left';
    }
    t.style.justifyContent = align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : 'center';
    return t;
  }

  async drawFaceplate({ exclude = [], splitTop = false } = {}) {
    const f = this.player.factionName.toUpperCase();
    const altOf = n => {
      const m = /_ALT(\d+)$/.exec(n);
      return m ? +m[1] : -1;
    };
    const visible = [...this.shell].filter(([n, m]) => !exclude.includes(n) && !m.hidden && m.texture && m.indices.length >= 3);
    const mine =
      (this.skin && visible.find(([n, m]) => altOf(n) >= 0 && this.skin.files.has(textureKey(m.texture)))) ||
      visible.find(([n]) => altOf(n) >= 0 && n.includes(f));
    const alt = mine ? altOf(mine[0]) : Math.min(...visible.map(([n]) => altOf(n)).filter(n => n >= 0), 0);
    const pick = visible
      .filter(([n]) => altOf(n) < 0 || altOf(n) === alt)
      .map(([, m]) => m)
      .sort((p, q) => (p.depth ?? 0) - (q.depth ?? 0) || q.rect.w * q.rect.h - p.rect.w * p.rect.h);
    const W = Math.max(BAR_W, ...pick.map(m => Math.ceil(m.rect.x + m.rect.w))),
      H = Math.max(BAR_H, ...pick.map(m => Math.ceil(m.rect.y + m.rect.h)));
    const k = Math.max(1, Math.min(3, Math.ceil(this.scale * (devicePixelRatio || 1)), Math.floor(Math.sqrt(12e6 / (W * H)))));
    const cv = this.plate;
    cv.width = W * k;
    cv.height = H * k;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    const g = cv.getContext('2d', { willReadFrequently: false });
    g.imageSmoothingQuality = 'high';
    const images = new Map();
    for (const mesh of pick) images.set(mesh, await loadTextureCanvas(this.skinTexture(mesh.texture)).catch(() => null));
    const toPlate = (x, y) => [x * k, (H - y) * k];
    const paintMesh = (ctx, mesh, shift = null) => {
      const img = images.get(mesh);
      if (!img) return;
      const shade = meshShade(mesh),
        art = shadedImage(img, shade.mult),
        moved = shift ? { ...mesh, verts: mesh.verts.map(v => ({ ...v, u: v.u + shift[0], v: v.v + shift[1] })) } : mesh;
      ctx.save();
      if (shade.additive) ctx.globalCompositeOperation = 'lighter';
      drawMesh(ctx, art, moved, toPlate);
      ctx.restore();
    };
    for (const mesh of pick) paintMesh(g, mesh);
    const C = 4,
      mw = Math.ceil(W / C),
      mh = Math.ceil(H / C),
      mask = new Uint8Array(mw * mh);
    try {
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      for (let y = 0; y < mh; y++)
        for (let x = 0; x < mw; x++) {
          const px = Math.min(cv.width - 1, Math.floor((x + 0.5) * C * k)),
            py = Math.min(cv.height - 1, Math.floor((y + 0.5) * C * k));
          mask[y * mw + x] = d[(py * cv.width + px) * 4 + 3] > 24 ? 1 : 0;
        }
    } catch {}
    this.solid = { W, H, C, mw, mh, mask, cut: mh, topH: 0, contentW: Math.max(0, ...pick.map(m => m.rect.x + m.rect.w)) };
    const scrolling = pick.filter(m => meshShade(m).scroll && images.get(m));
    this.scrollLayer?.remove();
    this.scrollLayer = null;
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
    if (scrolling.length) {
      g.clearRect(0, 0, cv.width, cv.height);
      for (const mesh of pick) if (!scrolling.includes(mesh)) paintMesh(g, mesh);
      const layer = document.createElement('canvas');
      layer.width = cv.width;
      layer.height = cv.height;
      layer.className = 'plate scroll';
      layer.style.cssText = cv.style.cssText + ';pointer-events:none';
      const firstStatic = pick.findIndex(m => !scrolling.includes(m));
      if (firstStatic >= 0 && pick.indexOf(scrolling[0]) > firstStatic) cv.after(layer);
      else cv.before(layer);
      this.scrollLayer = layer;
      const lg = layer.getContext('2d');
      lg.imageSmoothingQuality = 'high';
      let last = -1;
      const tick = now => {
        if (!layer.isConnected) return;
        this.scrollFrame = requestAnimationFrame(tick);
        if (now - last < 33) return;
        last = now;
        const t = now / 1000;
        lg.clearRect(0, 0, layer.width, layer.height);
        for (const mesh of scrolling) {
          const r = meshShade(mesh).scroll;
          paintMesh(lg, mesh, [(t * r[0]) % 1, (t * r[1]) % 1]);
        }
      };
      this.scrollFrame = requestAnimationFrame(tick);
    }
    this.plateTop?.remove();
    this.plateTop = null;
    if (splitTop) this.splitTopPlate(cv, g, k);
  }

  splitTopPlate(cv, g, k) {
    const S = this.solid,
      { W, H, C, mw, mh, mask } = S;
    let run = 0,
      start = -1,
      seen = false,
      best = { len: 0, start: 0 };
    for (let y = 0; y < mh; y++) {
      let any = false;
      for (let x = 0; x < mw && !any; x++) any = mask[y * mw + x] === 1;
      if (any) {
        if (seen && run > best.len) best = { len: run, start };
        seen = true;
        run = 0;
      } else if (seen) {
        if (run === 0) start = y;
        run++;
      }
    }
    if (best.len * C < 16) return;
    const rows = Math.min(cv.height, Math.round(best.start * C * k));
    const top = document.createElement('canvas');
    top.width = cv.width;
    top.height = rows;
    top.className = 'plate htop';
    top.getContext('2d').drawImage(cv, 0, 0, cv.width, rows, 0, 0, cv.width, rows);
    g.clearRect(0, 0, cv.width, rows);
    const h = rows / k;
    Object.assign(top.style, { width: W + 'px', height: h + 'px', left: '0px', bottom: H - h + 'px' });
    this.plate.after(top);
    this.plateTop = top;
    S.cut = best.start;
    S.topH = h;
    S.splitY = H - h;
    this.anchorTop?.();
  }

  solidAt(cx, cy) {
    const S = this.solid;
    if (!S) return false;
    const at = (cv, refH, first) => {
      const r = cv.getBoundingClientRect();
      if (!r.width || cx < r.left || cy < r.top || cx >= r.right || cy >= r.bottom) return false;
      const x = Math.floor((((cx - r.left) / r.width) * S.W) / S.C),
        y = Math.floor((((cy - r.top) / r.height) * refH) / S.C);
      return y >= first && S.mask[y * S.mw + x] === 1;
    };
    return at(this.plate, S.H, S.cut) || (!!this.plateTop && at(this.plateTop, S.topH, 0));
  }

  build() {
    const root = this.root,
      ui = this.ui,
      game = this.game,
      p = this.player;
    this.plate = document.createElement('canvas');
    this.plate.className = 'plate';
    root.appendChild(this.plate);
    this.drawFaceplate();
    this.onPoint = e => {
      this.plate.style.pointerEvents = this.solidAt(e.clientX, e.clientY) ? 'auto' : 'none';
    };
    for (const ev of ['pointermove', 'pointerdown']) addEventListener(ev, this.onPoint, true);

    const mm = document.getElementById('minimap');
    this.minimapHome = [mm.parentNode, mm.nextSibling, mm.getAttribute('style')];
    this.place(mm, 'radar');
    root.appendChild(mm);
    const scan = this.shell.get('RADAR');
    if (scan && scan.texture)
      loadTextureCanvas(this.skinTexture(scan.texture)).then(cv => {
        if (!cv) return;
        const o = this.place(el('scan', root), 'radar');
        o.style.backgroundImage = css(cv.toDataURL());
      });

    this.tPlanet = this.text('Text_Planet_tactical');
    this.fit(this.tPlanet, battlePlanetName(game));
    this.tTech = this.text('Text_Tactical_Tech');
    this.tTech.style.paddingLeft = '6px';
    this.tPop = this.text('Text_Planetary_Pop');
    this.tPopIcon = el('hicon', root);
    this.tCredits = this.text('Text_Credits_tactical');
    this.tCreditIcon = el('hicon', root);
    const pr = this.rect('Text_Planetary_Pop'),
      cr = this.rect('Text_Credits_tactical');
    if (pr) {
      this.tPop.style.width = pr.w - 30 + 'px';
      this.tPopIcon.style.cssText = `left:${pr.x + pr.w - 27}px;bottom:${pr.y + pr.h / 2 - 6.5}px;width:16px;height:13px;background-image:${css(this.tex('Text_Planetary_Pop', 'Icon_Texture_Name'))}`;
    }
    if (cr) {
      this.tCredits.style.width = cr.w - 21 + 'px';
      this.tCreditIcon.style.cssText = `bottom:${cr.y + cr.h / 2 - 4.5}px;width:9px;height:9px;background-image:${css(iconUrl('i_icon_credit.tga'))}`;
      this.creditRight = cr.x + cr.w - 21;
    }
    if (/empire/i.test(p.faction.name)) {
      for (const t of [this.tPlanet, this.tTech, this.tPop, this.tCredits]) t.style.color = '#fff';
      for (const i of [this.tPopIcon, this.tCreditIcon]) i.style.filter = 'grayscale(1) brightness(1.7)';
    }

    this.bHelp = this.button('b_droid_help_tactical', {
      onClick: () => game.advisor && game.advisor.openLog(),
      title: db.t('TEXT_TOOLTIP_DROID_ADVISOR')
    });
    this.bStory = this.button('b_story_arc_t', {
      onClick: () => game.advisor && game.advisor.openHolocron(),
      title: db.t('TEXT_TOOLTIP_STORY_BUTTON')
    });
    this.bPause = this.button('b_play_pause_t', { onClick: () => game.togglePause() });
    this.bFast = this.button('b_fast_forward_t', { onClick: () => game.setSpeed(game.speed > 1 ? 1 : FAST_FORWARD) });
    this.bCamera = this.button('b_camera_t', { onClick: () => game.cine.toggle() });
    const sw = (game.world.specialWeapons || []).find(x => x.player === p);
    const swi = sw ? sw.index : 0;
    this.bWeapon = this.button('b_special_weapon', {
      iconName: this.textureName('b_special_weapon', 'Icon_Alternate_Texture_Name', swi),
      title:
        db.t(
          (this.comp('b_special_weapon')
            ? this.comp('b_special_weapon')
                .all('Tooltip_Text')
                .map(n => n.text.trim())
                .join(' ')
                .split(/\s+/)
                .filter(Boolean)[swi]
            : '') || ''
        ) || 'Planetary weapon',
      onClick: () => {
        const sp = this.weaponOf();
        if (!sp) return;
        const x = sp.weapon;
        const why = sp.charge < 1 ? 'Not ready' : x && !x.enabled() ? 'Purchase a special weapon upgrade' : null;
        if (why) {
          if (x && x.charge < 0.99) x.announce('Charging');
          game.message(why, 'bad');
          return;
        }
        ui.arm(ui.armed === 'special' ? null : 'special');
      }
    });
    this.bWeapon.classList.add('dis');
    {
      const b = this.bWeapon,
        clock = Object.assign(document.createElement('i'), { className: 'hb-art hb-art-build' });
      b.appendChild(clock);
      b._nativeButton?.layers.set('build', clock);
      this.setButtonImage(b, 'build', this.textureName('b_special_weapon', 'Build_Texture_Name'));
      clock.style.backgroundImage = 'var(--build)';
      clock.style.display = 'none';
      this.weaponClock = clock;
    }
    this.bPing = this.button('b_special_weapon2', {
      title: db.t('TEXT_PLACE_BEACON') || 'Place beacon',
      onClick: () => {
        if (this.bPing.classList.contains('dis')) return;
        ui.arm(ui.armed === 'beacon' ? null : 'beacon');
      }
    });
    this.bPing.classList.add('dis');
    this.bReinforce = this.button('b_reinforcement', {
      onClick: () => {
        if (game.reinforcementsEnabled?.[String(p.factionName || '').toUpperCase()] === false) return;
        this.reinforceOpen = !this.reinforceOpen;
        this.reinSig = '';
        if (this.reinforceOpen) game.audio.play(p.faction.str('Reinforcements_Selection_SFXEvent'));
        this.refresh();
      },
      title: db.t('TEXT_TOOLTIP_REINFORCEMENTS') || 'Reinforcements'
    });
    this.bReinforce.style.setProperty('--flash', css(this.tex('b_reinforcement', 'Flash_Texture_Name')));
    this.bRetreat = this.button('b_retreat', {
      onClick: () => game.retreatClicked && game.retreatClicked(),
      title: game.canRetreat && game.canRetreat() ? '' : 'Retreat — not available in this battle'
    });
    if (!(game.canRetreat && game.canRetreat())) this.bRetreat.classList.add('dis');
    this.bOptions = this.button('b_option_t', { onClick: () => game.toggleMenu(), title: 'Menu [Esc]' });

    const orders = [
      ['c_button00', 'attack', 'Attack', 'ATTACK'],
      ['c_button01', 'attackmove', 'Attack move', 'ATTACK_MOVE'],
      ['c_button02', 'move', 'Move', 'MOVE'],
      ['c_button03', 'waypoint', db.t('TEXT_TOOLTIP_WAYPOINT') || 'Set waypoint', 'WAYPOINT'],
      ['c_button04', 'stop', 'Stop', 'STOP'],
      ['c_button05', 'guard', 'Guard', 'GUARD']
    ];
    this.orderButtons = orders.map(([name, mode]) => {
      const b = this.button(name, {
        onClick: () => {
          if (mode === 'stop') ui.stop();
          else if (mode) ui.arm(ui.armed === mode ? null : mode);
        }
      });
      b._mode = mode;
      return b;
    });
    const keyTips = () => {
      this.bPause.title = withKey('Pause', 'PAUSE');
      const up = keysOf('SPEED_UP')[0],
        down = keysOf('SPEED_DOWN')[0];
      this.bFast.title = 'Fast forward' + (up || down ? ` [${[up, down].filter(Boolean).map(keyName).join(' / ')}]` : '');
      this.bCamera.title = withKey('Cinematic camera', 'BATTLE_CAM');
      for (const [b, id] of [
        [this.bPause, 'PAUSE'],
        [this.bFast, 'SPEED_UP'],
        [this.bCamera, 'BATTLE_CAM'],
        [this.bHelp, 'DROID_ADVISOR'],
        [this.bStory, 'MISSION_HOLOCRON'],
        [this.bWeapon, 'SUPER_WEAPON'],
        [this.bPing, 'PLACE_BEACON'],
        [this.bReinforce, 'REINFORCE'],
        [this.bRetreat, 'RETREAT']
      ])
        keyBadge(b, id);
      keyBadge(this.bOptions, null, 'Escape');
      orders.forEach(([, , text, id], i) => {
        this.orderButtons[i].title = withKey(text, id);
        keyBadge(this.orderButtons[i], id);
      });
      this.abilityTips();
    };
    keyTips();
    this.offKeys = onBindingsChange(keyTips);

    this.borders = [];
    this.slots = [];
    for (let c = 0; c < 12; c++) {
      const name = 'special_border_' + String(c).padStart(2, '0');
      const b = this.place(el('hborder', root), name);
      b.style.backgroundImage = css(this.tex('special_border_00', 'Icon_Alternate_Texture_Name', 0));
      this.borders.push(b);
    }
    for (let i = 0; i < 24; i++) this.slots.push(this.selectSlot(i));
    this.buildBar = this.scrollBar(
      this.slots.map((_, i) => 's_select_' + String(i).padStart(2, '0')),
      offset => {
        if (this.barMode === 'units') this.unitScroll = offset;
        else this.buildScroll = offset;
        this.ui.hudTimer = 0;
      }
    );
    if (this.buildBar)
      this.buildBar.wheelArea(() => [...this.slots.map(slot => slot.el), ...this.borders, ...this.abilityLayer.children]);
    this.abilityLayer = el('hlayer', root);
    this.info = document.getElementById('encyc');
    this.info.className = 'hidden';
    this.info.style.opacity = '';
    const box = this.info;
    this.encyclopedia = { root: box, shown: null, hide: () => box.classList.add('hidden'), hideLinked() {} };
    this.tips = new TooltipGate(game, this.encyclopedia);
    this.tipTarget = null;
    tipBar = this;
    const fade = () => {
      if (tipBar !== this) return;
      if (this.ui) this.refreshInfo();
      this.tips.update();
      this.lightLoop();
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
    this.light = null;
    this.infoKey = '';
    this.infoPinned = false;
    this.hoverUnit = null;
    this.hoverSince = 0;

    this.queueSlots = [];
    for (let i = 0; i < 10; i++) {
      const q = this.place(el('hqueue', root), 'tqueue' + String(i).padStart(2, '0'));
      q.style.backgroundImage = css(this.tex('tqueue00', 'Blank_Texture_Name'));
      q.innerHTML = '<i class="ic"></i><i class="prog"></i><span></span>';
      q.querySelector('.prog').style.backgroundImage = css(this.tex('tqueue00', 'Build_Texture_Name'));
      q.onclick = () => this.cancelQueued(q._item);
      q.oncontextmenu = e => {
        e.preventDefault();
        this.cancelQueued(q._item);
      };
      q.onmouseenter = () => this.queueHover(i, true);
      q.onmouseleave = () => this.queueHover(i, false);
      this.queueSlots.push(q);
    }
  }

  selectSlot(i) {
    const root = this.root,
      id = String(i).padStart(2, '0');
    const s = this.place(el('hslot', root), 's_select_' + id);
    s.innerHTML = '<i class="ic"></i><i class="dark"></i><span class="cost"></span><span class="num"></span>';
    // Pad frame (Blank_Texture_Name) under the unit icon.
    const pad = document.createElement('i');
    pad.className = 'pad';
    pad.style.backgroundImage = css(this.tex('s_select_' + id, 'Blank_Texture_Name', selectPadIndex(this.game)));
    s.prepend(pad);
    const hp = this.thin(el('hbar hp', root), 's_health_' + id),
      sh = this.thin(el('hbar sh', root), 's_shield_' + id);
    hp.innerHTML = sh.innerHTML = '<i></i>';
    hp.style.backgroundImage = sh.style.backgroundImage = css(iconUrl('i_bar_control_wide.tga'));
    sh.firstChild.style.backgroundImage = css(iconUrl('i_bar_shield_small10.tga'));
    s.onclick = ev => this.slotClick(i, ev);
    s.onmouseenter = () => this.slotHover(i);
    s.onmouseleave = () => this.hideInfo();
    return { el: s, hp, sh, item: null };
  }

  layout() {
    const ui = this.ui,
      p = this.player,
      w = this.world;
    ui.addHeld?.();
    const sel = ui.selection.filter(s => !s.dead);
    const menu = sel.length === 1 && sel[0].player === p && !!ui.padOf?.(sel[0]);
    const units = menu
      ? []
      : // a lone builder shows what it builds, even one that can move (a mod station anchored by an ability)
        sel.filter(s => s.isSquad || s.sellable || ((s.isMobile || !s.isPad) && !(sel.length === 1 && this.listedBuildOptions(s).length)));
    const items = new Array(24).fill(null),
      columns = [];
    let skip = this.coveredColumns(false);
    this.buildBar?.set(0, 12 - skip, 0);
    const held = new Map();
    for (const q of units) {
      const host = q.members && q.members.find(u => u.inside)?.inside;
      if (host && sel.includes(host.squad)) held.set(q, host);
    }
    if (units.length) {
      if (addsUnits(this.unitScrollSelection, units)) {
        this.unitScroll = 0;
        this.unitScrollSelection = new Set(units);
      }
      const { items, columns, totalColumns, scrollColumns } = layoutSelectionPanels(units, held, skip, this.unitScroll);
      this.unitScroll = scrollColumns;
      this.barMode = 'units';
      this.buildBar?.set(totalColumns, 12 - skip, scrollColumns);
      return { mode: 'units', items, columns };
    }
    this.barMode = 'build';
    const b = ui.builder();
    // on land a pad's options float beside it, as the original shows them, and the bar stays empty
    if (b && this.game?.land === true && this.padMenu && b === this.menuPad()) {
      this.buildBar?.set(0, 12 - skip, 0);
      return { mode: 'build', items, columns };
    }
    if (b) {
      skip = this.coveredColumns(true);
      const opts = this.listedBuildOptions(b);
      const cols = Math.ceil(opts.length / 2);
      if (this.buildKey !== b) {
        this.buildKey = b;
        this.buildScroll = 0;
      }
      this.buildScroll = Math.max(0, Math.min(cols - (12 - skip), this.buildScroll));
      opts.slice(this.buildScroll * 2, this.buildScroll * 2 + 24 - skip * 2).forEach((t, i) => {
        items[skip * 2 + i] = { build: t, builder: b };
      });
      this.buildBar?.set(cols, 12 - skip, this.buildScroll);
    }
    return { mode: 'build', items, columns };
  }

  // what a builder lists on the bar: not what still needs something first, nor an upgrade already owned
  listedBuildOptions(builder) {
    const w = this.world,
      p = this.player;
    return w.buildOptions(builder, p).filter(t => {
      if (/^Requires /.test(w.cantBuild(builder, t, p) || '')) return false;
      if (!isUpgradeType(t)) return true;
      const seen = new Set();
      for (let n = t; n && !seen.has(n); n = db.type(n.str('Next_Upgrade_Level_Type'))) {
        seen.add(n);
        if (p.upgrades.has(n.name.toUpperCase())) return false;
      }
      return true;
    });
  }

  coveredColumns(build) {
    return (this.covers || []).some(c => (!build || c.build) && c.node.isConnected && !c.node.closest('[hidden]') && c.node.style.display !== 'none') ? 1 : 0;
  }

  // left or right click on a queued build or research cancels it (the build is refunded by cancelBuild)
  cancelQueued(x) {
    const q = x && x.u.buildQueues.get(x.name);
    if (!q) return;
    this.game.command({ c: 'cancel', b: x.u.id, q: x.name, i: q.indexOf(x.it), type: x.it.type.name });
    this.ui.hudTimer = 0;
  }

  slotClick(i, ev) {
    const it = this.slots[i].item,
      ui = this.ui;
    if (!it) return;
    if (it.held) {
      const q = it.unit;
      if (this.ui.world?.canExit?.(it.held, q)) this.game.command({ c: 'ungarrison', u: [it.held.squad.id], q: q.id });
      else this.game.audio.play('GUI_Bad_Sound');
    } else if (it.unit) {
      const picked = it.group || [it.unit];
      if (ev.ctrlKey || ev.shiftKey)
        ui.select(
          ui.selection.filter(x => !picked.includes(x)),
          false
        );
      else ui.select(slotClickSelection(it), false);
    } else if (it.build) {
      const r = this.game.command({ c: 'build', b: it.builder.id, type: it.build.name, n: ev.shiftKey ? 5 : 1 });
      if (!(r && r.why)) this.game.audio.play('GUI_Button_Press_2_SFX');
    }
    ui.hudTimer = 0;
  }

  slotHover(i) {
    const it = this.slots[i].item;
    if (it && it.build) this.tipOn('slot' + i, it.build, it.builder);
    else if (it && it.unit) this.tipOn('slot' + i, it.unit.type);
  }

  tipOn(id, type, builder = null) {
    const key = () => type.name + '|' + (builder ? builder.id + '|' + (this.world.cantBuild(builder, type, this.player) || '') : '');
    this.tipTarget = {
      id: id + '|' + type.name,
      get key() {
        return key();
      },
      show: () => this.showInfo(type, { builder })
    };
  }

  showInfo(type, { builder = null, pinned = false, flagship = false } = {}) {
    const key = type.name + '|' + (builder ? builder.id : '') + (flagship ? '|flagship' : '');
    this.infoPinned = pinned;
    const box = this.info;
    if (this.infoKey === key) {
      box.classList.remove('hidden');
      if (builder) this.infoWhy(type, builder);
      return;
    }
    this.infoKey = key;
    const src = k => {
      if (type.has(k)) return type;
      for (const tag of ['Squadron_Units', 'Company_Units']) {
        const t = db.type(type.list(tag)[0]);
        if (t && t.has(k)) return t;
      }
      const c = type.has('Company_Units') ? companySpaceUnits(type)[0] : null;
      return c && c.has(k) ? c : type;
    };
    const craft = db.type(type.list('Squadron_Units')[0]);
    const name = (craft && db.t(craft.str('Text_ID'))) || db.t(src('Text_ID').str('Text_ID')) || type.name.replace(/_/g, ' ');
    const cls = db.t(src('Encyclopedia_Unit_Class').str('Encyclopedia_Unit_Class'));
    const text = src('Encyclopedia_Text')
      .list('Encyclopedia_Text')
      .map(id => db.text.get(id.toUpperCase()))
      .filter(s => s !== undefined)
      .join('\n')
      .replace(/\\n/g, '\n');
    const icons = k =>
      src(k)
        .list(k)
        .map(n => db.type(n))
        .filter(Boolean)
        .map(t => iconUrl(iconNameFor(t)))
        .filter(Boolean)
        .slice(0, 3);
    const good = icons('Encyclopedia_Good_Against'),
      bad = icons('Encyclopedia_Vulnerable_To');
    let abil = [];
    try {
      const u = db.type(type.list('Squadron_Units')[0]) || (type.has('Company_Units') && companySpaceUnits(type)[0]) || type;
      abil = parseAbilities(u).slice(0, 3);
    } catch {
      abil = [];
    }
    const cost = builder ? buildCost(type) : 0,
      use = this.world.tacticalPop?.(type) ?? src('Population_Value').num('Population_Value', 0),
      pop = use > 0 ? -use : type.num('Additional_Population_Capacity', 0);
    box.classList.remove('hint');
    box.innerHTML = `<div class="etop"><i class="eicon"></i><span class="epop"></span><b></b><span class="ecost"></span></div>
      <div class="ebody"><div class="eclass"><span></span><span class="eabil"></span></div><div class="eline"></div>
      <p class="etext"></p><p class="ewhy"></p>
      <div class="eagainst"><div class="good"><em></em><div class="eframe"></div></div><div class="bad"><em></em><div class="eframe"></div></div></div></div>`;
    const q = sel => box.querySelector(sel);
    q('.etop').style.backgroundImage = css(iconUrl('e_topbar.tga'));
    q('.eicon').style.backgroundImage = css(iconUrl(iconNameFor(type)));
    q('.etop b').textContent = flagship ? name + ' - ' + db.t('TEXT_FLAGSHIP') : name;
    q('.epop').textContent = pop ? String(Math.abs(pop)) : '';
    q('.epop').classList.toggle('adds', pop > 0);
    q('.ecost').textContent = builder ? String(cost) : '';
    q('.ebody').style.backgroundImage = css(iconUrl('e_background.tga'));
    q('.eclass span').textContent = cls;
    for (const a of abil) {
      const i = document.createElement('i');
      i.style.backgroundImage = `${css(abilityIcon(a.kind, a.icon))}, ${css(this.tex('special_button_00', 'Blank_Texture_Name'))}`;
      i.title = a.label || '';
      q('.eabil').appendChild(i);
    }
    q('.eline').style.backgroundImage = css(iconUrl('e_line2.tga'));
    q('.etext').textContent = text;
    const fill = (sel, label, list) => {
      const d = q(sel);
      d.style.display = list.length ? '' : 'none';
      d.querySelector('em').textContent = label;
      const f = d.querySelector('.eframe');
      f.style.setProperty('--frame', css(iconUrl('e_against_frame.tga')));
      for (const url of list) {
        const i = document.createElement('i');
        i.style.backgroundImage = css(url);
        f.appendChild(i);
      }
    };
    fill('.good', db.t('TEXT_GOOD_AGAINST') || 'Strong Against :', good);
    fill('.bad', db.t('TEXT_VULNERABLE_TO') || db.t('TEXT_WEAK_AGAINST') || 'Weak Against :', bad);
    if (!good.length && !bad.length) q('.eagainst').style.display = 'none';
    if (builder) this.infoWhy(type, builder);
    box.classList.remove('hidden');
  }

  showWeather(m) {
    const box = this.info;
    this.infoKey = 'weather|' + m.icon;
    this.infoPinned = false;
    box.classList.remove('hint');
    box.innerHTML = `<div class="etop"><i class="eicon"></i><b></b></div>
      <div class="ebody"><div class="eclass"><span></span></div><div class="eline"></div><p class="etext"></p></div>`;
    const q = sel => box.querySelector(sel);
    q('.etop').style.backgroundImage = css(iconUrl('e_topbar2.tga'));
    q('.eicon').style.backgroundImage = css(iconUrl(m.icon));
    q('.etop b').textContent = db.t(m.display);
    q('.ebody').style.backgroundImage = css(iconUrl('e_background.tga'));
    q('.eclass span').textContent = db.t(m.cls);
    q('.eline').style.backgroundImage = css(iconUrl('e_line.tga'));
    q('.etext').textContent = db.t(m.desc);
    box.classList.remove('hidden');
  }

  showAbility(rec) {
    const box = this.info,
      def = rec.def;
    this.infoKey = 'ability|' + def.kind + '|' + rec.hint;
    this.infoPinned = false;
    box.classList.remove('hint');
    box.innerHTML = `<div class="etop"><i class="eicon"></i><b></b></div>
      <div class="ebody"><div class="eclass"><span></span></div><div class="eline"></div><p class="etext"></p></div>`;
    const q = sel => box.querySelector(sel);
    q('.etop').style.backgroundImage = css(iconUrl('e_topbar2.tga'));
    q('.eicon').style.backgroundImage = css(abilityIcon(def.kind, def.icon));
    q('.etop b').textContent = def.label;
    q('.ebody').style.backgroundImage = css(iconUrl('e_background.tga'));
    q('.eclass span').textContent = rec.hint.slice(def.label.length).replace(/^\s*/, '');
    q('.eline').style.backgroundImage = css(iconUrl('e_line.tga'));
    q('.etext').textContent = def.description || '';
    box.classList.remove('hidden');
  }

  infoWhy(type, builder) {
    const why = this.world.cantBuild(builder, type, this.player);
    const w = this.info.querySelector('.ewhy');
    if (w) w.textContent = why || '';
  }

  hideInfo() {
    this.tipTarget = null;
  }

  lightLoop() {
    const box = this.info,
      want = !!box && !box.classList.contains('hidden'),
      at = this.movieAt;
    if (!at) return;
    let L = this.light;
    if (want && !L) {
      const canvas = document.createElement('canvas');
      canvas.className = 'hlight';
      canvas.hidden = true;
      this.root.appendChild(canvas);
      L = this.light = { canvas, player: new BinkPlayer(canvas, { onError: () => (L.dead = true) }), on: false, last: performance.now() };
      movieDefinitions()
        .then(async defs => {
          const movie = defs.get('LIGHT_LOOP'),
            buffer = movie && (await fetchBinary(movie.val('Movie_File')));
          if (!buffer || L.dead) {
            L.dead = true;
            return;
          }
          const off = db.constants.vec('CB_Movie_Offset', [0, 0]),
            own = String(movie.val('Commandbar_Offset') || '')
              .trim()
              .split(/[\s,]+/)
              .map(Number);
          await L.player.play(buffer, {
            loop: true,
            alpha: /^(yes|true|1)$/i.test(movie.val('Alpha') || ''),
            color: db.constants.vec('CB_Movie_Color', [255, 255, 255, 255])
          });
          L.x = at.x + (off[0] || 0) + (own[0] || 0);
          L.y = at.y + (off[1] || 0) + (own[1] || 0);
          L.ready = true;
        })
        .catch(() => (L.dead = true));
    }
    if (!L || L.dead) return;
    const now = performance.now(),
      dt = (now - L.last) / 1000;
    L.last = now;
    const tip = this.tips.popup ? this.tips.alpha : parseFloat(box.style.opacity || '1');
    L.canvas.hidden = !(want && L.ready);
    if (L.canvas.hidden) return;
    L.player.update(dt);
    Object.assign(L.canvas.style, {
      left: L.x + 'px',
      bottom: L.y - L.canvas.height + 'px',
      width: L.canvas.width + 'px',
      height: L.canvas.height + 'px',
      opacity: String(Math.trunc(tip * 255) / 255)
    });
  }

  showHint(text, seconds) {
    const box = this.info;
    this.infoKey = 'hint';
    this.infoPinned = false;
    this.encyclopedia.shown = 'hint';
    box.style.opacity = '';
    box.innerHTML = '<div class="ebody"><p class="etext"></p></div>';
    box.classList.add('hint');
    const body = box.querySelector('.ebody'),
      c = db.constants
        .str('Hint_Text_Color')
        .split(/[\s,]+/)
        .filter(Boolean);
    body.style.backgroundImage = css(iconUrl('e_background.tga'));
    const p = box.querySelector('.etext');
    p.textContent = text;
    if (c.length >= 3) p.style.color = `rgb(${c[0]},${c[1]},${c[2]})`;
    box.classList.remove('hidden');
    this.hintUntil = performance.now() + seconds * 1000;
  }

  refreshInfo() {
    const hinting = this.infoKey === 'hint' && performance.now() < this.hintUntil;
    if (this.infoKey === 'hint' && !hinting) {
      this.infoKey = '';
      this.encyclopedia.shown = null;
      this.info.classList.add('hidden');
    }
    const h = this.ui.hover && !this.ui.hover.dead && !this.ui.hover.isPad ? this.ui.hover : null;
    if (h !== this.hoverUnit) {
      this.hoverUnit = h;
      this.hoverTip = h
        ? { id: h, key: h.type.name + (h.flagship ? '|flagship' : ''), show: () => this.showInfo(h.type, { flagship: !!h.flagship }) }
        : null;
    }
    const target = this.tipTarget || this.hoverTip;
    if (target || !hinting) this.tips.hover(target);
  }

  weaponOf() {
    return playerSpecial(this.world, this.player);
  }

  makePadMenu() {
    document.getElementById('padmenu')?.remove();
    const root = document.createElement('div');
    root.id = 'padmenu';
    root.hidden = true;
    this.root.parentNode.appendChild(root);
    const M = (this.padMenu = { root, pad: null, sig: '', buttons: [] });
    for (let i = 0; i < 6; i++) {
      const name = 'Build_0' + i,
        m = this.padShell?.get(name.toUpperCase()),
        x = m ? m.origin.x : ((i % 3) - 1) * 53,
        y = m ? m.origin.y : -(67 + Math.floor(i / 3) * 53),
        c = this.comp(name);
      const b = el('hslot padb', root);
      b.style.left = x - 26 + 'px';
      b.style.top = -y - 26 + 'px';
      b.style.backgroundImage = css(this.tex(name, 'Blank_Texture_Name'));
      b.style.setProperty('--over', css(this.tex(name, 'Mouse_Over_Texture_Name')));
      b.innerHTML = '<i class="ic"></i><i class="dark"></i><span class="cost"></span>';
      const slot = { el: b, type: null };
      b.onmouseenter = () => {
        if (slot.type && M.pad) this.tipOn('pad' + i, slot.type, M.pad);
        this.game.audio.play(c ? c.val('Mouse_Over_SFX') : '');
      };
      b.onmouseleave = () => this.hideInfo();
      b.onclick = ev => {
        if (!slot.type || !M.pad) return;
        if (b.classList.contains('off')) {
          this.game.audio.play('GUI_Bad_Sound');
          return;
        }
        const r = this.game.command({ c: 'build', b: M.pad.id, type: slot.type.name, n: ev.shiftKey && c && /^(true|yes)$/i.test(c.val('Click_Shift')) ? 5 : 1 });
        if (!(r && r.why)) this.game.audio.play((c && c.val('Click_SFX')) || 'GUI_Button_Press_2_SFX');
        this.hideInfo();
        this.ui.hudTimer = 0;
      };
      M.buttons.push(slot);
    }
  }

  // the build pad whose options float beside it: a lone selected pad of the player's side, empty, in space or on land
  menuPad() {
    const ui = this.ui,
      sel = ui.selection.length === 1 ? ui.selection[0] : null;
    return sel && sel.isPad && !sel.dead && !sel.padChild && (sel.padOwner ?? sel.player) === this.player ? sel : null;
  }

  updatePadMenu() {
    const M = this.padMenu;
    if (!M) return;
    const ui = this.ui,
      w = this.world,
      p = this.player,
      pad = this.menuPad(),
      opts = pad ? w.buildOptions(pad, p).filter(t => !/^Requires /.test(w.cantBuild(pad, t, p) || '')).slice(0, 6) : [];
    const at = opts.length ? ui.screenOf(pad) : null;
    if (!at || at.behind) {
      if (!M.root.hidden) {
        M.root.hidden = true;
        M.pad = null;
        M.sig = '';
      }
      return;
    }
    M.root.hidden = false;
    M.pad = pad;
    M.root.style.transform = `translate(${at.x}px, ${at.y}px) scale(${this.scale})`;
    const sig = pad.id + '|' + opts.map(t => t.name).join();
    if (sig !== M.sig) {
      M.sig = sig;
      M.buttons.forEach((b, i) => {
        const t = opts[i] || null;
        b.type = t;
        b.el.classList.toggle('on', !!t);
        b.el.querySelector('.ic').style.backgroundImage = t ? css(iconUrl(iconNameFor(t))) : 'none';
        b.el.querySelector('.cost').textContent = t ? buildCost(t) : '';
      });
    }
    for (const b of M.buttons) if (b.type) b.el.classList.toggle('off', !!w.cantBuild(pad, b.type, p));
  }

  refreshCredits() {
    const credits = Math.floor(this.player.credits).toLocaleString('en-US');
    if (credits === this.creditText) return;
    this.creditText = this.tCredits.textContent = credits;
    if (!this.measure) {
      const style = getComputedStyle(this.tCredits);
      this.measure = document.createElement('canvas').getContext('2d');
      this.measure.font = `${style.fontSize} ${style.fontFamily}`;
    }
    this.tCreditIcon.style.left = this.creditRight - this.measure.measureText(credits).width - 9 - 9 + 'px';
  }

  refresh() {
    this.updatePadMenu();
    const p = this.player,
      w = this.world,
      ui = this.ui,
      game = this.game;
    this.refreshCredits();
    const st = p.team && p.team.station,
      lv = st && !st.dead ? /(\d)\s*$/.exec(st.type.name) : null;
    const shown =
      (p.techLevel ?? (lv ? +lv[1] : 1)) + (game.setup?.campaign ? p.faction?.num('Displayed_Tech_Level_Adjustment', 0) || 0 : 0);
    const tech = `${db.t('TEXT_TECH') || 'Tech:'} ${shown}`;
    if (this.tTech.textContent !== tech) {
      this.tTech.textContent = tech;
      this.tPop.textContent = '';
    }
    this.fit(this.tPop, `${p.pop}/${p.popCap}`, () => {
      const pr = this.rect('Text_Planetary_Pop'),
        tr = this.rect('Text_Tactical_Tech');
      return pr && tr ? pr.x + pr.w - 30 - (tr.x + 6 + this.textWidth(this.tTech)) - 6 : 0;
    });
    this.bPause.classList.toggle('sel', game.paused);
    this.bFast.classList.toggle('sel', game.speed > 1);
    const reinforcing = game.reinforcementsEnabled?.[String(p.factionName || '').toUpperCase()] !== false;
    this.bReinforce.classList.toggle('dis', !p.reinforcements.length || !reinforcing);
    const sw = this.weaponOf();
    this.bWeapon.classList.toggle('dis', !sw || sw.charge < 1 || (!!sw.weapon && !sw.weapon.enabled()));
    this.bWeapon.classList.toggle('sel', ui.armed === 'special');
    {
      const charge = this.weaponCharge ? this.weaponCharge() : sw ? sw.charge : 1,
        on = charge > 0 && charge < 1;
      if (this.weaponClock.style.display !== (on ? '' : 'none')) this.weaponClock.style.display = on ? '' : 'none';
      if (on) this.weaponClock.style.setProperty('--cd', 100 * charge + '%');
    }
    this.bPing.classList.toggle('dis', !game.beaconReady?.());
    this.bPing.classList.toggle('sel', ui.armed === 'beacon');
    this.bReinforce.classList.toggle('flash', reinforcing && p.reinforcements.length > 0 && !this.reinforceOpen);
    const movable = ui.mine().some(s => s.isSquad || s.isMobile);
    for (const b of this.orderButtons) {
      b.classList.toggle('dis', !movable || !b._mode);
      b.classList.toggle('sel', !!b._mode && ui.armed === b._mode);
    }

    const L = this.layout();
    const sig =
      L.mode +
      '|' +
      L.items
        .map(it =>
          it ? (it.held ? 'h' : '') + (it.group ? 'g' + it.unit.id + 'x' + it.group.length : it.unit ? 'u' + it.unit.id : 'b' + it.build.name) : ''
        )
        .join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      L.items.forEach((it, i) => {
        const s = this.slots[i];
        s.item = it;
        const type = it && (it.unit ? it.unit.type : it.build);
        s.el.classList.toggle('on', !!it);
        s.el.classList.toggle('build', !!(it && it.build));
        const ic = s.el.querySelector('.ic');
        ic.style.backgroundImage = type ? css(iconUrl(iconNameFor(type))) : 'none';
        let tint = s.el.querySelector('.tint');
        if (it && it.held) {
          if (!tint) {
            tint = document.createElement('i');
            tint.className = 'tint';
            tint.style.cssText = 'background:rgb(230,230,40);mix-blend-mode:multiply;pointer-events:none;mask-size:100% 100%;-webkit-mask-size:100% 100%';
            ic.after(tint);
          }
          tint.style.maskImage = tint.style.webkitMaskImage = ic.style.backgroundImage;
          tint.hidden = false;
        } else if (tint) tint.hidden = true;
        s.el.querySelector('.cost').textContent = it && it.build ? buildCost(it.build) : '';
        s.el.querySelector('.num').textContent = it && it.group ? 'x' + it.group.length : '';
        s.el.classList.remove('off');
        s.hp.style.display = s.sh.style.display = it && it.unit && !it.group ? '' : 'none';
        s.el.title = '';
      });
      this.borders.forEach((b, c) => {
        const x = L.columns.find(k => k.col === c);
        b.style.display = x ? '' : 'none';
        if (x) b.style.backgroundImage = css(this.tex('special_border_00', 'Icon_Alternate_Texture_Name', x.part));
      });
      const mine = L.columns.filter(
        c => !c.held && c.units[0].player === p && c.col === c.first && this.rect('special_button_' + String(c.col * 2).padStart(2, '0'))
      );
      const abilityKey = mine.map(c => c.col + '+' + c.span + ':' + c.defs.map(def => def.kind).join('/')).join(',');
      // a panel's first ability button sits centred over it, each further one half a column to the right
      const abilityRect = (first, span, k) => {
        const own = this.rect('special_button_' + String(first * 2 + span - 1 + k).padStart(2, '0'));
        if (own) return own;
        const base = this.rect('special_button_' + String(first * 2).padStart(2, '0'));
        return base && { ...base, x: base.x + (span - 1 + k) * 27.5 };
      };
      const unitsWith = (units, kind) => units.filter(unit => unit.abilities.some(ability => ability.def.kind === kind));
      if (abilityKey === this.abilityKey && this.abilityButtons) {
        let i = 0;
        for (const c of mine) {
          c.defs.forEach((def, k) => {
            const rec = this.abilityButtons[i++];
            rec.units = unitsWith(c.units, def.kind);
            rec.b.style.left = abilityRect(c.first, c.span, k).x + 'px';
          });
        }
      } else {
        this.abilityKey = abilityKey;
        this.abilityLayer.replaceChildren();
        this.abilityButtons = [];
        for (const { col, first, span, units, defs } of mine) {
          defs.forEach((def, k) => {
            const b = el('hab', this.abilityLayer);
            b.dataset.component = 'SPECIAL_BUTTON_' + String(col * 2 + span - 1 + k).padStart(2, '0');
            b._ability = def.kind;
            const place = abilityRect(first, span, k);
            b.style.cssText = `left:${place.x}px;bottom:${place.y}px;width:${place.w}px;height:${place.h}px`;
            b.style.setProperty('--blank', css(this.tex('special_button_00', 'Blank_Texture_Name')));
            b.style.setProperty('--icon', css(def.text ? iconUrl('i_sa_blank_button.tga') : abilityIcon(def.kind, def.icon)));
            b.style.setProperty('--over', css(this.tex('special_button_00', 'Mouse_Over_Texture_Name')));
            b.style.setProperty('--sel', css(this.tex('special_button_00', 'Selected_Texture_Name')));
            b.style.setProperty('--dark', css(this.tex('special_button_00', 'Disabled_Texture_Name')));
            b.style.setProperty('--recharge', css(this.tex('special_button_00', 'Build_Texture_Name')));
            b.style.setProperty('--amibox', css(this.tex('special_button_00', 'Overlay_Texture_Name')));
            const ami = (this.amiFrames ||=
              this.comp('special_button_00')
                ?.all('Icon_Alternate_Texture_Name')
                .map(n => n.text.trim())
                .join(' ')
                .split(/\s+/)
                .filter(Boolean)
                .map(n => css(iconUrl(n))) || []);
            ami.forEach((u, i) => b.style.setProperty('--a' + i, u));
            for (let i = ami.length; i < 10; i++) b.style.setProperty('--a' + i, ami[ami.length - 1] || 'none');
            const fps = +this.comp('special_button_00')?.all('Anim_FPS')[0]?.text || 5;
            b.style.setProperty('--amitime', 10 / fps + 's');
            b.innerHTML = '<i class="cool"></i>';
            if (def.text) {
              const s = document.createElement('span');
              s.className = 'habtext';
              s.textContent = def.text;
              b.appendChild(s);
            }
            const rec = {
              b,
              def,
              units: unitsWith(units, def.kind),
              rest:
                (def.target === 'unit' ? ' — then click an enemy' : def.target === 'point' ? ' — then click a location' : '') +
                (def.autofire ? ' · right-click: auto-fire' : '')
            };
            b.onclick = () => {
              this.game.audio.play('GUI_Button_Press_2_SFX');
              ui.useAbility(def.kind, rec.units);
            };
            b.onmouseenter = () =>
              (this.tipTarget = { id: 'ability|' + def.kind, key: 'ability|' + def.kind + '|' + rec.hint, show: () => this.showAbility(rec) });
            b.onmouseleave = () => this.hideInfo();
            b.oncontextmenu = ev => {
              ev.preventDefault();
              ev.stopPropagation();
              if (!def.autofire) return;
              const sts = rec.units
                .filter(u => !u.dead)
                .flatMap(u => (u.isSquad ? u.fighters : [u]))
                .map(f => f.abilities.find(a => a.def.kind === def.kind))
                .filter(Boolean);
              const on = !sts.some(a => a.auto);
              this.game.command({ c: 'auto', u: rec.units.filter(u => !u.dead).map(u => u.id), kind: def.kind, on });
              this.game.audio.play('GUI_Button_Press_2_SFX');
            };
            this.abilityButtons.push(rec);
          });
        }
        this.abilityTips();
      }
    }
    for (const s of this.slots) {
      const it = s.item;
      if (!it || it.group) continue;
      if (it.unit) {
        const u = it.unit,
          f = u.healthFrac;
        s.hp.firstChild.style.width = 100 * f + '%';
        s.hp.firstChild.style.backgroundImage = css(iconUrl(`i_bar_health_small${Math.max(0, Math.min(10, Math.round(f * 10)))}.tga`));
        const hasShield = !u.isSquad && u.maxShield > 0;
        s.sh.style.display = hasShield ? '' : 'none';
        if (hasShield) s.sh.firstChild.style.width = (u.shieldBarDown ? 0 : (100 * u.shield) / u.maxShield) + '%';
      } else {
        const why = w.cantBuild(it.builder, it.build, p);
        s.el.classList.toggle('off', !!why);
        let q = 0,
          done = '';
        const pad = !!this.ui.siteOf?.(it.builder);
        for (const [, list] of w.queuesOf(it.builder, p))
          for (const x of list)
            if (x.type === it.build) {
              q++;
              if (pad && x.total > 0) done = Math.round(100 * (1 - x.left / x.total)) + '%';
            }
        s.el.querySelector('.num').textContent = done || q || '';
      }
    }
    for (const { b, def, units } of this.abilityButtons || []) {
      const states = units
        .filter(u => !u.dead)
        .map(u => u.abilityState(def.kind))
        .filter(Boolean);
      if (!states.length) continue;
      const active = states.some(a => a.active),
        ready = states.some(a => !a.active && a.cooldown <= 0);
      b.classList.toggle('sel', active || ui.armed === 'ability:' + def.kind);
      b.classList.toggle(
        'auto',
        states.some(a => a.auto)
      );
      b.classList.toggle(
        'off',
        (!!def.mustBuy && abilityLocked(this.world.campaign, def, this.world.marketOf(units[0]))) ||
          (!!this.world.abilityBlocked && units.every(u => u.dead || this.world.abilityBlocked(u, def.kind)))
      );
      const cd =
        !active && !ready ? Math.min(...states.map(a => (a.cooldown > 0 ? a.cooldown / (a.span || def.recharge || a.cooldown) : 0))) : 0;
      const left = Math.max(0, Math.min(1, cd));
      b.firstChild.style.display = left > 0 && left < 1 ? '' : 'none';
      b.firstChild.style.setProperty('--cd', 100 * (1 - left) + '%');
    }
    this.refreshQueue();
    this.refreshSidebar();
    this.refreshHeroes();
    this.refreshReinforce();
  }

  refreshQueue() {
    const w = this.world,
      p = this.player,
      ships = [],
      research = [];
    for (const u of w.units) {
      if (u.dead || !u.buildQueues.size) continue;
      for (const [name, q] of w.queuesOf(u, p)) q.forEach(it => (isUpgradeType(it.type) ? research : ships).push({ u, name, it }));
    }
    this.queueSlots.forEach((q, i) => {
      const x = i < 5 ? ships[i] : research[i - 5];
      q._item = x || null;
      q.style.display = x ? '' : 'none';
      if (!x) {
        if (this.queueHovered === i && this.tipTarget?.id?.startsWith('queue' + i + '|')) this.hideInfo();
        return;
      }
      const url = iconUrl(iconNameFor(x.it.type));
      if (q._url !== url) {
        q._url = url;
        q.querySelector('.ic').style.backgroundImage = css(url);
      }
      const first = x.u.buildQueues.get(x.name)[0] === x.it;
      q.querySelector('.prog').style.height = 100 * (x.it.left / x.it.total) + '%';
      q.lastChild.textContent = first ? Math.round(100 * (1 - x.it.left / x.it.total)) + '%' : '';
      q.setAttribute('aria-label', (db.t(x.it.type.str('Text_ID')) || x.it.type.name) + ' — click to cancel');
      if (this.queueHovered === i && this.tipTarget?.id !== 'queue' + i + '|' + x.it.type.name) this.queueHover(i, true);
    });
  }

  refreshSidebar() {
    const w = this.world,
      p = this.player,
      side = document.getElementById('sidebar');
    const rows = [];
    for (const u of w.units) {
      if (u.dead || !u.buildQueues.size) continue;
      for (const [name, q] of w.queuesOf(u, p))
        q.forEach(it => {
          if (isUpgradeType(it.type)) rows.push({ u, name, it, type: it.type });
        });
    }
    for (const n of p.upgrades) {
      const t = db.type(n);
      if (t && t.bool('Show_In_Sidebar_When_Complete') && !/Starbase_Upgrade/i.test(t.name)) {
        const next = db.type(t.str('Next_Upgrade_Level_Type'));
        if (!next || !p.upgrades.has(next.name.toUpperCase())) rows.push({ type: t });
      }
    }
    const wx = w.weatherNow?.();
    if (wx) rows.unshift({ weather: wx });
    const sig = rows.map(r => (r.weather ? 'wx:' + r.weather.icon : r.type.name + (r.it ? '*' : ''))).join();
    if (sig !== this.sideSig) {
      this.sideSig = sig;
      const perColumn = Math.max(1, db.constants.num('Icons_Per_Column', 13)),
        items = rows.map((r, i) => {
          const d = document.createElement('div');
          d.className = 'sideitem' + (r.it ? ' building' : '');
          const k = wx ? i - 1 : i,
            total = wx ? rows.length - 1 : rows.length,
            start = Math.floor(Math.max(0, k) / perColumn) * perColumn,
            n = Math.min(perColumn, total - start),
            at = k - start,
            piece = r.weather || n === 1 ? 3 : at === 0 ? 0 : at === n - 1 ? 2 : 1;
          d.style.backgroundImage = css(this.tex('skirmish_upgrade', 'Blank_Texture_Name', piece));
          d.innerHTML = '<i></i><span></span>';
          d._r = r;
          if (r.weather) {
            d.firstChild.style.backgroundImage = css(iconUrl(r.weather.icon));
            d.onmouseenter = () =>
              (this.tipTarget = { id: 'weather', key: 'weather|' + r.weather.icon, show: () => this.showWeather(r.weather) });
            d.onmouseleave = () => this.hideInfo();
            return d;
          }
          d.firstChild.style.backgroundImage = css(iconUrl(iconNameFor(r.type)));
          d.onmouseenter = () => this.tipOn('side' + i, r.type);
          d.onmouseleave = () => this.hideInfo();
          if (r.it) {
            d.onclick = () => this.cancelQueued(r);
            d.oncontextmenu = e => {
              e.preventDefault();
              this.cancelQueued(r);
            };
          }
          return d;
        });
      const columns = [];
      for (const d of items) {
        const k = d._r.weather ? -1 : items.indexOf(d) - (wx ? 1 : 0),
          c = k < 0 ? 0 : Math.floor(k / perColumn);
        (columns[c] ||= Object.assign(document.createElement('div'), { className: 'sidecolumn' })).appendChild(d);
      }
      side.style.flexDirection = columns.length > 1 ? 'row-reverse' : '';
      side.style.alignItems = 'flex-start';
      side.replaceChildren(...columns.filter(Boolean));
    }
    for (const d of side.querySelectorAll('.sideitem')) {
      const it = d._r && d._r.it;
      if (it) d.lastChild.textContent = Math.round(100 * (1 - it.left / it.total)) + '%';
    }
  }

  refreshHeroes() {
    if (!this.heroShells) return;
    const w = this.world,
      p = this.player;
    const isHero = t => t.list('CategoryMask').some(c => /^(SPACE|LAND)HERO$/i.test(c));
    const mine = [],
      theirs = [],
      allies = [];
    const add = (e, type, owner = type) => {
      if (e.dead || e.hyper || e.player.id < 0 || !(isHero(type) || owner.bool('Is_Named_Hero'))) return;
      if (e.player === p) mine.push({ e, type });
      else if (e.player.team === p.team) allies.push({ e, type });
      else theirs.push({ e, type });
    };
    for (const u of w.units) if (!u.squad) add(u, u.heroType || u.type);
    // A named hero squadron (Rogue Squadron) is flagged on the squadron type, not on its fighters' CategoryMask.
    for (const q of w.squads) if (q.fighters[0]) add(q, q.fighters[0].type, q.type);
    this.heroRow('evil', theirs.slice(0, 11));
    this.heroRow('good', mine.concat(allies).slice(0, 11));
  }

  heroClick(h, ev) {
    this.ui.select([h.e], ev.shiftKey);
  }

  heroHover(h, on) {
    if (on) this.tipOn('hero' + h.e.id, h.type);
    else this.hideInfo();
  }

  // A build queue item shows the encyclopedia popup of what it builds, as its unit button does.
  queueHover(i, on) {
    const x = on ? this.queueSlots[i]?._item : null;
    this.queueHovered = on ? i : -1;
    if (x) this.tipOn('queue' + i, x.it.type);
    else this.hideInfo();
  }

  heroFocus(h) {
    this.ui.r.rig.x = h.e.x;
    this.ui.r.rig.y = h.e.y;
  }

  heroRow(side, list) {
    const bar = this.heroBars[side],
      shell = this.heroShells[side],
      good = side === 'good';
    const sig = list.map(h => h.e.id).join();
    if (sig !== bar.sig) {
      bar.sig = sig;
      bar.el.replaceChildren();
      bar.el.style.display = list.length ? '' : 'none';
      if (!list.length) return;
      const X = x => (good ? -x : x),
        edge = good ? 'right' : 'left';
      let plate = null;
      for (const [name, m] of shell.meshes) if (new RegExp('_HERO_FRAME_ALT' + (Math.min(list.length, 6) - 1) + '$').test(name)) plate = m;
      if (plate) {
        const cv = document.createElement('canvas'),
          k = 4,
          t = shell.tex;
        const cols = [...new Map(plate.verts.map(v => [Math.round(v.x * 10), v])).values()].sort((a, b) => a.x - b.x);
        const xs = cols.map(v => v.x),
          us = cols.map(v => v.u);
        const v1 = Math.max(...plate.verts.map(v => v.v));
        cv.width = Math.round(plate.rect.w * k);
        cv.height = Math.round(plate.rect.h * k);
        const c = cv.getContext('2d');
        for (let i = 0; i + 1 < cols.length; i++)
          c.drawImage(
            t,
            us[i] * t.width,
            0,
            (us[i + 1] - us[i]) * t.width,
            v1 * t.height,
            (xs[i] - xs[0]) * k,
            0,
            (xs[i + 1] - xs[i]) * k + 0.5,
            cv.height
          );
        const near = good ? -(plate.rect.x + plate.rect.w) : plate.rect.x;
        cv.style.cssText = `position:absolute;${edge}:${near}px;top:${-(plate.rect.y + plate.rect.h)}px;width:${plate.rect.w}px;height:${plate.rect.h}px`;
        bar.el.appendChild(cv);
      }
      list.forEach((h, i) => {
        const id = `hero_slot_${side}${String(i).padStart(2, '0')}`,
          m = shell.meshes.get(id.toUpperCase());
        if (!m) return;
        const scale = this.comp(id)?.num('Scale', 0.8) || 0.8;
        const d = document.createElement('div');
        d.className = 'heroslot' + (good && h.e.player === this.player ? ' mine' : '');
        d.style.cssText = `${edge}:${X(m.origin.x) - m.rect.w / 2}px;top:${-m.origin.y - m.rect.h / 2}px;width:${m.rect.w}px;height:${m.rect.h}px`;
        d.innerHTML = '<i class="ring"></i><i class="face"></i><i class="over"></i><i class="hp"><b></b></i>';
        const [ring, face, over, hp] = d.children;
        const inset = ((1 - scale) / 2) * 100;
        face.style.cssText = `inset:${inset}%;background-image:${css(iconUrl(iconNameFor(h.type)))}`;
        ring.style.backgroundImage = css(this.tex(id, 'Blank_Texture_Name'));
        over.style.backgroundImage = css(this.tex(id, 'Mouse_Over_Texture_Name'));
        hp.style.backgroundImage = css(this.tex('hero_hb_' + side + '00', 'Bar_Texture_Name'));
        // The encyclopedia popup the unit buttons show, not a native title, for every hero icon, own or not.
        d.setAttribute('aria-label', db.t(h.type.str('Text_ID')) || h.type.name.replace(/_/g, ' '));
        d.onmouseenter = () => this.heroHover(d._h, true);
        d.onmouseleave = () => this.heroHover(d._h, false);
        d.onmousedown = ev => ev.stopPropagation();
        if (good && h.e.player === this.player) {
          const c = this.comp(id);
          d.onmouseenter = () => {
            this.game.audio.play(c.val('Mouse_Over_SFX'));
            this.heroHover(d._h, true);
          };
          d.onclick = ev => {
            ev.stopPropagation();
            this.game.audio.play(c.val('Click_SFX'));
            this.heroClick(d._h, ev);
          };
          d.ondblclick = () => this.heroFocus(d._h);
          d.onmousedown = ev => ev.stopPropagation();
        }
        d._h = h;
        bar.el.appendChild(d);
      });
    }
    let slot = 0;
    for (const d of bar.el.children) {
      if (!d._h) continue;
      if (list[slot]?.e.id === d._h.e.id) d._h = list[slot];
      slot++;
      const e = d._h.e,
        f = e.isSquad ? (e.fighters[0] ? e.fighters[0].healthFrac : 0) : e.healthFrac;
      const fill = d.lastChild.firstChild,
        level = Math.round(f * 10);
      fill.style.width = f * 100 + '%';
      if (fill._level !== level) {
        fill._level = level;
        fill.style.backgroundImage = css(this.tex('hero_hb_' + side + '00', 'Bar_Overlay_Name', level));
      }
    }
  }

  refreshReinforce() {
    const win = document.getElementById('reinforceWin'),
      p = this.player;
    const counts = new Map();
    for (const t of p.reinforcements) counts.set(t, (counts.get(t) || 0) + 1);
    const grid = (this.reinGrid ||= reinforceGrid(this.rshell));
    const rows = Math.max(1, Math.min(grid.rows, Math.ceil(counts.size / grid.cols)));
    // A slot greys out when one more of that unit would not fit under the cap.
    const w = this.world,
      room = w.popRoom ? w.popRoom(p) : p.popCap - p.pop,
      unitPop = t => (w.popOf ? w.popOf(t) : spacePop(t)),
      full = t => unitPop(t) > 0 && room < unitPop(t);
    const sig =
      (this.reinforceOpen ? 'o' : 'c') + rows + [...counts].map(([t, n]) => t.name + n + (full(t) ? 'x' : '')).join();
    if (sig === this.reinSig) {
      if (this.reinPop) this.reinPop.textContent = `${p.pop}/${p.popCap}`;
      return;
    }
    this.reinSig = sig;
    win.classList.toggle('hidden', !this.reinforceOpen);
    if (!this.reinforceOpen) return;
    win.replaceChildren();
    const mesh = this.rshell.get('REINFORCEMENT_WINDOW_ALT' + (rows - 1));
    if (!mesh) return;
    const R = mesh.rect,
      ox = -R.x,
      oy = R.y + R.h;
    const frames = this.frames || (this.frames = new Map());
    let cv = frames.get(rows);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = Math.ceil(R.w) * 3;
      cv.height = Math.ceil(R.h) * 3;
      cv.style.cssText = `position:absolute;left:0;top:0;width:${Math.ceil(R.w)}px;height:${Math.ceil(R.h)}px`;
      frames.set(rows, cv);
      const frame = cv;
      this.frameArt ||= loadTextureCanvas(mesh.texture.replace(/\.tga$/i, '.dds'));
      this.frameArt.then(img => {
        if (img) drawMesh(frame.getContext('2d'), img, mesh, (x, y) => [(x + ox) * 3, (oy - y) * 3]);
      });
    }
    win.appendChild(cv);
    win.style.width = Math.ceil(R.w) + 'px';
    win.style.height = Math.ceil(R.h) + 'px';
    const at = (node, x, y, w, h) => {
      node.style.cssText += `;position:absolute;left:${x + ox - w / 2}px;top:${oy - y - h / 2}px;width:${w}px;height:${h}px`;
      return node;
    };
    const right = R.x + R.w - grid.wide;
    const icon = at(el('hicon', win), 86 + right, -15, 22, 17);
    icon.style.backgroundImage = css(iconUrl('i_icon_planet_Pop.tga'));
    const pop = at(el('ht outline', win), 122 + right, -15, 50, 16);
    pop.style.justifyContent = 'flex-start';
    pop.style.fontSize = 6 * PT + 'px';
    pop.style.color = '#fff';
    pop.textContent = `${p.pop}/${p.popCap}`;
    this.reinPop = pop;
    let i = 0;
    for (const [t, n] of counts) {
      if (i >= grid.cols * grid.rows) break;
      const r = Math.floor(i / grid.cols),
        c = i % grid.cols;
      const s = at(el('rslot', win), grid.x[c], grid.y[r], 43, 43);
      s.style.backgroundImage = css(iconUrl(iconNameFor(t)));
      s.style.setProperty('--over', css(iconAdditiveUrl('i_button_unit_frame_select.tga')));
      s.innerHTML = `<span>${n > 1 ? n : ''}</span>`;
      s.onmouseenter = () => this.tipOn('rein' + i, t);
      if (full(t)) {
        // The slot's Disabled_Texture_Name is drawn over the icon, as the original does.
        const slot = `r_${String(r).padStart(2, '0')}${String(c).padStart(2, '0')}`;
        const dis = this.textureName(slot, 'Disabled_Texture_Name') || this.textureName('r_0000', 'Disabled_Texture_Name');
        if (dis) s.style.setProperty('--dis', css(this.skinIcon(dis) || iconUrl(dis)));
        s.classList.add('dis');
        s.onmouseleave = () => this.hideInfo();
        s.onmousedown = ev => ev.button === 0 && ev.preventDefault();
        i++;
        continue;
      }
      s.onmouseleave = ev => {
        this.hideInfo();
        if (this.reinPress === t && ev.buttons & 1) {
          this.reinPress = null;
          this.ui.startPlacing(t, true);
        }
      };
      s.onmousedown = ev => {
        if (ev.button === 0) {
          ev.preventDefault();
          if (globalThis.multiPlace === false) this.ui.startPlacing(t, true);
          else this.reinPress = t;
        }
      };
      s.onmouseup = ev => {
        if (ev.button === 0 && this.reinPress === t) {
          this.reinPress = null;
          this.ui.addPlacing(t);
        }
      };
      i++;
    }
    const close = at(el('rclose', win), grid.closeX, grid.y[rows - 1] - grid.closeDrop, 101, 22);
    close.style.setProperty('--icon', css(iconUrl('i_reinforcement_button.tga')));
    close.style.setProperty('--over', css(iconUrl('i_reinforcement_button_mouse_over.tga')));
    close.textContent = db.t('TEXT_BUTTON_CLOSE') || 'CLOSE';
    close.onclick = () => {
      this.reinforceOpen = false;
      this.reinSig = '';
      this.refresh();
    };
  }
}

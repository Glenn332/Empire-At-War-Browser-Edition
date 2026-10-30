import { db, loadFileList } from '../gamedata.js';
import { fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';
import { loadALO } from '../alo.js';
import { loadTextureCanvas } from '../dds.js';
import { iconUrl, iconCanvasRect, warmIcons, iconAdditiveUrl } from '../icons.js';
import { fontFamily } from '../fonts.js';
import { buildCost, isUpgradeType, companySpaceUnits } from './sim.js';
import { parseAbilities } from './abilities.js';
import { abilityLocked } from './blackmarket.js';
import { battlePlanetName } from './battleplanet.js';
import { withKey, keysOf, keyName, onBindingsChange } from './keybinds.js';
import { TooltipGate } from './tooltipgate.js';

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

let assets = null;
export async function loadHudAssets() {
  if (assets) return assets;
  const barFiles = await loadFileList('CommandBarComponentFiles.xml')
    .then(l => (l.length ? l : ['CommandBarComponents.xml']))
    .catch(() => ['CommandBarComponents.xml']);
  const [xmls, shell, reinforce, evil, good, evilTex, goodTex] = await Promise.all([
    Promise.all(barFiles.map(f => fetchText('Data/XML/' + f))),
    loadALO('i_tactical_controls.alo'),
    loadALO('i_main_reinforce.alo'),
    loadALO('i_main_hero_frame_empire.alo').catch(() => null),
    loadALO('i_main_hero_frame_rebel.alo').catch(() => null),
    loadTextureCanvas('i_main_hero_frame_empire.dds').catch(() => null),
    loadTextureCanvas('i_main_hero_frame_rebel.dds').catch(() => null)
  ]);
  const comps = new Map();
  for (const xml of xmls)
    if (xml)
      for (const top of parseXML(xml).children) for (const c of top.children) if (c.attrs.Name) comps.set(c.attrs.Name.toUpperCase(), c);
  if (!shell || !reinforce || !comps.size) return null;
  assets = { comps, shell: uiMeshes(shell), reinforce: uiMeshes(reinforce) };
  const dsName = comps.get('DS_SHELL')?.val('Model_Name');
  const ds = !assets.shell.has('DEATHSTAR_SWITCH') && dsName ? await loadALO(dsName).catch(() => null) : null;
  const matrices = uiBoneTransforms(shell),
    timer = shell.bones.findIndex(b => b.name.toUpperCase() === 'DS_COUNTDOWN_TIMER');
  assets.superweapon = {
    shell: ds ? uiMeshes(ds) : assets.shell,
    centered: !!ds,
    timer: timer < 0 ? null : { x: matrices[timer][3], y: matrices[timer][7] }
  };
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
  return assets;
}

export class CommandBar {
  constructor(game, ui, data) {
    this.game = game;
    this.ui = ui;
    this.world = game.world;
    this.player = game.human;
    this.comps = data.comps;
    this.shell = data.shell;
    this.rshell = data.reinforce;
    this.heroShells = data.heroes || null;
    this.root = document.getElementById('cmdbar');
    this.root.replaceChildren();
    this.sig = '';
    this.abilityKey = '';
    this.queueSig = '';
    this.sideSig = '';
    this.reinSig = '';
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
    return iconUrl(this.textureName(name, prop, index));
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
    const info = document.getElementById('encyc');
    info.style.transform = `scale(${s})`;
    info.style.left = 65 * s + 'px';
    info.style.bottom = 310 * s + 'px';
    info.style.setProperty('--encyc-max', Math.max(80, innerHeight / s - 310 - 4) + 'px');
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
      r.b.title = (n && n <= 5 ? withKey(r.def.label, 'ABILITY_' + n) : r.def.label) + r.rest;
    }
  }

  setButtonImage(button, kind, texture) {
    button.style.setProperty('--' + kind, css(iconUrl(texture)));
    const state = button._nativeButton,
      image = iconCanvasRect(texture);
    if (!state?.mesh) return;
    const layer = state.layers.get(kind);
    if (layer) layer.hidden = !image;
    if (layer?._additive) layer.style.backgroundImage = css(iconAdditiveUrl(texture));
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
    const mine = visible.find(([n]) => altOf(n) >= 0 && n.includes(f));
    const alt = mine ? altOf(mine[0]) : Math.min(...visible.map(([n]) => altOf(n)).filter(n => n >= 0), 0);
    const pick = visible
      .filter(([n]) => altOf(n) < 0 || altOf(n) === alt)
      .map(([, m]) => m)
      .sort((p, q) => q.rect.w * q.rect.h - p.rect.w * p.rect.h);
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
    for (const mesh of pick) {
      const img = await loadTextureCanvas(mesh.texture.replace(/\.tga$/i, '.dds')).catch(() => null);
      if (img) drawMesh(g, img, mesh, (x, y) => [x * k, (H - y) * k]);
    }
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
    this.solid = { W, H, C, mw, mh, mask, cut: mh, topH: 0 };
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
      loadTextureCanvas(scan.texture.replace(/\.tga$/i, '.dds')).then(cv => {
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
    this.bFast = this.button('b_fast_forward_t', { onClick: () => game.setSpeed(game.speed > 1 ? 1 : 2) });
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
        const x = this.weaponOf();
        if (!x) return;
        const why = x.charge < 0.99 ? 'Not ready' : !x.enabled() ? 'Purchase a special weapon upgrade' : null;
        if (why) {
          if (x.charge < 0.99) x.announce('Charging');
          game.message(why, 'bad');
          return;
        }
        ui.arm(ui.armed === 'special' ? null : 'special');
      }
    });
    this.bWeapon.classList.add('dis');
    this.bPing = this.button('b_special_weapon2');
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
      orders.forEach(([, , text, id], i) => {
        this.orderButtons[i].title = withKey(text, id);
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
    for (let i = 0; i < 24; i++) {
      const id = String(i).padStart(2, '0');
      const s = this.place(el('hslot', root), 's_select_' + id);
      s.innerHTML = '<i class="ic"></i><i class="dark"></i><span class="cost"></span><span class="num"></span>';
      const hp = this.thin(el('hbar hp', root), 's_health_' + id),
        sh = this.thin(el('hbar sh', root), 's_shield_' + id);
      hp.innerHTML = sh.innerHTML = '<i></i>';
      hp.style.backgroundImage = sh.style.backgroundImage = css(iconUrl('i_bar_control_wide.tga'));
      sh.firstChild.style.backgroundImage = css(iconUrl('i_bar_shield_small10.tga'));
      s.onclick = ev => this.slotClick(i, ev);
      s.onmouseenter = () => this.slotHover(i);
      s.onmouseleave = () => this.hideInfo();
      this.slots.push({ el: s, hp, sh, item: null });
    }
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
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
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
      q.onclick = () => {
        const it = q._item;
        if (it) {
          this.game.command({
            c: 'cancel',
            b: it.u.id,
            q: it.name,
            i: it.u.buildQueues.get(it.name).indexOf(it.it),
            type: it.it.type.name
          });
          ui.hudTimer = 0;
        }
      };
      this.queueSlots.push(q);
    }
  }

  layout() {
    const ui = this.ui,
      p = this.player,
      w = this.world;
    const sel = ui.selection.filter(s => !s.dead);
    const units = sel.filter(
      s => s.isSquad || s.isMobile || s.sellable || (s.player !== p && !s.isPad && !(sel.length === 1 && w.buildOptions(s, p).length))
    );
    const items = new Array(24).fill(null),
      columns = [];
    if (units.length) {
      const groups = new Map();
      for (const s of units) {
        const k = s.type.name + '|' + s.player.id;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(s);
      }
      let col = 0;
      for (const list of groups.values()) {
        const first = col;
        for (let i = 0; i < list.length && col < 12; i += 2, col++) {
          list.slice(i, i + 2).forEach((s, r) => {
            items[col * 2 + r] = { unit: s };
          });
        }
        for (let c = first; c < col; c++)
          columns.push({
            col: c,
            first,
            span: col - first,
            units: list,
            part: col - first === 1 ? 0 : c === first ? 1 : c === col - 1 ? 3 : 2
          });
      }
      return { mode: 'units', items, columns };
    }
    const b = ui.builder();
    if (b) {
      const opts = w.buildOptions(b, p).filter(t => {
        if (/^Requires /.test(w.cantBuild(b, t, p) || '')) return false;
        if (!isUpgradeType(t)) return true;
        const seen = new Set();
        for (let n = t; n && !seen.has(n); n = db.type(n.str('Next_Upgrade_Level_Type'))) {
          seen.add(n);
          if (p.upgrades.has(n.name.toUpperCase())) return false;
        }
        return true;
      });
      opts.slice(0, 24).forEach((t, i) => {
        items[i] = { build: t, builder: b };
      });
    }
    return { mode: 'build', items, columns };
  }

  slotClick(i, ev) {
    const it = this.slots[i].item,
      ui = this.ui;
    if (!it) return;
    if (it.unit) {
      if (ev.ctrlKey || ev.shiftKey)
        ui.select(
          ui.selection.filter(x => x !== it.unit),
          false
        );
      else ui.select([it.unit], false);
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

  showInfo(type, { builder = null, pinned = false } = {}) {
    const key = type.name + '|' + (builder ? builder.id : '');
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
      .filter(Boolean)
      .join(' ')
      .replace(/\\n/g, ' ');
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
      pop = builder ? (this.world.tacticalPop?.(type) ?? src('Population_Value').num('Population_Value', 0)) : 0;
    box.classList.remove('hint');
    box.innerHTML = `<div class="etop"><i class="eicon"></i><b></b><span class="ecost"></span></div>
      <div class="ebody"><div class="eclass"><span></span><span class="eabil"></span></div><div class="eline"></div>
      <p class="etext"></p><p class="ewhy"></p>
      <div class="eagainst"><div class="good"><em></em><div class="eframe"></div></div><div class="bad"><em></em><div class="eframe"></div></div></div></div><div class="ebeam"></div>`;
    const q = sel => box.querySelector(sel);
    q('.etop').style.backgroundImage = css(iconUrl('e_topbar.tga'));
    q('.eicon').style.backgroundImage = css(iconUrl(iconNameFor(type)));
    q('.etop b').textContent = name;
    q('.ecost').textContent = builder ? (pop ? `${pop}  ·  ` : '') + cost : '';
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

  infoWhy(type, builder) {
    const why = this.world.cantBuild(builder, type, this.player);
    const w = this.info.querySelector('.ewhy');
    if (w) w.textContent = why || '';
  }

  hideInfo() {
    this.tipTarget = null;
  }

  showHint(text, seconds) {
    const box = this.info;
    this.infoKey = 'hint';
    this.infoPinned = false;
    this.encyclopedia.shown = 'hint';
    box.style.opacity = '';
    box.innerHTML = '<div class="ebody"><p class="etext"></p></div><div class="ebeam"></div>';
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
      this.hoverTip = h ? { id: h, key: h.type.name, show: () => this.showInfo(h.type) } : null;
    }
    const target = this.tipTarget || this.hoverTip;
    if (target || !hinting) this.tips.hover(target);
  }

  weaponOf() {
    const mine = (this.world.specialWeapons || []).filter(x => x.player === this.player);
    return mine.find(x => x.charge >= 0.99) || mine[0] || null;
  }

  refresh() {
    const p = this.player,
      w = this.world,
      ui = this.ui,
      game = this.game;
    const credits = Math.floor(p.credits).toLocaleString('en-US');
    if (credits !== this.creditText) {
      this.creditText = this.tCredits.textContent = credits;
      if (!this.measure) this.measure = document.createElement('canvas').getContext('2d');
      const cs = getComputedStyle(this.tCredits);
      this.measure.font = `${cs.fontSize} ${cs.fontFamily}`;
      this.tCreditIcon.style.left = this.creditRight - this.measure.measureText(credits).width - 9 - 9 + 'px';
    }
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
    this.bWeapon.classList.toggle('dis', !sw || sw.charge < 0.99 || !sw.enabled());
    this.bWeapon.classList.toggle('sel', ui.armed === 'special');
    this.bReinforce.classList.toggle('flash', reinforcing && p.reinforcements.length > 0 && !this.reinforceOpen);
    const movable = ui.mine().some(s => s.isSquad || s.isMobile);
    for (const b of this.orderButtons) {
      b.classList.toggle('dis', !movable || !b._mode);
      b.classList.toggle('sel', !!b._mode && ui.armed === b._mode);
    }

    const L = this.layout();
    const sig = L.mode + '|' + L.items.map(it => (it ? (it.unit ? 'u' + it.unit.id : 'b' + it.build.name) : '')).join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      L.items.forEach((it, i) => {
        const s = this.slots[i];
        s.item = it;
        const type = it && (it.unit ? it.unit.type : it.build);
        s.el.classList.toggle('on', !!it);
        s.el.classList.toggle('build', !!(it && it.build));
        s.el.querySelector('.ic').style.backgroundImage = type ? css(iconUrl(iconNameFor(type))) : 'none';
        s.el.querySelector('.cost').textContent = it && it.build ? buildCost(it.build) : '';
        s.el.querySelector('.num').textContent = '';
        s.el.classList.remove('off');
        s.hp.style.display = s.sh.style.display = it && it.unit ? '' : 'none';
        s.el.title = '';
      });
      this.borders.forEach((b, c) => {
        const x = L.columns.find(k => k.col === c);
        b.style.display = x ? '' : 'none';
        if (x) b.style.backgroundImage = css(this.tex('special_border_00', 'Icon_Alternate_Texture_Name', x.part));
      });
      const mine = L.columns.filter(
        c => c.units[0].player === p && c.col === c.first && this.rect('special_button_' + String(c.col * 2).padStart(2, '0'))
      );
      const abilityKey = mine.map(c => c.col + ':' + c.units[0].abilities.map(a => a.def.kind).join('/')).join(',');
      const habX = (base, span, k, n) => base.x + (span - 1) * 27.5 + (k - (n - 1) / 2) * 27.5;
      if (abilityKey === this.abilityKey && this.abilityButtons) {
        let i = 0;
        for (const c of mine) {
          const base = this.rect('special_button_' + String(c.col * 2).padStart(2, '0')),
            n = c.units[0].abilities.length;
          for (let k = 0; k < n; k++) {
            const rec = this.abilityButtons[i++];
            rec.units = c.units;
            rec.b.style.left = habX(base, c.span, k, n) + 'px';
          }
        }
      } else {
        this.abilityKey = abilityKey;
        this.abilityLayer.replaceChildren();
        this.abilityButtons = [];
        for (const { col, first, span, units } of L.columns) {
          if (units[0].player !== p || col !== first) continue;
          const defs = units[0].abilities.map(a => a.def);
          const base = this.rect('special_button_' + String(col * 2).padStart(2, '0'));
          if (!base) continue;
          defs.forEach((def, k) => {
            const b = el('hab', this.abilityLayer);
            b.dataset.component = 'SPECIAL_BUTTON_' + String(col * 2 + k).padStart(2, '0');
            b._ability = def.kind;
            const x = habX(base, span, k, defs.length);
            b.style.cssText = `left:${x}px;bottom:${base.y}px;width:${base.w}px;height:${base.h}px`;
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
              units,
              rest:
                (def.target === 'unit' ? ' — then click an enemy' : def.target === 'point' ? ' — then click a location' : '') +
                (def.autofire ? ' · right-click: auto-fire' : '')
            };
            b.onclick = () => {
              this.game.audio.play('GUI_Button_Press_2_SFX');
              ui.useAbility(def.kind, rec.units);
            };
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
      if (!it) continue;
      if (it.unit) {
        const u = it.unit,
          f = u.healthFrac;
        s.hp.firstChild.style.width = 100 * f + '%';
        s.hp.firstChild.style.backgroundImage = css(iconUrl(`i_bar_health_small${Math.max(0, Math.min(10, Math.round(f * 10)))}.tga`));
        const hasShield = !u.isSquad && u.maxShield > 0;
        s.sh.style.display = hasShield ? '' : 'none';
        if (hasShield) s.sh.firstChild.style.width = (100 * u.shield) / u.maxShield + '%';
      } else {
        const why = w.cantBuild(it.builder, it.build, p);
        s.el.classList.toggle('off', !!why);
        let q = 0;
        for (const [, list] of w.queuesOf(it.builder, p)) for (const x of list) if (x.type === it.build) q++;
        s.el.querySelector('.num').textContent = q || '';
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
      const cd = !active && !ready && def.recharge > 0 ? Math.min(...states.map(a => a.cooldown)) / def.recharge : 0;
      const left = Math.max(0, Math.min(1, cd));
      b.firstChild.style.display = left > 0 ? '' : 'none';
      b.firstChild.style.setProperty('--cd', 100 * left + '%');
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
      if (!x) return;
      const url = iconUrl(iconNameFor(x.it.type));
      if (q._url !== url) {
        q._url = url;
        q.querySelector('.ic').style.backgroundImage = css(url);
      }
      const first = x.u.buildQueues.get(x.name)[0] === x.it;
      q.querySelector('.prog').style.height = 100 * (x.it.left / x.it.total) + '%';
      q.lastChild.textContent = first ? Math.round(100 * (1 - x.it.left / x.it.total)) + '%' : '';
      q.title = (db.t(x.it.type.str('Text_ID')) || x.it.type.name) + ' — click to cancel';
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
    const sig = rows.map(r => r.type.name + (r.it ? '*' : '')).join();
    if (sig !== this.sideSig) {
      this.sideSig = sig;
      side.replaceChildren(
        ...rows.map((r, i) => {
          const d = document.createElement('div');
          d.className = 'sideitem' + (r.it ? ' building' : '');
          const piece = rows.length === 1 ? 3 : i === 0 ? 0 : i === rows.length - 1 ? 2 : 1;
          d.style.backgroundImage = css(this.tex('skirmish_upgrade', 'Blank_Texture_Name', piece));
          d.innerHTML = '<i></i><span></span>';
          d.firstChild.style.backgroundImage = css(iconUrl(iconNameFor(r.type)));
          d.title = (db.t(r.type.str('Text_ID')) || r.type.name) + (r.it ? ' — click to cancel' : '');
          if (r.it)
            d.onclick = () => {
              this.game.command({ c: 'cancel', b: r.u.id, q: r.name, i: r.u.buildQueues.get(r.name).indexOf(r.it), type: r.it.type.name });
              this.ui.hudTimer = 0;
            };
          d._r = r;
          return d;
        })
      );
    }
    for (const d of side.children) {
      const it = d._r.it;
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
    const add = (e, type) => {
      if (e.dead || e.hyper || e.player.id < 0 || !isHero(type)) return;
      if (e.player === p) mine.push({ e, type });
      else if (e.player.team === p.team) allies.push({ e, type });
      else theirs.push({ e, type });
    };
    for (const u of w.units) if (!u.squad) add(u, u.heroType || u.type);
    for (const q of w.squads) if (q.fighters[0]) add(q, q.fighters[0].type);
    this.heroRow('evil', theirs.slice(0, 11));
    this.heroRow('good', mine.concat(allies).slice(0, 11));
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
        if (!good) {
          c.translate(cv.width, 0);
          c.scale(-1, 1);
        }
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
        const near = good ? -(plate.rect.x + plate.rect.w) : 2 * plate.origin.x - (plate.rect.x + plate.rect.w);
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
        d.title = db.t(h.type.str('Text_ID')) || h.type.name.replace(/_/g, ' ');
        if (good && h.e.player === this.player) {
          const c = this.comp(id);
          d.onmouseenter = () => this.game.audio.play(c.val('Mouse_Over_SFX'));
          d.onclick = ev => {
            ev.stopPropagation();
            this.game.audio.play(c.val('Click_SFX'));
            this.ui.select([h.e], ev.shiftKey);
          };
          d.ondblclick = () => {
            this.ui.r.rig.x = h.e.x;
            this.ui.r.rig.y = h.e.y;
          };
          d.onmousedown = ev => ev.stopPropagation();
        }
        d._h = h;
        bar.el.appendChild(d);
      });
    }
    for (const d of bar.el.children) {
      if (!d._h) continue;
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
    const rows = Math.max(1, Math.min(5, Math.ceil(counts.size / 4)));
    const sig = (this.reinforceOpen ? 'o' : 'c') + rows + [...counts].map(([t, n]) => t.name + n).join();
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
    const icon = at(el('hicon', win), 86, -15, 22, 17);
    icon.style.backgroundImage = css(iconUrl('i_icon_planet_Pop.tga'));
    const pop = at(el('ht outline', win), 122, -15, 50, 16);
    pop.style.justifyContent = 'flex-start';
    pop.style.fontSize = 6 * PT + 'px';
    pop.style.color = '#fff';
    pop.textContent = `${p.pop}/${p.popCap}`;
    this.reinPop = pop;
    let i = 0;
    for (const [t, n] of counts) {
      if (i >= 20) break;
      const r = Math.floor(i / 4),
        c = i % 4;
      const s = at(el('rslot', win), 32 + 43 * c, -(49 + 46 * r), 43, 43);
      s.style.backgroundImage = css(iconUrl(iconNameFor(t)));
      s.style.setProperty('--over', css(iconAdditiveUrl('i_button_unit_frame_select.tga')));
      s.innerHTML = `<span>${n > 1 ? n : ''}</span>`;
      s.onmouseenter = () => this.tipOn('rein' + i, t);
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
    const close = at(el('rclose', win), 97, -(49 + 46 * (rows - 1) + 37), 101, 22);
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

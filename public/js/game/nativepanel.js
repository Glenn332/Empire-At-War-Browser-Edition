import { db } from '../gamedata.js';
import { loadALO } from '../alo.js';
import { loadTextureCanvas } from '../dds.js';
import { iconCanvasRect, iconUrl } from '../icons.js';
import { snapNativeText } from '../nativefont.js';
import { setComponentText, componentTextAlign } from './componenttext.js';
import { loadHudAssets, uiMeshes, uiBoneTransforms, drawMesh } from './hud.js';
const nameOf = type => type && (db.t(type.str('Text_ID')) || type.name);
const css = url => (url ? `url("${url}")` : 'none');

export function tintShell(data) {
  const result = new Map();
  for (const [name, mesh] of data.shell) {
    const image = data.textures.get(mesh.texture),
      color = data.materials.get(name)?.params.Color;
    if (!image || !color) {
      result.set(name, image);
      continue;
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) for (let c = 0; c < 4; c++) pixels.data[i + c] *= color[c] ?? 1;
    ctx.putImageData(pixels, 0, 0);
    result.set(name, canvas);
  }
  return result;
}

export function animateScan(parent, mesh, image, rate, bounds) {
  if (!image || !rate?.some(v => v)) return false;
  const quads = [];
  for (let i = 0; i < mesh.indices.length; i += 6) {
    const v = [...new Set(Array.from(mesh.indices.slice(i, i + 6)))].map(n => mesh.verts[n]);
    if (v.length !== 4) return false;
    const xs = v.map(p => p.x),
      ys = v.map(p => p.y),
      x = Math.min(...xs),
      y = Math.max(...ys),
      w = Math.max(...xs) - x,
      h = y - Math.min(...ys);
    const at = (px, py) => v.find(p => Math.abs(p.x - px) < 0.001 && Math.abs(p.y - py) < 0.001);
    const a = at(x, y),
      b = at(x + w, y),
      c = at(x, y - h),
      d = at(x + w, y - h);
    if (
      !a ||
      !b ||
      !c ||
      !d ||
      Math.abs(a.v - b.v) > 0.001 ||
      Math.abs(a.u - c.u) > 0.001 ||
      Math.abs(d.u - b.u) > 0.001 ||
      Math.abs(d.v - c.v) > 0.001
    )
      return false;
    const du = b.u - a.u,
      dv = c.v - a.v;
    if (Math.abs(du) < 1e-6 || Math.abs(dv) < 1e-6) return false;
    quads.push({ a, x, y, w, h, sx: Math.abs(w / du), sy: Math.abs(h / dv), flipX: Math.sign(du), flipY: Math.sign(dv) });
  }
  const variants = new Map();
  for (const q of quads) {
    const { a, x, y, w, h, sx, sy, flipX, flipY } = q,
      key = flipX + ',' + flipY;
    if (!variants.has(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.translate(flipX < 0 ? image.width : 0, flipY < 0 ? image.height : 0);
      ctx.scale(flipX, flipY);
      ctx.drawImage(image, 0, 0);
      variants.set(key, canvas.toDataURL());
    }
    const clip = document.createElement('div'),
      horizontal = document.createElement('div'),
      vertical = document.createElement('div');
    clip.style.cssText = `position:absolute;overflow:hidden;left:${x - bounds.x}px;top:${bounds.y - y}px;width:${w}px;height:${h}px`;
    horizontal.style.cssText = `position:absolute;left:${-sx}px;top:${-sy}px;width:${w + sx * 2}px;height:${h + sy * 2}px`;
    vertical.style.cssText = `width:100%;height:100%;background-image:url("${variants.get(key)}");background-repeat:repeat;background-size:${sx}px ${sy}px;background-position:${-a.u * flipX * sx}px ${-a.v * flipY * sy}px`;
    const scroll = (el, amount, axis, period) => {
      if (amount)
        el.animate([{ transform: 'translate' + axis + '(0px)' }, { transform: `translate${axis}(${-Math.sign(amount) * period}px)` }], {
          duration: 1000 / Math.abs(amount),
          iterations: Infinity
        });
    };
    scroll(horizontal, rate[0] * flipX, 'X', sx);
    scroll(vertical, rate[1] * flipY, 'Y', sy);
    horizontal.appendChild(vertical);
    clip.appendChild(horizontal);
    parent.appendChild(clip);
  }
  return true;
}

export function typeIcon(type) {
  if (!type) return '';
  let icon = type.str('Icon_Name');
  if (!icon)
    for (const key of ['Company_Units', 'Squadron_Units']) {
      icon = db.type(type.list(key)[0])?.str('Icon_Name');
      if (icon) break;
    }
  return icon || '';
}

export function overviewIcon(type, prefix = '', big = true) {
  if (!type) return 'i_button_unknown.tga';
  const icon = typeIcon(type),
    choices = big ? [`${prefix}big_${icon}`, `big_${icon}`, `${prefix}${icon}`, icon] : [`${prefix}${icon}`, icon];
  for (const n of choices) if (icon && iconCanvasRect(n)) return n;
  return 'i_button_temporary.tga';
}

export async function loadNativePanelAssets(component, fallback) {
  const data = await loadHudAssets();
  const model = data && (await loadALO(data.comps.get(component.toUpperCase())?.val('Model_Name') || fallback));
  if (!data || !model) return null;
  const shell = uiMeshes(model),
    textures = new Map(),
    origins = new Map(),
    materials = new Map();
  for (const mesh of model.meshes) for (const sub of mesh.subs) if (sub.material) materials.set(mesh.name.toUpperCase(), sub.material);
  const transforms = uiBoneTransforms(model);
  for (let i = 0; i < model.bones.length; i++) origins.set(model.bones[i].name.toUpperCase(), { x: transforms[i][3], y: transforms[i][7] });
  await Promise.all(
    [
      ...new Set(
        [...shell.values()]
          .filter(m => !m.hidden)
          .map(m => m.texture)
          .filter(Boolean)
      )
    ].map(async n => {
      textures.set(n, await loadTextureCanvas(n).catch(() => null));
    })
  );
  return { comps: data.comps, shell, textures, origins, materials, model };
}

export class NativePanel {
  constructor(game, data, className, label) {
    this.game = game;
    Object.assign(this, data);
    this.paintKey = '';
    this.textLabels = new Map();
    this.buttonLabels = new Map();
    this.prefix = db.faction(game.me)?.str('Alternate_Icon_Prefix') || '';
    this.root = document.createElement('div');
    this.root.className = 'native-panel ' + className;
    this.root.hidden = true;
    this.root.setAttribute('aria-label', label);
    document.body.appendChild(this.root);
    this.plate = document.createElement('canvas');
    this.plate.className = 'overview-art';
    this.root.appendChild(this.plate);
    const art = [...this.shell.values()].filter(m => !m.hidden && m.texture);
    this.bounds = { x: Math.floor(Math.min(...art.map(m => m.rect.x))), y: Math.ceil(Math.max(...art.map(m => m.rect.y + m.rect.h))) };
    this.bounds.w = Math.ceil(Math.max(...art.map(m => m.rect.x + m.rect.w))) - this.bounds.x;
    this.bounds.h = this.bounds.y - Math.floor(Math.min(...art.map(m => m.rect.y)));
    this.plate.style.cssText = `left:${this.bounds.x}px;top:${-this.bounds.y}px;width:${this.bounds.w}px;height:${this.bounds.h}px`;
    this.resize();
  }

  resize() {
    this.scale = this.game.overlayScale();
    this.root.style.transform = `scale(${this.scale})`;
    this.root.style.left = innerWidth / 2 + 0.5 * this.scale + 'px';
    this.root.style.top = innerHeight / 2 - 0.5 * this.scale + 'px';
    this.paintKey = '';
    this.reflowText();
  }

  reflowText() {
    for (const [el, label] of this.textLabels) this.setText(el, label.source ?? label.value);
    for (const [button, { label, tip }] of this.buttonLabels) {
      const value = typeof label === 'function' ? label() : label,
        help = db.t(tip);
      button.title = help || value;
      button.setAttribute('aria-label', value || help);
    }
    snapNativeText(this.root);
  }

  setText(el, value) {
    const label = this.textLabels.get(el);
    if (!label) return;
    label.source = value;
    label.value = String((typeof value === 'function' ? value() : value) ?? '');
    return setComponentText(el, label.component, label.value, {
      scale: this.scale,
      align: componentTextAlign(label.component, label.left),
      tint: label.tint || null
    });
  }

  paintShell(only = null) {
    const b = this.bounds,
      k = Math.min(3, Math.max(1, Math.ceil(this.scale * devicePixelRatio)), Math.sqrt(12e6 / (b.w * b.h)));
    const cv = this.plate;
    cv.width = b.w * k;
    cv.height = b.h * k;
    const ctx = cv.getContext('2d');
    for (const [name, mesh] of this.shell) {
      const img = this.images?.get(name);
      if (!mesh.hidden && mesh.texture && img && (!only || only(name))) drawMesh(ctx, img, mesh, (x, y) => [(x - b.x) * k, (b.y - y) * k]);
    }
  }

  controls(pattern) {
    return [...this.shell.keys()]
      .filter(n => pattern.test(n))
      .sort()
      .map(n => {
        const m = this.shell.get(n),
          d = document.createElement('div');
        d.className = 'overview-slot';
        d.dataset.control = n;
        d.hidden = true;
        this.place(d, m.rect);
        this.root.appendChild(d);
        const img = document.createElement('img');
        img.alt = '';
        d.appendChild(img);
        const count = document.createElement('span');
        count.className = 'overview-count';
        d.appendChild(count);
        const c = this.comps.get(n);
        const offset =
          c
            ?.val('Icon_Offset')
            .split(/[\s,]+/)
            .map(Number) || [];
        img.style.marginLeft = (offset[0] || 0) + 'px';
        img.style.marginTop = -(offset[1] || 0) + 'px';
        const textOffset =
            c
              ?.val('Text_Offset')
              .split(/[\s,]+/)
              .map(Number) || [],
          origin = this.origins.get(n) || { x: m.rect.x + m.rect.w / 2, y: m.rect.y + m.rect.h / 2 };
        count.style.left = origin.x - m.rect.x + (textOffset[0] || 0) + 'px';
        count.style.top = m.rect.y + m.rect.h - origin.y - (textOffset[1] || 0) + 'px';
        this.textLabels.set(count, { component: c, left: null, value: '' });
        d.onmouseenter = () => this.game.audio.play(c?.val('Mouse_Over_SFX') || '');
        return { name: n, mesh: m, el: d, img, count, offset, icon: '' };
      });
  }

  place(d, r) {
    Object.assign(d.style, { left: r.x + 'px', top: -r.y - r.h + 'px', width: r.w + 'px', height: r.h + 'px' });
  }

  button(name, label, onClick) {
    const n = name.toUpperCase(),
      m = this.shell.get(n),
      origin = this.origins.get(n),
      c = this.comps.get(n);
    if (!origin) return null;
    const texture = key => c?.val(key).trim().split(/\s+/)[0] || '';
    const art = texture('Icon_Texture_Name') || texture('Blank_Texture_Name'),
      over = texture('Mouse_Over_Texture_Name'),
      r = iconCanvasRect(art);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'native-button';
    b.dataset.control = n;
    this.place(b, m?.rect || { x: origin.x - (r?.w || 24) / 2, y: origin.y - (r?.h || 24) / 2, w: r?.w || 24, h: r?.h || 24 });
    const hit = m?.rect || { x: origin.x - (r?.w || 24) / 2, y: origin.y - (r?.h || 24) / 2, w: r?.w || 24, h: r?.h || 24 };
    b.style.setProperty('--art-x', origin.x - hit.x + 'px');
    b.style.setProperty('--art-y', hit.y + hit.h - origin.y + 'px');
    b.style.setProperty('--art-w', (r?.w || 0) + 'px');
    b.style.setProperty('--art-h', (r?.h || 0) + 'px');
    b.style.setProperty('--art', css(iconUrl(art)));
    b.style.setProperty('--over', css(iconUrl(over)));
    const tip = texture('Tooltip_Text'),
      value = typeof label === 'function' ? label() : label;
    this.buttonLabels.set(b, { label, tip });
    b.title = db.t(tip) || value;
    b.setAttribute('aria-label', value || db.t(tip));
    b.onmouseenter = () => {
      if (!b.disabled) this.game.audio.play(c?.val('Mouse_Over_SFX') || '');
    };
    b.onclick = () => {
      if (!b.disabled) {
        this.game.audio.play(c?.val('Click_SFX') || 'GUI_Button_Press_2_SFX');
        onClick();
      }
    };
    this.root.appendChild(b);
    if (label) this.text(name, label);
    return b;
  }

  text(n, text, left = null) {
    const origin = this.origins.get(n.toUpperCase());
    if (!origin) return null;
    const d = document.createElement('div'),
      c = this.comps.get(n.toUpperCase());
    const off =
      c
        ?.val('Text_Offset')
        .split(/[\s,]+/)
        .map(Number) || [];
    d.className = 'ht';
    d.dataset.control = n.toUpperCase();
    Object.assign(d.style, { position: 'absolute', left: origin.x + (off[0] || 0) + 'px', top: -origin.y - (off[1] || 0) + 'px' });
    this.textLabels.set(d, { component: c, left, value: '' });
    this.root.appendChild(d);
    this.setText(d, text);
    return d;
  }

  put(slot, record, { blank = '', big = true, packed = false } = {}) {
    if (record?.reserved) record = null;
    slot.el.hidden = !record && !blank;
    if (slot.el.hidden) return;
    const u = record?.unit,
      type = u && (u.carries || u.type);
    const icon = record ? overviewIcon(type, this.prefix, big) : '',
      r = iconCanvasRect(icon),
      scale = packed && r?.w >= 52 ? 0.5 : 1;
    const key = icon + '|' + scale;
    if (slot.icon !== key) {
      slot.icon = key;
      slot.img.hidden = !icon;
      if (icon) {
        slot.img.src = iconUrl(icon);
        slot.img.style.width = (r?.w || 50) * scale + 'px';
        slot.img.style.height = (r?.h || 50) * scale + 'px';
      }
    }
    slot.img.style.marginLeft = (slot.offset[0] || 0) + (big && !packed && r?.w >= 52 ? 22 : 0) + 'px';
    slot.img.style.marginTop = -(slot.offset[1] || 0) + (big && !packed && r?.h >= 52 ? 22 : 0) + 'px';
    const wide = big && !packed && r?.w >= 52,
      tall = big && !packed && r?.h >= 52;
    const frames = this.comps.get(slot.name)?.val('Mouse_Over_Texture_Name').trim().split(/\s+/).filter(Boolean) || [];
    const frame = frames[Math.min(frames.length - 1, (wide ? 1 : 0) + (tall ? 2 : 0))],
      fr = iconCanvasRect(frame);
    slot.el.style.setProperty('--over', css(iconUrl(frame)));
    slot.el.style.setProperty('--over-w', (fr?.w || 0) + 'px');
    slot.el.style.setProperty('--over-h', (fr?.h || 0) + 'px');
    slot.el.style.setProperty('--over-x', (wide ? 22 : 0) + 'px');
    slot.el.style.setProperty('--over-y', (tall ? 22 : 0) + 'px');
    const blankRect = iconCanvasRect(blank);
    slot.el.style.setProperty('--blank', css(iconUrl(blank)));
    slot.el.style.setProperty('--blank-w', (blankRect?.w || 0) + 'px');
    slot.el.style.setProperty('--blank-h', (blankRect?.h || 0) + 'px');
    this.setText(slot.count, record?.count > 1 ? String(record.count) : '');
    slot.el.title = record
      ? nameOf(type) || db.t('TEXT_UNKNOWN')
      : db.t(this.comps.get(slot.name)?.val('Tooltip_Text').trim().split(/\s+/)[0]);
    slot.el.setAttribute('role', 'img');
    slot.el.setAttribute('aria-label', slot.el.title);
    if (type) slot.el.dataset.type = type.name;
    else delete slot.el.dataset.type;
  }
}

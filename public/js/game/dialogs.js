import { fontFamily, loadGameFonts } from '../fonts.js';
import { stretchedFontHeight } from '../fontpolicy.js';
import { onLanguageChange } from '../language.js';
import { loadNativeFont, paintNativeText } from '../nativefont.js';
import { db } from '../gamedata.js';
import { fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';
import { iconUrl, iconCanvasRect } from '../icons.js';
import { loadTextureCanvas, canvasUrl } from '../dds.js';
import { wrapDialogText, wrapStaticText, dialogFontPixels, dialogStaticText } from './dialogtext.js';

let data = null;
const rasterFonts = new Map();
const rasterKey = f => JSON.stringify([f.face, f.basePixels, f.wide]);
onLanguageChange(() => rasterFonts.clear(), 0);

function args(s) {
  const out = [];
  let cur = '',
    q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (ch === ',' && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const unq = s => (s || '').replace(/^"|"$/g, '');

function parseRC(text) {
  const dialogs = new Map();
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(IDD_\w+)\s+DIALOG(?:EX)?\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) continue;
    const dlg = { id: m[1], w: +m[4], h: +m[5], controls: [] };
    while (i < lines.length && lines[i].trim() !== 'BEGIN') i++;
    let stmt = '';
    const flush = () => {
      const s = stmt.trim();
      stmt = '';
      const k = s.match(/^(\w+)\s+(.*)$/s);
      if (!k) return;
      const kind = k[1],
        a = args(k[2]);
      let c = null;
      const n = j => parseInt(a[j], 10) || 0;
      if (/^(PUSHBUTTON|DEFPUSHBUTTON|LTEXT|CTEXT|RTEXT|GROUPBOX)$/.test(kind))
        c = { kind, text: unq(a[0]), id: a[1], x: n(2), y: n(3), w: n(4), h: n(5), style: a[6] || '' };
      else if (/^(EDITTEXT|COMBOBOX|LISTBOX|SCROLLBAR)$/.test(kind))
        c = { kind, text: '', id: a[0], x: n(1), y: n(2), w: n(3), h: n(4), style: a[5] || '' };
      else if (kind === 'CONTROL')
        c = { kind, text: unq(a[0]), id: a[1], cls: unq(a[2]), style: a[3] || '', x: n(4), y: n(5), w: n(6), h: n(7) };
      if (c) dlg.controls.push(c);
    };
    for (i++; i < lines.length && lines[i].trim() !== 'END'; i++) {
      if (/^\s{0,4}[A-Z]+\s/.test(lines[i])) flush();
      stmt += ' ' + lines[i].trim();
    }
    flush();
    dialogs.set(dlg.id, dlg);
  }
  return dialogs;
}

function section(node, firstWins = false) {
  const out = new Map();
  if (!node) return out;
  for (const c of node.children) {
    if (firstWins && out.has(c.tag.toUpperCase())) continue;
    const m = new Map();
    const leaf = c.children.length && c.children.every(k => !k.children.length);
    if (leaf) for (const k of c.children) m.set(k.tag, k.text.trim());
    else
      for (const k of c.children) {
        const mm = new Map();
        for (const kk of k.children) mm.set(kk.tag, kk.text.trim());
        m.set(k.tag, mm);
      }
    out.set(c.tag.toUpperCase(), m);
  }
  return out;
}

export async function loadDialogs() {
  await loadGameFonts();
  if (data) return data;
  const [rc, xml] = await Promise.all([fetchText('Data/Resources/GUIDialog/GUIDialogs.rc'), fetchText('Data/XML/GUIDialogs.xml')]);
  if (!rc || !xml) return null;
  const root = parseXML(xml).children.find(c => /GUIDialogs/i.test(c.tag));
  const find = t => root && root.children.find(c => c.tag.toLowerCase() === t);
  data = {
    dialogs: parseRC(rc),
    textures: section(find('textures')),
    fonts: section(find('fonts'), true),
    legacyFonts: section(find('fonts'))
  };
  return data;
}

const loose = new Map();
async function image(name) {
  if (!name || /^none$/i.test(name)) return null;
  const r = iconCanvasRect(name);
  if (r) return { url: iconUrl(name), w: r.w, h: r.h, atlas: true };
  const key = name.toUpperCase();
  if (!loose.has(key))
    loose.set(
      key,
      loadTextureCanvas(name)
        .then(async cv => (cv ? { url: await canvasUrl(cv), w: cv.width, h: cv.height } : null))
        .catch(() => null)
    );
  return loose.get(key);
}

function tex(dlgId, ctlId, key) {
  const T = data.textures;
  for (const id of [ctlId, dlgId, 'DEFAULT']) {
    const m = id && T.get(id.toUpperCase());
    if (m && m.has(key)) return m.get(key);
  }
  return '';
}

function font(ctlId, kind, nativeSize = false, dialogId = null) {
  const F = nativeSize ? data.fonts : data.legacyFonts,
    own = ctlId && F.get(ctlId.toUpperCase()),
    def = F.get('DEFAULT');
  const dialogDefault = dialogId && F.get(dialogId.toUpperCase())?.get(kind);
  const base = {
    ...Object.fromEntries((def && def.get('Global_Default')) || []),
    ...Object.fromEntries(dialogDefault instanceof Map ? dialogDefault : (def && def.get(kind)) || [])
  };
  const f = own ? { ...(nativeSize ? {} : base), ...Object.fromEntries(own) } : base;
  const rgb = s => {
    const c = (s || '255,255,255,255').split(/[\s,]+/).map(Number);
    return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;
  };
  const yes = s => /^(yes|true)$/i.test(s || '');
  const eaw = /^EmpireAtWar/i.test(f.Name || '') && document.body.classList.contains('game-fonts');
  const family = fontFamily(f.Name || 'Arial');
  const scale = nativeSize ? innerHeight / 768 : Math.min(innerHeight / 768, innerWidth / 1024),
    widthScale = nativeSize ? innerWidth / 1024 : scale;
  const basePixels = dialogFontPixels(innerHeight, parseInt(f.Size, 10) || 7),
    stretch = parseFloat(f.Stretch_Factor) || 1;
  const physical = stretchedFontHeight(basePixels, stretch);
  const face = f.Name || 'Arial',
    wide = parseFloat(f.Stretch_Factor) || 1;
  const bitmap = nativeSize ? rasterFonts.get(JSON.stringify([face, basePixels, wide])) : null;
  return {
    controlId: ctlId,
    kind,
    dialogId,
    face,
    basePixels,
    bitmap,
    family,
    px: nativeSize ? physical / scale : ((parseFloat(f.Size) || 7) * 96) / 72,
    metricScale: nativeSize ? scale : 1,
    widthScale: nativeSize ? widthScale : 1,
    glyphScale: basePixels / physical,
    native: nativeSize,
    xScale: nativeSize ? ((basePixels / physical) * scale) / widthScale : 1,
    padding: parseInt(f.Character_Padding, 10) || 0,
    eaw,
    bold: !eaw && /bold/i.test(f.Name || ''),
    top: rgb(f.Top_Color),
    bottom: rgb(f.Bottom_Color),
    emboss: yes(f.Emboss),
    outline: yes(f.Outline),
    wide: parseFloat(f.Stretch_Factor) || 1
  };
}

function styleText(el, f) {
  if (!f.native) el._legacyFont = f;
  el.style.fontSize = f.px + 'px';
  el.style.fontWeight = f.bold ? '700' : f.eaw ? '400' : '500';
  if (f.family) el.style.fontFamily = f.family;
  el.style.letterSpacing = f.native ? '0' : (f.wide - 1) * 0.12 + 'em';
  if (f.native) el.style.fontKerning = 'none';
  if (f.top !== f.bottom) {
    el.style.backgroundImage = `linear-gradient(${f.top}, ${f.bottom})`;
    el.style.webkitBackgroundClip = 'text';
    el.style.backgroundClip = 'text';
    el.style.color = 'transparent';
  } else el.style.color = f.top;
  if (f.outline)
    el.style.filter = 'drop-shadow(0.6px 0 0 #000) drop-shadow(-0.6px 0 0 #000) drop-shadow(0 0.6px 0 #000) drop-shadow(0 -0.6px 0 #000)';
  else if (f.emboss) el.style.textShadow = '1px 1px 0 rgba(0,0,0,0.85)';
}

function nativeLabel(el, text, f, options = {}) {
  el._nativeLabel = { text, f, options };
  el.style.fontFamily = f.family;
  if (!f.bitmap) {
    styleText(el, f);
    el.style.transform = `scaleX(${f.xScale})`;
    el.textContent = text;
    return;
  }
  el.style.transform = '';
  el.style.position ||= 'relative';
  el.style.letterSpacing = '0';
  paintNativeText(el, String(text), f.bitmap, {
    scaleX: f.widthScale,
    scaleY: f.metricScale,
    padding: f.padding,
    top: f.top,
    bottom: f.bottom,
    outline: f.outline,
    emboss: f.emboss,
    screenHeight: innerHeight,
    ...options
  });
}

const box = (parent, cls, x, y, w, h) => {
  const d = document.createElement('div');
  d.className = cls;
  d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  parent.appendChild(d);
  return d;
};
const bg = (el, img, how = '100% 100%', repeat = 'no-repeat') => {
  if (img) {
    el.style.backgroundImage = `url(${img.url})`;
    el.style.backgroundSize = how;
    el.style.backgroundRepeat = repeat;
  }
};

async function frame(el, w, h, get, prefix, outside = false, nativeRect = false) {
  const names = [
    'Top_Left',
    'Top',
    'Top_Right',
    'Right',
    'Bottom_Right',
    'Bottom',
    'Bottom_Left',
    'Left',
    'Background',
    'Top_Transition_Left',
    'Top_Transition_Right',
    'Bottom_Transition_Left',
    'Bottom_Transition_Right',
    'Left_Transition_Top',
    'Left_Transition_Bottom',
    'Right_Transition_Top',
    'Right_Transition_Bottom'
  ];
  const im = {};
  await Promise.all(
    names.map(async n => {
      im[n] = await image(get(prefix + n));
    })
  );
  const parts = [],
    initialWidth = w,
    initialHeight = h;
  const layout = (width = initialWidth, height = initialHeight) => {
    const anchor = parts.at(-1)?.nextSibling || null,
      hidden = new Map(parts.map(part => [part.className, part.hidden]));
    for (const part of parts) part.remove();
    parts.length = 0;
    w = width;
    h = height;
    const s = n => (im[n] ? [im[n].w, im[n].h] : [0, 0]);
    const part = (cls, x, y, w, h, img) => {
      const d = box(el, cls, x, y, w, h);
      d.hidden = hidden.get(cls) || false;
      if (anchor) el.insertBefore(d, anchor);
      parts.push(d);
      bg(d, img);
      return d;
    };
    const B = im.Background;
    let ox = 0,
      oy = 0;
    if (!nativeRect && B && (B.w > 256 || B.h > 256)) {
      ox = Math.min(0, (w - B.w) / 2);
      oy = Math.min(0, (h - B.h) / 2);
      const W = Math.max(w, B.w),
        H = Math.max(h, B.h);
      part('dlg-bg', ox, oy, W, H, B);
      w = W;
      h = H;
    } else {
      if (B) part('dlg-bg', 0, 0, w, h, B);
      if (outside) {
        const l = s('Left')[0],
          t = s('Top')[1],
          r = s('Right')[0],
          b = s('Bottom')[1];
        ox = -l;
        oy = -t;
        w += l + r;
        h += t + b;
      }
    }
    const [tlw, tlh] = s('Top_Left'),
      [trw, trh] = s('Top_Right'),
      [blw, blh] = s('Bottom_Left'),
      [brw, brh] = s('Bottom_Right');
    const put = (n, x, y, ww, hh) => {
      if (im[n] && ww > 0 && hh > 0) part('dlg-fr', x + ox, y + oy, ww, hh, im[n]);
    };
    const tt = s('Top_Transition_Left')[0],
      ttr = s('Top_Transition_Right')[0],
      bt = s('Bottom_Transition_Left')[0],
      btr = s('Bottom_Transition_Right')[0];
    const lt = s('Left_Transition_Top')[1],
      ltb = s('Left_Transition_Bottom')[1],
      rt = s('Right_Transition_Top')[1],
      rtb = s('Right_Transition_Bottom')[1];
    put('Top', tlw + tt, 0, w - tlw - trw - tt - ttr, s('Top')[1]);
    put('Bottom', blw + bt, h - s('Bottom')[1], w - blw - brw - bt - btr, s('Bottom')[1]);
    put('Left', 0, tlh + lt, s('Left')[0], h - tlh - blh - lt - ltb);
    put('Right', w - s('Right')[0], trh + rt, s('Right')[0], h - trh - brh - rt - rtb);
    put('Top_Transition_Left', tlw, 0, tt, s('Top_Transition_Left')[1]);
    put('Top_Transition_Right', w - trw - ttr, 0, ttr, s('Top_Transition_Right')[1]);
    put('Bottom_Transition_Left', blw, h - s('Bottom_Transition_Left')[1], bt, s('Bottom_Transition_Left')[1]);
    put('Bottom_Transition_Right', w - brw - btr, h - s('Bottom_Transition_Right')[1], btr, s('Bottom_Transition_Right')[1]);
    put('Left_Transition_Top', 0, tlh, s('Left_Transition_Top')[0], lt);
    put('Left_Transition_Bottom', 0, h - blh - ltb, s('Left_Transition_Bottom')[0], ltb);
    put('Right_Transition_Top', w - s('Right_Transition_Top')[0], trh, s('Right_Transition_Top')[0], rt);
    put('Right_Transition_Bottom', w - s('Right_Transition_Bottom')[0], h - brh - rtb, s('Right_Transition_Bottom')[0], rtb);
    put('Top_Left', 0, 0, tlw, tlh);
    put('Top_Right', w - trw, 0, trw, trh);
    put('Bottom_Left', 0, h - blh, blw, blh);
    put('Bottom_Right', w - brw, h - brh, brw, brh);
  };
  layout();
  if (nativeRect) (el._nativeFrames ||= []).push(layout);
  return layout;
}

async function gadgetInsets(id, cid) {
  const out = {};
  await Promise.all(
    ['Left', 'Top', 'Right', 'Bottom'].map(async side => {
      const im = await image(tex(id, cid, 'Small_Frame_' + side));
      out[side.toLowerCase()] = im ? (/Left|Right/.test(side) ? im.w : im.h) : 0;
    })
  );
  return out;
}

async function nativeList(parent, id, c) {
  const inset = await gadgetInsets(id, c.id),
    f = font(c.id, 'List_Box', true, id);
  f.bitmap ||= await loadNativeFont(f.face, f.basePixels, f.wide);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${f.bold ? 'bold ' : ''}${f.px * f.metricScale}px ${f.family || 'Arial'}`;
  ctx.fontKerning = 'none';
  const metrics = ctx.measureText('Mg');
  let rowHeight = f.bitmap
    ? f.bitmap.height / f.metricScale
    : Math.ceil((metrics.fontBoundingBoxAscent || f.px * f.metricScale) + (metrics.fontBoundingBoxDescent || 0)) / f.metricScale;
  let ix = inset.left * 2,
    iy = inset.top * 2,
    count = Math.max(0, Math.floor((c.h - iy * 2) / rowHeight)),
    height = count * rowHeight + iy * 2;
  const d = box(parent, 'dlg-native-list', c.x, c.y, c.w, height);
  const up = await image(tex(id, c.id, 'Scroll_Up_Button')),
    sw = up?.w || 0;
  const layoutFrame = await frame(d, c.w - sw, height, k => tex(id, c.id, k), 'Small_Frame_', false, true);
  const rows = box(d, 'dlg-native-lines', ix, iy, c.w - sw - ix * 2, count * rowHeight);
  styleText(rows, f);
  rows.style.fontKerning = 'none';
  rows.style.lineHeight = rowHeight + 'px';
  rows.style.letterSpacing = '0';
  rows.style.width = (c.w - sw - ix * 2) / (f.bitmap ? 1 : f.xScale) + 'px';
  rows.style.transformOrigin = 'left top';
  rows.style.transform = f.bitmap ? '' : `scaleX(${f.xScale})`;
  if (f.bitmap) {
    rows.style.filter = '';
    rows.style.textShadow = '';
    rows.style.backgroundImage = 'none';
  }
  const scroll = box(d, 'dlg-native-scroll disabled', c.w - sw - inset.right, 0, sw, height);
  scroll.style.pointerEvents = 'none';
  const parts = {};
  for (const [name, key] of [
    ['up', 'Scroll_Up_Button'],
    ['down', 'Scroll_Down_Button'],
    ['track', 'Scroll_Middle'],
    ['tab', 'Scroll_Tab']
  ]) {
    const im = await image(tex(id, c.id, key)),
      over = await image(tex(id, c.id, key + '_Mouse_Over')),
      pressed = await image(tex(id, c.id, key + '_Pressed')),
      disabled = await image(tex(id, c.id, key + '_Disabled'));
    const el = document.createElement('div');
    el.className = name === 'track' ? 'dlg-sbt' : 'dlg-sb';
    scroll.appendChild(el);
    el.style.position = 'absolute';
    el.style.width = sw + 'px';
    el.style.height = (im?.h || sw) + 'px';
    const u = a => (a ? `url(${a.url})` : 'none');
    el.style.setProperty('--up', u(im));
    el.style.setProperty('--over', u(over || im));
    el.style.setProperty('--down', u(pressed || im));
    el.style.setProperty('--off', u(disabled || im));
    parts[name] = { el, height: im?.h || sw };
  }
  let start = parts.up.height,
    trackHeight = Math.max(0, height - start - parts.down.height);
  parts.up.el.style.top = '0px';
  parts.down.el.style.bottom = '0px';
  parts.track.el.style.top = start + 'px';
  parts.track.el.style.height = trackHeight + 'px';
  let lines = [],
    first = 0,
    max = 0,
    fraction = 0,
    replay = null,
    preserving = false;
  d._preserveList = fn => {
    const position = first,
      previous = preserving;
    preserving = true;
    try {
      fn();
    } finally {
      preserving = previous;
      set(position);
    }
  };
  d._nativeFont = f;
  d._nativeReflow = () => {
    const previousFirst = first;
    ctx.font = `${f.bold ? 'bold ' : ''}${f.px * f.metricScale}px ${f.family || 'Arial'}`;
    rows.style.fontFamily = f.family;
    rowHeight = f.bitmap ? f.bitmap.height / f.metricScale : rowHeight;
    ix = inset.left * 2;
    iy = inset.top * 2;
    count = Math.max(0, Math.floor((c.h - iy * 2) / rowHeight));
    height = count * rowHeight + iy * 2;
    d.style.height = height + 'px';
    Object.assign(rows.style, {
      left: ix + 'px',
      top: iy + 'px',
      width: c.w - sw - ix * 2 + 'px',
      height: count * rowHeight + 'px',
      lineHeight: rowHeight + 'px'
    });
    scroll.style.left = c.w - sw - inset.right + 'px';
    scroll.style.height = height + 'px';
    trackHeight = Math.max(0, height - start - parts.down.height);
    parts.track.el.style.height = trackHeight + 'px';
    layoutFrame(c.w - sw, height);
    d._preserveList(() => replay?.());
    set(previousFirst);
  };
  const textGap = 3 / (f.bitmap ? 1 : f.xScale);
  let drawLine = text => {
    const row = document.createElement('div');
    nativeLabel(row, text || '', f, { top: rows.style.color || f.top, bottom: rows.style.color || f.bottom });
    row.style.height = rowHeight + 'px';
    row.style.marginLeft = textGap + 'px';
    return row;
  };
  const set = (n, at = null) => {
    first = Math.max(0, Math.min(max, Math.round(n)));
    fraction = at ?? (max ? first / max : 0);
    rows.replaceChildren(...lines.slice(first, first + count).map((text, i) => drawLine(text, first + i)));
    parts.tab.el.style.top = start + fraction * Math.max(0, trackHeight - parts.tab.height) + 'px';
  };
  const point = e => {
    const r = parts.track.el.getBoundingClientRect(),
      ratio = r.height / Math.max(1, trackHeight);
    const at = Math.max(
      0,
      Math.min(1, (e.clientY - r.top - (parts.tab.height * ratio) / 2) / Math.max(1, r.height - parts.tab.height * ratio))
    );
    set(Math.min(max, Math.trunc((max + 1) * at)), at);
  };
  const drag = e => {
    if (!max || e.button !== 0) return;
    e.preventDefault();
    point(e);
    const move = e => point(e),
      end = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', end);
      };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
  };
  parts.track.el.onpointerdown = drag;
  parts.tab.el.onpointerdown = drag;
  for (const [part, delta] of [
    [parts.up, -1],
    [parts.down, 1]
  ])
    part.el.onpointerdown = e => {
      if (!max || e.button !== 0) return;
      e.preventDefault();
      set(first + delta);
      let counter = 0,
        running = true,
        frame,
        x = e.clientX,
        y = e.clientY;
      const move = e => {
          x = e.clientX;
          y = e.clientY;
        },
        end = () => {
          running = false;
          cancelAnimationFrame(frame);
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', end);
        };
      const tick = () => {
        if (!running || !d.isConnected) {
          end();
          return;
        }
        counter++;
        const r = part.el.getBoundingClientRect();
        if (counter > 10 && counter % 2 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) set(first + delta);
        frame = requestAnimationFrame(tick);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', end);
      frame = requestAnimationFrame(tick);
    };
  d.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      set(first + Math.sign(e.deltaY));
    },
    { passive: false }
  );
  d._fillText = (text, color) => {
    replay = () => d._fillText(text, color);
    if (f.bitmap && !f.bitmap.has(text)) {
      const token = (d._textRequest = Symbol()),
        keep = preserving;
      f.bitmap.ensure(text).then(() => {
        if (d._textRequest === token) {
          if (keep) d._preserveList(() => d._fillText(text, color));
          else d._fillText(text, color);
        }
      });
      return;
    }
    d._textRequest = null;
    const advances = new Map(),
      measure = text =>
        [...text].reduce((n, ch) => {
          if (!advances.has(ch))
            advances.set(
              ch,
              (f.bitmap ? f.bitmap.measure(ch, f.padding) : Math.round(ctx.measureText(ch).width * f.glyphScale) + f.padding) / f.widthScale
            );
          return n + advances.get(ch);
        }, 0);
    lines = wrapDialogText(text, c.w - sw - ix * 4, measure);
    max = Math.max(0, lines.length - count);
    rows.style.color = color;
    scroll.classList.toggle('disabled', max === 0);
    scroll.style.pointerEvents = max ? 'auto' : 'none';
    set(0);
  };
  d._fillColoredText = (items, { follow = true } = {}) => {
    replay = () => d._fillColoredText(items, { follow });
    const content = items.map(item => item.text).join('');
    if (f.bitmap && !f.bitmap.has(content)) {
      const token = (d._textRequest = Symbol()),
        keep = preserving;
      f.bitmap.ensure(content).then(() => {
        if (d._textRequest === token) {
          if (keep) d._preserveList(() => d._fillColoredText(items, { follow }));
          else d._fillColoredText(items, { follow });
        }
      });
      return;
    }
    d._textRequest = null;
    const advances = new Map(),
      measure = text =>
        [...text].reduce((n, ch) => {
          if (!advances.has(ch))
            advances.set(
              ch,
              (f.bitmap ? f.bitmap.measure(ch, f.padding) : Math.round(ctx.measureText(ch).width * f.glyphScale) + f.padding) / f.widthScale
            );
          return n + advances.get(ch);
        }, 0);
    drawLine = item => {
      const row = document.createElement('div');
      nativeLabel(row, item.text || '', f, { top: item.color, bottom: item.color });
      row.style.height = rowHeight + 'px';
      row.style.marginLeft = textGap + 'px';
      row.style.color = item.color;
      return row;
    };
    rows.style.backgroundImage = 'none';
    lines = items.flatMap(item =>
      (item.wrap ? wrapDialogText(item.text, c.w - sw - ix * 4, measure) : [item.text]).map(text => ({ text, color: item.color }))
    );
    max = Math.max(0, lines.length - count);
    scroll.classList.toggle('disabled', !max);
    scroll.style.pointerEvents = max ? 'auto' : 'none';
    set(follow ? max : 0);
  };
  d._fillRows = (items, pick, open) => {
    replay = () => d._fillRows(items, pick, open);
    const sprites = new Map(),
      advances = new Map(),
      wAdvance =
        (f.bitmap ? f.bitmap.measure('W', f.padding) : Math.round(ctx.measureText('W').width * f.glyphScale) + f.padding) / f.widthScale;
    const measure = text =>
      [...text].reduce((n, ch) => {
        if (!advances.has(ch))
          advances.set(
            ch,
            (f.bitmap ? f.bitmap.measure(ch, f.padding) : Math.round(ctx.measureText(ch).width * f.glyphScale) + f.padding) / f.widthScale
          );
        return n + advances.get(ch);
      }, 0);
    if (d._listItems !== items || !(d._listSelectedIndex >= 0 && d._listSelectedIndex < items.length)) d._listSelectedIndex = -1;
    const visible = new Map();
    let selected = d._listSelectedIndex,
      hovered = -1;
    d._listItems = items;
    const paint = (e, i) => {
      e.style.background = i === selected ? 'rgba(255,255,255,0.3)' : i === hovered ? 'rgba(0,0,170,0.3)' : 'transparent';
      e.setAttribute('aria-selected', String(i === selected));
    };
    rows.style.transform = '';
    rows.style.width = c.w - sw - ix * 2 + 'px';
    drawLine = (row, i) => {
      const e = document.createElement('div');
      e.className = 'dlg-native-row';
      e.setAttribute('role', 'option');
      e.tabIndex = 0;
      e.style.cssText = `position:relative;left:${-inset.left}px;width:${c.w - sw - ix}px;height:${rowHeight}px;cursor:pointer;white-space:nowrap`;
      visible.set(i, e);
      paint(e, i);
      const sprite = sprites.get(row.icon),
        ratio = sprite ? sprite.h / sprite.w : 1;
      const imageWidth = row.icon ? Math.min(wAdvance, rowHeight / ratio) : 0,
        imageHeight = imageWidth * ratio;
      if (sprite) bg(box(e, 'dlg-native-row-icon', inset.left, (rowHeight - imageHeight) / 2, imageWidth, imageHeight), sprite);
      const left = inset.left + imageWidth + 3,
        available = c.w - sw - ix * 2 - imageWidth - 3;
      for (const column of row.columns || [{ text: row.label, at: 0 }]) {
        let label = String(column.text || '');
        if (!row.columns) while (label && measure(label) > available) label = label.slice(0, -1);
        const text = box(
          e,
          'dlg-native-row-text',
          left + (column.at || 0) * (c.w - sw),
          0,
          Math.max(0, available) / (f.bitmap ? 1 : f.xScale),
          rowHeight
        );
        text.textContent = label;
        text.style.transformOrigin = 'left top';
        text.style.transform = f.bitmap ? '' : `scaleX(${f.xScale})`;
        const top = column.color || row.color,
          bottom = column.bottomColor || row.bottomColor || top;
        if (top && bottom !== top) {
          text.style.backgroundImage = `linear-gradient(${top},${bottom})`;
          text.style.backgroundClip = 'text';
          text.style.webkitBackgroundClip = 'text';
          text.style.color = 'transparent';
        } else if (top) text.style.color = top;
        if (f.bitmap) nativeLabel(text, label, f, { top: top || f.top, bottom: bottom || f.bottom });
      }
      e.onmouseenter = () => {
        hovered = i;
        paint(e, i);
      };
      e.onmouseleave = () => {
        hovered = -1;
        paint(e, i);
      };
      e.onclick = () => {
        selected = i;
        d._listSelectedIndex = i;
        for (const [n, node] of visible) paint(node, n);
        pick(row);
      };
      e.onkeydown = event => {
        if (event.code === 'Enter' || event.code === 'Space') {
          event.preventDefault();
          e.click();
        }
      };
      e.ondblclick = () => open(row);
      return e;
    };
    d.setAttribute('role', 'listbox');
    lines = items;
    max = Math.max(0, items.length - count);
    scroll.classList.toggle('disabled', max === 0);
    scroll.style.pointerEvents = max ? 'auto' : 'none';
    set(0);
    Promise.all([...new Set(items.map(row => row.icon).filter(Boolean))].map(async name => [name, await image(name)])).then(loaded => {
      if (!d.isConnected || lines !== items) return;
      for (const [name, sprite] of loaded) if (sprite) sprites.set(name, sprite);
      visible.clear();
      set(first);
    });
    const content = items.map(row => [row.label, ...(row.columns || []).map(c => c.text)].join('')).join('');
    if (f.bitmap && !f.bitmap.has(content))
      f.bitmap.ensure(content).then(() => {
        if (lines === items && d.isConnected) {
          advances.clear();
          visible.clear();
          set(first);
        }
      });
    const selectKey = key => {
      const i = items.findIndex(row => row.key === key);
      if (i < 0) return;
      selected = i;
      d._listSelectedIndex = i;
      visible.clear();
      set(i < first ? i : i >= first + count ? i - count + 1 : first);
      pick(items[i]);
    };
    d._selectListRow = selectKey;
    return {
      selected: () => (d._listItems === items && d._listSelectedIndex >= 0 ? items[d._listSelectedIndex] || null : null),
      select(key) {
        if (d._listItems === items) d._selectListRow(key);
      }
    };
  };
  d.setAttribute('role', 'region');
  return d;
}

async function anchorAt(id, anchor, w, h) {
  const [left, top] = await Promise.all([image(tex(id, null, 'Frame_Left')), image(tex(id, null, 'Frame_Top'))]);
  const W = w / 1024,
    H = h / 768,
    l = (left?.w || 0) / 1024,
    t = (top?.h || 0) / 768,
    mid = (1 - H) * 0.5;
  const at = {
    1: [l + 0.008, t + 0.006],
    2: [1 - W, t],
    3: [l + 0.008, 0.994 - H],
    4: [0.992 - W, 0.994 - H],
    5: [(1 - W) * 0.5, t + 0.006 + 0.02625],
    6: [(1 - W) * 0.5, 0.994 - H],
    7: [l + 0.008, mid],
    8: [0.992 - W, mid]
  }[anchor];
  return at ? [at[0] * 1024, at[1] * 768] : null;
}

const ENGINE_ANCHOR = {
  IDD_MAIN_MENU_DIALOG: 2,
  IDD_BATTLE_END_DIALOG: 9,
  IDD_CAMPAIGN_SCORE_DIALOG: 9,
  IDD_LAN_LOBBY_DIALOG: 9,
  IDD_MAIN_CAMPAIGN_DIALOG: 9,
  IDD_SKIRMISH_BATTLE_LOAD_DIALOG: 9,
  IDD_SPACE_BATTLE_LOAD_DIALOG: 9,
  IDD_LAND_BATTLE_LOAD_DIALOG: 9,
  IDD_SPACE_MISSION_LOAD_DIALOG: 9,
  IDD_LAND_MISSION_LOAD_DIALOG: 9,
  IDD_INGAME_CHAT_DIALOG: 1,
  IDD_MAIN_OPTIONS_DIALOG: 2,
  IDD_MULTIPLAYER_DIALOG: 2,
  IDD_SINGLE_PLAYER_GAMES_MENU_DIALOG: 2,
  IDD_STORY_DIALOG: 5
};

export async function openDialog(
  id,
  {
    parent = document.body,
    modal = true,
    adjust = null,
    at = null,
    anchor = null,
    cls = '',
    nativeImages = false,
    nativeLists = false,
    nativeFonts = false,
    nativeFrame = nativeFonts,
    stretch = nativeFonts,
    extra = null,
    size = null
  } = {}
) {
  if (!data) await loadDialogs();
  const original = data && data.dialogs.get(id);
  if (!original) return null;
  const resource = extra?.length || size ? { ...original, ...size, controls: [...original.controls, ...(extra || [])] } : original;
  anchor ??= at ? 0 : (ENGINE_ANCHOR[id] ?? 0);
  if (anchor === 9 && !stretch) anchor = 0;
  if (anchor >= 1 && anchor <= 8) at = await anchorAt(id, anchor, resource.w, resource.h);
  const centered = (size, reference) => Math.trunc(Math.fround(Math.fround(1 - Math.fround(size / reference)) * (reference / 2)));
  const dx = anchor === 9 ? centered(resource.w, 1024) : 0,
    dy = anchor === 9 ? centered(resource.h, 768) : 0;
  const dlg =
    anchor === 9 ? { ...resource, w: 1024, h: 768, controls: resource.controls.map(c => ({ ...c, x: c.x + dx, y: c.y + dy })) } : resource;
  if (nativeFonts) {
    const descriptors = dlg.controls.flatMap(c =>
      ['Push_Button', 'Radio_Button', 'Check_Box', 'L_Text', 'C_Text', 'R_Text', 'List_Box', 'Overlay_Caption_Text'].map(kind =>
        font(c.id, kind, true, id)
      )
    );
    await Promise.all(
      [...new Map(descriptors.map(f => [rasterKey(f), f])).values()].map(async f =>
        rasterFonts.set(rasterKey(f), await loadNativeFont(f.face, f.basePixels, f.wide))
      )
    );
  }
  const veil = document.createElement('div');
  veil.className = 'dlg-veil' + (modal ? ' modal' : '') + (cls ? ' ' + cls : '');
  const el = document.createElement('div');
  el.className = 'dlg';
  el.style.width = dlg.w + 'px';
  el.style.height = dlg.h + 'px';
  veil.appendChild(el);
  if (at) el.style.transformOrigin = '0 0';
  let layoutVersion = 0;
  const fit = () => {
    const sy = stretch ? innerHeight / 768 : Math.min(innerHeight / 768, innerWidth / 1024),
      sx = stretch ? innerWidth / 1024 : sy;
    el.style.transform = at
      ? `scale(${sx},${sy}) translate(${at[0] - 512}px, ${at[1] - 384}px)`
      : `translate(-50%, -50%) scale(${sx},${sy})`;
  };
  fit();
  const resize = async () => {
    fit();
    if (!nativeFonts) {
      for (const node of [el, ...el.querySelectorAll('*')]) {
        const f = node._legacyFont;
        if (f) styleText(node, font(f.controlId, f.kind, false, f.dialogId));
      }
      return;
    }
    const version = ++layoutVersion;
    const nodes = [el, ...el.querySelectorAll('*')],
      fonts = [...new Set(nodes.flatMap(n => [n._nativeLabel?.f, n._nativeFont].filter(Boolean)))];
    const updated = await Promise.all(
      fonts.map(async f => {
        const next = font(f.controlId, f.kind, true, f.dialogId);
        next.bitmap ||= await loadNativeFont(next.face, next.basePixels, next.wide);
        return [f, next];
      })
    );
    if (version !== layoutVersion || !veil.isConnected) return;
    for (const [f, next] of updated) Object.assign(f, next);
    for (const node of nodes) node._nativeReflow?.();
    for (const node of [el, ...el.querySelectorAll('*')]) {
      if (!node._nativeReflow) for (const layout of node._nativeFrames || []) layout();
      const label = node._nativeLabel;
      if (label) nativeLabel(node, label.text, label.f, label.options);
    }
  };
  addEventListener('resize', resize);
  await frame(el, dlg.w, dlg.h, k => tex(id, null, k), 'Frame_', true, nativeFrame);
  const ctls = new Map(),
    sources = new Map(),
    refreshers = new Set(),
    controlFont = (cid, kind) => font(cid, kind, nativeFonts, id);
  for (const c0 of dlg.controls) {
    const c = (adjust && adjust(c0)) || c0;
    const text = /^TEXT_/.test(c.text) ? db.t(c.text) || '' : '';
    let d;
    if (c.kind === 'PUSHBUTTON' || c.kind === 'DEFPUSHBUTTON') {
      d = box(el, 'dlg-btn', c.x, c.y, c.w, c.h);
      const caps = {};
      for (const st of ['', '_Mouse_Over', '_Pressed', '_Disabled'])
        for (const part of ['Left', 'Middle', 'Right']) caps[part + st] = await image(tex(id, c.id, 'Button_' + part + st));
      let lw = 0,
        rw = 0,
        bh = c.h;
      const sized = nativeFonts || stretch;
      const capW = im => (im ? (sized ? im.w : Math.round((im.w * c.h) / im.h)) : 0);
      const layer = st => {
        const L = caps['Left' + st],
          M = caps['Middle' + st],
          R = caps['Right' + st];
        if (!M) return '';
        if (nativeFonts && !M.atlas) return `url(${M.url}) left top / 100% 100% no-repeat`;
        return `${L ? `url(${L.url}) left top / ${lw}px 100% no-repeat, ` : ''}${R ? `url(${R.url}) right top / ${rw}px 100% no-repeat, ` : ''}url(${M.url}) ${lw}px top / calc(100% - ${lw + rw}px) 100% no-repeat`;
      };
      const layout = () => {
        lw = capW(caps.Left);
        rw = capW(caps.Right);
        bh = sized && caps.Middle ? caps.Middle.h : c.h;
        d.style.height = bh + 'px';
        if (nativeFonts && caps.Middle && !caps.Middle.atlas) d.style.width = caps.Middle.w + 'px';
        d.style.setProperty('--up', layer(''));
        d.style.setProperty('--over', layer('_Mouse_Over') || layer(''));
        d.style.setProperty('--down', layer('_Pressed') || layer(''));
        d.style.setProperty('--off', layer('_Disabled') || layer(''));
      };
      layout();
      if (nativeFonts) d._nativeReflow = layout;
      const t = document.createElement('span');
      t.textContent = text;
      d.appendChild(t);
      const f = controlFont(c.id, 'Push_Button');
      styleText(t, f);
      if (nativeFonts) {
        t.style.position = 'relative';
        t.style.zIndex = 1;
        nativeLabel(t, text, f);
        d._setText = (value, color) => nativeLabel(t, value, f, color ? { top: color, bottom: color } : {});
      }
      d.addEventListener('mouseenter', () => window.game && window.game.audio.play('GUI_Highlight_Mouse_Over'));
      d.addEventListener('click', () => window.game && window.game.audio.play('GUI_Button_Press_2_SFX'));
    } else if (c.kind === 'LTEXT' || c.kind === 'CTEXT' || c.kind === 'RTEXT') {
      d = box(el, 'dlg-txt', c.x, c.y, c.w, c.h);
      d.style.textAlign = c.kind === 'LTEXT' ? 'left' : c.kind === 'RTEXT' ? 'right' : 'center';
      d.textContent = nativeFonts ? dialogStaticText(text) : text;
      const f = controlFont(c.id, c.kind === 'RTEXT' ? 'R_Text' : c.kind === 'CTEXT' ? 'C_Text' : 'L_Text');
      styleText(d, f);
      if (nativeFonts) {
        d.style.pointerEvents = 'none';
        {
          d.style.filter = '';
          d.style.textShadow = '';
          d.style.backgroundImage = 'none';
          let lastText = text,
            lastColor = null;
          const setText = (value, color = null) => {
            lastText = value;
            lastColor = color;
            if (!f.bitmap) {
              styleText(d, f);
              d.textContent = dialogStaticText(value);
              const ctx = document.createElement('canvas').getContext('2d');
              ctx.font = `${f.bold ? 'bold ' : ''}${f.px * f.metricScale}px ${f.family || 'Arial'}`;
              const m = ctx.measureText('Mg');
              d.style.lineHeight = ((m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / f.metricScale) * 1.05 + 'px';
              d.style.whiteSpace = 'pre-line';
              d.style.width = c.w / f.xScale + 'px';
              d.style.transformOrigin = 'left top';
              d.style.transform = `scaleX(${f.xScale})`;
              return;
            }
            d.style.width = c.w + 'px';
            d.style.transform = '';
            d.style.filter = '';
            d.style.textShadow = '';
            d.style.backgroundImage = 'none';
            if (!f.bitmap.has(value)) {
              const token = (d._staticTextRequest = Symbol());
              f.bitmap.ensure(value).then(() => {
                if (d._staticTextRequest === token) setText(value, color);
              });
              return;
            }
            d._staticTextRequest = null;
            const effect = Math.trunc(Math.fround(innerHeight / 600) + 0.5),
              lines = wrapStaticText(value, c.w * f.widthScale, t => f.bitmap.measure(t, f.padding) + (f.outline ? effect : 0)),
              pitch = ((f.bitmap.height + (f.outline || f.emboss ? effect : 0)) * 1.05) / f.metricScale;
            d.replaceChildren();
            d.setAttribute('aria-label', dialogStaticText(value));
            for (const line of lines) {
              const row = document.createElement('div');
              row.style.cssText = `display:flex;justify-content:${c.kind === 'LTEXT' ? 'flex-start' : c.kind === 'RTEXT' ? 'flex-end' : 'center'};height:${pitch}px`;
              nativeLabel(row, line, f, color ? { top: color, bottom: color } : {});
              d.appendChild(row);
            }
          };
          d._nativeFont = f;
          d._nativeReflow = () => setText(lastText, lastColor);
          d._setText = setText;
          setText(text);
        }
      }
    } else if (c.kind === 'CONTROL' && /DIALOG_IMAGE/i.test(c.cls)) {
      d = box(el, 'dlg-img', c.x, c.y, c.w, c.h);
      if (nativeImages) {
        const inset = await gadgetInsets(id, c.id);
        await frame(d, c.w, c.h, k => (k.endsWith('Background') ? 'none' : tex(id, c.id, k)), 'Small_Frame_', false, nativeFrame);
        d._image = box(d, 'dlg-img', inset.left, inset.top, c.w - inset.left - inset.right, c.h - inset.top - inset.bottom);
      }
    } else if (c.kind === 'CONTROL' && /trackbar/i.test(c.cls) && /TBS_VERT/.test(c.style)) {
      d = box(el, 'dlg-scroll', c.x, c.y, c.w, c.h);
      d.hidden = true;
      const part = async (cls, key, x, y, w, h) => {
        const p = box(d, cls, x, y, w, h);
        const up = await image(tex(id, c.id, key)),
          over = await image(tex(id, c.id, key + '_Mouse_Over')),
          down = await image(tex(id, c.id, key + '_Pressed'));
        const u = im => (im ? `url(${im.url})` : 'none');
        p.style.setProperty('--up', u(up));
        p.style.setProperty('--over', u(over || up));
        p.style.setProperty('--down', u(down || up));
        return p;
      };
      const tab = await image(tex(id, c.id, 'Trackbar_Scroll_Tab'));
      const tabH = tab ? Math.round((tab.h * c.w) / tab.w) : c.w;
      d._up = await part('dlg-sb', 'Trackbar_Scroll_Up_Button', 0, 0, c.w, c.w);
      d._down = await part('dlg-sb', 'Trackbar_Scroll_Down_Button', 0, c.h - c.w, c.w, c.w);
      d._track = await part('dlg-sbt', 'Trackbar_Scroll_Middle', 0, c.w, c.w, c.h - 2 * c.w);
      d._tab = await part('dlg-sb', 'Trackbar_Scroll_Tab', 0, c.w, c.w, tabH);
      d._span = c.h - 2 * c.w - tabH;
      d._top = c.w;
    } else if (c.kind === 'CONTROL' && /trackbar/i.test(c.cls)) {
      d = box(el, 'dlg-slider', c.x, c.y, c.w, c.h);
      const h = c.h,
        im = {};
      for (const k of [
        'Dial_Left',
        'Dial_Middle',
        'Dial_Right',
        'Dial_Tab',
        'Dial_Minus',
        'Dial_Plus',
        'Dial_Minus_Mouse_Over',
        'Dial_Plus_Mouse_Over',
        'Dial_Minus_Pressed',
        'Dial_Plus_Pressed'
      ])
        im[k] = await image(tex(id, c.id, k));
      const wOf = k => (im[k] ? Math.round((im[k].w * h) / im[k].h) : 0),
        u = k => (im[k] ? `url(${im[k].url})` : 'none');
      const bw = wOf('Dial_Minus'),
        lw = wOf('Dial_Left'),
        rw = wOf('Dial_Right'),
        tw = wOf('Dial_Tab') || h;
      const btn = (k, x) => {
        const p = box(d, 'dlg-sb', x, 0, bw, h);
        p.style.setProperty('--up', u(k));
        p.style.setProperty('--over', u(k + '_Mouse_Over'));
        p.style.setProperty('--down', u(k + '_Pressed'));
        return p;
      };
      d._minus = btn('Dial_Minus', 0);
      d._plus = btn('Dial_Plus', c.w - bw);
      d._track = box(d, 'dlg-dial', bw, 0, c.w - 2 * bw, h);
      d._track.style.background = `${u('Dial_Left')} left top / ${lw}px 100% no-repeat, ${u('Dial_Right')} right top / ${rw}px 100% no-repeat, ${u('Dial_Middle')} ${lw}px top / calc(100% - ${lw + rw}px) 100% no-repeat`;
      d._tab = box(d, 'dlg-tab', bw, 0, tw, h);
      d._tab.style.background = `${u('Dial_Tab')} center / 100% 100% no-repeat`;
      d._x0 = bw;
      d._span = c.w - 2 * bw - tw;
    } else if (c.kind === 'CONTROL' && /^button$/i.test(c.cls) && /RADIOBUTTON/.test(c.style)) {
      d = box(el, 'dlg-radio', c.x, c.y, c.w, c.h);
      const u = async k => {
        const im = await image(tex(id, c.skin || c.id, k));
        return im ? `url(${im.url})` : 'none';
      };
      d.style.setProperty('--on', await u('Radio_On'));
      d.style.setProperty('--off', await u('Radio_Off'));
      d.style.setProperty('--over', await u('Radio_Mouse_Over'));
      const off = nativeFonts ? await image(tex(id, c.id, 'Radio_Off')) : null;
      if (off) {
        d._nativeReflow = () => {
          d.style.width = off.w + 'px';
          d.style.height = off.h + 'px';
        };
        d._nativeReflow();
      }
      const t = document.createElement('span');
      t.textContent = text;
      d.appendChild(t);
      const f = controlFont(c.id, nativeFonts ? 'Radio_Button' : 'Push_Button');
      styleText(t, f);
      if (nativeFonts && !/BS_PUSHLIKE/.test(c.style)) {
        t.style.position = 'absolute';
        t.style.left = (off?.w || 0) + 14 + 'px';
        t.style.pointerEvents = 'none';
      }
      if (nativeFonts) {
        nativeLabel(t, text, f);
        d._setText = (value, color) => nativeLabel(t, value, f, color ? { top: color, bottom: color } : {});
      }
    } else if (c.kind === 'CONTROL' && /^button$/i.test(c.cls) && /CHECKBOX/.test(c.style)) {
      d = box(el, 'dlg-check', c.x, c.y, c.w, c.h);
      const on = await image(tex(id, c.id, 'Check_On')),
        off = await image(tex(id, c.id, 'Check_Off'));
      const side = Math.max(14, Math.min(c.h, 18));
      d.style.setProperty('--on', on ? `url(${on.url})` : 'none');
      d.style.setProperty('--off', off ? `url(${off.url})` : 'none');
      d.style.setProperty('--side', side + 'px');
      const t = document.createElement('span');
      t.textContent = text;
      d.appendChild(t);
      const f = controlFont(c.id, nativeFonts ? 'Check_Box' : 'L_Text');
      styleText(d, f);
      if (nativeFonts) {
        nativeLabel(t, text, f);
        d.style.filter = '';
        d.style.textShadow = '';
        d._setText = (value, color) => nativeLabel(t, value, f, color ? { top: color, bottom: color } : {});
      }
    } else if (c.kind === 'LISTBOX' && nativeLists) {
      d = await nativeList(el, id, c);
    } else if (c.kind === 'LISTBOX' || c.kind === 'EDITTEXT' || c.kind === 'GROUPBOX') {
      d = box(el, c.kind === 'LISTBOX' ? 'dlg-list' : c.kind === 'EDITTEXT' ? 'dlg-edit' : 'dlg-group', c.x, c.y, c.w, c.h);
      await frame(
        d,
        c.w,
        c.h,
        k => (c.kind === 'GROUPBOX' && k === 'Small_Frame_Background' ? '' : tex(id, c.id, k)),
        'Small_Frame_',
        false,
        nativeFrame
      );
      if (c.kind === 'LISTBOX') {
        d._rows = box(d, 'dlg-rows', 3, 3, c.w - 6, c.h - 6);
        styleText(d._rows, controlFont(c.id, 'List_Box'));
      }
      if (c.kind === 'EDITTEXT') {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.spellcheck = false;
        if (/ES_CENTER/.test(c.style)) inp.style.textAlign = 'center';
        d.appendChild(inp);
        d._input = inp;
        styleText(inp, controlFont(c.id, 'Edit_Box'));
        for (const ev of ['keydown', 'keyup', 'keypress']) inp.addEventListener(ev, e => e.stopPropagation());
      }
    } else if (c.kind === 'CONTROL' && /progress/i.test(c.cls)) {
      d = box(el, 'dlg-progress', c.x, c.y, c.w, c.h);
      const L = await image(tex(id, c.id, 'Progress_Bar_Left')),
        R = await image(tex(id, c.id, 'Progress_Bar_Right'));
      const on = await image(tex(id, c.id, 'Progress_Bar_Middle_On')),
        off = await image(tex(id, c.id, 'Progress_Bar_Middle_Off'));
      const capW = im => (im ? Math.round((im.w * c.h) / im.h) : 0),
        lw = capW(L),
        rw = capW(R),
        u = im => (im ? `url(${im.url})` : 'none');
      bg(box(d, 'dlg-fr', 0, 0, lw, c.h), L);
      bg(box(d, 'dlg-fr', c.w - rw, 0, rw, c.h), R);
      const tile = im => (im ? `${Math.max(1, Math.round((im.w * c.h) / im.h))}px 100%` : 'auto');
      const offBar = box(d, 'dlg-fr', lw, 0, c.w - lw - rw, c.h);
      offBar.style.background = `${u(off)} left top / ${tile(off)} repeat-x`;
      d._on = box(d, 'dlg-fr', lw, 0, 0, c.h);
      d._on.style.background = `${u(on)} left top / ${tile(on)} repeat-x`;
      d._span = c.w - lw - rw;
    } else if (c.kind === 'COMBOBOX') {
      const L = await image(tex(id, c.id, 'Combo_Box_Left_Cap')),
        M = await image(tex(id, c.id, 'Combo_Box_Text_Box')),
        P = await image(tex(id, c.id, 'Combo_Box_Popdown_Button'));
      const PO = await image(tex(id, c.id, 'Combo_Box_Popdown_Button_Mouse_Over')),
        PP = await image(tex(id, c.id, 'Combo_Box_Popdown_Button_Pressed'));
      const h = M ? M.h : 25,
        pw = P ? Math.round((P.w * h) / P.h) : h,
        lw = L ? L.w : 0,
        u = im => (im ? `url(${im.url})` : 'none');
      d = box(el, 'dlg-combo', c.x, c.y, c.w, h);
      d.style.background = `${u(L)} left top / ${lw}px 100% no-repeat, ${u(M)} ${lw}px top / calc(100% - ${lw + pw}px) 100% no-repeat`;
      const arrow = box(d, 'dlg-sb', c.w - pw, 0, pw, h);
      arrow.style.setProperty('--up', u(P));
      arrow.style.setProperty('--over', u(PO || P));
      arrow.style.setProperty('--down', u(PP || P));
      d._label = box(d, 'dlg-combo-text', lw + 4, 0, c.w - lw - pw - 8, h);
      styleText(d._label, controlFont(c.id, 'Combo_Box'));
      d._drop = box(el, 'dlg-drop', c.x, c.y + h, c.w, 10);
      d._drop.hidden = true;
      d._drop.style.height = 'auto';
      d._drop.style.maxHeight = Math.max(60, c.h - h) + 'px';
      styleText(d._drop, controlFont(c.id, 'Combo_Box'));
    } else {
      d = box(el, 'dlg-etc', c.x, c.y, c.w, c.h);
      d.hidden = true;
    }
    d.dataset.id = c.id;
    if (!ctls.has(c.id)) ctls.set(c.id, d);
    if (/^TEXT_/.test(c.text) && !sources.has(c.id)) sources.set(c.id, () => api._paintText(c.id, db.t(c.text)));
  }
  parent.appendChild(veil);
  const api = {
    el,
    veil,
    def: dlg,
    ctl: cid => ctls.get(cid) || null,
    _paintText(cid, t, color = null) {
      t = String(t ?? '');
      t = db.text.get(t.toUpperCase()) ?? t;
      const c = ctls.get(cid);
      if (c?._setText) {
        c._setText(t, color);
        return;
      }
      if (c)
        (c.classList.contains('dlg-btn') || c.classList.contains('dlg-radio') || c.classList.contains('dlg-check')
          ? c.firstChild
          : c
        ).textContent = nativeFonts && c.classList.contains('dlg-txt') ? dialogStaticText(t) : t;
    },
    setText(cid, value, color = null) {
      const paint = () => api._paintText(cid, typeof value === 'function' ? value() : value, color);
      sources.set(cid, paint);
      paint();
    },
    onLanguageRefresh(fn) {
      refreshers.add(fn);
      return () => refreshers.delete(fn);
    },
    setImage(cid, url) {
      const ctl = ctls.get(cid),
        c = ctl?._image || ctl;
      if (c) {
        c.style.backgroundImage = url ? `url(${url})` : '';
        c.style.backgroundSize = '100% 100%';
      }
    },
    imageText(cid, text) {
      const ctl = ctls.get(cid),
        image = ctl?._image || ctl;
      if (!image) return;
      if (!text) {
        ctl._caption?.remove();
        ctl._caption = null;
        return;
      }
      const caption = (ctl._caption ||= document.createElement('span')),
        f = controlFont(cid, 'Overlay_Caption_Text');
      styleText(caption, { ...f, bottom: f.top });
      caption.textContent = text;
      Object.assign(caption.style, {
        position: 'absolute',
        right: '0',
        bottom: '0',
        whiteSpace: 'pre',
        pointerEvents: 'none',
        transformOrigin: 'right bottom',
        transform: `scaleX(${f.xScale})`
      });
      image.appendChild(caption);
      if (f.bitmap) nativeLabel(caption, text, f, { bottom: f.top });
    },
    imageFrame(cid, on) {
      for (const c of ctls.get(cid)?.querySelectorAll('.dlg-fr') || []) c.hidden = !on;
    },
    textList(cid, text, color = '#fff') {
      const paint = () => ctls.get(cid)?._fillText?.(typeof text === 'function' ? text() : text, color);
      sources.set(cid, paint);
      paint();
    },
    coloredTextList(cid, rows, options) {
      const paint = () => ctls.get(cid)?._fillColoredText?.(typeof rows === 'function' ? rows() : rows, options);
      sources.set(cid, paint);
      paint();
    },
    show(cid, on) {
      const c = ctls.get(cid);
      if (c) c.hidden = !on;
    },
    on(cid, fn) {
      const c = ctls.get(cid);
      if (c) c.addEventListener('click', fn);
    },
    enable(cid, on) {
      const c = ctls.get(cid);
      if (c) c.classList.toggle('off', !on);
    },
    slider(cid, value, change, steps = 0) {
      const c = ctls.get(cid);
      if (!c || !c._tab) return;
      let v = value;
      const set = (n, tell = true) => {
        v = Math.max(0, Math.min(1, n));
        if (steps > 0) v = Math.round(v * (steps - 1)) / (steps - 1);
        c._tab.style.left = c._x0 + c._span * v + 'px';
        if (tell) change(v);
      };
      const at = ev => {
        const r = c._track.getBoundingClientRect(),
          tw = c._tab.getBoundingClientRect().width;
        return (ev.clientX - r.left - tw / 2) / Math.max(1, r.width - tw);
      };
      c._minus.onclick = () => set(v - (steps > 0 ? 1 / (steps - 1) : 0.1));
      c._plus.onclick = () => set(v + (steps > 0 ? 1 / (steps - 1) : 0.1));
      const drag = ev => {
        ev.preventDefault();
        set(at(ev));
        const move = e => set(at(e)),
          up = () => {
            removeEventListener('mousemove', move);
            removeEventListener('mouseup', up);
          };
        addEventListener('mousemove', move);
        addEventListener('mouseup', up);
      };
      c._track.onmousedown = drag;
      c._tab.onmousedown = drag;
      set(value, false);
    },
    radios(ids, value, change = () => {}) {
      const set = v => {
        for (const cid of ids) {
          const c = ctls.get(cid);
          if (c) {
            c.classList.toggle('on', cid === v);
            c.setAttribute('aria-checked', String(cid === v));
          }
        }
      };
      for (const cid of ids) {
        const c = ctls.get(cid);
        if (c) {
          c.setAttribute('role', 'radio');
          c.tabIndex = 0;
          c.onkeydown = e => {
            if (e.code === 'Enter' || e.code === 'Space') {
              e.preventDefault();
              c.click();
            }
          };
          c.onclick = () => {
            if (c.classList.contains('on')) return;
            if (window.game) window.game.audio.play('GUI_Button_Press_2_SFX');
            set(cid);
            change(cid);
          };
        }
      }
      set(value);
      return { set };
    },
    check(cid, value, change) {
      const c = ctls.get(cid);
      if (!c) return;
      c.classList.toggle('on', !!value);
      c.setAttribute('role', 'checkbox');
      c.setAttribute('aria-checked', String(!!value));
      c.tabIndex = 0;
      c.onkeydown = e => {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          c.click();
        }
      };
      c.onclick = () => {
        const on = !c.classList.contains('on');
        c.classList.toggle('on', on);
        c.setAttribute('aria-checked', String(on));
        if (window.game) window.game.audio.play('GUI_Button_Press_2_SFX');
        change(on);
      };
    },
    list(cid, rows, pick = () => {}, open = () => {}) {
      const c = ctls.get(cid);
      if (typeof rows === 'function') {
        const source = rows,
          items = [],
          paint = () => {
            items.splice(0, items.length, ...source());
            return c?._fillRows?.(items, pick, open);
          };
        sources.set(cid, paint);
        return paint();
      }
      sources.delete(cid);
      if (c?._fillRows) return c._fillRows(rows, pick, open);
      if (!c || !c._rows) return null;
      let cur = null,
        selected = null,
        hovered = null;
      const paint = e => {
        if (nativeFonts)
          e.style.background = e === selected ? 'rgba(255,255,255,0.3)' : e === hovered ? 'rgba(0,0,170,0.3)' : 'transparent';
      };
      c._rows.replaceChildren();
      const els = rows.map(row => {
        const e = document.createElement('div');
        e.className = 'dlg-row';
        paint(e);
        if (nativeFonts) {
          e.onmouseenter = () => {
            hovered = e;
            paint(e);
          };
          e.onmouseleave = () => {
            hovered = null;
            paint(e);
          };
        }
        const a = document.createElement('span');
        a.textContent = row.label;
        const b = document.createElement('span');
        b.className = 'note';
        b.textContent = row.note || '';
        e.append(a, b);
        e.onclick = () => {
          cur = row;
          selected = e;
          for (const x of els) {
            x.classList.toggle('sel', x === e);
            paint(x);
          }
          pick(row);
        };
        e.ondblclick = () => open(row);
        c._rows.appendChild(e);
        return e;
      });
      return {
        selected: () => cur,
        select(key) {
          const i = rows.findIndex(x => x.key === key);
          if (i >= 0) els[i].click();
        }
      };
    },
    combo(cid, options, value, change) {
      const c = ctls.get(cid);
      if (!c || !c._drop) return null;
      const paint = (node, o) => {
        node.textContent = o && !o.color ? o.label : '';
        node.style.background = o && o.color ? o.color : '';
        node.classList.toggle('swatch', !!(o && o.color));
      };
      const set = v => {
        value = v;
        paint(
          c._label,
          options.find(o => String(o.value) === String(v))
        );
      };
      const close = () => {
        c._drop.hidden = true;
        removeEventListener('mousedown', away, true);
      };
      const away = ev => {
        if (!c.contains(ev.target) && !c._drop.contains(ev.target)) close();
      };
      c._drop.replaceChildren();
      c._drop.classList.toggle('grid', options.length > 12 && options.every(o => o.color));
      for (const o of options) {
        const row = document.createElement('div');
        row.className = 'dlg-opt';
        paint(row, o);
        row.onclick = () => {
          close();
          if (String(o.value) !== String(value)) {
            set(o.value);
            change(o.value);
          }
        };
        c._drop.appendChild(row);
      }
      c.onclick = () => {
        if (!c._drop.hidden) {
          close();
          return;
        }
        el.appendChild(c._drop);
        c._drop.hidden = false;
        c._drop.style.left = c._drop.classList.contains('grid')
          ? Math.max(0, Math.min(parseFloat(c.style.left), el.offsetWidth - c._drop.offsetWidth - 4)) + 'px'
          : c.style.left;
        addEventListener('mousedown', away, true);
        if (window.game) window.game.audio.play('GUI_Button_Press_2_SFX');
      };
      set(value);
      return { set };
    },
    progress(cid, value) {
      const c = ctls.get(cid);
      if (c && c._on) c._on.style.width = c._span * Math.max(0, Math.min(1, value)) + 'px';
    },
    edit(cid) {
      const c = ctls.get(cid);
      return c ? c._input : null;
    },
    scroll(cid, max, change, wheelOver = null) {
      const c = ctls.get(cid);
      if (!c || !c._tab) return;
      c.hidden = max <= 0;
      if (max <= 0) return;
      let v = 0;
      const set = n => {
        n = Math.max(0, Math.min(max, Math.round(n)));
        c._tab.style.top = c._top + (c._span * n) / max + 'px';
        if (n !== v) {
          v = n;
          change(v);
        }
      };
      c._up.onclick = () => set(v - 1);
      c._down.onclick = () => set(v + 1);
      const at = ev => {
        const r = c._track.getBoundingClientRect();
        return (
          (max * (ev.clientY - r.top - (c._tab.offsetHeight * r.height) / c._track.offsetHeight / 2)) /
          Math.max(1, r.height - (c._tab.offsetHeight * r.height) / c._track.offsetHeight)
        );
      };
      c._track.onmousedown = ev => set(at(ev));
      c._tab.onmousedown = ev => {
        ev.preventDefault();
        const move = e => set(at(e)),
          up = () => {
            removeEventListener('mousemove', move);
            removeEventListener('mouseup', up);
          };
        addEventListener('mousemove', move);
        addEventListener('mouseup', up);
      };
      const wheel = ev => {
        ev.preventDefault();
        set(v + Math.sign(ev.deltaY));
      };
      c.addEventListener('wheel', wheel, { passive: false });
      if (wheelOver) {
        const pad = box(el, 'dlg-wheel', wheelOver.x, wheelOver.y, wheelOver.w, wheelOver.h);
        el.insertBefore(pad, el.querySelector('.dlg-btn, .dlg-txt, .dlg-img, .dlg-scroll, .dlg-etc'));
        el.addEventListener(
          'wheel',
          ev => {
            const r = pad.getBoundingClientRect();
            if (!c.contains(ev.target) && ev.clientX >= r.left && ev.clientX < r.right && ev.clientY >= r.top && ev.clientY < r.bottom)
              wheel(ev);
          },
          { passive: false }
        );
      }
      set(0);
      return { set };
    },
    close() {
      layoutVersion++;
      unsubscribeLanguage();
      refreshers.clear();
      sources.clear();
      removeEventListener('resize', resize);
      veil.remove();
    }
  };
  const unsubscribeLanguage = onLanguageChange(async () => {
    await resize();
    if (!veil.isConnected) return;
    for (const [cid, paint] of sources) {
      const c = ctls.get(cid);
      if (c?._preserveList) c._preserveList(paint);
      else paint();
    }
    for (const refresh of refreshers) {
      if (!veil.isConnected) break;
      await refresh();
    }
  });
  return api;
}

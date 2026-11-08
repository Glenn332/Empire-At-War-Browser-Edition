import { db } from '../gamedata.js';
import { fetchText } from '../vfs.js';
import { loadTextureCanvas } from '../dds.js';
import { loadALO } from '../alo.js';
import { loadALA } from '../ala.js';
import { iconAtlas, iconCanvasRect } from '../icons.js';
import { parseXML } from '../xml.js';

const rgba = (v, def) => {
  const n = String(v || '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  return n.length >= 3 ? n : def;
};
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${((c[3] ?? 255) / 255) * a})`;
const yes = (t, k, def) => {
  if (!t.has(k)) return def;
  return /^(yes|true|1)$/i.test(t.str(k).trim());
};

export class Radar {
  constructor() {
    this.events = [];
    this.seeAll = false;
    this.icons = new Map();
    this.info = new Map();
    this.ready = this.load().catch(e => console.warn('radar', e));
  }

  fieldLayer(w, W, H, X, Y, sx, sy, S) {
    const key = W + 'x' + H + ':' + w.radarFields.length;
    if (this.fieldKey === key && this.fieldCanvas) return this.fieldCanvas;
    this.fieldKey = key;
    const c = (this.fieldCanvas ||= document.createElement('canvas'));
    c.width = Math.max(1, Math.ceil(W));
    c.height = Math.max(1, Math.ceil(H));
    const w0 = c.width,
      h0 = c.height,
      mask = new Uint8Array(w0 * h0);
    for (const f of w.radarFields) {
      const cx = X(f.x),
        cy = Y(f.y),
        rx = Math.max(1, f.rx * sx),
        ry = Math.max(1, f.ry * sy);
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(h0 - 1, Math.ceil(cy + ry)); y++)
        for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(w0 - 1, Math.ceil(cx + rx)); x++) {
          const dx = (x + 0.5 - cx) / rx,
            dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) mask[y * w0 + x] = 255;
        }
    }
    const rim = new Uint8Array(w0 * h0);
    for (let y = 0; y < h0; y++)
      for (let x = 0; x < w0; x++) {
        const i = y * w0 + x,
          p = mask[i],
          left = x ? mask[i - 1] : p,
          up = y ? mask[i - w0] : p,
          down = y < h0 - 1 ? mask[i + w0] : p,
          e1 = Math.abs(p - left) + Math.abs(p - up),
          e2 = Math.abs(p - left) + Math.abs(p - down);
        rim[i] = Math.min(255, Math.max(e1 > 85 ? e1 : 0, e2 > 85 ? e2 : 0));
      }
    const blur = src => {
      const out = new Uint8Array(w0 * h0),
        k = [1, 2, 1];
      for (let y = 0; y < h0; y++)
        for (let x = 0; x < w0; x++) {
          let sum = 0;
          for (let j = -1; j <= 1; j++)
            for (let i = -1; i <= 1; i++) {
              const xx = Math.min(w0 - 1, Math.max(0, x + i)),
                yy = Math.min(h0 - 1, Math.max(0, y + j));
              sum += src[yy * w0 + xx] * k[i + 1] * k[j + 1];
            }
          out[y * w0 + x] = sum >> 4;
        }
      return out;
    };
    const m = blur(mask),
      b = blur(rim),
      g = c.getContext('2d'),
      img = g.createImageData(w0, h0),
      d = img.data,
      F = [...S.field.slice(0, 3), S.field[3] ?? 255],
      B = [...S.fieldBorder.slice(0, 3), S.fieldBorder[3] ?? 255];
    for (let i = 0; i < w0 * h0; i++) {
      const mi = m[i],
        bi = b[i],
        o = i * 4;
      if (mi && bi) {
        const a = mi / 255;
        d[o] = F[0] * a + B[0] * (1 - a);
        d[o + 1] = F[1] * a + B[1] * (1 - a);
        d[o + 2] = F[2] * a + B[2] * (1 - a);
        d[o + 3] = F[3] * a + B[3] * (1 - a);
      } else if (mi) {
        d[o] = F[0];
        d[o + 1] = F[1];
        d[o + 2] = F[2];
        d[o + 3] = (F[3] * mi) / 255;
      } else if (bi) {
        d[o] = B[0];
        d[o + 1] = B[1];
        d[o + 2] = B[2];
        d[o + 3] = (B[3] * bi) / 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  async load() {
    const xml = await fetchText('Data/XML/RadarMap.xml').catch(() => null);
    const root = xml ? parseXML(xml) : null,
      map = root && (root.child('RadarMap') || root);
    const set = map && map.child('RadarMapSettings');
    this.settings = {
      backdrop: set ? set.val('Space_Backdrop_Texture_Name') : '',
      fow: rgba(set && set.val('Space_FOW_Color'), [25, 66, 120, 100]),
      field: rgba(set && set.val('Space_Asteroid_Field_Color'), [128, 128, 250, 255]),
      fieldBorder: rgba(set && set.val('Space_Asteroid_Field_Border_Color'), [98, 98, 150, 255]),
      events: !set || !/^no$/i.test(set.val('Use_Event_System', 'Yes')),
      base: rgba((/<Color\s+name\s*=\s*"space"\s*>([^<]*)</i.exec(xml || '') || [])[1], [12, 30, 51, 255])
    };
    this.eventDefs = new Map();
    for (const e of map && map.child('RadarMapEvents') ? map.child('RadarMapEvents').all('Radar_Map_Event') : []) {
      this.eventDefs.set(String(e.attrs.name || e.attrs.Name).toUpperCase(), {
        model: e.val('Event_Model_Name'),
        scale: e.num('Event_Model_Scale', 0.001),
        duration: e.num('Event_Duration', 1),
        single: /^yes$/i.test(e.val('Event_Single_Instance', 'No')),
        persistent: /^yes$/i.test(e.val('Event_Persistent', 'No')),
        look: null
      });
    }
    const C = db.constants;
    this.selColor = C && yes(C, 'Radar_Colorize_Selected_Units', false) ? rgba(C.str('Radar_Selected_Units_Color'), null) : null;
    if (this.settings.backdrop) this.backdrop = await loadTextureCanvas(this.settings.backdrop.replace(/\.\w+$/, '')).catch(() => null);
    this.settings.landFow = rgba(set && set.val('Land_FOW_Color'), [10, 10, 10, 100]);
    const lb = set ? set.val('Land_Backdrop_Texture_Name') : '';
    this.landBackdrop = lb
      ? lb === this.settings.backdrop
        ? this.backdrop
        : await loadTextureCanvas(lb.trim().replace(/\.\w+$/, '')).catch(() => null)
      : null;
  }

  of(t) {
    let r = this.info.get(t);
    if (r) return r;
    const size = t.has('Radar_Icon_Size') ? t.vec('Radar_Icon_Size', [0.05, 0.05]) : [0.05, 0.05];
    r = {
      show:
        yes(t, 'Is_Visible_On_Radar', false) &&
        !yes(t, 'Is_Asteroid_Field', false) &&
        !yes(t, 'Is_Ion_Storm', false) &&
        !yes(t, 'Is_Nebula', false),
      enemy: yes(t, 'Is_Visible_On_Enemy_Radar', true),
      fogged: yes(t, 'Visible_On_Radar_When_Fogged', false),
      icon: t.has('Radar_Icon_Name') ? t.str('Radar_Icon_Name').trim() : 'i_radar_default_blip.tga',
      sx: size[0],
      sy: size[1] ?? size[0],
      facing: yes(t, 'Radar_Show_Facing', true),
      turn: yes(t, 'Radar_Rotate_Icon', false),
      blip: t.num('Radar_Blip_Size', 2) === 2 ? 2 : 1
    };
    this.info.set(t, r);
    return r;
  }

  tone(c) {
    const key = c[0] * 65536 + c[1] * 256 + c[2];
    let l = (this.tones ||= new Map()).get(key);
    if (!l) this.tones.set(key, (l = { c: [c[0], c[1], c[2], 255], rgb: `rgb(${c[0]},${c[1]},${c[2]})`, icons: new Map() }));
    return l;
  }

  colorOf(p) {
    const col = p.color,
      r = Math.round(col.r * 255),
      g = Math.round(col.g * 255),
      b = Math.round(col.b * 255);
    const l = p._radarLook;
    if (l && l.c[0] === r && l.c[1] === g && l.c[2] === b) return l;
    return (p._radarLook = this.tone([r, g, b]));
  }

  grid(W, H, img = this.backdrop) {
    let cv = this.gridCv;
    if (cv && cv.width === W && cv.height === H && cv._img === img) return cv;
    cv = this.gridCv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    cv._img = img;
    const g = cv.getContext('2d'),
      n = BACKDROP_REPEAT,
      tw = W / n,
      th = H / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) g.drawImage(img, i * tw, j * th, tw, th);
    return cv;
  }

  icon(name, c) {
    const key = name.toUpperCase() + '|' + c.join(',');
    let cv = this.icons.get(key);
    if (cv !== undefined) return cv;
    const atlas = iconAtlas(),
      rect = iconCanvasRect(name);
    cv = null;
    if (atlas && rect) {
      cv = document.createElement('canvas');
      cv.width = rect.w;
      cv.height = rect.h;
      const g = cv.getContext('2d');
      g.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      g.fillRect(0, 0, rect.w, rect.h);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    }
    if (this.icons.size > 600) this.icons.clear();
    this.icons.set(key, cv);
    return cv;
  }

  async look(def) {
    const m = await loadALO(def.model).catch(() => null),
      mesh = m && m.meshes.find(x => !x.hidden && x.subs.length);
    const mat = mesh && mesh.subs[0].material,
      p = mat ? mat.params : {};
    const tex = p.BaseTexture ? await loadTextureCanvas(String(p.BaseTexture).replace(/\.\w+$/, '')).catch(() => null) : null;
    if (!tex) return null;
    const col = Array.isArray(p.Color) ? p.Color : [1, 1, 1, 1];
    const cv = document.createElement('canvas');
    cv.width = tex.width;
    cv.height = tex.height;
    const g = cv.getContext('2d');
    g.drawImage(tex, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height),
      px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] *= col[0];
      px[i + 1] *= col[1];
      px[i + 2] *= col[2];
      px[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    const b = mesh.bbox || [-1, -1, 0, 1, 1, 0],
      half = Math.max(b[3] - b[0], b[4] - b[1]) / 2;
    const anim = await Promise.resolve(loadALA(def.model.replace(/\.alo$/i, '').toUpperCase() + '_IDLE_00.ALA')).catch(() => null);
    let sizes = null;
    const moving = anim && anim.tracks.filter(t => t.trans && (t.offset[0] || t.offset[1]));
    if (moving && moving.length) {
      sizes = [];
      for (let f = 0; f < anim.frames; f++) {
        let sum = 0;
        for (const t of moving) {
          const k = f * (t.transStride || 3);
          sum += Math.abs(t.offset[0] + t.scale[0] * t.trans[k]) + Math.abs(t.offset[1] + t.scale[1] * t.trans[k + 1]);
        }
        sizes.push(sum / (moving.length * 2));
      }
    }
    return { cv, half, sizes, fps: anim ? anim.fps || 30 : 30, additive: /additive/i.test(mat.shader || '') };
  }

  fogCanvas(f, col) {
    const { nx, ny, state } = f;
    let cv = this.fogCv;
    if (!cv || cv.width !== nx || cv.height !== ny) {
      cv = this.fogCv = document.createElement('canvas');
      cv.width = nx;
      cv.height = ny;
      this.fogImg = new ImageData(nx, ny);
    }
    const img = this.fogImg.data,
      a = col[3] ?? 255;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const q = ((ny - 1 - j) * nx + i) * 4;
        img[q] = col[0];
        img[q + 1] = col[1];
        img[q + 2] = col[2];
        img[q + 3] = Math.round(a * state[j * nx + i]);
      }
    cv.getContext('2d').putImageData(this.fogImg, 0, 0);
    return cv;
  }

  event(name, x, y, obj = null) {
    const def = this.settings && this.settings.events && this.eventDefs.get(String(name).toUpperCase());
    if (!def || !def.model) return;
    if (def.look === null) def.look = this.look(def).then(l => (def.look = l));
    if (def.single && this.events.length) {
      const e = this.events[0];
      e.x = x;
      e.y = y;
      e.age = 0;
      return;
    }
    if (def.persistent && obj) this.remove(obj);
    this.events.push({ def, x, y, age: 0, obj: def.persistent ? obj : null });
  }

  click(x, y, attack) {
    const C = db.constants,
      name = (key, def) => (C ? C.str(key).trim() : '') || def,
      click = name('GUI_Movement_Click_Radar_Event_Name', 'Default_Click'),
      now = performance.now(),
      last = this.lastClick;
    this.lastClick = { t: now, x, y };
    if (attack) this.event(name('GUI_Attack_Movement_Click_Radar_Event_Name', 'Default_Attack_Click'), x, y);
    else if (last && now - last.t < 350 && Math.hypot(x - last.x, y - last.y) < 250) {
      this.removeLatest(click);
      this.event(name('GUI_Movement_Double_Click_Radar_Event_Name', 'Default_Double_Click'), x, y);
      this.lastClick = null;
    } else this.event(click, x, y);
  }

  remove(obj) {
    this.events = this.events.filter(e => e.obj !== obj);
  }

  removeLatest(name) {
    const def = this.eventDefs?.get(String(name).toUpperCase());
    if (!def) return;
    for (let i = this.events.length - 1; i >= 0; i--)
      if (this.events[i].def === def) {
        this.events.splice(i, 1);
        return;
      }
  }

  drawBeacons(g, X, Y, W, H, list, toneOf) {
    for (const b of list) {
      const t = this.of(b.type);
      if (!t.show) continue;
      const c = toneOf(b.owner);
      let img = c.icons.get(t.icon);
      if (!img && (img = this.icon(t.icon, c.c))) c.icons.set(t.icon, img);
      if (!img) continue;
      const hw = (t.sx * W) / 2,
        hh = (t.sy * H) / 2;
      g.drawImage(img, X(b.x) - hw, Y(b.y) - hh, hw * 2, hh * 2);
    }
  }

  drawStoryBlips(g, X, Y, blips, time) {
    if (!blips?.size) return;
    const img = this.icon('i_radar_focus.tga', [255, 255, 255]);
    if (!img) return;
    const z = (g.canvas.width / (g.canvas.clientWidth || g.canvas.width)) * Math.min(innerWidth / 1024, innerHeight / 768);
    for (const [name, b] of blips) {
      if (b.obj?.dead || (b.until !== undefined && (time ?? 0) > b.until)) {
        blips.delete(name);
        continue;
      }
      const x = b.obj ? b.obj.x : b.x,
        y = b.obj ? b.obj.y : b.y,
        w = img.width * z,
        h = img.height * z;
      g.drawImage(img, X(x) - w / 2, Y(y) - h / 2, w, h);
    }
  }

  drawEvents(g, X, Y, W, H, now) {
    const dt = this.lastNow === undefined ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      e.age += dt;
      if (e.obj ? e.obj.dead : !e.def.persistent && e.age >= e.def.duration) {
        this.events.splice(i, 1);
        continue;
      }
      if (e.obj) {
        e.x = e.obj.x;
        e.y = e.obj.y;
      }
      const l = e.def.look;
      if (!l || typeof l.then === 'function') continue;
      let half = l.half;
      if (l.sizes) {
        const f = Math.floor(e.age * l.fps);
        half = l.sizes[e.def.persistent ? f % l.sizes.length : Math.min(l.sizes.length - 1, f)];
      }
      const hw = half * e.def.scale * W,
        hh = half * e.def.scale * H;
      g.globalCompositeOperation = l.additive ? 'lighter' : 'source-over';
      g.drawImage(l.cv, X(e.x) - hw, Y(e.y) - hh, hw * 2, hh * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }

  radarOn(world, player) {
    if (world.radarAlways) return true;
    if (world.time === this.radarAt && player === this.radarFor) return this.radarHas;
    let on = false;
    for (const u of world.units) {
      if (on) break;
      if (u.dead || u.player.id < 0 || u.player.team !== player.team) continue;
      const abs = (u.type.radarAbs ??= u.type.sub('Abilities').flatMap(a => a.all('Enable_Radar_Ability')));
      for (const a of abs) {
        if (u.player !== player && !/^(yes|true)$/i.test(a.val('Affects_All_Allies', 'No'))) continue;
        if (/^(yes|true)$/i.test(a.val('Initially_Enabled', 'Yes'))) {
          on = true;
          break;
        }
        const name = String(a.attrs.Name || '').toUpperCase();
        if (
          (u.hardpoints || []).some(
            h => h.alive && h.kind === 'HARD_POINT_ENABLE_SPECIAL_ABILITY' && h.def.str('Special_Ability_Name').toUpperCase() === name
          )
        ) {
          on = true;
          break;
        }
      }
    }
    this.radarAt = world.time;
    this.radarFor = player;
    this.radarHas = on;
    return on;
  }

  draw(cv, ui, dt) {
    const w = ui.world,
      player = ui.player,
      r = ui.r,
      S = this.settings;
    const box = cv.getBoundingClientRect(),
      dpr = window.devicePixelRatio || 1;
    const cw = Math.round(box.width * dpr),
      ch = Math.round(box.height * dpr);
    if (cw > 0 && ch > 0 && (cv.width !== cw || cv.height !== ch)) {
      cv.width = cw;
      cv.height = ch;
    }
    const g = cv.getContext('2d'),
      W = cv.width,
      H = cv.height;
    const sx = W / (w.max.x - w.min.x),
      sy = H / (w.max.y - w.min.y);
    const X = x => (x - w.min.x) * sx,
      Y = y => (w.max.y - y) * sy;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    if (!S) return;
    g.fillStyle = css(S.base);
    g.fillRect(0, 0, W, H);
    const fog = r.fog;
    if (w.fog && fog && fog.mesh.visible) g.drawImage(this.fogCanvas(fog, S.fow), 0, 0, W, H);
    if (w.radarFields?.length) g.drawImage(this.fieldLayer(w, W, H, X, Y, sx, sy, S), 0, 0, W, H);
    if (this.backdrop) g.drawImage(this.grid(W, H), 0, 0);
    const bit = player.bit,
      radar = this.seeAll || this.radarOn(w, player),
      sel = this.selColor && this.tone(this.selColor);
    let fill = null;
    for (let pass = 0; pass < 2; pass++)
      for (const u of w.units) {
        if (u.dead || u.hyper) continue;
        const t = this.of(u.type);
        if (!t.show) continue;
        const own = u.player.team === player.team,
          isEnemy = !own && u.player.id >= 0;
        if (isEnemy && (!t.enemy || u.cloaked || (!radar && !u.capture))) continue;
        if (!own && w.fog && !this.seeAll && !(u.seenBy & bit) && !t.fogged) continue;
        if (u.isPad && u.padChild) continue;
        const owner = u.isPad || u.capture ? u.padOwner || (u.player.id >= 0 ? u.player : null) : u.player.id >= 0 ? u.player : null;
        const selected = sel && (u.selected || (u.squad && u.squad.selected));
        if ((pass === 0) !== !t.icon) continue;
        const c = selected ? sel : owner ? this.colorOf(owner) : this.tone(NEUTRAL);
        const hit = u.radarHit > 0;
        if (hit) u.radarHit = 0;
        g.globalAlpha = hit ? 0.5 : 1;
        const x = X(u.x),
          y = Y(u.y);
        if (!t.icon) {
          const b = t.blip * dpr;
          if (fill !== c.rgb) g.fillStyle = fill = c.rgb;
          g.fillRect(Math.round(x - b / 2), Math.round(y - b / 2), b, b);
          continue;
        }
        let img = c.icons.get(t.icon);
        if (!img && (img = this.icon(t.icon, c.c))) c.icons.set(t.icon, img);
        if (!img) continue;
        const hw = (t.sx * W) / 2,
          hh = (t.sy * H) / 2;
        const a = (t.facing ? -(u.heading - Math.PI / 2) : 0) + (t.turn ? Math.PI / 2 : 0);
        if (a) {
          g.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), x, y);
          g.drawImage(img, -hw, -hh, hw * 2, hh * 2);
          g.setTransform(1, 0, 0, 1, 0, 0);
        } else g.drawImage(img, x - hw, y - hh, hw * 2, hh * 2);
      }
    g.globalAlpha = 1;
    if (w.beacons)
      this.drawBeacons(
        g,
        X,
        Y,
        W,
        H,
        w.beacons.live(w.time).filter(b => b.owner.team === player.team),
        p => this.colorOf(p)
      );
    this.drawEvents(g, X, Y, W, H, w.time);
    this.drawStoryBlips(g, X, Y, w.storyBlips, w.time);
    const corners = [
      [0, 0],
      [r.width, 0],
      [r.width, r.height],
      [0, r.height]
    ].map(([px, py]) => r.pickGround(px, py, {}));
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = Math.max(1, dpr);
    if (corners.every(Boolean)) {
      g.beginPath();
      corners.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
      g.closePath();
      g.stroke();
    } else g.strokeRect(X(r.rig.x) - 12 * dpr, Y(r.rig.y) - 9 * dpr, 24 * dpr, 18 * dpr);
  }
}

const NEUTRAL = [127, 149, 171];
const BACKDROP_REPEAT = 25;

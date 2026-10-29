import { db } from '../gamedata.js';
import { loadNativePanelAssets, tintShell, animateScan } from './nativepanel.js';
import { drawMesh, uiMeshClipPath } from './hud.js';
import { iconUrl, iconCanvasRect, iconAdditiveUrl } from '../icons.js';
import { fontFamily } from '../fonts.js';
import { snapNativeText } from '../nativefont.js';
import { setComponentText } from './componenttext.js';
import { loadALA, animName, frameKeys } from '../ala.js';

const yes = s => /^(true|yes|1)$/i.test(s || '');
const token = (c, p) => c?.val(p).trim().split(/\s+/)[0] || '';
const pair = s => String(s || '').split(/[\s,]+/).map(Number);
const css = s => s ? `url("${s}")` : 'none';

const LOCAL_KEYS = new Set(['B_OPTION_G', 'B_DROID_HELP', 'B_STORY_ARC_G']);
export class ScriptUI {
  constructor(game, data) {
    this.game = game; this.comps = data.comps; this.states = new Map(); this.shells = new Map(); this.controls = new Map(); this.pending = new Set();
    this.outlines = new Map();
    this.filterDefs = document.createElementNS('http://www.w3.org/2000/svg','svg'); this.filterDefs.setAttribute('width','0'); this.filterDefs.setAttribute('height','0'); this.filterDefs.style.position='fixed'; document.body.appendChild(this.filterDefs);
    this.main = { root: game.ui.root, shell: data.shell, centered: false };
    const existing = new Set([...game.ui.root.querySelectorAll('[data-control]')].map(e => e.dataset.control.toUpperCase()));
    this.nativeControls = new Map([...game.ui.root.querySelectorAll('[data-control]')].map(e => [e.dataset.control.toUpperCase(),e]));
    this.forcedNativeDepth = 0;
    for (const [name,el] of this.nativeControls) {
      el.addEventListener('click', e => { if (this.states.get(name)?.enabled === false) {e.preventDefault();e.stopImmediatePropagation();} },true);
      el.addEventListener('click', () => { if (!this.forcedNativeDepth && !el.disabled && !el.classList.contains('dis')) { if (game.net) game.order({ c: 'ui', name, native: true }); else game.story?.clickGUI(name); } });
    }
    for (const [name, mesh] of data.shell) {
      const c = this.comps.get(name), type = c?.val('Type');
      if (!existing.has(name) && /^(TextButton|Button)$/i.test(type || '') && !/^B_(CREATE_|FILTERS|SCROLL_|DIAL$)/.test(name)) this.buildControl(this.main, name, mesh);
    }
  }

  snapshot() { return [...this.states.values()].map(s => ({ ...s, tint: s.tint && [...s.tint], layerTint: s.layerTint && [...s.layerTint] })); }

  restore(list) {
    for (const saved of list || []) {
      const s = this.state(saved.name);
      Object.assign(s, { ...saved, tint: saved.tint && [...saved.tint] });
      if (s.visible) this.visibility(s.name, true); else this.apply(s.name);
    }
  }

  state(name) {
    const key = String(name).toUpperCase();
    if (!this.states.has(key)) { const c = this.comps.get(key), tint=pair(c?.val('Color') || '255 255 255 255').map(v=>v/255); this.states.set(key, { name: key, visible: !yes(c?.val('Hidden')), enabled: true, selected: false, text: db.t(token(c, 'Associated_Text')), textSource:token(c,'Associated_Text'), icon: null, tint }); }
    return this.states.get(key);
  }

  visibility(name, visible) {
    const s = this.state(name); s.visible = !!visible;
    const c = this.comps.get(s.name);
    if (visible && /^Shell$/i.test(c?.val('Type') || '') && c.val('Model_Name') && !this.shells.has(s.name)) this.loadShell(s.name);
    this.apply(s.name);
  }
  enable(name, enabled) {
    const s = this.state(name); s.enabled = !!enabled;
    if (yes(this.comps.get(s.name)?.val('Disable_Darken'))) {
      const v = enabled ? 1 : 128 / 255; s.tint = [v,v,v,1]; s.layerTint = s.tint;
    }
    this.apply(name);
  }
  text(name, text) { const state=this.state(name);state.textSource=String(text??'');state.text=db.text.get(state.textSource.toUpperCase())??state.textSource;this.apply(name); }
  refreshLanguage() {
    for(const state of this.states.values())state.text=db.text.get(state.textSource.toUpperCase())??state.textSource;
    for(const [name,rec]of this.controls){rec.b.title=db.t(token(rec.c,'Tooltip_Text'));this.apply(name);}
    this.resize();
  }
  icon(name, icon, ...tint) { const s = this.state(name); s.icon = icon; s.tint = tint.length ? tint : [1,1,1,1]; this.apply(name); }

  async loadShell(name) {
    this.shells.set(name, null);
    const root = document.createElement('div'); root.className = 'script-shell'; root.dataset.control = name; root.hidden = true;
    document.body.appendChild(root);
    const work = (async () => {
      const data = await loadNativePanelAssets(name, this.comps.get(name).val('Model_Name'));
      if (!data) { root.remove(); return; }
      const c = this.comps.get(name), shell = { ...data, root, centered:true, offsetX:yes(c.val('Model_Offset_X')), offsetY:yes(c.val('Model_Offset_Y')), dialog: yes(c.val('Dialog_Scene')) };
      root.style.zIndex = String(20 + c.num('Base_Layer', 0)); root.style.pointerEvents = 'none';
      this.shells.set(name, shell);
      const images = tintShell(data);
      for (const [key, mesh] of data.shell) {
        if (!mesh.hidden && mesh.texture) {
          const img = images.get(key), material = data.materials.get(key), r = mesh.rect;
          if (!img) continue;
          const art = document.createElement('div'); art.className = 'script-art'; art.dataset.bone = mesh.bone;
          Object.assign(art.style, { left: r.x+'px', top: (-r.y-r.h)+'px', width: r.w+'px', height: r.h+'px', mixBlendMode: /additive/i.test(material?.shader || '') ? 'plus-lighter' : 'normal' });
          if (!animateScan(art, mesh, img, material?.params.UVScrollRate, {x:r.x,y:r.y+r.h})) {
            const cv = document.createElement('canvas'), k = Math.min(3, Math.ceil(this.game.overlayScale() * devicePixelRatio)); cv.width = Math.ceil(r.w*k); cv.height = Math.ceil(r.h*k);
            cv.style.cssText = 'width:100%;height:100%;display:block'; drawMesh(cv.getContext('2d'), img, mesh, (x,y) => [(x-r.x)*k,(r.y+r.h-y)*k]); art.appendChild(cv);
          }
          if (shell.dialog) art.style.pointerEvents = 'auto';
          root.appendChild(art);
        }
        const component = this.comps.get(key);
        if (/^(TextButton|Button)$/i.test(component?.val('Type') || '')) this.buildControl(shell, key, mesh);
      }
      shell.anim = await Promise.resolve(loadALA(animName(c.val('Model_Name'), 'IDLE'))).catch(() => null);
      this.resize(); this.apply(name);
    })();
    this.pending.add(work); try { await work; } finally { this.pending.delete(work); }
  }

  async ready() { while (this.pending.size) await Promise.all([...this.pending]); }

  buildControl(shell, name, mesh) {
    const c = this.comps.get(name), s = this.state(name), b = document.createElement('button');
    b.type = 'button'; b.className = 'script-button'; b.dataset.control = name; b.title = db.t(token(c, 'Tooltip_Text'));
    const r = mesh.rect, origin = mesh.origin;
    if (mesh.bone !== undefined) b.dataset.bone = mesh.bone;
    Object.assign(b.style, { left: r.x+'px', top: shell.centered ? (-r.y-r.h)+'px' : '', bottom: shell.centered ? '' : r.y+'px', width:r.w+'px', height:r.h+'px', zIndex:String(c.num('Base_Layer', 0)) });
    b.style.pointerEvents = 'none';
    const hit = document.createElement('span'); hit.className = 'script-button-hit'; hit.setAttribute('aria-hidden', 'true');
    Object.assign(hit.style, { position: 'absolute', inset: '0', pointerEvents: 'auto', clipPath: uiMeshClipPath(mesh) });
    const art = document.createElement('span'), text = document.createElement('span'); art.className = 'script-button-art'; text.className = 'script-button-text';
    const x = origin.x-r.x, y = r.y+r.h-origin.y;
    art.style.left = x+'px'; art.style.top = y+'px';
    const off = pair(c.val('Text_Offset')), align = yes(c.val('Left_Justified')) ? 'left' : yes(c.val('Right_Justified')) ? 'right' : 'center';
    Object.assign(text.style, { left:(x+(off[0]||0))+'px', top:(y-(off[1]||0))+'px', textAlign:align, transform:`translate(${align==='left'?'0':align==='right'?'-100%':'-50%'},-50%)`, fontFamily:fontFamily(c.val('Font_Name') || 'Arial'), fontWeight:'700' });
    if (yes(c.val('Text_Outline'))) text.style.filter = `url(#${this.outline(c.num('Scale',1))})`;
    b.append(hit,art,text); shell.root.appendChild(b);
    const rec = { name,c,shell,mesh,b,art,text,hover:false }; this.controls.set(name,rec);
    b.onpointermove = e => this.hoverAt(e.clientX,e.clientY);
    b.onpointerleave = () => this.setHover(null);
    b.onclick = e => { e.stopPropagation(); const hit = e.detail ? this.pick(e.clientX,e.clientY) : rec; if (hit) this.click(hit.name); };
    this.apply(name); this.sizeText(rec); return rec;
  }

  click(name, forced = false, net = false) {
    const key = String(name).toUpperCase(), c = this.comps.get(key), s = this.state(key);
    if (!c || !forced && (!s.visible || !s.enabled)) return false;
    const own = !forced && !net && this.handlers?.get(key);
    if (own) { this.game.audio?.play(c.val('Click_SFX') || 'GUI_Button_Press_2_SFX'); own(key); if (!this.game.net) this.game.story?.clickGUI(key); return true; }
    if (this.game.net && !forced && !net && !LOCAL_KEYS.has(key) && !(key === 'ATTACK_BUTTON' && this.game.pauseShellOpen) && !this.game.pendingBattle?.request) {
      this.game.audio?.play(c.val('Click_SFX') || 'GUI_Button_Press_2_SFX');
      this.game.order({ c: 'ui', name: key });
      return true;
    }
    const group = c.val('Group'), tab = yes(c.val('Tab'));
    s.selected = yes(c.val('Toggle')) ? !s.selected : tab ? true : s.selected;
    if (tab && s.selected && group) for (const [n,t] of this.states) if (n !== key && this.comps.get(n)?.val('Group') === group) { t.selected=false; this.apply(n); }
    this.apply(key);
    const native = forced && this.nativeControls.get(key);
    if (native) {
      this.forcedNativeDepth++;
      try { native.click(); } finally { this.forcedNativeDepth--; }
      return true;
    }
    if (!forced && !net) this.game.audio?.play(c.val('Click_SFX') || 'GUI_Button_Press_2_SFX');
    if (!forced && !net && key === 'B_OPTION_G') this.game.toggleMenu();
    this.game.pendingBattle?.click(key);
    if (key === 'ATTACK_BUTTON' && this.game.pauseShellOpen) this.game.setUserPaused(false);
    if (key === 'B_DROID_HELP' && !net) this.game.galacticLog?.toggle();
    if (key === 'B_STORY_ARC_G' && !net) {if(this.game.storyDialog?.opened)this.game.storyDialog.close();else this.game.storyDialog?.showSummary();}
    this.game.story?.clickGUI(key); return true;
  }

  pick(clientX, clientY) {
    const scale = this.game.overlayScale(), modal = this.modal; let best = null, depth = -Infinity;
    for (const rec of this.controls.values()) {
      const {shell,mesh,name} = rec, s = this.state(name);
      if (!s.visible || !s.enabled || shell.root.hidden || modal && !shell.dialog) continue;
      const anim = shell.boneDelta && mesh.bone !== undefined ? shell.boneDelta(mesh.bone) : [0,0], extra = shell.offsets?.get(name) || [0,0], moved = [anim[0]+extra[0], anim[1]+extra[1]];
      const x = (shell.centered ? (clientX-parseFloat(shell.root.style.left))/scale : clientX/scale) - moved[0];
      const y = (shell.centered ? (parseFloat(shell.root.style.top)-clientY)/scale : (innerHeight-clientY)/scale) - moved[1];
      for (let i=0;i<mesh.indices.length;i+=3) {
        const a=mesh.verts[mesh.indices[i]],b=mesh.verts[mesh.indices[i+1]],c=mesh.verts[mesh.indices[i+2]];
        const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y); if (Math.abs(den)<1e-10) continue;
        const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den, v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den;
        if (u<0 || v<0 || u+v>1) continue;
        const z=u*(a.z||0)+v*(b.z||0)+(1-u-v)*(c.z||0);
        if (z>depth+1e-6) {best=rec;depth=z;}
      }
    }
    return best;
  }
  setHover(rec) {
    if (this.hover === rec) return;
    if (this.hover) {this.hover.hover=false;this.apply(this.hover.name);}
    this.hover=rec;
    if (rec) {rec.hover=true;this.game.audio?.play(rec.c.val('Mouse_Over_SFX'));this.apply(rec.name);}
  }
  hoverAt(x,y) {this.setHover(this.pick(x,y));}

  outline(scale) {
    if (this.outlines.has(scale)) return this.outlines.get(scale).id;
    const ns='http://www.w3.org/2000/svg', id='script-outline-'+this.outlines.size;
    const f=document.createElementNS(ns,'filter'); f.id=id; f.setAttribute('x','-20%');f.setAttribute('y','-50%');f.setAttribute('width','140%');f.setAttribute('height','200%');
    const morph=document.createElementNS(ns,'feMorphology'); morph.setAttribute('in','SourceAlpha');morph.setAttribute('operator','dilate');morph.setAttribute('radius',scale/this.game.overlayScale());morph.setAttribute('result','edge');
    const flood=document.createElementNS(ns,'feFlood');flood.setAttribute('flood-color','black');flood.setAttribute('result','black');
    const comp=document.createElementNS(ns,'feComposite');comp.setAttribute('in','black');comp.setAttribute('in2','edge');comp.setAttribute('operator','in');comp.setAttribute('result','outline');
    const merge=document.createElementNS(ns,'feMerge'); for (const src of ['outline','SourceGraphic']) {const n=document.createElementNS(ns,'feMergeNode');n.setAttribute('in',src);merge.appendChild(n);}
    f.append(morph,flood,comp,merge);this.filterDefs.appendChild(f);this.outlines.set(scale,{id,morph});return id;
  }

  apply(name) {
    const key = String(name).toUpperCase(), s = this.state(key), shell = this.shells.get(key), rec = this.controls.get(key);
    if (shell) { const opening=shell.root.hidden&&s.visible;shell.root.hidden = !s.visible;if(opening)snapNativeText(shell.root); }
    if (!rec) {
      for (const el of this.game.ui.root.querySelectorAll('[data-control]')) if (el.dataset.control.toUpperCase() === key) { el.hidden = !s.visible; el.classList.toggle('dis',!s.enabled); if ('disabled' in el) el.disabled = !s.enabled; }
      return;
    }
    const {b,art,text,c} = rec; const opening=b.hidden&&s.visible;b.hidden = !s.visible; b.disabled = !s.enabled; b.setAttribute('aria-pressed',String(s.selected));
    this.paintText(rec,s.text); b.setAttribute('aria-label', s.text || b.title || name);
    if(opening)snapNativeText(text);
    const color = pair(c.val('Text_Color') || '255 255 255 255');
    text.style.color = `rgba(${color.slice(0,3).join(',')},${(color[3]??255)/255})`;
    const scale = c.num('Scale',1);
    const normal = s.icon ?? token(c,'Icon_Texture_Name'), overlay = !s.enabled ? token(c,'Disabled_Texture_Name') : s.selected ? token(c,'Selected_Texture_Name') : rec.hover ? token(c,'Mouse_Over_Texture_Name') : '';
    const artKey = [normal,overlay,token(c,'Blank_Texture_Name'),scale,s.enabled,s.tint.join(','),s.layerTint?.join(',')].join('|');
    if (rec.artKey === artKey) return;
    rec.artKey = artKey; art.replaceChildren();
    const swap = yes(c.val('Swap_Texture'));
    const replaced = swap && overlay;
    for (const [image,kind] of [[token(c,'Blank_Texture_Name'),'blank'],[replaced ? '' : normal,'icon'],[overlay,'overlay']]) {
      const url = iconUrl(image), r = iconCanvasRect(image); if (!url || !r) continue;
      const tint = kind==='icon' ? s.tint : s.layerTint || [1,1,1,1];
      const additive=kind==='icon' ? yes(c.val('Draw_Additive')) : kind==='overlay' && s.enabled && !swap && (!s.selected || !yes(c.val('Selected_Alpha')));
      const tinted = !additive && tint.slice(0,3).some(v=>v!==1) ? this.game.tinted(image,tint.slice(0,3)) : null;
      const picture = additive ? iconAdditiveUrl(image,tint) : tinted ? tinted.toDataURL() : url;
      const i = document.createElement('span'); i.style.cssText = `position:absolute;left:${-r.w*scale/2}px;top:${-r.h*scale/2}px;width:${r.w*scale}px;height:${r.h*scale}px;background:${css(picture)} center / 100% 100% no-repeat`;
      i.style.opacity=String(tint[3]??1);
      if (additive) i.style.mixBlendMode='plus-lighter'; art.appendChild(i);
    }
  }

  paintText(rec,value) {
    setComponentText(rec.text,rec.c,value,{scale:this.game.overlayScale()});
  }
  sizeText(rec) { this.paintText(rec,this.state(rec.name).text); }
  resize() {
    const scale = this.game.overlayScale();
    const offset = this.offset || [0,0];
    for (const shell of this.shells.values()) if (shell) { const o = shell.manual || offset; Object.assign(shell.root.style, {left:(innerWidth/2+(0.5+(shell.offsetX?Math.floor(o[0]):0))*scale)+'px',top:(innerHeight/2-(0.5+(shell.offsetY?Math.floor(o[1]):0))*scale)+'px',transform:`scale(${scale})`}); }
    for (const rec of this.controls.values()) this.sizeText(rec);
    for (const [s,f] of this.outlines) f.morph.setAttribute('radius',s/scale);
  }
  place(name, offset) {
    const shell = this.shells.get(String(name).toUpperCase()); if (!shell) return;
    shell.manual = offset; this.resize();
  }

  play(name) {
    const key = String(name).toUpperCase(), shell = this.shells.get(key), a = shell?.anim;
    if (!a) return;
    const bones = shell.model.bones, start = performance.now();
    const step = () => {
      if (this.shells.get(key) !== shell) return;
      const f = (performance.now() - start) / 1000 * a.fps, [f0, f1] = frameKeys(a, f, false), k = f - Math.floor(f);
      const local = new Map();
      for (const t of a.tracks) {
        const i = t.index >= 0 && bones[t.index]?.name === t.name ? t.index : bones.findIndex(b => b.name === t.name), m = bones[i]?.matrix;
        if (i < 0 || !m) continue;
        let x = t.offset[0], y = t.offset[1];
        if (t.trans) { const d = t.trans, p = f0 * t.transStride + t.transAt, q = f1 * t.transStride + t.transAt; x += t.scale[0] * (d[p] + (d[q] - d[p]) * k); y += t.scale[1] * (d[p + 1] + (d[q + 1] - d[p + 1]) * k); }
        local.set(i, [x - m[3], y - m[7]]);
      }
      const delta = i => { let x = 0, y = 0; for (let j = i, n = 0; j >= 0 && n < 64; j = bones[j].parent, n++) { const v = local.get(j); if (v) { x += v[0]; y += v[1]; } } return [x, y]; };
      shell.boneDelta = delta;
      for (const el of shell.root.querySelectorAll('[data-bone]')) { const [x, y] = delta(+el.dataset.bone); el.style.translate = x || y ? `${x}px ${-y}px` : ''; }
      if (f < a.frames - 1) requestAnimationFrame(step);
    };
    step();
  }

  get modal() { return [...this.shells.values()].some(s => s?.dialog && !s.root.hidden); }
  dispose() { for (const s of this.shells.values()) s?.root.remove(); this.filterDefs.remove(); }
}

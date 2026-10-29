import { db } from '../gamedata.js';
import { iconUrl, iconCanvasRect } from '../icons.js';
import { CommandBar } from './hud.js';
import { setComponentText } from './componenttext.js';
import { componentFont, loadComponentFont, paintNativeText } from '../nativefont.js';
import { fontPixels } from '../fontpolicy.js';
import { languageRevision } from '../language.js';
export class TacticalSuperweaponHUD {
  constructor(game, assets) {
    this.game = game;
    this.elapsed = 0;
    this.clicked = false;
    this.sent = false;
    const noticeFace = db.constants.str('Win_Lose_Message_Font'),
      noticePoint = db.constants.num('Win_Lose_Message_Font_Size');
    if (noticeFace && noticePoint) loadComponentFont(noticeFace, fontPixels(innerHeight, noticePoint));
    const root = (this.root = document.createElement('div'));
    root.style.cssText = 'position:fixed;left:50%;bottom:50%;width:0;height:0;transform-origin:0 0;z-index:12;pointer-events:none';
    document.body.appendChild(root);
    this.centered = assets.superweapon.centered;
    if (!this.centered) {
      root.style.left = '0';
      root.style.bottom = '0';
    }
    const bar = (this.bar = Object.assign(Object.create(CommandBar.prototype), {
      root,
      game,
      comps: assets.comps,
      shell: assets.superweapon.shell
    }));
    this.button = bar.button('deathstar_switch', { nativeArtwork: true });
    this.button.style.pointerEvents = 'auto';
    this.button.style.position = 'absolute';
    this.button.setAttribute('role', 'button');
    this.button.onclick = () => {
      const manager = game.world.tacticalSuperweapons,
        unit = manager.first(game.human);
      if (this.clicked || !unit || !manager.ready(unit) || !manager.eligible()) return;
      this.clicked = true;
      this.elapsed = 0;
      game.audio.play(unit.type.str('TSW_SFXEvent_GUI_Bttton_Press'));
    };
    const timer = (this.timer = document.createElement('div'));
    timer.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;transform-origin:0 0;z-index:12;pointer-events:none';
    document.body.appendChild(timer);
    const point = assets.superweapon.timer,
      c = bar.comp('DS_Countdown_Timer');
    this.timerComponent = c;
    this.timerPoint = point;
    const name = c?.val('Icon_Texture_Name'),
      image = iconCanvasRect(name);
    if (point && image) {
      const art = document.createElement('img');
      art.src = iconUrl(name);
      Object.assign(art.style, {
        position: 'absolute',
        left: point.x - image.w / 2 + 'px',
        bottom: point.y - image.h / 2 + 'px',
        width: image.w + 'px',
        height: image.h + 'px'
      });
      timer.appendChild(art);
    }
    this.text = document.createElement('div');
    this.text.style.position = 'absolute';
    timer.appendChild(this.text);
  }
  reset() {
    this.clicked = false;
    this.elapsed = 0;
    this.sent = false;
  }
  victory(id, won) {
    this.noticeId = id;
    this.noticeWon = won;
    if (!this.notice) {
      this.notice = document.createElement('div');
      this.notice.style.cssText = 'position:fixed;pointer-events:none;z-index:12;white-space:pre';
      this.notice.setAttribute('role', 'status');
      document.body.appendChild(this.notice);
    }
    this.renderNotice();
  }
  renderNotice() {
    if (!this.notice) return;
    const face = db.constants.str('Win_Lose_Message_Font'),
      point = db.constants.num('Win_Lose_Message_Font_Size'),
      text = db.t(this.noticeId),
      height = fontPixels(innerHeight, point),
      key = JSON.stringify([face, height, text, this.noticeWon, innerWidth, innerHeight, languageRevision]);
    if (!face || !point || this.noticeKey === key) return;
    const font = componentFont(face, height);
    if (!font) {
      if (this.noticePending !== key) {
        this.noticePending = key;
        loadComponentFont(face, height).then(f => {
          if (f) this.renderNotice();
        });
      }
      return;
    }
    if (!font.has(text)) {
      font.ensure(text).then(() => this.renderNotice());
      return;
    }
    this.noticeKey = key;
    const color = db.constants
      .str(this.noticeWon ? 'Win_Message_Color' : 'Lose_Message_Color')
      .split(/[\s,]+/)
      .map(Number);
    const width = font.measure(text) + Math.floor(innerHeight / 600 + 0.5);
    this.notice.style.left = Math.floor((innerWidth - width) / 2 + 0.5) - 0.5 + 'px';
    this.notice.style.top = Math.floor(innerHeight * 0.4 + 0.5) - 0.5 + 'px';
    paintNativeText(this.notice, text, font, { outline: true, top: color, screenHeight: innerHeight });
  }
  update(dt) {
    this.renderNotice();
    const { game, bar, button } = this,
      manager = game.world.tacticalSuperweapons,
      unit = manager.first(game.human),
      r = unit && manager.record(unit),
      scale = Math.min(innerWidth / 1024, innerHeight / 768);
    if (!unit) {
      this.root.hidden = this.timer.hidden = true;
      return;
    }
    this.root.style.transform = `scale(${scale})${this.centered ? ' translate(.5px,-.5px)' : ''}`;
    this.timer.style.transform = `scale(${scale})`;
    const visible = !!unit && !game.over && !game.cine?.on;
    this.root.hidden = !visible;
    const c = bar.comp('deathstar_switch'),
      alternates =
        c
          ?.all('Icon_Alternate_Texture_Name')
          .flatMap(n => n.text.trim().split(/\s+/))
          .filter(Boolean) || [];
    if (this.clicked) {
      this.elapsed += dt;
      const fps = c?.num('Anim_FPS', 0) || 0;
      if (!this.sent && this.elapsed * fps >= alternates.length) {
        this.sent = true;
        const current = manager.first(game.human);
        if (current) manager.command(current, game.human, false);
      }
      this.frame = alternates[Math.min(alternates.length - 1, Math.floor(this.elapsed * fps))];
    } else this.frame = r?.state === 4 ? alternates[0] : c?.val('Icon_Texture_Name');
    if (this.frame !== this.lastFrame) {
      bar.setButtonImage(button, 'icon', this.frame || '');
      this.lastFrame = this.frame;
    }
    button.classList.toggle('dis', !r || r.state !== 4 || !manager.eligible() || this.clicked);
    const tips = c?.all('Tooltip_Text').flatMap(n => n.text.trim().split(/\s+/)) || [];
    button.title = db.t(tips[this.clicked ? 2 : r?.state === 4 ? 1 : 0] || '');
    const max = unit ? Math.fround(unit.type.num('Max_Speed', 0) * (unit.bonus?.speed ?? 1) * (unit.mods?.speed ?? 1)) : 0;
    const show =
      visible && !this.clicked && !!r?.target && !r.target.dead && (r.state === 4 || (r.state === 3 && r.speed === max && max > 0));
    this.timer.hidden = !show || !this.timerPoint;
    if (show && this.timerPoint) {
      const seconds = r.state === 4 ? 0 : Math.fround(Math.fround(r.previousDistance / max) / 30),
        whole = Math.trunc(seconds),
        fraction = Math.trunc(Math.fround(Math.fround(seconds - Math.fround(whole)) * 1000)),
        text = ` ${String(whole).padStart(3, '0')}.${String(fraction).padStart(3, '0')}`;
      const offset = (this.timerComponent?.val('Text_Offset') || '0 0').split(/[\s,]+/).map(Number);
      this.text.style.left = this.timerPoint.x + (offset[0] || 0) + 'px';
      this.text.style.bottom = this.timerPoint.y + (offset[1] || 0) + 'px';
      setComponentText(this.text, this.timerComponent, text, {
        scale,
        bottom: true,
        tint: r.state === 4 ? [255, 0, 0, 255] : [0, 255, 0, 255]
      });
    }
  }
  destroy() {
    this.root.remove();
    this.timer.remove();
    this.notice?.remove();
  }
}

import { db } from '../gamedata.js';

export class TooltipGate {
  constructor(game, encyclopedia) {
    this.game = game;
    this.encyclopedia = encyclopedia;
    this.target = null;
    this.key = null;
    this.popup = false;
    this.cooldown = 0;
    this.minimum = 0;
    this.alpha = 0;
    this.fadeIn = false;
    this.fadeOut = false;
    this.last = null;
    this.built = null;
  }

  get delayed() {
    if (this.game.delayTooltips === undefined) {
      try {
        this.game.delayTooltips = localStorage.getItem('swr-delay-tooltips') === '1';
      } catch {
        this.game.delayTooltips = false;
      }
    }
    return this.game.delayTooltips;
  }
  get delay() {
    return this.delayed ? db.constants.num('Long_Encyclopedia_Delay', 4000) : db.constants.num('Encyclopedia_Delay', 750);
  }
  get rate() {
    return db.constants.num('Encyclopedia_Fade_Rate', 4);
  }

  destroy() {
    const e = this.encyclopedia;
    if (this.popup && e.shown === this.key) {
      e.hide();
      e.hideLinked();
    }
    if (e.root) e.root.style.opacity = '';
    this.target = null;
    this.key = null;
    this.popup = false;
    this.alpha = 0;
    this.fadeIn = this.fadeOut = false;
    this.built = null;
  }

  moved() {
    this.cooldown = this.delay;
    if (this.popup) this.destroy();
  }

  dismiss() {
    if (this.popup) {
      this.cooldown = this.delay;
      this.fadeIn = false;
      this.fadeOut = true;
    }
  }

  hover(target) {
    if (!target) {
      this.dismiss();
      return;
    }
    if (this.cooldown > 0) return;
    const same = target.id === this.target;
    if (!same && this.popup) {
      this.cooldown = this.delay;
      this.fadeIn = false;
      this.fadeOut = true;
      return;
    }
    if (!same) {
      this.minimum = db.constants.num('Encyclopedia_Min_Display_Time', 1);
      this.destroy();
      this.fadeIn = true;
      this.fadeOut = false;
      this.alpha = 0;
    }
    this.target = target.id;
    this.popup = true;
    if (!same || this.built !== target.key || this.encyclopedia.shown !== target.key) {
      this.key = target.key;
      this.built = target.key;
      target.show();
      this.encyclopedia.shown = target.key;
    }
  }

  update(now = performance.now()) {
    const dt = this.last === null ? 0 : now - this.last;
    this.last = now;
    this.cooldown -= dt;
    if (this.popup && this.encyclopedia.shown !== this.key) {
      this.target = null;
      this.key = null;
      this.popup = false;
      this.alpha = 0;
      this.fadeIn = this.fadeOut = false;
      this.built = null;
      if (this.encyclopedia.root) this.encyclopedia.root.style.opacity = '';
      return;
    }
    const s = dt / 1000;
    this.minimum -= s;
    if (!this.target) {
      this.alpha = 0;
      this.fadeIn = this.fadeOut = false;
      return;
    }
    if (this.fadeIn) {
      if (this.alpha < 1) this.alpha += s * this.rate;
      if (this.alpha >= 1) {
        this.alpha = 1;
        this.fadeIn = false;
      }
    } else if (this.fadeOut && this.minimum <= 0) {
      if (this.alpha > 0) this.alpha -= s * this.rate;
      if (this.alpha <= 0) {
        this.alpha = 0;
        this.fadeOut = false;
        this.destroy();
        return;
      }
    }
    if (this.popup && this.encyclopedia.root) this.encyclopedia.root.style.opacity = String(Math.trunc(this.alpha * 255) / 255);
  }
}

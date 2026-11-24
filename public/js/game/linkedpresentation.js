import { db } from '../gamedata.js';
export class LinkedPresentation {
  constructor(options, height) {
    this.alpha = options.faded ? 1 : 0;
    this.bar = options.letterbox ? height : 0;
    this.height = height;
    this.fade = null;
    this.slide = null;
  }
  fadeTo(visible, seconds) {
    if (seconds === undefined) return;
    this.alpha = visible ? 1 : 0;
    this.fade = { from: this.alpha, to: visible ? 0 : 1, seconds: Math.max(0, typeof seconds === 'number' ? seconds : 0.5), elapsed: 0 };
    this.update(0);
  }
  bars(on, seconds) {
    if (seconds === undefined) return;
    const target = on ? this.height : 0;
    if (this.slide?.to === target || (!this.slide && this.bar === target)) return;
    let duration = Math.max(0, typeof seconds === 'number' ? seconds : 0.5);
    if (this.slide) duration *= this.height ? this.bar / this.height : 0;
    this.slide = { from: this.bar, to: target, seconds: duration, elapsed: 0 };
    this.update(0);
  }
  update(dt, modal = false) {
    for (const [field, slot] of [
      ['alpha', 'fade'],
      ['bar', 'slide']
    ]) {
      const t = this[slot];
      if (!t || (slot === 'slide' && modal)) continue;
      t.elapsed += Math.max(0, dt);
      const a = t.seconds ? Math.min(1, t.elapsed / t.seconds) : 1;
      this[field] = t.from + (t.to - t.from) * a;
      if (a === 1) this[slot] = null;
    }
  }
}
// The fade and letterbox calls of linked mission scripts. `fx` is the page's LinkedPresentation.
export function presentationOps(game, fx, scripts) {
  return {
    Fade_Screen_In: seconds => fx.fadeTo(true, seconds),
    Fade_Screen_Out: seconds => fx.fadeTo(false, seconds),
    Letter_Box_In: seconds => fx.bars(true, seconds),
    Letter_Box_Out: seconds => fx.bars(false, seconds),
    Letter_Box_On: () => {
      fx.slide = null;
      fx.bar = fx.height;
    },
    Letter_Box_Off: () => {
      fx.slide = null;
      fx.bar = 0;
    },
    Fade_On: () => {
      fx.fade = null;
      fx.alpha = 1;
    },
    Fade_Off: () => {
      fx.fade = null;
      fx.alpha = 0;
    },
    End_Cinematic_Mode: () => {
      game.tacticalCinematics?.stop?.();
      fx.slide = null;
      fx.bar = 0;
      if (scripts) scripts.localizedSFX = false;
      game.audio?.allowVO?.('localizedOff', true);
    }
  };
}

export function installLinkedPresentation(game, scripts) {
  const options = game.setup.linkedTactical;
  if (!options) return;
  // On the battle thread the screen effects are the page's; only their effect on the battle stays here.
  if (typeof document === 'undefined') {
    if (!scripts) return;
    const vm = scripts.vm,
      page = name => (...args) => game.forwardPresentation?.(name, args);
    for (const name of ['Fade_Screen_In', 'Fade_Screen_Out', 'Letter_Box_In', 'Letter_Box_Out', 'Letter_Box_On', 'Letter_Box_Off', 'Fade_On', 'Fade_Off'])
      vm.global(name, page(name));
    vm.global('End_Cinematic_Mode', (...args) => {
      scripts.localizedSFX = false;
      game.forwardPresentation?.('End_Cinematic_Mode', args);
    });
    vm.global('Resume_Hyperspace_In', () => {
      game.world.holdHyperspace = false;
    });
    return;
  }
  const fx = (game.linkedPresentation = new LinkedPresentation(options, db.constants.num('Camera_FX_Manager_Letterbox_Height', 0.085)));
  if (options.letterbox) game.controlsLocked = true;
  const mask = document.createElement('div');
  mask.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;z-index:8';
  document.body.appendChild(mask);
  const bars = ['letterTop', 'letterBottom'].map(id => document.getElementById(id)).filter(Boolean);
  for (const bar of bars) bar.style.transition = 'none';
  let lastAlpha, lastBar;
  fx.paint = () => {
    if (fx.alpha !== lastAlpha) {
      mask.style.opacity = String(fx.alpha);
      lastAlpha = fx.alpha;
    }
    if (fx.bar !== lastBar) {
      for (const bar of bars) bar.style.height = fx.bar * 100 + 'vh';
      lastBar = fx.bar;
      document.body.classList.toggle('letterboxed', fx.bar > 0);
    }
  };
  fx.paint();
  game.presentationOps = presentationOps(game, fx, scripts);
  if (scripts) {
    const vm = scripts.vm;
    for (const [name, f] of Object.entries(game.presentationOps)) vm.global(name, f);
    vm.global('Resume_Hyperspace_In', () => {
      if (!game.landBattle) game.world.holdHyperspace = false;
    });
  }
}

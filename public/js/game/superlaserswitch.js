import { db } from '../gamedata.js';

const KIND = 'SUPER_LASER';

// The unit whose superlaser the switch fires: a unit of this player with the ABILITY_COUNTDOWN behaviour and a
// SUPER_LASER ability (the Death Star II), which is never selected itself.
export function superLaserUser(world, player) {
  for (const unit of world.units)
    if (!unit.dead && unit.player === player && !unit.isSquad && unit.type.behaviors().has('ABILITY_COUNTDOWN') && unit.abilityState?.(KIND))
      return unit;
  return null;
}

// The superlaser switch on the space command bar (sl_switch and its sl_switch_recharge bar), as in the original
// game: shown while the player has such a unit, lit when the laser is ready, the bar filling as it recharges.
// Pressing it aims the superlaser for that unit.
export class SuperLaserSwitch {
  constructor(bar, ui, game) {
    this.bar = bar;
    this.ui = ui;
    this.game = game;
    this.button = bar.button('sl_switch', { onClick: () => this.press() });
    this.charge = bar.place(Object.assign(document.createElement('div'), { className: 'hbar' }), 'sl_switch_recharge');
    this.charge.innerHTML = '<i></i>';
    bar.root.appendChild(this.charge);
    const back = bar.tex('sl_switch_recharge', 'Bar_Texture_Name'),
      fill = bar.tex('sl_switch_recharge', 'Bar_Overlay_Name');
    if (back) this.charge.style.backgroundImage = `url("${back}")`;
    if (fill) this.charge.firstChild.style.backgroundImage = `url("${fill}")`;
    this.charge.firstChild.style.backgroundSize = (parseFloat(this.charge.style.width) || 0) + 'px 100%';
    this.button.hidden = this.charge.hidden = true;
    this.icon = '';
  }

  press() {
    const unit = superLaserUser(this.game.world, this.ui.player);
    if (!unit || this.state(unit).kind !== 'ready') return;
    if (this.ui.armed === 'ability:' + KIND) this.ui.arm(null);
    else this.ui.armAbilityFor(KIND, [unit]);
  }

  // ready: can fire; active: firing; recharging: the bar fills; locked: no shot for another reason.
  state(unit) {
    const ability = unit.abilityState(KIND);
    const span = ability.span || ability.def.recharge;
    if (ability.cooldown > 0) return { kind: 'recharging', level: span > 0 ? Math.max(0, 1 - ability.cooldown / span) : 1 };
    if (ability.active) return { kind: 'active', level: 0 };
    if (unit.abilitiesDisabled || (unit.abilityLock || 0) > this.game.world.time) return { kind: 'locked', level: 1 };
    return { kind: 'ready', level: 1 };
  }

  refresh() {
    const unit = superLaserUser(this.game.world, this.ui.player),
      shown = !!unit && !!this.button.style.width;
    this.button.hidden = this.charge.hidden = !shown;
    if (!shown) {
      if (this.ui.armedUsers && this.ui.armed === 'ability:' + KIND) this.ui.arm(null);
      return;
    }
    const { kind, level } = this.state(unit),
      ready = kind === 'ready',
      icon = this.bar.textureName('sl_switch', ready ? 'Icon_Alternate_Texture_Name' : 'Icon_Texture_Name');
    if (icon !== this.icon) {
      this.bar.setButtonImage(this.button, 'icon', icon);
      this.icon = icon;
    }
    this.button.classList.toggle('dis', !ready);
    this.button.classList.toggle('sel', this.ui.armed === 'ability:' + KIND);
    this.button.title = db.t('TEXT_TOOLTIP_ABILITY_SUPER_LASER_NAME') || '';
    this.charge.firstChild.style.width = 100 * level + '%';
  }
}

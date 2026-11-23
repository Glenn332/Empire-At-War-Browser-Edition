// Three pairs of tapered blades with a break at the apex of each pair. The
// aim point never moves; bloom changes the diameter, not the shot direction.
const blade = 'M-1 -47 Q-5 -46 -9 -42 Q-22 -38 -32 -28 Q-20 -35 -9 -37 L-1 -39 Z';
const ring = [0, 120, 240]
  .map(angle => `<g transform="rotate(${angle})"><path d="${blade}"/><path transform="scale(-1 1)" d="${blade}"/></g>`)
  .join('');
const ticks = Array.from({ length: 9 }, (_, i) => `<rect x="-2.6" y="38" width="5.2" height="6" transform="rotate(${(i - 4) * 9})"/>`).join(
  ''
);
export class BattleReticle {
  constructor(parent) {
    const el = (this.el = document.createElement('div'));
    el.className = 'bf-reticle';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<svg viewBox="-50 -50 100 100" width="100%" height="100%"><g class="bf-blades">${ring}</g><path class="bf-cross-lines" d="M-12 0h8 M4 0h8 M0 -12v8 M0 4v8"/><rect class="bf-pip" x="-1.6" y="-1.6" width="3.2" height="3.2"/><g class="bf-heat">${ticks}</g></svg>`;
    parent.appendChild(el);
    this.ticks = [...el.querySelectorAll('.bf-heat rect')];
  }
  draw(mode, style, size, heat, hot) {
    const el = this.el;
    if (mode !== this.mode) el.dataset.target = this.mode = mode;
    if (style !== this.style) el.dataset.shape = this.style = style;
    if (size !== this.size) el.style.width = `${(this.size = size)}px`;
    const level = heat == null ? -1 : Math.ceil(Math.min(1, Math.max(0, heat)) * 5);
    if (level !== this.level) {
      this.level = level;
      el.classList.toggle('has-heat', level >= 0);
      el.classList.toggle('warm', level > 0);
      this.ticks.forEach((tick, i) => tick.classList.toggle('lit', Math.abs(i - 4) < level));
    }
    el.classList.toggle('venting', !!hot && level >= 0);
  }
}

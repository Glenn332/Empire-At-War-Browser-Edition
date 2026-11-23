import { factionBadge } from './faction-badges.js';

// Derive the dial directly from the host's (owner, taker, progress) tuple.
// Progress can run backwards on a defense. -2 neutralizes; it isn't a pause.
export function capturePhase(side, taker, progress) {
  const p = Math.max(0, Math.min(1, progress || 0));
  if (taker === -1) return { side, strength: side >= 0 ? 1 : 0, action: side >= 0 ? 'Held' : 'Neutral' };
  if (taker < 0) return { side, strength: side >= 0 ? 1 - p : 0, action: side >= 0 ? 'Neutralizing' : 'Contested' };
  if (side >= 0 && side !== taker) {
    // Some scripted sites transfer directly without an intermediate neutral owner.
    if (p < 0.5) return { side, strength: 1 - 2 * p, action: 'Neutralizing' };
    return { side: taker, strength: 2 * p - 1, action: 'Capturing' };
  }
  return { side: taker, strength: p, action: 'Capturing' };
}

export class CaptureDial {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.hidden = true;
    this.el.className = 'bf-capture';
    this.el.setAttribute('role', 'meter');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    this.el.innerHTML = `<div class="bf-dial"><svg aria-hidden="true" viewBox="0 0 64 64" fill="none" stroke-width="4"><circle class="track" cx="32" cy="32" r="28"/><circle class="arc" cx="32" cy="32" r="28" pathLength="100" stroke-dasharray="100" transform="rotate(-90 32 32)"/></svg><div class="emblem"></div></div><small></small>`;
    parent.append(this.el);
    this.arc = this.el.querySelector('.arc');
    this.emblem = this.el.querySelector('.emblem');
    this.label = this.el.querySelector('small');
  }
  draw(pt, factions, ally, letter, now) {
    // Show the completed friendly ring briefly, then leave held points quiet.
    if (pt !== this.point) this.settledUntil = 0;
    else if (pt && this.lastTaker >= 0 && pt.side === this.lastTaker && pt.taker === -1) this.settledUntil = now + 850;
    this.point = pt;
    this.lastTaker = pt?.taker;
    this.el.hidden = !pt || (pt.taker === -1 && pt.side >= 0 && ally(pt.side) && now >= this.settledUntil);
    if (this.el.hidden) return;
    const phase = capturePhase(pt.side, pt.taker, pt.progress),
      pct = Math.round(phase.strength * 1000) / 10,
      faction = factions[phase.side] || null,
      relation = phase.side < 0 ? 'neutral' : ally(phase.side) ? 'ally' : 'enemy',
      label = letter ? `${phase.action} · ${letter}` : phase.action;
    if (faction !== this.faction) {
      this.faction = faction;
      this.emblem.replaceChildren(factionBadge(faction, false));
    }
    this.el.dataset.side = relation;
    this.el.style.setProperty('--strength', pct + '%');
    this.arc.style.strokeDashoffset = String(100 - pct);
    if (this.label.textContent !== label) this.label.textContent = label;
    this.el.setAttribute('aria-label', `${label}: ${faction || 'Neutral'}`);
    this.el.setAttribute('aria-valuenow', String(pct));
  }
}

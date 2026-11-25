// The two ticket banks stay put. The reserved center slot is only for target health.
export class BattleReadout {
  constructor(parent, makeBadge) {
    this.makeBadge = makeBadge;
    this.losses = [];
    const el = document.createElement('div');
    el.className = 'bf-readout';
    el.innerHTML = `<div class="bf-tally ours"></div><div class="bf-readout-center"><span></span><div class="bf-meter"><div class="bf-target-track"><i></i></div></div></div><div class="bf-tally theirs"></div>`;
    parent.appendChild(el);
    this.el = el;
    this.center = el.querySelector('.bf-readout-center');
    this.center.style.visibility = 'hidden';
    this.label = this.center.querySelector('span');
    this.track = el.querySelector('.bf-target-track');
    this.fill = this.track.firstElementChild;
    this.banks = [...el.querySelectorAll('.bf-tally')];
  }

  tickets(teams) {
    for (const [i, bank] of this.banks.entries()) {
      const items = teams.filter(t => t.mine === (i === 0));
      bank.replaceChildren(
        ...items.map(t => {
          const badge = document.createElement('span');
          const n = document.createElement('b');
          n.textContent = t.t;
          badge.className = 'bf-ticket';
          badge.append(...t.names.map(name => this.makeBadge(name)), n);
          return badge;
        })
      );
    }
    this.hasTickets = teams.length > 0;
  }

  aim(u, nameOf, ally, neutral, now = performance.now()) {
    const on = u && !u.gone && !u.dead && u.health > 0 && u.maxHealth > 0;
    const mode = on ? (neutral ? 'neutral' : ally ? 'ally' : 'enemy') : 'empty';
    this.el.hidden = !on && !this.hasTickets;
    if (this.el.dataset.mode !== mode) {
      this.el.dataset.mode = mode;
      this.center.style.visibility = on ? 'visible' : 'hidden';
    }
    const subject = on ? u : null,
      fraction = on ? Math.max(0, Math.min(1, u.health / u.maxHealth)) : 0;
    if (this.subject !== subject || (on && (u.health > this.lastHealth || u.maxHealth !== this.lastMax))) {
      for (const { el } of this.losses) el.remove();
      this.losses.length = 0;
      this.label.textContent = on ? nameOf(u.type) : '';
    } else if (on && fraction < this.fraction) {
      const el = document.createElement('b');
      el.className = 'bf-lost-hp';
      el.style.left = fraction * 100 + '%';
      el.style.width = (this.fraction - fraction) * 100 + '%';
      this.track.append(el);
      this.losses.push({ el, at: now });
    }
    // Each hit owns just its old-to-new interval and fades independently.
    for (let i = this.losses.length - 1; i >= 0; i--) {
      const { el, at } = this.losses[i],
        opacity = 1 - Math.max(0, now - at - 80) / 430;
      if (opacity <= 0) {
        el.remove();
        this.losses.splice(i, 1);
      } else el.style.opacity = String(opacity);
    }
    this.subject = subject;
    this.lastHealth = subject?.health;
    this.lastMax = subject?.maxHealth;
    this.fraction = fraction;
    const pct = fraction * 100 + '%';
    if (this.fill.style.width !== pct) this.fill.style.width = pct;
    return mode; // Single classification for the health readout and the sight.
  }
}

// Screen-space glyphs: a 200px radar is often displayed at 100–150 CSS px.
// Size people for the displayed map, independent of bitmap size or world zoom.
export function arrowRadius(canvas, designWidth, cssRadius) {
  return (cssRadius * designWidth) / (canvas.clientWidth || designWidth);
}
export function facingArrow(ctx, x, y, heading, radius, color) {
  const dx = Math.cos(heading) * radius,
    dy = -Math.sin(heading) * radius;
  ctx.beginPath();
  ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x - 0.64 * dx - 0.6 * dy, y - 0.64 * dy + 0.6 * dx);
  ctx.lineTo(x - 0.3 * dx, y - 0.3 * dy);
  ctx.lineTo(x - 0.64 * dx + 0.6 * dy, y - 0.64 * dy - 0.6 * dx);
  ctx.closePath();
  ctx.strokeStyle = '#152029';
  ctx.lineWidth = Math.max(0.8, radius * 0.19);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
}

// Edge pins use the same yaw-relative coordinates as contacts and terrain.
// Keep the marker (not just its center) inside the visible circle.
export function pinRadarPoint(x, y, center, rim) {
  const dx = x - center,
    dy = y - center,
    distance = Math.hypot(dx, dy);
  return distance <= rim ? [x, y] : [center + (dx * rim) / distance, center + (dy * rim) / distance];
}

// Give edge markers on nearly identical bearings separate readable positions.
// The tick at their original bearing stays exact. Work across the largest gap
// first so that north (or any other wrap seam) is not a special case.
export function spaceRimPins(pins, radius) {
  if (pins.length < 2) return;
  const turn = Math.PI * 2;
  pins.sort((a, b) => a.bearing - b.bearing);
  let start = 0,
    gap = pins[0].bearing + turn - pins.at(-1).bearing;
  for (let i = 1; i < pins.length; i++) {
    const g = pins[i].bearing - pins[i - 1].bearing;
    if (g > gap) {
      start = i;
      gap = g;
    }
  }
  const ordered = pins.slice(start).concat(pins.slice(0, start));
  const step = Math.min(18 / radius, turn / pins.length);
  let last = -Infinity;
  for (const p of ordered) {
    const angle = p.bearing < ordered[0].bearing ? p.bearing + turn : p.bearing;
    last = p.angle = Math.max(angle, last + step);
  }
  // Bound the last cluster against the first marker across the seam as well.
  let next = ordered[0].angle + turn;
  for (let i = ordered.length - 1; i >= 0; i--) next = ordered[i].angle = Math.min(ordered[i].angle, next - step);
}

// Original silhouettes rather than captured HUD sprites. Kept inline so the
// quick equipment readout is available offline, including with modded units.
export const kitIcon = `<svg aria-hidden="true" viewBox="0 0 112 30" class="bf-kit-icon" fill="currentColor">
<g data-weapon="blaster"><path d="M2 13l13-2 8 2 4-4h37l4 2h29v2h12v4H93v2H61l-7 4-6-1-2-5h-9l-3 10h-7l1-10h-9L4 21z"/><path d="M33 4h20v4H33z M36 7h3v3h-3z M48 7h3v3h-3z"/></g>
<g data-weapon="launcher"><path d="M4 9h12v-3h62v2h22v-2h7v16h-7v-2H65l-8 4h-8l-4-4h-9l-4 7h-7l1-8H4z M37 2h17v3H37z"/></g>
<g data-weapon="blade"><path d="M5 21l25-5 2 5-25 5z M28 14l3-1 5 10-4 1z M34 15L105 2l-1 4-68 14z"/></g></svg>`;
export const cannonIcon = `<svg aria-hidden="true" viewBox="0 0 112 30" class="bf-kit-icon" fill="currentColor"><g data-weapon="cannon"><path d="M4 19l7-5h8l6-7h28l6 4h23v2h24v5H81v2H58l-5 4H34l-3 3H16v-4H4z M30 3h16v3H30z"/></g><g data-weapon="missile"><path d="M6 4l13 8h43l9-5h15l-7 5h14l14 4-14 4H77l8 6H70l-10-6H18L6 27l3-11z"/></g></svg>`;
export const grenadeIcon = `<svg aria-hidden="true" viewBox="0 0 22 24" fill="currentColor"><path d="M8 2h7v3l3 2-1 2-3-2H9L6 9 4 8l2-3h2z M5 11h12a8 8 0 1 1-12 0z"/><path d="M5 14h12v2H5z" fill="#202831"/></svg>`;

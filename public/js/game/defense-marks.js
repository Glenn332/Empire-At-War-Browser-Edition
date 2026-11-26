// A map-only view of land combat. Identify emplacements by their live weapons
// or firing ports, not by model names (many decorative towers share those).
const shots = new WeakMap();
export function noteMapShot(from, time) {
  if (!from) return;
  const record = u => {
    const mark = shots.get(u) || {};
    mark.time = time;
    mark.side = u.side;
    shots.set(u, mark);
  };
  record(from);
  if (from.inside) record(from.inside);
}

export function shotFlash(u, time) {
  const shot = shots.get(u);
  return !!shot && shot.side === u.side && time >= shot.time && time - shot.time < 0.24;
}

// The map projects world +Y upwards. Radar supplies its extra world rotation.
export function unitArrow(ctx, x, y, u, time, color, size, rotation = 0) {
  const a = (u.heading || 0) + rotation,
    dx = Math.cos(a) * size,
    dy = -Math.sin(a) * size;
  ctx.beginPath();
  ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x - 0.62 * dx - 0.58 * dy, y - 0.62 * dy + 0.58 * dx);
  ctx.lineTo(x - 0.32 * dx, y - 0.32 * dy);
  ctx.lineTo(x - 0.62 * dx + 0.58 * dy, y - 0.62 * dy - 0.58 * dx);
  ctx.closePath();
  ctx.fillStyle = shotFlash(u, time) ? '#fff' : color;
  ctx.fill();
}

export function defenseMarks(w, me) {
  const marks = new Map();
  for (const u of w.units) {
    if (!u.structure || u.dead || u.gone || u.inside || u.seen === false || u.squad?.craft) continue;
    const gun = !!u.weapon || !!u.guns?.length;
    const ports = u.ports > 0;
    const manned =
      w.shooter?.post === u ||
      u.holds?.some(q => q.members.some(m => m.inside === u && !m.dead && m.weapon && (m.gunner || m.remote?.post === u)));
    if (!gun && !ports && !manned) continue;
    const side = u.capturable?.side ?? u.side;
    const relation = side < 0 ? 'neutral' : side === w.wild ? 'wild' : w.ally(me, side) ? 'ally' : 'enemy';
    const ready = side >= 0 && ((gun && !u.unpowered && !(u.stunUntil > w.time)) || !!manned);
    const shot = shots.get(u),
      age = w.time - (shot?.time ?? -Infinity);
    const flash = ready && shot?.side === side && age >= 0 ? Math.max(0, 1 - age / 0.85) : 0;
    marks.set(u, { side, relation, ready, flash });
  }
  return marks;
}

// A raised barrel and a broad pedestal distinguish a gun from an infantry pip
// or a numbered command post. Outline-only = offline / vacant; echo = fired.
export function drawDefense(ctx, x, y, size, mark, friend, enemy) {
  const color = { ally: friend, enemy, wild: '#c8b070', neutral: '#bfc2c4' }[mark.relation];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  if (mark.flash > 0) {
    ctx.globalAlpha = mark.flash;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.arc(0, 0, 8 + 5 * (1 - mark.flash), 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-7, 5);
  ctx.lineTo(-6, 2);
  ctx.lineTo(-4, 2);
  ctx.lineTo(-4, -1);
  ctx.lineTo(-2, -4);
  ctx.lineTo(2, -4);
  ctx.lineTo(7, -8);
  ctx.lineTo(9, -6);
  ctx.lineTo(4, -1);
  ctx.lineTo(4, 2);
  ctx.lineTo(6, 2);
  ctx.lineTo(7, 5);
  ctx.closePath();
  ctx.strokeStyle = '#121412';
  ctx.lineWidth = 3.2;
  ctx.stroke();
  ctx.fillStyle = mark.flash > 1 - 0.24 / 0.85 ? '#fff' : mark.ready ? color : '#242626';
  ctx.fill();
  ctx.strokeStyle = mark.ready ? '#eae8d9' : color;
  ctx.lineWidth = mark.ready ? 0.75 : 1.4;
  ctx.stroke();
  ctx.restore();
}

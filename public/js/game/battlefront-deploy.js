import { DeployPreview } from './deploy-preview.js';
import { defenseMarks, drawDefense, unitArrow } from './defense-marks.js';
import { arrowRadius, facingArrow } from './combat-hud.js';
import { TERRAIN } from './landtables.js';
import { heightAt } from './terrain.js';
import { iconAdditiveUrl } from '../icons.js';
import { fitSpawnDisc, projectDisc, DISC_EDGE } from './deploy-disc.js';

// The 2005 screen had no dashboard around the game: class list, soldier, map, spawn.
export const bfPanel = `<div class="bf-screen" role="region" aria-label="Deployment">
  <div class="sh-cards" role="group" aria-label="Choose a unit"></div>
  <div class="bf-model" role="img"></div>
  <div class="bf-spawn"><div class="bf-count"></div><button type="button" class="sh-go bf-go">Spawn</button><div class="sh-status" role="status"></div></div>
  <div class="bf-objective"></div>
  <div class="bf-map"><svg aria-hidden="true" class="bf-north" viewBox="0 0 28 24"><path fill="#fff" d="M14 0 27 22 18 17 14 24 10 17 1 22Z"/><path fill="#aeb0b1" d="M14 0v24l4-7 9 5Z"/></svg><canvas class="sh-map" width="520" height="520" tabindex="0" aria-label="Battle map. Click a friendly unit to spectate. Click a friendly post or use the arrow keys to select a spawn point."></canvas></div>
  <button class="bf-post" type="button" aria-label="Cycle spawn point"><i aria-hidden="true"></i><span>Command Post</span></button>
</div>`;

// Native medic/targeting sprites; custom silhouettes for a scoped blaster and
// two sprinting boots. The shapes stay distinct even without their stat colors.
const statDefs = [
  ['health', 'Health', 'maximum HP', 'I_PA_TACTICAL_HEAL_INFANTRY.TGA', 'M3 6h14v11H3z M7 3h6v3H7z M9 8v2H7v2h2v2h2v-2h2v-2h-2V8z'],
  [
    'fire',
    'Firepower',
    'primary damage per second',
    null,
    'M.5 7.2h4.2l1-1h6.7v1.2h5.4v-.9h1.7v3h-2v-.7h-4.7l-1.3 2.1H9.8l1 2.2H8.7l-1.2-2.3H6.4L5 14.9H2.6l1.5-4.4-3.6 1.2z M6 3.2h6.6v1.9h-2.2v1.2H8.5V5.1H6z'
  ],
  [
    'range',
    'Range',
    'attack distance in world units',
    'I_RADAR_FOCUS.TGA',
    'M10 1a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M10 3a7 7 0 1 1 0 14 7 7 0 1 1 0-14z M8 9h4v2H8z'
  ],
  [
    'speed',
    'Speed',
    'base movement speed',
    null,
    'm9.5 1.8 4.9 1.4-1 2.8-3.6-.6-2.9 5.8-5.1-.1L.4 9.5 1.1 8l4.1.3 2.1-4.6z M12.8 6l4.6 2.8.2 2.1-5.2 5 .9 1.6-1.4 1.1-2.6-2.8.2-1.4 4.2-4.3-3.7-1.8z'
  ]
];
const numeric = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, useGrouping: false });
const abbreviated = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
function statRow(stats) {
  const row = document.createElement('span');
  row.className = 'bf-stats';
  for (const [key, name, units, sprite, path] of statDefs) {
    const item = document.createElement('span'),
      icon = document.createElement('i'),
      number = document.createElement('span');
    item.className = `bf-stat bf-stat-${key}`;
    const v = stats[key];
    const text = Number.isFinite(v)
      ? `${name}: ${v.toLocaleString(undefined, { maximumFractionDigits: 3 })} (${units})`
      : `${name}: unavailable`;
    item.title = text;
    item.setAttribute('role', 'img');
    item.setAttribute('aria-label', text);
    icon.setAttribute('aria-hidden', 'true');
    number.setAttribute('aria-hidden', 'true');
    const mask =
      (sprite && iconAdditiveUrl(sprite)) ||
      'data:image/svg+xml,' +
        encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill-rule="evenodd" d="${path}"/></svg>`);
    icon.style.maskImage = `url("${mask}")`;
    number.textContent = Number.isFinite(v) ? (Math.abs(v) >= 10000 ? abbreviated : numeric).format(v) : '—';
    item.append(icon, number);
    row.appendChild(item);
  }
  return row;
}

function loadout(s, c, cls) {
  const role = s.roleOf(c, cls),
    weapon = c.unit.str('Projectile_Types').toLowerCase();
  const primary =
    role === 'rocket'
      ? 'Missile Launcher'
      : role === 'scout'
        ? 'Precision Rifle'
        : /flame/.test(weapon)
          ? 'Flamethrower'
          : /rocket|missile/.test(weapon)
            ? 'Missile Launcher'
            : /laser_cannon/.test(weapon)
              ? 'Laser Cannon'
              : /blaster/.test(weapon) || role === 'trooper'
                ? 'Blaster Rifle'
                : role === 'heavy'
                  ? 'Heavy Blaster'
                  : '';
  const rows = primary ? [primary] : [];
  if (c.vehicle) return ['Vehicle', 'Driver seat'];
  if (role === 'trooper' && s.nadeWeapon()) rows.push('Thermal Detonator');
  if (role === 'hero' && !rows.length) rows.push('Hero');
  return rows.length ? rows : ['Infantry'];
}

// An overhead plan from THIS land map, not a recoloured minimap or a BF2 map image.
// Alpha expresses traversable ground; blocked terrain is cut out, and walls,
// buildings and elevation breaks form the lighter architectural lines.
function floorPlan(s) {
  const w = s.world,
    t = s.game.terrain,
    n = t.size,
    cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const ctx = cv.getContext('2d'),
    image = ctx.createImageData(n, n),
    data = image.data;
  const solid = i => !w.open[i] || (w.kind[i] & (TERRAIN.IMPASSABLE | TERRAIN.OBSTACLE | TERRAIN.REBELWALL | TERRAIN.EMPIREWALL)) !== 0;
  const slopeBand = i => Math.floor(t.heights[i] / 28);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x,
        j = 4 * ((n - 1 - y) * n + x),
        rock = solid(i),
        wet = w.wet[i];
      const outline = x > 0 && y > 0 && (rock !== solid(i - 1) || rock !== solid(i - n));
      const contour = !rock && !wet && x > 0 && y > 0 && (slopeBand(i) !== slopeBand(i - 1) || slopeBand(i) !== slopeBand(i - n));
      const wall = !w.open[i] || !!(w.kind[i] & (TERRAIN.REBELWALL | TERRAIN.EMPIREWALL));
      const v = outline ? 188 : wall ? 158 : rock ? 33 : wet ? 59 : contour ? 118 : 99;
      data[j] = v + (wet ? -3 : 7);
      data[j + 1] = v + 2;
      data[j + 2] = v + (wet ? 9 : -5);
      // A fit can extend beyond a square level (especially corner posts).
      // Let real terrain dissolve there; never invent or stretch map geometry.
      const edge = Math.min(1, Math.min(x, y, n - 1 - x, n - 1 - y) / Math.max(1, n * 0.075));
      data[j + 3] = (outline ? 201 : wall ? 190 : rock ? 55 : wet ? 142 : contour ? 156 : 126) * edge * edge * (3 - 2 * edge);
    }
  }
  ctx.putImageData(image, 0, 0);
  return cv;
}

export class BattlefrontDeploy {
  constructor(s, panel) {
    this.s = s;
    this.views = new WeakMap();
    this.q = k => panel.querySelector(k);
    this.preview = new DeployPreview(this.q('.bf-model'));
    this.objective = this.q('.bf-objective');
    this.post = this.q('.bf-post');
    this.post.onclick = () => this.cycle(1);
  }
  cycle(dir) {
    const pts = this.s.spawnSpots();
    if (!pts.length) return;
    const i = pts.indexOf(this.s.from);
    this.s.chooseSpawn(pts[(i + dir + pts.length) % pts.length]);
  }
  card(b, c, cls, cost) {
    const s = this.s,
      on = c === s.pick,
      locked = b.classList.contains('locked');
    b.className = 'bf-card' + (on ? ' on' : '') + (locked ? ' locked' : '');
    b.setAttribute('aria-pressed', String(on));
    const title = document.createElement('strong'),
      list = document.createElement('span');
    title.textContent = s.cardName(c);
    list.className = 'bf-loadout';
    for (const text of loadout(s, c, cls)) {
      const line = document.createElement('span');
      line.textContent = text;
      list.appendChild(line);
    }
    list.appendChild(statRow(s.statsOf(c, true)));
    if (locked || /credits$/.test(cost)) {
      const price = document.createElement('span');
      price.className = 'bf-price';
      price.textContent = cost;
      list.appendChild(price);
    }
    b.append(title, list);
  }
  select(c, locked) {
    const s = this.s,
      host = this.preview.host;
    host.classList.toggle('bf-locked', locked);
    host.setAttribute('aria-label', c ? `${s.cardName(c)}${locked ? ' (locked)' : ''}` : 'No unit available');
    this.preview.show(c?.unit, c && s.world.teamColorFor(s.me, c.unit), c && s.iconOf(c.unit));
  }
  update(pts) {
    const s = this.s,
      p = s.from;
    const label =
      !p && this.teammate
        ? `Spectating ${s.nameOf(this.teammate.type)}`
        : !p
          ? 'No spawn point'
          : p.squad
            ? `Squad ${p.n}`
            : p.home
              ? 'Home base'
              : `Command Post ${this.number(p)}`;
    this.objective.textContent = s.world.points.some(point => point.reinforce && !point.locked)
      ? 'Capture the Command Posts'
      : 'Defeat the enemy forces';
    this.post.querySelector('span').textContent = this.teammate ? (p?.squad ? `Squad ${p.n}` : 'Spectating') : 'Command Post';
    this.post.title = label + ' · Click to cycle';
    this.post.setAttribute('aria-label', label + '. Next spawn point');
    this.post.disabled = pts.length === 0 || (pts.length === 1 && pts[0] === p);
    this.q('.bf-count').textContent = s.pick
      ? 'Unit Count: ' + s.world.units.filter(u => !u.dead && u.side === s.me && u.type === s.pick.unit).length
      : '';
  }
  canWatch(u) {
    return (
      u &&
      !u.dead &&
      !u.gone &&
      !u.inside &&
      u.seen !== false &&
      !u.scriptHidden &&
      !u.netHidden &&
      !u.structure &&
      u.side >= 0 &&
      this.s.world.ally(u.side, this.s.me)
    );
  }
  syncTeammate(pts) {
    if (!this.canWatch(this.teammate)) {
      this.teammate = null;
      return false;
    }
    const team = this.s.teamOf.get(this.teammate);
    this.s.from = pts.find(p => p.squad && (p.squad === team || p.squad.lead === this.teammate)) || null;
    return true;
  }
  teammateHit(x, y, limit) {
    const drawn = this.views.get(this.s.mapCv);
    if (!drawn) return null;
    let closest = null;
    for (const hit of drawn.friends) {
      const d = Math.hypot(x - hit.x, y - hit.y);
      if (d < limit && this.canWatch(hit.watchUnit)) {
        closest = hit;
        limit = d;
      }
    }
    return closest;
  }
  setBackdrop(cam, real) {
    // A low view into the actual level behind the model, not a second map or a bitmap.
    const s = this.s,
      t = s.game.terrain,
      p = s.from;
    const u = this.teammate || p?.squad?.lead;
    if (this.canWatch(u)) {
      s.teammateView(cam, u, real);
      return true;
    }
    s.squadCamera = null;
    if (!p || (p.squad && !p.squad.lead)) return;
    const mid = (t.size - 1) * 10,
      dx = mid - p.x,
      dy = mid - p.y,
      len = Math.hypot(dx, dy) || 1;
    const x = p.x - (dx / len) * 74 + (dy / len) * 42,
      y = p.y - (dy / len) * 74 - (dx / len) * 42;
    cam.position.set(x, y, heightAt(t, x, y) + 25);
    const tx = p.x + (dx / len) * 150,
      ty = p.y + (dy / len) * 150;
    cam.up.set(0, 0, 1);
    cam.lookAt(tx, ty, heightAt(t, tx, ty) + 15);
  }
  number(p) {
    return this.s.world.points.filter(q => q.reinforce).indexOf(p) + 1;
  }
  defenseTitle(event) {
    const cv = this.s.mapCv,
      drawn = this.views.get(cv);
    if (!drawn) return '';
    const { frame: f, defenses } = drawn,
      rect = cv.getBoundingClientRect();
    const px = ((event.clientX - rect.left) * f.W) / rect.width,
      py = ((event.clientY - rect.top) * f.W) / rect.height;
    for (const [u, mark] of defenses) {
      if (Math.hypot(f.X(u.x) - px, f.Y(u.y) - py) > (12 * f.W) / 520) continue;
      const owner = this.s.world.factions[mark.side] || (mark.side < 0 ? 'Neutral' : 'Independent');
      return `${owner} · ${this.s.nameOf(u.type)} · ${mark.flash ? 'Firing' : mark.ready ? 'Ready' : 'Inactive'}`;
    }
    return '';
  }
  ground() {
    if (!this.plan || this.version !== this.s.world.groundVer) {
      this.version = this.s.world.groundVer;
      this.plan = floorPlan(this.s);
    }
    return this.plan;
  }
  draw(cv) {
    const s = this.s,
      w = s.world,
      x = cv.getContext('2d'),
      base = s.mapFrame(cv, false),
      posts = w.points.filter(p => p.reinforce),
      pts = s.spawnSpots(),
      extras = pts.filter(p => p.squad || p.home),
      defenses = defenseMarks(w, s.me),
      anchors = [...posts, ...pts, ...defenses.keys()],
      W = cv.width;
    if (cv === s.mapCv && this.canWatch(this.teammate)) anchors.push(this.teammate);
    if (cv !== s.mapCv && s.body && s.state === 'alive') anchors.push(s.body);
    const view = fitSpawnDisc(anchors, base.lo, base.hi, this.views.get(cv)?.view);
    const F = projectDisc(view, W, base.side);
    const friends = [];
    this.views.set(cv, { view, frame: F, defenses, friends });
    const blue = s.cfg.colorblind ? '#319fff' : '#236ee1',
      red = s.cfg.colorblind ? '#ff9c25' : '#d13636';
    const ring = (px, py, r) => {
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
    };
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, W, W);
    x.save();
    ring(W / 2, W / 2, W * DISC_EDGE);
    x.clip();
    x.imageSmoothingEnabled = true;
    x.drawImage(this.ground(), F.X(0), F.Y(F.side), F.side * F.k, F.side * F.k);
    // Feather just the terrain, then lay smoke behind it. Markers are painted
    // afterwards at full contrast all the way to the safe inset.
    const gradient = () => x.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W * DISC_EDGE);
    const fade = gradient();
    fade.addColorStop(0, '#fff');
    fade.addColorStop(0.72, '#fff');
    fade.addColorStop(0.93, '#ffffffb8');
    fade.addColorStop(1, '#ffffff00');
    x.globalCompositeOperation = 'destination-in';
    x.fillStyle = fade;
    x.fillRect(0, 0, W, W);
    const smoke = gradient();
    smoke.addColorStop(0, 'rgba(19,20,17,.77)');
    smoke.addColorStop(0.77, 'rgba(20,20,17,.78)');
    smoke.addColorStop(1, 'rgba(13,14,12,.65)');
    x.globalCompositeOperation = 'destination-over';
    x.fillStyle = smoke;
    x.fillRect(0, 0, W, W);
    x.globalCompositeOperation = 'source-over';
    ring(W / 2, W / 2, W * (DISC_EDGE - 0.003));
    x.strokeStyle = 'rgba(219,186,102,.48)';
    x.lineWidth = W / 460;
    x.stroke();
    x.save();
    x.scale(W / 520, W / 520);
    const k = 520 / W, person = arrowRadius(cv, 520, 6);
    // Keep infantry readable at the displayed disc size; only posts get numbers.
    for (const u of w.units) {
      if (u.dead || u.gone || u.inside || u.side < 0 || u.side === w.wild || defenses.has(u) || (u.structure && u.seen === false)) continue;
      const px = F.X(u.x) * k,
        py = F.Y(u.y) * k;
      if (u.structure) {
        const r = Math.max(3, Math.min(15, (u.hitRadius || 22) * F.k * k));
        x.fillStyle = '#a8a8a899';
        x.fillRect(px - r, py - r, r * 2, r * 2);
        continue;
      }
      if (u.seen === false || u.scriptHidden || u.netHidden) continue;
      const ally = w.ally(u.side, s.me);
      if (ally && cv === s.mapCv && Math.hypot(px - 260, py - 260) < 520 * DISC_EDGE) friends.push({ x: px / k, y: py / k, watchUnit: u });
      unitArrow(x, px, py, u, w.time, ally ? blue : red, u.kind === 'INFANTRY' || u.foot ? person : 6);
    }
    for (const [u, mark] of defenses) drawDefense(x, F.X(u.x) * k, F.Y(u.y) * k, 1.05, mark, blue, red);
    for (const p of [...extras, ...posts]) {
      const px = F.X(p.x) * k,
        py = F.Y(p.y) * k,
        cp = posts.includes(p);
      const color = p.home || p.squad ? blue : p.side < 0 ? '#c7c7c7' : w.ally(p.side, s.me) ? blue : red;
      // Keep a squad leader's facing and muzzle flash visible inside its spawn halo.
      if (p.squad?.lead) {
        x.strokeStyle = color;
        x.lineWidth = 1.2;
        ring(px, py, 6);
        x.stroke();
        continue;
      }
      ring(px, py, cp ? 6 : 3.5);
      x.fillStyle = color;
      x.fill();
      x.lineWidth = 1;
      x.strokeStyle = '#18191c';
      x.stroke();
      if (cp) {
        x.font = 'bold 15px Arial';
        x.textAlign = 'center';
        x.fillStyle = '#fff';
        x.shadowColor = '#111';
        x.shadowBlur = 2;
        x.fillText(String(posts.indexOf(p) + 1), px, py - 8);
        x.shadowBlur = 0;
      }
    }
    const sel = cv === s.mapCv && this.canWatch(this.teammate) ? this.teammate : pts.includes(s.from) ? s.from : null;
    if (sel) {
      const px = F.X(sel.x) * k,
        py = F.Y(sel.y) * k;
      x.strokeStyle = blue;
      x.lineWidth = 2.5;
      ring(px, py, 12);
      x.stroke();
      ring(px, py, 16);
      x.strokeStyle = '#f1cb69';
      x.lineWidth = 1.8;
      x.stroke();
    }
    if (s.body && s.state === 'alive') {
      const px = F.X(s.body.x) * k,
        py = F.Y(s.body.y) * k;
      facingArrow(x, px, py, s.yaw, person*1.85, '#fff8e9');
    }
    x.restore();
    x.restore();
  }
  dispose() {
    this.preview.dispose();
  }
}

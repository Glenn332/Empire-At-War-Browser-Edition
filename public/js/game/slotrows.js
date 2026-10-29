export const MAX_SLOTS = 100;
export const ROWS = 8;
export function rowsOf(dlg) { let n = 0; while (n < 64 && dlg.ctl(`IDC_PLAYER_NAME_${n}`)) n++; return n; }
export const PALETTE = ['#3686f2', '#e0352b', '#f7c90d', '#3fc45a', '#b05cf0', '#ff8a1f', '#27c9c9', '#f06aa8',
  '#ffffff', '#8a5a2b', '#9fd13a', '#3a3aa8', '#ff4fd8', '#7a7a7a', '#00a37a', '#c9b38a'];
{
  const hex = (h, s, l) => {
    const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
    return '#' + f(0) + f(8) + f(4);
  };
  for (let i = 0; PALETTE.length < MAX_SLOTS; i++) {
    const c = hex((i * 137.508 + 20) % 360, [0.85, 0.6][i % 2], [0.55, 0.4, 0.7][Math.floor(i / 2) % 3]);
    if (!PALETTE.includes(c)) PALETTE.push(c);
  }
}

export function slotWindow(dlg, { count, draw, add = null, canAdd = () => true, like }) {
  const def = id => { const e = dlg.ctl(id); return e && { x: parseFloat(e.style.left), y: parseFloat(e.style.top), w: parseFloat(e.style.width), h: parseFloat(e.style.height) }; };
  const rows = rowsOf(dlg);
  const first = def('IDC_PLAYER_NAME_0'), last = rows && def(`IDC_PLAYER_NAME_${rows - 1}`), team = rows && def(`IDC_PLAYER_TEAM_${rows - 1}`);
  let off = 0;
  const max = () => Math.max(0, count() - rows);
  const go = n => { n = Math.max(0, Math.min(max(), n)); if (n !== off) { off = n; draw(); } update(); };
  if (!first || !last || !dlg.ctl(like)) return { rows, get off() { return 0; }, show() {}, update() {} };
  const y = last.y + last.h + 6, h = 22, right = (team ? team.x + team.w : last.x + 480);
  const button = (label, x, w, fn) => {
    const b = dlg.ctl(like).cloneNode(true);
    b.removeAttribute('data-id');
    b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.width = w + 'px'; b.style.height = h + 'px';
    b.firstChild.textContent = label;
    b.classList.remove('off');
    b.onclick = ev => { ev.stopPropagation(); if (!b.classList.contains('off')) fn(); };
    dlg.el.appendChild(b);
    return b;
  };
  const addBtn = add ? button('Add Slot', first.x, first.w, () => { add(); update(); go(count() - rows); }) : null;
  const down = button('▼', right - 34, 34, () => go(off + 1)), up = button('▲', right - 72, 34, () => go(off - 1));
  const label = document.createElement('div');
  label.className = 'dlg-txt';
  label.style.cssText = `position:absolute;left:${first.x + first.w + 8}px;top:${y + 4}px;width:${right - 80 - first.x - first.w - 8}px;text-align:right;font-size:11px;color:#c8b46a`;
  dlg.el.appendChild(label);
  const area = { x0: first.x, y0: first.y, x1: right, y1: last.y + last.h };
  dlg.el.addEventListener('wheel', ev => {
    if (max() <= 0) return;
    const r = dlg.el.getBoundingClientRect(), k = r.width / dlg.el.offsetWidth;
    const x = (ev.clientX - r.left) / k, yy = (ev.clientY - r.top) / k;
    if (x < area.x0 || x > area.x1 || yy < area.y0 || yy > area.y1) return;
    ev.preventDefault();
    go(off + Math.sign(ev.deltaY));
  }, { passive: false });
  function update() {
    const n = count(), scroll = n > rows;
    off = Math.min(off, max());
    up.hidden = down.hidden = !scroll;
    up.classList.toggle('off', off <= 0); down.classList.toggle('off', off >= max());
    label.textContent = scroll ? `Players ${off + 1}-${off + rows} of ${n}` : '';
    if (addBtn) addBtn.classList.toggle('off', n >= MAX_SLOTS || !canAdd());
  }
  update();
  return { rows, get off() { return off; }, show(i) { if (i < off) go(i); else if (i >= off + rows) go(i - rows + 1); }, update };
}

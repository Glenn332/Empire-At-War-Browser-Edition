import { db } from '../gamedata.js';
import { setComponentText } from './componenttext.js';
import { snapNativeText } from '../nativefont.js';

const SHELL = 'TARGET_TYPE_BACK',
  SLOTS = 12,
  ROW = 43;
const button = k => `H_${String(k >> 1).padStart(2, '0')}${String(k & 1).padStart(2, '0')}`;
const two = k => String(k).padStart(2, '0');

function wrap(text, width, max = 0) {
  const words = String(text || '')
      .split(/\s+/)
      .filter(Boolean),
    lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) {
      lines.push(line);
      line = w;
    } else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return max ? lines.slice(0, max) : lines;
}

export class NeutralizeShell {
  constructor(game) {
    this.game = game;
    this.opened = false;
    this.texts = [];
    this.generation = 0;
  }

  static available(game) {
    return !!game.scriptUI?.comps.get(SHELL)?.val('Model_Name');
  }

  async open(rows, choose, { cancel = null } = {}) {
    const ui = this.game.scriptUI;
    if (this.opened || !ui) return false;
    const shown = rows.filter(r => r.valid).slice(0, SLOTS);
    if (!shown.length) return false;
    const generation = ++this.generation;
    this.opened = true;
    this.rows = shown;
    this.choose = choose;
    this.cancel = cancel;
    ui.visibility(SHELL, true);
    await ui.ready();
    const shell = ui.shells.get(SHELL);
    if (generation !== this.generation || !this.opened) return true;
    if (!shell) {
      this.opened = false;
      return false;
    }
    this.shell = shell;
    const rowsUsed = Math.max(0, Math.min(5, (shown.length - 1) >> 1)),
      lift = (5 - rowsUsed) * ROW;
    for (let i = 0; i <= 5; i++) {
      const mesh = shell.shell.get('FRAME_ALT' + i);
      if (mesh) for (const el of shell.root.querySelectorAll(`.script-art[data-bone="${mesh.bone}"]`)) el.hidden = i !== rowsUsed;
    }
    const credits = Math.trunc(
      (this.game.galaxy.players.find(p => String(p.faction).toUpperCase() === String(this.game.me).toUpperCase())?.credits ?? 0) + 0.5
    );
    this.handlers = new Map();
    for (let k = 0; k < SLOTS; k++) {
      const name = button(k),
        row = shown[k];
      ui.visibility(name, !!row);
      if (!row) continue;
      const price = Math.trunc(row.cost + 0.5),
        ok = credits >= price;
      ui.icon(name, row.type.str('Icon_Name') || 'i_button_temporary.tga', ...(ok ? [1, 1, 1, 1] : [128 / 255, 128 / 255, 128 / 255, 1]));
      ui.enable(name, ok);
      this.handlers.set(name, () => {
        const pick = this.rows?.[k];
        this.close();
        if (pick) this.choose(pick, name);
      });
    }
    if (ui.comps.get('H_CLOSE'))
      this.handlers.set('H_CLOSE', () => {
        this.close();
        this.cancel?.('H_CLOSE');
      });
    ui.handlers = this.handlers;
    const text = (comp, value, x, y) => {
      const c = ui.comps.get(comp);
      if (!c || !value) return;
      const el = document.createElement('div');
      el.className = 'ht';
      el.dataset.control = comp;
      const left = /^(true|yes|1)$/i.test(c.val('Left_Justified') || '');
      Object.assign(el.style, {
        position: 'absolute',
        left: x + 'px',
        top: -y + 'px',
        transform: left ? 'translate(0,-50%)' : 'translate(-50%,-50%)',
        pointerEvents: 'none',
        whiteSpace: 'pre',
        zIndex: '30'
      });
      setComponentText(el, c, value, { scale: this.game.overlayScale() });
      shell.root.appendChild(el);
      this.texts.push(el);
    };
    const at = name => shell.origins.get(name);
    const size = name =>
      String(ui.comps.get(name)?.val('Size') || '')
        .split(/[\s,]+/)
        .map(Number);
    const o = at('H_TITLE');
    if (o) text('H_TITLE', db.t('TEXT_NEUTRALIZE_HERO_DIALOG_TITLE'), o.x, o.y);
    const close = ui.controls.get('H_CLOSE'),
      c = at('H_CLOSE');
    if (close) {
      ui.text('H_CLOSE', 'TEXT_BUTTON_CANCEL');
      ui.visibility('H_CLOSE', true);
      ui.enable('H_CLOSE', true);
      close.b.style.transform = lift ? `translateY(${-lift}px)` : '';
      (shell.offsets ||= new Map()).set('H_CLOSE', [0, lift]);
    } else if (c && ui.comps.get('H_CLOSE')) text('H_CLOSE', db.t('TEXT_BUTTON_CANCEL'), c.x, c.y + lift);
    shown.forEach((row, k) => {
      const n = at('H_NAME_' + two(k)),
        p = at('H_PRICE_' + two(k));
      const lines = wrap(db.t(row.type.str('Text_ID')) || row.type.name, size('H_NAME_' + two(k))[0] || 12, 2);
      if (n) text('H_NAME_' + two(k), lines.join('\n'), n.x, n.y);
      if (p) text('H_PRICE_' + two(k), `$ ${Math.trunc(row.cost + 0.5)}`, p.x, p.y);
    });
    const d = at('TEXT_HERO'),
      [width, height] = size('TEXT_HERO');
    ui.visibility('TEXT_HERO', false);
    if (d)
      wrap(db.t('TEXT_NEUTRALIZE_HERO_DIALOG_DESCRIPTION'), width || 57).forEach((line, i) =>
        text('TEXT_HERO', line, d.x, d.y + lift - i * (height || 10))
      );
    snapNativeText(shell.root);
    return true;
  }

  close() {
    this.generation++;
    if (!this.opened) return;
    this.opened = false;
    this.rows = null;
    const ui = this.game.scriptUI;
    for (const el of this.texts.splice(0)) el.remove();
    if (ui) {
      if (ui.handlers === this.handlers) ui.handlers = null;
      ui.visibility(SHELL, false);
    }
    this.handlers = null;
    this.game.keys?.clear();
  }
}

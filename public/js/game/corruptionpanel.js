import { db } from '../gamedata.js';
import { iconCanvasRect, iconUrl } from '../icons.js';
import { NativePanel, loadNativePanelAssets, tintShell } from './nativepanel.js';
import { GalacticEncyclopedia } from './galacticencyclopedia.js';
import { requirements } from './galacticcorruption.js';
import { dialogFontPixels } from './dialogtext.js';
import { loadComponentFont } from '../nativefont.js';
import { capturePlanet, CORRUPTION_PICTURE } from './planetinfo.js';

const css = url => (url ? `url("${url}")` : 'none');
const key = s => String(s || '').toUpperCase();
const WHITE = [255, 255, 255, 255], RED = [255, 0, 0, 255];
const list = name => db.constants.str(name).split(/\s+/).filter(Boolean);
const LETTERS = ['a', 'b', 'c'];

export const loadCorruptionAssets = () => loadNativePanelAssets('corruption_shell', 'i_corrupt_choice.alo');

function wrap(text, width, font) {
  const out = []; let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (line && font.measure(next) > width) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export class CorruptionPanel extends NativePanel {
  constructor(game, data) {
    super(game, data, 'corruption-panel', db.t('TEXT_CORRUPTION_TITLE'));
    this.images = tintShell(this); this.open = false; this.state = null;
    this.blocker = document.createElement('div'); this.blocker.className = 'market-blocker'; this.blocker.hidden = true;
    document.body.insertBefore(this.blocker, this.root);
    this.title = this.text('corrupt_planet_title00', ''); this.planetName = this.text('corrupt_planet_title01', '');
    this.defiler = [this.text('corrupt_planet_defiler_00', ''), this.text('corrupt_planet_defiler_01', '')];
    this.picture = document.createElement('img'); this.picture.alt = ''; this.picture.className = 'corruption-planet'; this.root.appendChild(this.picture);
    const r = this.shell.get('I_PLANET_IMAGE')?.rect;
    if (r) this.place(this.picture, r);
    this.closeButton = this.button('corrupt_close', () => db.t('TEXT_BUTTON_CANCEL'), () => this.close());
    this.tip = new GalacticEncyclopedia(game, { comps: data.comps, model: data.model });
    this.tip.anchorFn = () => {
      const o = this.origins.get('I_CORRUPT_ENCYCL') || { x: 0, y: 0 }, s = this.game.overlayScale();
      return [innerWidth / 2 / s + o.x, innerHeight / 2 / s + o.y];
    };
    this.columns = LETTERS.map(L => {
      const button = this.controls(new RegExp(`^CORRUPT_BUTTON_ICON_${L.toUpperCase()}$`))[0];
      const column = {
        button, title: this.text(`corrupt_title_${L}`, ''), cost: this.text(`corrupt_cost_${L}`, ''), text: [0, 1, 2, 3].map(k => this.text(`corrupt_text0${k}${L}`, '')), header: this.text(`corrupt_text04${L}`, ''),
        slots: [0, 1, 2, 3, 4, 5, 6, 7].map(k => ({ name: `corrupt_icon_0${k}${L}`, text: this.text(`corrupt_icon_0${k}${L}`, ''), img: null })),
      };
      for (const slot of column.slots) {
        const o = this.origins.get(slot.name.toUpperCase()), img = document.createElement('img');
        img.alt = ''; img.hidden = true; img.className = 'corruption-requirement';
        if (o) Object.assign(img.style, { left: o.x + 'px', top: -o.y + 'px' });
        this.root.appendChild(img); slot.img = img;
      }
      const over = this.comps.get(`CORRUPT_BUTTON_ICON_${L.toUpperCase()}`)?.val('Mouse_Over_Texture_Name').trim().split(/\s+/)[0] || '', rect = iconCanvasRect(over);
      if (button) {
        button.el.style.setProperty('--over', css(iconUrl(over)));
        button.el.style.setProperty('--over-w', (rect?.w || 0) + 'px'); button.el.style.setProperty('--over-h', (rect?.h || 0) + 'px');
        button.el.style.setProperty('--over-x', '0px'); button.el.style.setProperty('--over-y', '0px');
        button.el.onmouseenter = () => { if (column.choice) { if (button.el.getAttribute('aria-disabled') !== 'true') this.game.audio.play(this.comps.get(`CORRUPT_BUTTON_ICON_${L.toUpperCase()}`)?.val('Mouse_Over_SFX') || ''); this.describe(column.choice); } };
        button.el.onmouseleave = () => this.tip.hide();
        button.el.onclick = () => { if (button.el.getAttribute('aria-disabled') !== 'true' && column.choice) this.choose(column.choice); };
      }
      return column;
    });
    this.paint();
  }

  describe(choice) {
    const icons = list('Corruption_Mission_Requirement_Icon_Name'), names = list('Corruption_Choice_Name'), encyclopedia = list('Corruption_Choice_Encyclopedia');
    const body = choice.briefing ? db.t(choice.briefing) : db.t(encyclopedia[choice.type]);
    this.tip.showInfo(icons[choice.type] || '', db.t(names[choice.type]), body);
  }

  async show({ actor, planet, choices, info = false }) {
    if (this.open || this.game.battle || this.game.baseLayout?.open || this.game.marketPanel?.open) return false;
    this.wrapFont = await loadComponentFont('Arial', dialogFontPixels(768, 7)); this.wrapFont8 = await loadComponentFont('Arial', dialogFontPixels(768, 8));
    if (!this.wrapFont || this.open) return false;
    this.open = true; this.state = { actor, planet, choices, info };
    this.root.hidden = this.blocker.hidden = false;
    this.game.mouse.in = false; this.game.keys.clear();
    this.reflowText();
    this.fill();
    this.picture.src = ''; this.picture.hidden = true;
    capturePlanet(this.game, planet, { ...CORRUPTION_PICTURE, rgb: [126, 103, 44] }).then(url => { if (this.open && this.state?.planet === planet && url) { this.picture.src = url; this.picture.hidden = false; } }).catch(() => {});
    this.refresh();
    this.game.story?.signal?.('STORY_OPEN_CORRUPTION', planet.type.name);
    return true;
  }

  close() {
    if (this.open) this.game.story?.generic?.('close_corruption_dialog');
    if (!this.open) return;
    this.open = false; this.state = null; this.tip.hide();
    this.root.hidden = this.blocker.hidden = true;
    for (const c of this.columns) c.choice = null;
  }

  choose(choice) {
    const { actor, planet, info } = this.state, game = this.game;
    if (info) return;
    this.close();
    game.executeCorruptionChoice?.(actor, planet, choice);
    game.story?.generic?.('choose_corruption_option');
    game.ui?.refresh();
  }

  fill() {
    const { planet, choices, info } = this.state, names = list('Corruption_Choice_Name'), icons = list('Corruption_Choice_Icon_Name'), benefits = list('Corruption_Choice_Benefit'), marks = list('Corruption_Mission_Requirement_Icon_Name');
    this.setText(this.title, db.t(info ? 'TEXT_PLANETARY_CORRUPTION_INFO' : 'TEXT_CORRUPTION_TITLE'));
    const need = info && this.wrapFont8 ? wrap(db.t('TEXT_CORRUPTION_REQUIRED'), this.comps.get('CORRUPT_PLANET_DEFILER_00')?.val('Size').trim().split(/\s+/).map(Number)[1] || 252, this.wrapFont8) : [];
    this.defiler.forEach((el, k) => { if (!el) return; const label = this.textLabels.get(el); if (label) label.tint = [255, 0, 0, 255]; this.setText(el, need[k] || ''); }); this.setText(this.planetName, db.t(planet.type.str('Text_ID')) || planet.type.name);
    this.columns.forEach((column, i) => {
      const choice = choices[i];
      column.choice = choice || null;
      const hide = !choice;
      if (column.button) { column.button.el.hidden = hide; column.button.el.setAttribute('aria-disabled', 'true'); column.button.img.hidden = hide; }
      for (const el of [column.title, column.cost, ...column.text, column.header]) { el.hidden = hide; if (hide) this.setText(el, ''); }
      for (const slot of column.slots) { slot.img.hidden = true; slot.text.hidden = true; this.setText(slot.text, ''); slot.kind = null; }
      if (!choice) return;
      const base = icons[choice.type] || '', icon = info && iconCanvasRect('f_' + base) ? 'f_' + base : base, r = iconCanvasRect(icon);
      if (column.button) { column.button.img.src = iconUrl(icon); column.button.img.style.width = (r?.w || 96) + 'px'; column.button.img.style.height = (r?.h || 96) + 'px'; column.button.icon = icon; }
      this.setText(column.title, db.t(names[choice.type]));
      this.setText(column.cost, `$ ${Math.round(choice.cost)}`);
      const size = this.comps.get(`CORRUPT_TEXT00${LETTERS[i].toUpperCase()}`)?.val('Size').trim().split(/\s+/).map(Number) || [1, 445];
      const lines = wrap(db.t(benefits[choice.type]), size[1] || 445, this.wrapFont);
      column.text.forEach((el, k) => this.setText(el, lines[k] || ''));
      this.setText(column.header, db.t('TEXT_CORRUPTION_REQUIREMENT'));
      let row = 0;
      const put = (slotIndex, icon, kind, value) => {
        const slot = column.slots[slotIndex]; if (!slot) return;
        const rect = iconCanvasRect(icon);
        slot.img.src = iconUrl(icon); slot.img.style.width = (rect?.w || 48) + 'px'; slot.img.style.height = (rect?.h || 48) + 'px'; slot.img.hidden = false;
        slot.kind = kind; slot.value = value; slot.img.onmouseenter = () => this.explain(kind, value); slot.img.onmouseleave = () => this.tip.hide();
      };
      column.rows = [];
      if (choice.missionType >= 0) { put(row * 4, marks[choice.missionType] || '', 'mission', choice.missionType); column.rows.push({ at: row * 4 + 1, kind: 'mission', icon: row * 4 }); row++; }
      if (choice.units.length) {
        const type = choice.units.find(t => (this.game.galaxy.fleets.some(f => f.units.some(u => (u.carries || u.type) === t || (u.carries || u.type).list('Company_Units').some(n => key(n) === key(t.name)))))) || choice.units[0];
        put(row * 4, type.str('Icon_Name'), 'unit', type); column.rows.push({ at: row * 4 + 1, kind: 'unit', icon: row * 4 }); row++;
      }
      if (row < 2 && choice.planets.length) {
        const planetIcon = marks[8] || '';
        put(row * 4, planetIcon, 'planet', choice.planets[0]); column.rows.push({ at: row * 4 + 1, kind: 'planet', icon: row * 4 }); row++;
      }
    });
  }

  explain(kind, value) {
    const marks = list('Corruption_Mission_Requirement_Icon_Name'), names = list('Corruption_Choice_Name');
    if (kind === 'unit') this.tip.showInfo(value.str('Icon_Name'), db.t(value.str('Text_ID')) || value.name, db.t('TEXT_CORRUPTION_UNIT_REQUIREMENT'));
    else if (kind === 'planet') this.tip.showInfo(marks[8] || '', db.t(db.type(value)?.str('Text_ID')) || String(value), db.t('TEXT_CORRUPTION_PLANET_REQUIREMENT'));
    else this.tip.showInfo(marks[value] || '', db.t(names[value]), db.t('TEXT_CORRUPTION_MISSION_REQUIREMENT'));
  }

  refresh() {
    if (!this.open) return;
    const { actor, planet, choices, info } = this.state, game = this.game, player = game.galaxy.players.find(p => key(p.faction) === key(info ? game.me : actor.owner));
    if (!player) return;
    const tint = (el, color) => { const label = this.textLabels.get(el); if (label) { label.tint = color; this.setText(el, label.source ?? label.value); } };
    this.columns.forEach((column, i) => {
      const choice = choices[i];
      if (!choice) return;
      const r = requirements(game, player, choice);
      tint(column.cost, r.credits ? WHITE : RED);
      let ok = r.credits;
      for (const row of column.rows || []) {
        const met = row.kind === 'mission' ? r.missions : row.kind === 'unit' ? r.units : r.planets;
        const have = row.kind === 'mission' ? Math.min(r.haveMissions, choice.missionCount) : row.kind === 'unit' ? Math.min(r.haveUnits, choice.unitCount) : (r.planets ? 1 : 0), need = row.kind === 'mission' ? choice.missionCount : row.kind === 'unit' ? choice.unitCount : 1;
        const slot = column.slots[row.at], iconSlot = column.slots[row.icon];
        slot.text.hidden = false; this.setText(slot.text, `${have}/${need}`); tint(slot.text, met ? WHITE : RED);
        if (row.kind !== 'planet') iconSlot.img.style.filter = met ? '' : 'brightness(0.5)';
        ok = ok && met;
      }
      if (column.button) {
        column.button.el.setAttribute('aria-disabled', ok && !info ? 'false' : 'true');
        column.button.img.style.filter = ok ? '' : 'brightness(0.5)';
      }
    });
  }

  resize() { super.resize(); if (this.images) this.paint(); }
  paint() { this.paintShell(); }
}

import { db } from '../gamedata.js';
import { iconUrl } from '../icons.js';

const T = (id, fallback = '') => db.t(id) || fallback;
const rgb = (s, def) => {
  const c = (s || '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  return c.length >= 3 ? `rgb(${c[0]},${c[1]},${c[2]})` : def;
};
const KEY = 'swr.hints';
const WEATHER = [
  'i_pa_weather_sun.tga',
  'i_pa_weather_fire.tga',
  'i_pa_weather_snow.tga',
  'i_pa_weather_rain.tga',
  'i_pa_weather_wind.tga'
];
const SHOW_SECONDS = 10;

export class Advisor {
  constructor(game) {
    this.game = game;
    this.log = [];
    this.next = 0;
    this.timer = 5;
    let on = true;
    try {
      on = localStorage.getItem(KEY) !== '0';
    } catch {}
    this.enabled = on;
    this.interval = db.constants.num('Advisor_Hint_Interval', 300);
  }

  hints() {
    return this.game.human.faction
      .list('Space_Advisor_Hints')
      .map(id => T(id))
      .filter(Boolean);
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {}
  }

  update(dt) {
    const g = this.game;
    if (!this.enabled || g.over || g.setup.benchmark || g.setup.attract) return;
    if (g.advisorEnabled?.[String(g.human?.factionName || '').toUpperCase()] === false) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.interval;
    const list = this.hints();
    if (!list.length) return;
    const text = list[this.next++ % list.length];
    this.log.push({ time: g.world.time, text });
    g.audio.play(g.human.faction.str('SFXEvent_HUD_Advisor_Hint'));
    const bar = g.ui && g.ui.bar;
    if (bar && bar.showHint) bar.showHint(text, SHOW_SECONDS);
  }

  async openLog() {
    const g = this.game,
      m = g.menus;
    const dlg = await m.push('IDD_DROID_LOG', { adjust: c => (c.id === 'IDC_DROID_LIST' ? { ...c, h: 314 - c.y } : null) });
    if (!dlg) return false;
    if (!g.over) g.paused = true;
    const f = g.human.faction,
      C = db.constants;
    const tabs = ['IDC_DROID_LOG_RADIO', 'IDC_DATA_CHART_RADIO', 'IDC_TECH_TREE_RADIO', 'IDC_SUMMARY_SCREEN_RADIO'];
    dlg.radios(tabs, tabs[0]);
    for (const t of tabs.slice(1)) dlg.enable(t, false);
    dlg.setImage('IDC_DROID_PICTURE_', iconUrl(f.str('Helper_Icon_Name')));
    dlg.check('IDC_HINTS_CHECK', this.enabled, on => this.setEnabled(on));
    const list = dlg.ctl('IDC_DROID_LIST');
    if (list && list._rows) {
      list._rows.style.setProperty('--date', rgb(C.str('Droid_Date_Color'), '#f00'));
      list._rows.style.setProperty('--sep', rgb(C.str('Droid_Seperator_Color'), '#808080'));
      list._rows.style.color = rgb(C.str('Droid_Text_Color'), '#fff');
      list._rows.replaceChildren(
        ...this.log.map(e => {
          const d = document.createElement('div');
          d.className = 'droid-msg';
          const when = document.createElement('b'),
            mm = Math.floor(e.time / 60),
            ss = Math.floor(e.time % 60);
          when.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
          d.append(when, e.text);
          return d;
        })
      );
      list._rows.scrollTop = list._rows.scrollHeight;
    }
    const icons = C.list('Planet_Ability_Icon_Names'),
      texts = C.list('Planet_Ability_Text_IDs'),
      cols = C.list('Planet_Ability_RGBs');
    for (let i = 0; i < 25; i++) {
      const has = i < Math.min(icons.length, texts.length);
      dlg.setImage('IDC_PA_ICON' + i, has ? iconUrl(icons[i]) : '');
      dlg.setText('IDC_PA_TEXT' + i, has ? T(texts[i]) : '');
      const t = dlg.ctl('IDC_PA_TEXT' + i);
      if (t && has && cols.length >= i * 3 + 3) {
        t.style.color = `rgb(${cols[i * 3]},${cols[i * 3 + 1]},${cols[i * 3 + 2]})`;
        t.style.background = 'none';
        t.style.webkitTextFillColor = 'currentColor';
      }
    }
    WEATHER.forEach((n, i) => dlg.setImage('IDC_WEATHER_ICON' + i, iconUrl(n)));
    dlg.on('IDC_BUTTON_CLOSE', () => m.pop());
    return true;
  }

  async openHolocron() {
    const g = this.game,
      m = g.menus,
      dlg = await m.push('IDD_STORY_SUMMARY_DIALOG');
    if (!dlg) return false;
    if (!g.over) g.paused = true;
    dlg.radios(['IDC_RADIO_ACTIVE', 'IDC_RADIO_COMPLETED'], 'IDC_RADIO_ACTIVE');
    dlg.list('IDC_GOAL_LIST', []);
    dlg.list('IDC_STORY_RECAP', []);
    dlg.show('IDC_SUMMARY_DIALOG_ABANDON', false);
    dlg.on('IDC_SUMMARY_DIALOG_CLOSE_BUTTON', () => m.pop());
    return true;
  }
}

import { db } from '../gamedata.js';
import { iconUrl } from '../icons.js';
import { loadTextureCanvas } from '../dds.js';
import { openDialog, loadDialogs } from './dialogs.js';
import {
  LOG_TABS,
  LOG_WEATHER,
  logState,
  appendLog,
  logRows,
  logLegend,
  advisorHints,
  techTreeDialog,
  updateHistory
} from './galacticlogdata.js';
import { renderHistory } from './galactichistory.js';
import { renderTechTree } from './galactictechtree.js';
import { renderSummary } from './galacticsummary.js';
import { GalacticEncyclopedia } from './galacticencyclopedia.js';

const pictures = new Map();
export class GalacticLog {
  constructor(game, hud) {
    this.state = logState(game.galaxy).ui ||= { page: 0, metric: 'economy', techSpace: false };
    this.game = game;
    this.opened = false;
    this.dialog = null;
    this.generation = 0;
    this.page = this.state.page;
    this.wasPaused = false;
    this.historyMetric = this.state.metric;
    this.techSpace = this.state.techSpace;
    this.summaryKind = 'production';
    this.summarySort = 'planet';
    this.summaryDescending = false;
    this.portraits = new Map();
    this.queue = [];
    this.hold = 0;
    this.cleanup = null;
    this.encyclopedia = hud && new GalacticEncyclopedia(game, hud);
  }
  toggle() {
    if (this.opened) this.close();
    else this.show();
  }
  async show(page = this.page, { summary = null } = {}) {
    if (!this.opened) {
      this.wasPaused = !!this.game.paused;
      if (this.game.pauseGalactic) this.game.pauseGalactic(true);
      else this.game.paused = true;
      this.opened = true;
    }
    this.encyclopedia?.hide();
    this.cleanup?.();
    this.cleanup = null;
    this.dialog?.close();
    this.dialog = null;
    const generation = ++this.generation;
    if (page === 3) {
      this.summaryKind = summary || 'production';
      this.summarySort = 'planet';
      this.summaryDescending = false;
    }
    this.state.page = this.page = page;
    this.game.keys?.clear();
    if (this.game.mouse) this.game.mouse.in = false;
    try {
      const skin = await loadDialogs();
      let name =
        page === 0
          ? 'IDD_DROID_LOG'
          : page === 1
            ? 'IDD_DATA_CHART'
            : page === 2
              ? techTreeDialog(this.game.me, this.techSpace)
              : 'IDD_SUMMARY_SCREEN_' + this.summaryKind.toUpperCase();
      if (page === 3 && this.summaryKind === 'economy') name = 'IDD_SUMMARY_SCREEN_ECONOMY';
      if (page === 2 && !skin.dialogs.has(name)) name = 'IDD_TECH_TREE_REBEL' + (this.techSpace ? '_SPACE' : '');
      const d = await openDialog(name, { cls: 'galactic-log', nativeImages: true, nativeLists: true, nativeFonts: true });
      if (!d) {
        this.close();
        return false;
      }
      if (!this.opened || generation !== this.generation) {
        d.close();
        return false;
      }
      this.dialog = d;
      d.veil.style.background = 'none';
      d.el.setAttribute('role', 'dialog');
      d.el.setAttribute('aria-modal', 'true');
      d.el.setAttribute('aria-label', db.t(['TEXT_DROID_LOG', 'TEXT_DATA_CHART', 'TEXT_TECH_TREE', 'TEXT_SUMMARY_SCREEN'][page]));
      d.onLanguageRefresh(() =>
        d.el.setAttribute('aria-label', db.t(['TEXT_DROID_LOG', 'TEXT_DATA_CHART', 'TEXT_TECH_TREE', 'TEXT_SUMMARY_SCREEN'][page]))
      );
      d.show('IDC_DIALOG_CLOSE_BUTTON', false);
      d.radios(LOG_TABS, LOG_TABS[page], id => this.show(LOG_TABS.indexOf(id)));
      for (const id of ['IDC_BUTTON_CLOSE', 'IDC_BUTTON_EXIT']) {
        const b = d.ctl(id);
        if (b) {
          b.style.outline = 'none';
          b.setAttribute('role', 'button');
          b.tabIndex = 0;
          b.onkeydown = e => {
            if (e.code === 'Enter' || e.code === 'Space') {
              e.preventDefault();
              this.close();
            }
          };
          d.on(id, () => this.close());
          b.focus();
        }
      }
      let cleanup;
      if (page === 0) await this.renderLog(d);
      else if (page === 1) cleanup = await renderHistory(this, d);
      else if (page === 2) await renderTechTree(this, d);
      else cleanup = await renderSummary(this, d);
      if (this.dialog === d) this.cleanup = cleanup;
      else cleanup?.();
      return true;
    } catch (error) {
      if (generation === this.generation) this.close();
      throw error;
    }
  }
  async picture(d, id, name, color = [255, 255, 255]) {
    const ctl = d.ctl(id);
    if (!ctl) return;
    const request = (ctl._pictureRequest = Symbol());
    d.imageFrame(id, false);
    if (!name) {
      d.setImage(id, '');
      return;
    }
    const key = name.toUpperCase() + '|' + color.join(',');
    if (!pictures.has(key))
      pictures.set(
        key,
        (async () => {
          const tinted = this.game.tinted?.(
            name,
            color.map(v => v / 255)
          );
          if (tinted) return tinted.toDataURL();
          const url = iconUrl(name);
          if (url) return url;
          const cv = await loadTextureCanvas(name).catch(() => null);
          if (!cv) return '';
          if (color.some(v => v !== 255)) {
            const ctx = cv.getContext('2d'),
              pixels = ctx.getImageData(0, 0, cv.width, cv.height);
            for (let i = 0; i < pixels.data.length; i += 4)
              for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.trunc((pixels.data[i + c] * color[c]) / 255);
            ctx.putImageData(pixels, 0, 0);
          }
          return cv.toDataURL();
        })()
      );
    const url = await pictures.get(key);
    if (this.dialog === d && ctl._pictureRequest === request) d.setImage(id, url);
  }
  async renderLog(d) {
    d.coloredTextList('IDC_DROID_LIST', logRows(this.game.galaxy));
    const label = () => d.ctl('IDC_DROID_LIST')?.setAttribute('aria-label', db.t('TEXT_DROID_LOG'));
    label();
    d.onLanguageRefresh(label);
    const player = this.game.galaxy.players.find(p => p.faction === this.game.me),
      flags = advisorHints(player);
    d.check('IDC_HINTS_CHECK', Object.values(flags).some(Boolean), on => {
      flags.Galactic = flags.Space = flags.Land = on;
    });
    const work = [this.picture(d, 'IDC_DROID_PICTURE_', db.faction(this.game.me)?.str('Helper_Icon_Name'))];
    for (const [i, item] of logLegend().entries()) {
      d.setText('IDC_PA_TEXT' + i, () => logLegend()[i].text);
      work.push(this.picture(d, 'IDC_PA_ICON' + i, item.icon, item.color.length === 3 ? item.color : [255, 255, 255]));
    }
    for (const [i, name] of LOG_WEATHER.entries()) work.push(this.picture(d, 'IDC_WEATHER_ICON' + i, name));
    await Promise.all(work);
  }
  add(text, color) {
    if (!text) return;
    appendLog(this.game.galaxy, text, color);
    if (this.opened && this.page === 0) this.dialog?.coloredTextList('IDC_DROID_LIST', logRows(this.game.galaxy));
  }
  showType(type) {
    this.encyclopedia?.showType(type, this.page === 0 || this.page === 2);
  }
  showLinked(type, event) {
    if (type) this.encyclopedia?.linked(() => db.t(type.str('Text_ID')) || type.name, event.clientX, event.clientY);
  }
  moveLinked(event) {
    this.encyclopedia?.moveLinked(event.clientX, event.clientY);
  }
  hideLinked() {
    this.encyclopedia?.hideLinked();
  }
  message(text, { urgent = true, color = [255, 255, 255], sfx = '' } = {}) {
    if (!text) return;
    const record = { text, color, sfx, urgent };
    if (urgent) {
      this.queue.unshift(record);
      this.hold = 0;
    } else this.queue.push(record);
  }
  update(dt) {
    const g = this.game;
    updateHistory(g.galaxy);
    if (!g.paused) {
      const p = g.galaxy.players.find(p => p.faction === g.me),
        frame = Math.trunc(g.galaxy.time * 30);
      if (p && advisorHints(p).Galactic && frame >= (p.advisorHintFrame ?? 90)) {
        const faction = db.faction(g.me),
          hints = faction.list('Galactic_Advisor_Hints');
        if (hints.length) {
          const index = p.advisorHintIndex || 0;
          this.message(db.t(hints[index % hints.length]), {
            urgent: false,
            color: [0, 193, 91],
            sfx: faction.str('SFXEvent_HUD_Advisor_Hint')
          });
          p.advisorHintIndex = (index + 1) % hints.length;
          p.advisorHintFrame = frame + Math.round(30 * db.constants.num('Advisor_Hint_Interval', 300));
        }
      }
    }
    if (this.opened || g.storyDialog?.opened || g.menus?.open || g.planetInfo?.open || g.scriptUI?.modal) return;
    this.hold -= dt;
    if (this.hold > 0) return;
    if (this.showing) {
      this.showing = false;
      if (this.encyclopedia?.shown === null) this.encyclopedia.hide();
    }
    if (!this.queue.length) return;
    const record = this.queue.shift();
    this.add(record.text, record.color);
    const faction = db.faction(g.me);
    g.audio?.play(record.sfx || faction.str(record.urgent ? 'SFXEvent_HUD_Advisor_Urgent' : 'SFXEvent_HUD_Advisor_Message'));
    this.hold = record.text.length * db.constants.num('Advisor_Hint_Duration', 0.1);
    if (this.hold > 0) {
      this.encyclopedia?.message(record.text, record.color);
      this.showing = true;
    }
  }
  close() {
    if (!this.opened) return;
    this.opened = false;
    this.generation++;
    this.encyclopedia?.hide();
    this.cleanup?.();
    this.cleanup = null;
    this.dialog?.close();
    this.dialog = null;
    this.portraits.clear();
    if (this.game.pauseGalactic) this.game.pauseGalactic(false);
    else this.game.paused = this.wasPaused;
  }
  dispose() {
    this.close();
    this.queue.length = 0;
    this.encyclopedia?.dispose();
  }
}

import { db } from '../gamedata.js';
import { MenuArtwork } from './menuartwork.js';
import { openCampaignMenu } from './campaignmenu.js';
import { openMainCampaignMenu, suggestTutorial, tutorialSuggested, markTutorialSuggested } from './storycampaignmenu.js';
import { TacticalMovies } from './tacticalmovies.js';
import { tutorialFinished } from './tutorialprofile.js';
import { loadDialogs } from './dialogs.js';

const PANEL = { cls: 'front', stretch: true };

export class FrontEnd {
  constructor(game, { skirmish, instant, leave, start, multiplayer }) {
    this.game = game;
    this.menus = game.menus;
    this.skirmish = skirmish;
    this.instant = instant;
    this.leave = leave;
    this.start = start;
    this.openLobbies = multiplayer;
    this.depth = 0;
    this.onKey = e => {
      const top = this.menus.stack[this.menus.stack.length - 1];
      if (e.code === 'Escape' && !this.menus.listening && this.menus.stack.length > 1 && top.veil.style.display !== 'none') {
        e.stopPropagation();
        this.menus.pop();
      }
    };
  }

  async open() {
    const m = this.menus;
    if (!(await m.ready)) return false;
    const o = (this.overlay = document.createElement('div'));
    o.id = 'frontOverlay';
    document.body.appendChild(o);
    this.artwork = new MenuArtwork(o);
    await this.artwork.refresh();
    addEventListener('keydown', this.onKey, true);
    return this.main();
  }
  dispose() {
    this.artwork?.dispose();
    this.overlay?.remove();
    removeEventListener('keydown', this.onKey, true);
  }

  async screen(id, hide = [], opts = {}) {
    const dlg = await this.menus.push(id, { ...PANEL, ...opts });
    if (!dlg) return null;
    for (const c of ['IDC_MENU_PETRO_LOGO', ...hide]) dlg.show(c, false);
    dlg.on('IDC_MENU_CREDITS', () => this.credits(dlg));
    return dlg;
  }

  credits(dlg) {
    if (this.rolling) return;
    const g = this.game,
      overlay = document.getElementById('frontOverlay'),
      show = on => {
        for (const d of this.menus.stack) d.veil.style.display = on ? '' : 'none';
        if (overlay) overlay.style.display = on ? '' : 'none';
      };
    g.audio?.unlock?.();
    show(false);
    g.audio?.stopMusic?.();
    const movies = (g.tacticalMovies ||= new TacticalMovies(g, { missing: new Map() }));
    movies.canvas.style.zIndex = '90';
    this.rolling = true;
    const back = () => {
      this.rolling = false;
      show(true);
      if (g.music) {
        g.music.mode = '';
        g.setMusic?.('ambient');
      }
    };
    movies.play('Credits', { loop: true, skippable: true });
    movies.onFinish = back;
  }

  async main() {
    const dlg = await this.screen('IDD_MAIN_MENU_DIALOG', ['IDC_MAIN_MENU_PLAY_DEMO']);
    if (!dlg) return false;
    dlg.on('IDC_MAIN_MENU_TUTORIAL', () => this.campaign(dlg, true));
    dlg.on('IDC_MAIN_MENU_MULTIPLAYER', () => this.multiplayer());
    dlg.on('IDC_MAIN_MENU_SINGLE_PLAYER_GAMES', () => this.single());
    dlg.on('IDC_LOAD_GAME_MAIN', () => this.menus.load());
    dlg.on('IDC_OPTIONS', () => this.options());
    dlg.on('IDC_MAIN_MENU_EXIT2', () => this.leave());
    return true;
  }

  async single() {
    const dlg = await this.screen('IDD_SINGLE_PLAYER_GAMES_MENU_DIALOG', ['IDC_HINT_LIST', 'IDC_DEBUG_LOAD_SKIRMISH_MAP_BUTTON']);
    if (!dlg) return;
    dlg.on('IDC_NEW_CAMPAIGN_BUTTON', () => this.newCampaign(dlg));
    dlg.on('IDC_CUSTOM_CAMPAIGN_BUTTON', () => this.campaign(dlg));
    const show = on => {
      dlg.veil.style.display = on ? '' : 'none';
      const o = document.getElementById('frontOverlay');
      if (o) o.style.display = on ? '' : 'none';
    };
    dlg.on('IDC_SKIRMISH_GAMES_BUTTON', async () => {
      show(false);
      const ok = await this.skirmish(() => show(true)).catch(() => false);
      if (!ok) show(true);
    });
    dlg.on('IDC_BACK_BUTTON_MAIN', () => this.menus.pop());
    if (this.instant) this.instantEntry(dlg, show);
  }

  instantEntry(dlg, show) {
    const box = id => dlg.def.controls.find(c => c.id === id);
    const skirmish = box('IDC_SKIRMISH_GAMES_BUTTON'),
      back = box('IDC_BACK_BUTTON_MAIN');
    if (!skirmish || !back) return;
    const ys = ['IDC_NEW_CAMPAIGN_BUTTON', 'IDC_CUSTOM_CAMPAIGN_BUTTON', 'IDC_SKIRMISH_GAMES_BUTTON']
      .map(box)
      .filter(Boolean)
      .map(c => c.y)
      .sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter(d => d > 0),
      gap = gaps.length ? Math.min(...gaps) : back.y - skirmish.y,
      fits = back.y - skirmish.y >= 2 * gap;
    let y = skirmish.y + gap;
    if (!fits) {
      y = skirmish.y;
      for (const id of ['IDC_STATIC_OPTIONS', 'IDC_NEW_CAMPAIGN_BUTTON', 'IDC_CUSTOM_CAMPAIGN_BUTTON', 'IDC_SKIRMISH_GAMES_BUTTON']) {
        const c = box(id),
          e = dlg.ctl(id);
        if (c && e) e.style.top = c.y - gap + 'px';
      }
    }
    this.menus.extra(dlg, 'IDC_SKIRMISH_GAMES_BUTTON', 'Instant Battle', skirmish.x, y, skirmish.w, async () => {
      this.game.audio.unlock();
      show(false);
      const ok = await this.instant(() => show(true)).catch(e => {
        console.warn('instant battle', e);
        return false;
      });
      if (!ok) show(true);
    });
  }

  async multiplayer() {
    const dlg = await this.screen('IDD_MULTIPLAYER_DIALOG');
    if (!dlg) return;
    const go = kind => {
      this.game.audio.unlock();
      this.openLobbies(kind);
    };
    dlg.on('IDC_MULTIPLAYER_INTERNET_BUTTON', () => go('internet'));
    dlg.on('IDC_MULTIPLAYER_LAN_BUTTON', () => go('lan'));
    dlg.enable('IDC_MAIN_OPTIONS_NETWORK', false);
    dlg.on('IDC_OK_MAIN', () => this.menus.pop());
  }

  async options() {
    const def = (await loadDialogs())?.dialogs.get('IDD_MAIN_OPTIONS_DIALOG'),
      okC = def && def.controls.find(c => c.id === 'IDC_OK_MAIN'),
      above = okC && def.controls.filter(c => /^IDC_MAIN_OPTIONS_/.test(c.id) && c.y < okC.y).sort((a, b) => b.y - a.y)[0],
      ok = okC || { x: 265, y: 706, w: 236, h: 21 },
      step = above ? ok.y - above.y : 36;
    const dlg = await this.screen('IDD_MAIN_OPTIONS_DIALOG', [], {
      extra: [{ kind: 'PUSHBUTTON', text: '', id: 'IDC_MAIN_OPTIONS_TWEAKS', x: ok.x, y: ok.y - step, w: ok.w, h: ok.h, style: '' }],
      adjust: c => (c.id !== 'IDC_OK_MAIN' && c.id !== 'IDC_MAIN_OPTIONS_TWEAKS' && c.id !== 'IDC_MENU_PETRO_LOGO' && c.y < ok.y ? { ...c, y: c.y - step } : null)
    });
    if (!dlg) return;
    dlg.setText('IDC_MAIN_OPTIONS_TWEAKS', 'Tweaks');
    dlg.on('IDC_MAIN_OPTIONS_TWEAKS', () => this.menus.tweaks());
    dlg.on('IDC_MAIN_OPTIONS_KEYBOARD', () => this.menus.keyboard());
    dlg.enable('IDC_MAIN_OPTIONS_MODS', false);
    dlg.on('IDC_MAIN_OPTIONS_AUDIO', () => this.menus.audio());
    dlg.on('IDC_MAIN_OPTIONS_VIDEO', () => this.menus.video());
    dlg.on('IDC_MAIN_OPTIONS_GAMEPLAY', () => this.menus.gameplay());
    dlg.on('IDC_OK_MAIN', () => this.menus.pop());
  }

  async newCampaign(parent) {
    if (!tutorialSuggested()) {
      markTutorialSuggested();
      const answer = await suggestTutorial();
      if (answer === 'yes') return this.campaign(parent, true);
      if (answer !== 'no' && answer !== null) return;
    }
    const overlay = document.getElementById('frontOverlay');
    const show = on => {
      parent.veil.style.display = on ? '' : 'none';
      if (overlay) overlay.style.display = on ? '' : 'none';
    };
    show(false);
    const ok = await openMainCampaignMenu({
      audio: this.game.audio,
      cancel: () => show(true),
      start: setup => {
        this.game.audio.unlock();
        this.start(setup);
      }
    }).catch(e => {
      console.warn('Campaign menu', e);
      return false;
    });
    if (!ok) show(true);
  }

  async campaign(parent, tutorial = false) {
    const overlay = document.getElementById('frontOverlay');
    const show = on => {
      parent.veil.style.display = on ? '' : 'none';
      if (overlay) overlay.style.display = on || tutorial ? '' : 'none';
    };
    show(false);
    const ok = await openCampaignMenu({
      tutorial,
      isTutorialComplete: c => tutorialFinished(c.name),
      audio: this.game.audio,
      cancel: () => show(true),
      start: setup => {
        this.game.audio.unlock();
        this.start(setup);
      }
    }).catch(e => {
      console.warn('Campaign menu', e);
      return false;
    });
    if (!ok) show(true);
  }
}

import { db } from '../gamedata.js';
import { MenuArtwork } from './menuartwork.js';
import { openCampaignMenu } from './campaignmenu.js';
import { openMainCampaignMenu, suggestTutorial, tutorialSuggested, markTutorialSuggested } from './storycampaignmenu.js';

const PANEL = { cls: 'front', stretch: true };

export class FrontEnd {
  constructor(game, { skirmish, leave, start, multiplayer }) {
    this.game = game;
    this.menus = game.menus;
    this.skirmish = skirmish;
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

  async screen(id, hide = []) {
    const dlg = await this.menus.push(id, PANEL);
    if (!dlg) return null;
    for (const c of ['IDC_MENU_CREDITS', 'IDC_MENU_PETRO_LOGO', ...hide]) dlg.show(c, false);
    return dlg;
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
    dlg.on('IDC_SKIRMISH_GAMES_BUTTON', async () => {
      const show = on => {
        dlg.veil.style.display = on ? '' : 'none';
        const o = document.getElementById('frontOverlay');
        if (o) o.style.display = on ? '' : 'none';
      };
      show(false);
      const ok = await this.skirmish(() => show(true)).catch(() => false);
      if (!ok) show(true);
    });
    dlg.on('IDC_BACK_BUTTON_MAIN', () => this.menus.pop());
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
    const dlg = await this.screen('IDD_MAIN_OPTIONS_DIALOG');
    if (!dlg) return;
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

import { db } from '../gamedata.js';
import { openDialog } from './dialogs.js';
import { loadCampaignData } from './galaxy.js';
import { expansion } from '../edition.js';

export const MAIN_CAMPAIGN = 'Full_Story_Campaign_Underworld';
const MAIN_CAMPAIGNS = () => (expansion() ? { A: MAIN_CAMPAIGN } : { A: 'Full_Story_Campaign_Rebel', B: 'Full_Story_Campaign_Empire' });
const PROFILE_KEY = 'swr-profile-suggested-tutorial';
const key = s => String(s || '').trim().toUpperCase();

export function tutorialSuggested(storage = globalThis.localStorage) {
  try { return storage?.getItem(PROFILE_KEY) === '1'; } catch { return false; }
}
export function markTutorialSuggested(storage = globalThis.localStorage) {
  try { storage?.setItem(PROFILE_KEY, '1'); } catch {}
}

export async function suggestTutorial() {
  const dlg = await openDialog('IDD_DIALOG_BOX', { nativeImages: true, nativeFonts: true }).catch(() => null);
  if (!dlg) return null;
  return new Promise(resolve => {
    dlg.show('IDC_DIALOG_CLOSE_BUTTON', false);
    dlg.setText('IDC_CAPTION', db.t('TEXT_SUGGEST_TUTORIAL'));
    for (const id of ['IDC_USER_TEXT_STRING_1', 'IDC_USER_TEXT_STRING_2', 'IDC_USER_TEXT_STRING_3', 'IDC_DIALOG_BOX_BUTTON_CENTER']) dlg.show(id, false);
    dlg.setText('IDC_DIALOG_BOX_BUTTON_LEFT', db.t('TEXT_BUTTON_YES'));
    dlg.setText('IDC_DIALOG_BOX_BUTTON_RIGHT', db.t('TEXT_BUTTON_NO'));
    dlg.on('IDC_DIALOG_BOX_BUTTON_LEFT', () => { dlg.close(); resolve('yes'); });
    dlg.on('IDC_DIALOG_BOX_BUTTON_RIGHT', () => { dlg.close(); resolve('no'); });
  });
}

export function mainCampaign(campaigns, name = MAIN_CAMPAIGNS().A) {
  for (const c of campaigns.values()) if (key(c.name) === key(name)) return c;
  return null;
}

export async function openMainCampaignMenu({ start, cancel = null, audio = null }) {
  const data = await loadCampaignData();
  const dlg = await openDialog('IDD_MAIN_CAMPAIGN_DIALOG', { modal: false, anchor: 9, nativeImages: true, nativeFonts: true });
  if (!dlg) return false;
  const names = MAIN_CAMPAIGNS();
  let difficulty = 'medium', closed = false, starting = false;
  const close = () => { if (closed) return; closed = true; removeEventListener('keydown', onKey, true); dlg.close(); };
  const back = () => { if (starting) return; close(); if (cancel) cancel(); };
  const onKey = e => { if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); back(); } };
  dlg.show('IDC_DIALOG_CLOSE_BUTTON', false);
  dlg.show('IDC_LOAD_FACTION_A_PROGRESS', false); dlg.show('IDC_LOAD_FACTION_B_PROGRESS', false);
  const ids = ['IDC_RADIO_EASY', 'IDC_RADIO_MEDIUM', 'IDC_RADIO_HARD'];
  dlg.radios(ids, ids[1], id => { difficulty = ['easy', 'medium', 'hard'][ids.indexOf(id)]; });
  const play = side => {
    const campaign = names[side] && mainCampaign(data.campaigns, names[side]);
    if (closed || starting || !campaign) return;
    starting = true;
    dlg.enable('IDC_CANCEL_BUTTON', false); dlg.enable('IDC_MAIN_CAMPAIGN_START', false);
    dlg.show('IDC_LOAD_FACTION_' + side + '_PROGRESS', true);
    close();
    start({ mode: 'galactic', campaign: campaign.name, faction: campaign.str('Starting_Active_Player'), difficulty, players: [], teamFactions: [] });
  };
  dlg.on('IDC_CANCEL_BUTTON', back);
  for (const id of ['IDC_MAIN_CAMPAIGN_START', 'IDC_PLAY_FACTION_A_BUTTON_BIG']) if (dlg.ctl(id)) dlg.on(id, () => play('A'));
  if (dlg.ctl('IDC_PLAY_FACTION_B_BUTTON_BIG')) dlg.on('IDC_PLAY_FACTION_B_BUTTON_BIG', () => play('B'));
  for (const id of ['IDC_CANCEL_BUTTON', 'IDC_MAIN_CAMPAIGN_START']) {
    const ctl = dlg.ctl(id); if (!ctl) continue;
    ctl.setAttribute('role', 'button'); ctl.tabIndex = 0;
    ctl.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); ctl.click(); } });
    if (audio && !window.game) { ctl.addEventListener('mouseenter', () => audio.play('GUI_Highlight_Mouse_Over')); ctl.addEventListener('click', () => audio.play('GUI_Button_Press_2_SFX')); }
  }
  addEventListener('keydown', onKey, true);
  return true;
}

import { db } from '../gamedata.js';
import { loadTextureCanvas } from '../dds.js';
import { openDialog } from './dialogs.js';
import { loadCampaignData } from './galaxy.js';

const key = s => String(s || '').trim().toUpperCase();
const compare = (a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
const crc = s => { let c = 0xffffffff; for (const ch of key(s)) { c ^= ch.charCodeAt(0); for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
let rememberedSet = '', rememberedFaction = '';

export function campaignMenuRows(campaigns, translate = id => db.t(id), { tutorial = false } = {}) {
  const seen = new Set(), out = [];
  for (const c of [...campaigns.values()].sort((a, b) => crc(a.name) - crc(b.name))) {
    if (c.bool('Is_Multiplayer') || (!tutorial && !c.bool('Is_Listed', true))) continue;
    const set = key(c.str('Campaign_Set'));
    if (seen.has(set)) continue;
    seen.add(set);
    if (c.bool('Tutorial') === tutorial) out.push({ key: set, campaign: c, label: translate(c.str('Text_ID')), order: c.num('Sort_Order') });
  }
  return out.sort((a, b) => (tutorial ? 0 : a.order - b.order) || compare(a.label, b.label));
}

export function campaignMenuVariant(campaigns, set, faction) {
  return [...campaigns.values()].sort((a, b) => crc(a.name) - crc(b.name))
    .find(c => key(c.str('Campaign_Set')) === key(set) && key(c.str('Starting_Active_Player')) === key(faction)) || null;
}

export async function openCampaignMenu({ start, cancel = null, audio = null, tutorial = false, isTutorialComplete = () => false }) {
  const data = await loadCampaignData();
  const dlg = await openDialog(tutorial ? 'IDD_SELECT_TUTORIAL_DIALOG' : 'IDD_CUSTOM_CAMPAIGN_STAGING_DIALOG', { modal: false, nativeImages: true, nativeLists: tutorial, nativeFonts: true });
  if (!dlg) return false;
  const rows = campaignMenuRows(data.campaigns, id => db.t(id), { tutorial });
  if (tutorial) for (const row of rows) row.icon = isTutorialComplete(row.campaign) ? 'checked_box.tga' : 'i_dialogue_blank.tga';
  const factions = [...db.factions.values()].filter(f => f.bool('Is_Playable'));
  let faction = factions.find(f => key(f.name) === key(rememberedFaction))?.name || factions[0]?.name || '';
  let selection = null, difficulty = 'medium', closed = false;
  const close = () => { if (closed) return; closed = true; removeEventListener('keydown', onKey, true); dlg.close(); };
  const back = () => { close(); if (cancel) cancel(); };
  const onKey = e => { if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); back(); } };
  const refresh = () => {
    const c = selection && (tutorial ? selection.campaign : campaignMenuVariant(data.campaigns, selection.key, faction));
    dlg.enable('IDC_PLAY_BUTTON', !!c);
    dlg.show('IDC_SELECT_OPTIONS', !!c?.bool('Supports_Custom_Settings'));
    dlg.enable('IDC_SELECT_OPTIONS', false);
  };
  const pick = row => {
    selection = row; rememberedSet = row.key;
    dlg.setText('IDC_CAMPAIGN_DESCRIPTION', db.t(row.campaign.str('Description_Text')));
    refresh();
  };
  const play = () => {
    if (closed || !selection) return;
    const c = tutorial ? selection.campaign : campaignMenuVariant(data.campaigns, selection.key, faction);
    if (!c) return;
    rememberedFaction = faction; close();
    start({ mode: 'galactic', campaign: c.name, faction: c.str('Starting_Active_Player'), difficulty, players: [], teamFactions: [] });
  };
  dlg.show('IDC_DIALOG_CLOSE_BUTTON', false);
  dlg.enable('IDC_SELECT_CUSTOM_MAPS', false);
  const options = factions.map(f => ({ value: f.name, label: db.t(f.str('Text_ID')) }));
  options.sort((a, b) => compare(a.label, b.label));
  dlg.combo('IDC_FACTION_COMBO', options, faction, v => { faction = v; rememberedFaction = v; refresh(); });
  const ids = ['IDC_RADIO_CUSTOM_EASY', 'IDC_RADIO_CUSTOM_MEDIUM', 'IDC_RADIO_CUSTOM_HARD'];
  dlg.radios(ids, ids[1], id => { difficulty = ['easy', 'medium', 'hard'][ids.indexOf(id)]; });
  const list = dlg.list('IDC_STAGING_MAP_LIST', rows, pick);
  const initial = tutorial ? rows[0] : rows.find(r => r.key === rememberedSet) || rows.find(r => campaignMenuVariant(data.campaigns, r.key, faction)) || rows[0];
  if (initial) list?.select(initial.key);
  else { dlg.setText('IDC_CAMPAIGN_DESCRIPTION', ''); refresh(); }
  const image = dlg.ctl('IDC_IMAGE') && await loadTextureCanvas('Galactic_Back.tga').catch(() => null);
  if (image && !closed) dlg.setImage('IDC_IMAGE', image.toDataURL());
  dlg.on('IDC_CANCEL_BUTTON', back); dlg.on('IDC_PLAY_BUTTON', play);
  for (const id of ['IDC_CANCEL_BUTTON', 'IDC_PLAY_BUTTON']) {
    const ctl = dlg.ctl(id); if (!ctl) continue;
    ctl.setAttribute('role', 'button'); ctl.tabIndex = 0;
    ctl.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); ctl.click(); } });
    if (audio && !window.game) { ctl.addEventListener('mouseenter', () => audio.play('GUI_Highlight_Mouse_Over')); ctl.addEventListener('click', () => audio.play('GUI_Button_Press_2_SFX')); }
  }
  addEventListener('keydown', onKey, true);
  return true;
}

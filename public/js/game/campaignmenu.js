import { db, loadFileList } from '../gamedata.js';
import { fetchText } from '../vfs.js';
import { iconAtlas, iconCanvasRect } from '../icons.js';
import { loadTextureCanvas } from '../dds.js';
import { openDialog, loadDialogs } from './dialogs.js';
import { loadCampaignData } from './galaxy.js';
import {
  campaignLimits,
  campaignDefaults,
  creditSteps,
  creditsAt,
  techRange,
  optionBoxes,
  offersRandomEvents,
  popCapRowsLayout,
  popCapSliders
} from './campaignsettings.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const compare = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const crc = s => {
  let c = 0xffffffff;
  for (const ch of key(s)) {
    c ^= ch.charCodeAt(0);
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
};
let rememberedSet = '',
  rememberedFaction = '';

export function campaignMenuRows(campaigns, translate = id => db.t(id), { tutorial = false } = {}) {
  const seen = new Set(),
    out = [];
  for (const c of [...campaigns.values()].sort((a, b) => crc(a.name) - crc(b.name))) {
    if (c.bool('Is_Multiplayer') || (!tutorial && !c.bool('Is_Listed', true))) continue;
    const set = key(c.str('Campaign_Set'));
    if (seen.has(set)) continue;
    seen.add(set);
    if (c.bool('Tutorial') === tutorial)
      out.push({ key: set, campaign: c, label: translate(c.str('Text_ID')), order: c.num('Sort_Order') });
  }
  return out.sort((a, b) => (tutorial ? 0 : a.order - b.order) || compare(a.label, b.label));
}

export function campaignMenuVariant(campaigns, set, faction) {
  return (
    [...campaigns.values()]
      .sort((a, b) => crc(a.name) - crc(b.name))
      .find(c => key(c.str('Campaign_Set')) === key(set) && key(c.str('Starting_Active_Player')) === key(faction)) || null
  );
}

// Some mods send players into their galactic conquest from the tutorial list, through a menu campaign that supports
// custom settings. That list has no Advanced button, so one is added on the row of Cancel and Start, or on a row of
// its own when they leave no room. A dialog that has the button keeps it as it is.
export function optionsButtonLayout(def) {
  if (!def?.controls?.length || def.controls.some(c => c.id === 'IDC_SELECT_OPTIONS')) return {};
  const find = id => def.controls.find(c => c.id === id),
    cancel = find('IDC_CANCEL_BUTTON'),
    play = find('IDC_PLAY_BUTTON');
  if (!cancel || !play) return {};
  const [a, b] = cancel.x < play.x ? [cancel, play] : [play, cancel],
    gap = b.x - (a.x + a.w),
    h = Math.max(a.h, b.h),
    w = Math.min(Math.max(a.w, b.w), gap - 24),
    button = { kind: 'PUSHBUTTON', text: 'TEXT_SELECT_OPTIONS', id: 'IDC_SELECT_OPTIONS', style: '', h };
  if (Math.abs(a.y - b.y) <= 4 && w >= 100) return { extra: [{ ...button, x: Math.round(a.x + a.w + (gap - w) / 2), y: Math.min(a.y, b.y), w }] };
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { size: { w: def.w, h: def.h + h + 12 }, extra: [{ ...button, x: a.x, y: bottom + 12, w: Math.max(a.w, b.w) }] };
}

export async function openCampaignMenu({ start, cancel = null, audio = null, tutorial = false, isTutorialComplete = () => false }) {
  const data = await loadCampaignData();
  const id = tutorial ? 'IDD_SELECT_TUTORIAL_DIALOG' : 'IDD_CUSTOM_CAMPAIGN_STAGING_DIALOG',
    def = (await loadDialogs())?.dialogs.get(id),
    ownButton = !!def?.controls.some(c => c.id === 'IDC_SELECT_OPTIONS');
  const dlg = await openDialog(id, {
    modal: false,
    nativeImages: true,
    nativeLists: tutorial,
    nativeFonts: true,
    ...optionsButtonLayout(def)
  });
  if (!dlg) return false;
  const rows = campaignMenuRows(data.campaigns, id => db.t(id), { tutorial });
  if (tutorial) for (const row of rows) row.icon = isTutorialComplete(row.campaign) ? 'checked_box.tga' : 'i_dialogue_blank.tga';
  const sets = new Set(rows.map(r => key(r.key))),
    starters = new Set(
      [...data.campaigns.values()].filter(c => sets.has(key(c.str('Campaign_Set')))).map(c => key(c.str('Starting_Active_Player')))
    );
  const playable = [...db.factions.values()].filter(f => f.bool('Is_Playable')),
    factions = playable.some(f => starters.has(key(f.name))) ? playable.filter(f => starters.has(key(f.name))) : playable;
  let faction = factions.find(f => key(f.name) === key(rememberedFaction))?.name || factions[0]?.name || '';
  let selection = null,
    difficulty = 'medium',
    settings = null,
    closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    removeEventListener('keydown', onKey, true);
    dlg.close();
  };
  const back = () => {
    close();
    if (cancel) cancel();
  };
  const onKey = e => {
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      back();
    }
  };
  const variant = () => selection && (tutorial ? selection.campaign : campaignMenuVariant(data.campaigns, selection.key, faction));
  // the original tutorials say Supports_Custom_Settings False and a mod's galactic conquest menu entry says True; a
  // mod that put the button in its tutorial list itself offers it unless the campaign says False
  const hasOptions = c => !!c && (!tutorial || c.bool('Supports_Custom_Settings', ownButton));
  const refresh = () => {
    const c = variant();
    settings = c ? campaignDefaults(c, c.str('Starting_Active_Player')) : null;
    dlg.enable('IDC_PLAY_BUTTON', !!c);
    dlg.show('IDC_SELECT_OPTIONS', !!selection && (!tutorial || hasOptions(c)));
    dlg.enable('IDC_SELECT_OPTIONS', !!c);
  };
  const pick = row => {
    selection = row;
    rememberedSet = row.key;
    dlg.setText('IDC_CAMPAIGN_DESCRIPTION', db.t(row.campaign.str('Description_Text')));
    refresh();
    if (!tutorial) drawCampaignPreview(dlg, row.campaign);
  };
  const play = () => {
    if (closed || !selection) return;
    const c = tutorial ? selection.campaign : campaignMenuVariant(data.campaigns, selection.key, faction);
    if (!c) return;
    rememberedFaction = faction;
    close();
    const chosen = hasOptions(c) ? settings : null;
    start({
      mode: 'galactic',
      campaign: c.name,
      faction: c.str('Starting_Active_Player'),
      difficulty,
      players: [],
      teamFactions: [],
      ...(chosen?.custom ? { campaignSettings: { ...chosen } } : {}),
      // off unless the player ticks it, and never in a tutorial, which teaches the ground battles
      options: {
        groundAutoResolve: chosen?.groundAutoResolve === true,
        ...(offersRandomEvents() ? { randomEvents: settings?.randomEvents !== false } : {}),
        ...(chosen?.landPopCap ? { landPopCap: chosen.landPopCap } : {}),
        ...(chosen?.spacePopCap ? { spacePopCap: chosen.spacePopCap } : {})
      }
    });
  };
  dlg.show('IDC_DIALOG_CLOSE_BUTTON', false);
  dlg.enable('IDC_SELECT_CUSTOM_MAPS', false);
  const options = factions.map(f => ({ value: f.name, label: db.t(f.str('Text_ID')) }));
  options.sort((a, b) => compare(a.label, b.label));
  dlg.combo('IDC_FACTION_COMBO', options, faction, v => {
    faction = v;
    rememberedFaction = v;
    refresh();
  });
  const ids = ['IDC_RADIO_CUSTOM_EASY', 'IDC_RADIO_CUSTOM_MEDIUM', 'IDC_RADIO_CUSTOM_HARD'];
  dlg.radios(ids, ids[1], id => {
    difficulty = ['easy', 'medium', 'hard'][ids.indexOf(id)];
  });
  const list = dlg.list('IDC_STAGING_MAP_LIST', rows, pick);
  const initial = tutorial
    ? rows[0]
    : rows.find(r => r.key === rememberedSet) || rows.find(r => campaignMenuVariant(data.campaigns, r.key, faction)) || rows[0];
  if (initial) list?.select(initial.key);
  else {
    dlg.setText('IDC_CAMPAIGN_DESCRIPTION', '');
    refresh();
  }
  const image = dlg.ctl('IDC_IMAGE') && (await loadTextureCanvas('Galactic_Back.tga').catch(() => null));
  if (image && !closed) dlg.setImage('IDC_IMAGE', image.toDataURL());
  dlg.on('IDC_CANCEL_BUTTON', back);
  dlg.on('IDC_PLAY_BUTTON', play);
  dlg.on('IDC_SELECT_OPTIONS', async () => {
    const c = variant();
    if (!c || !settings) return;
    const scratch = { ...settings };
    if (await campaignOptionsDialog(scratch, c, c.str('Starting_Active_Player'))) settings = scratch;
  });
  for (const id of ['IDC_CANCEL_BUTTON', 'IDC_PLAY_BUTTON']) {
    const ctl = dlg.ctl(id);
    if (!ctl) continue;
    ctl.setAttribute('role', 'button');
    ctl.tabIndex = 0;
    ctl.addEventListener('keydown', e => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        ctl.click();
      }
    });
    if (audio && !window.game) {
      ctl.addEventListener('mouseenter', () => audio.play('GUI_Highlight_Mouse_Over'));
      ctl.addEventListener('click', () => audio.play('GUI_Button_Press_2_SFX'));
    }
  }
  addEventListener('keydown', onKey, true);
  return true;
}

export async function campaignOptionsDialog(st, campaign, faction) {
  const id = 'IDD_CAMPAIGN_ADVANCED_OPTIONS_DIALOG',
    def = (await loadDialogs())?.dialogs.get(id);
  const dlg = await openDialog(id, { modal: true, nativeImages: true, nativeFonts: true, ...popCapRowsLayout(def) });
  if (!dlg) return false;
  const limits = campaignLimits(campaign),
    { lo, hi, adj } = techRange(limits, faction),
    steps = Math.max(1, hi - lo + 1),
    span = limits.maxCredits - limits.minCredits;
  const mark = () => {
    st.custom = true;
  };
  const show = () => {
    st.tech = Math.max(lo, Math.min(hi, st.tech));
    st.maxTech = Math.max(st.tech, Math.min(hi, st.maxTech));
    const credits = Math.max(limits.minCredits, Math.min(limits.maxCredits, st.credits));
    dlg.slider(
      'IDC_SKIRMISH_CREDITS_SLIDER',
      span > 0 ? (credits - limits.minCredits) / span : 0,
      v => {
        st.credits = creditsAt(limits, v);
        mark();
        dlg.setText('IDC_SKIRMISH_CREDITS_VALUE', String(st.credits));
      },
      creditSteps(limits)
    );
    dlg.setText('IDC_SKIRMISH_CREDITS_VALUE', String(credits));
    dlg.slider(
      'IDC_SKIRMISH_STARTING_TECH_LEVEL_SLIDER',
      steps > 1 ? (st.tech - lo) / (steps - 1) : 0,
      v => {
        st.tech = lo + Math.round(v * (steps - 1));
        mark();
        if (st.maxTech < st.tech) {
          st.maxTech = st.tech;
          show();
        }
        dlg.setText('IDC_SKIRMISH_STARTING_TECH_LEVEL_VALUE', String(st.tech + adj));
      },
      steps
    );
    dlg.setText('IDC_SKIRMISH_STARTING_TECH_LEVEL_VALUE', String(st.tech + adj));
    dlg.slider(
      'IDC_SKIRMISH_MAX_TECH_LEVEL_SLIDER',
      steps > 1 ? (st.maxTech - lo) / (steps - 1) : 0,
      v => {
        st.maxTech = lo + Math.round(v * (steps - 1));
        mark();
        if (st.maxTech < st.tech) {
          st.tech = st.maxTech;
          show();
        }
        dlg.setText('IDC_SKIRMISH_MAX_TECH_LEVEL_VALUE', String(st.maxTech + adj));
      },
      steps
    );
    dlg.setText('IDC_SKIRMISH_MAX_TECH_LEVEL_VALUE', String(st.maxTech + adj));
    dlg.combo(
      'IDC_ALLOW_AUTORESOLVE_COMBO',
      [
        { value: 0, label: db.t('TEXT_ALLOW_AUTORESOLVE_ALWAYS') || 'Always' },
        { value: 2, label: db.t('TEXT_ALLOW_AUTORESOLVE_ASK') || 'Ask' }
      ],
      st.autoResolve,
      v => {
        st.autoResolve = +v;
        mark();
      }
    );
    optionBoxes(dlg, st, 'Auto-resolve all ground battles');
    // not a custom setting: the caps leave credits and tech at the campaign's own values
    popCapSliders(dlg, st);
  };
  if (!limits.custom)
    for (const id of ['IDC_SKIRMISH_CREDITS_SLIDER', 'IDC_SKIRMISH_STARTING_TECH_LEVEL_SLIDER', 'IDC_SKIRMISH_MAX_TECH_LEVEL_SLIDER', 'IDC_ALLOW_AUTORESOLVE_COMBO'])
      dlg.enable(id, false);
  show();
  return new Promise(done => {
    dlg.on('IDC_BUTTON_ACCEPT', () => {
      dlg.close();
      done(true);
    });
    dlg.on('IDC_CANCEL_BUTTON', () => {
      dlg.close();
      done(false);
    });
    dlg.on('IDC_DEFAULTS_BUTTON', () => {
      Object.assign(st, campaignDefaults(campaign, faction));
      show();
    });
  });
}

let blipTexture = null;
function previewBlipTexture() {
  return (blipTexture ||= (async () => {
    const files = await loadFileList('CommandBarComponentFiles.xml')
      .then(l => (l.length ? l : ['CommandBarComponents.xml']))
      .catch(() => ['CommandBarComponents.xml']);
    for (const f of files) {
      const src = String((await fetchText('Data/XML/' + f).catch(() => '')) || ''),
        m = src.match(/Name\s*=\s*"g_radar_blip"[\s\S]*?<Icon_Texture_Name>\s*([^<\s]+)/i);
      if (m) return m[1];
    }
    return 'i_radar_galactic_planet.tga';
  })());
}

export function campaignPreviewSpot(type) {
  const p = type.list('Galactic_Position').map(Number),
    clamp = v => Math.max(0, Math.min(1, v));
  return { x: clamp((220 + (p[0] || 0)) / 440), y: 1 - clamp((260 + (p[1] || 0)) / 520) };
}

function neutralColor() {
  const f = db.faction('Neutral') || [...db.factions.values()].find(x => x.bool('Is_Neutral'));
  const c = String(f?.str('Color') || '100,100,100,255')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  return [c[0] ?? 100, c[1] ?? 100, c[2] ?? 100];
}

async function drawCampaignPreview(dlg, campaign) {
  const host = dlg.ctl('IDC_IMAGE');
  if (!host || typeof document === 'undefined') return;
  host.querySelector(':scope > .campaign-preview')?.remove();
  if (!campaign) return;
  const name = await previewBlipTexture(),
    rect = iconCanvasRect(name),
    atlas = iconAtlas();
  if (!rect || !atlas) return;
  const blip = document.createElement('canvas');
  blip.width = rect.w;
  blip.height = rect.h;
  const x = blip.getContext('2d');
  x.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = `rgb(${neutralColor().join(',')})`;
  x.fillRect(0, 0, rect.w, rect.h);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const url = blip.toDataURL();
  host.querySelector(':scope > .campaign-preview')?.remove();
  const layer = document.createElement('div');
  layer.className = 'campaign-preview';
  layer.style.cssText = 'position:absolute;left:5%;top:5%;width:90%;height:90%;pointer-events:none;z-index:2';
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  for (const n of campaign.list('Locations')) {
    const type = db.type(n);
    if (!type || !type.has('Galactic_Position')) continue;
    const at = campaignPreviewSpot(type),
      img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.cssText = `position:absolute;left:${at.x * 100}%;top:${at.y * 100}%;width:${rect.w}px;height:${rect.h}px;transform:translate(-50%,-50%)`;
    layer.appendChild(img);
  }
  host.appendChild(layer);
}

import { db, factionColor, autoColors } from '../gamedata.js';
import { PALETTE, ROWS, MAX_SLOTS, slotWindow, rowsOf } from './slotrows.js';
import { openDialog } from './dialogs.js';
import { loadTextureCanvas } from '../dds.js';
import { mapHeader, mapTitle, controlMap } from '../ted.js';
import { NetSession, Hall, listGames, newGameId } from '../net.js';
import { advancedOptions } from './lobby.js';
import { loadCampaignData } from './galaxy.js';
import { listSaves, getSave, deleteSave, importSaveFile, validate, packSave, unpackSave } from './savegame.js';

const T = (id, fallback) => { const s = db.text.get(id); return s ?? fallback; };
const NAME_KEY = 'swr.mpname';

const storedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const storeName = n => { try { localStorage.setItem(NAME_KEY, n); } catch { } };

export function dataFingerprint() {
  let h = 0x811c9dc5;
  const mix = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
  for (const [name, t] of db.types) {
    mix(name);
    for (const [k, v] of t.props) { mix(k); for (const x of v) mix(x); }
  }
  return (h >>> 0).toString(16) + ':' + db.types.size;
}

export function inviteLink(gameId, kind = 'internet') {
  const u = new URL(location.pathname, location.origin);
  u.search = (kind === 'lan' ? 'multiplayer=lan' : 'multiplayer') + '&join=' + gameId;
  const lobby = new URLSearchParams(location.search).get('lobby');
  if (lobby) u.search += '&lobby=' + encodeURIComponent(lobby);
  return u.href;
}

function resizeFramed(box, w0, h0, w1, h1) {
  box.style.width = w1 + 'px'; box.style.height = h1 + 'px'; box.style.overflow = 'hidden';
  for (const part of box.children) {
    const x = parseFloat(part.style.left), y = parseFloat(part.style.top), w = parseFloat(part.style.width), h = parseFloat(part.style.height);
    if (x > w0 / 2) part.style.left = (x - (w0 - w1)) + 'px'; else if (w > w0 / 2) part.style.width = (w - (w0 - w1)) + 'px';
    if (y > h0 / 2) part.style.top = (y - (h0 - h1)) + 'px'; else if (h > h0 / 2) part.style.height = (h - (h0 - h1)) + 'px';
  }
}

export const GAME_TYPES = [
  { id: 1, type: 'campaign', text: 'TEXT_GAME_TYPE_CAMPAIGN', desc: 'TEXT_GAME_DESCRIPTION_CAMPAIGN', fallback: 'Campaign' },
  { id: 2, type: 'land', text: 'TEXT_GAME_TYPE_TEAM_LAND', desc: 'TEXT_GAME_DESCRIPTION_TEAM_LAND', fallback: 'Land' },
  { id: 3, type: 'space', text: 'TEXT_GAME_TYPE_TEAM_SPACE', desc: 'TEXT_GAME_DESCRIPTION_TEAM_SPACE01', fallback: 'Space' },
  { id: 4, type: 'control', text: 'TEXT_GAME_TYPE_CAPTURE_CONTROL_POINTS', desc: 'TEXT_GAME_DESCRIPTION_CAPTURE_CONTROL_POINTS', fallback: 'Land Control' },
];
const gameType = t => GAME_TYPES.find(g => g.type === t) || GAME_TYPES[2];
const typeLabel = mode => { const g = gameType(mode === 'galactic' ? 'campaign' : mode); return T(g.text, g.fallback); };
const TYPE_KEY = 'swr.mptype';

const SCREEN = { stretch: true, nativeFrame: true };

export async function multiplayerCampaigns() {
  const data = await loadCampaignData().catch(() => null);
  if (!data) return [];
  const playable = new Set([...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name.toUpperCase()));
  const sides = c => [...new Set([...c.tuples('Starting_Credits'), ...c.tuples('Home_Location')].map(t => db.faction(t[0])?.name).filter(f => f && playable.has(f.toUpperCase())))];
  const mp = [...data.campaigns.values()].filter(c => c.bool('Is_Multiplayer') && c.bool('Is_Listed', true))
    .map(c => ({ name: c.name, label: T(c.str('Text_ID'), c.name.replace(/_/g, ' ')), campaign: c, factions: sides(c), variants: null }));
  if (mp.length) return mp;
  const sets = new Map();
  for (const c of data.campaigns.values()) {
    if (!c.bool('Is_Listed', true) && (c.bool('Is_Story_Campaign') || c.bool('Is_Tutorial') || c.list('Locations').length < 3)) continue;
    const set = c.str('Campaign_Set') || c.name, e = sets.get(set.toUpperCase()) || { set, variants: [] };
    e.variants.push(c); sets.set(set.toUpperCase(), e);
  }
  const rows = [...sets.values()].map(({ set, variants }) => {
    const c = variants[0], factions = [...new Set(variants.map(v => db.faction(v.str('Starting_Active_Player'))?.name).filter(Boolean))];
    const menu = variants.length === 1 && c.list('Locations').length < 3, own = factions.length >= 2 ? factions : sides(c);
    return { name: c.name, set, label: T(c.str('Text_ID'), /\s/.test(c.str('Text_ID')) ? c.str('Text_ID') : set.replace(/_/g, ' ')), campaign: c, factions: !menu && own.length >= 2 ? own : [...playable].map(f => db.faction(f).name), menu: menu ? db.faction(c.str('Starting_Active_Player'))?.name || null : null, variants, listed: variants.some(v => v.bool('Is_Listed', true)) };
  }).filter(r => !(r.menu && db.faction(r.menu)?.bool('Is_Neutral'))).sort((a, b) => (b.listed - a.listed));
  const count = new Map(), same = r => r.label.trim().toUpperCase(); for (const r of rows) count.set(same(r), (count.get(same(r)) || 0) + 1);
  for (const r of rows) if (count.get(same(r)) > 1) r.label = `${r.label.trim()} (${r.set.replace(/_/g, ' ')})`;
  return rows;
}

export function campaignVariant(entry, faction) {
  const key = String(faction || '').toUpperCase();
  return entry.variants?.find(v => String(v.str('Starting_Active_Player')).toUpperCase() === key) || entry.campaign;
}

async function hostOptions({ name, campaigns, landMaps, customMaps = { land: [] } }) {
  const types = GAME_TYPES.filter(g => (g.type !== 'campaign' || campaigns.length) && (g.type === 'campaign' || g.type === 'space' || landMaps.length || customMaps.land.length));
  let type = (() => { try { return localStorage.getItem(TYPE_KEY); } catch { return null; } })();
  if (!types.some(g => g.type === type)) type = types[0].type;
  const dlg = await openDialog('IDD_INTERNET_HOST_OPTIONS_DIALOG', SCREEN);
  if (!dlg) return { name: `${name}'s game`, password: '', type };
  for (const id of ['IDC_INTERNET_HOST_CLAN_COMBO', 'IDC_TEXT_HOST_CLAN']) dlg.show(id, false);
  const nameBox = dlg.edit('IDC_INTERNET_GAME_NAME_EDIT'), passBox = dlg.edit('IDC_INTERNET_GAME_PASSWORD_EDIT');
  if (nameBox) { nameBox.maxLength = 48; nameBox.value = name; }
  if (passBox) { passBox.maxLength = 24; passBox.type = 'password'; }
  const describe = () => { const g = gameType(type); dlg.setText('IDC_GAME_TYPE_DESCRIPTION_TEXT', T(g.desc, '')); const d = dlg.ctl('IDC_GAME_TYPE_DESCRIPTION_TEXT'); if (d) d.style.whiteSpace = 'normal'; };
  dlg.list('IDC_GAME_TYPE_LIST', types.map(g => ({ key: g.type, label: T(g.text, g.fallback) })), row => { type = row.key; describe(); })?.select(type);
  describe();
  return new Promise(done => {
    const finish = v => { dlg.close(); done(v); };
    dlg.on('IDC_INTERNET_CREATE_GAME_BUTTON', () => {
      try { localStorage.setItem(TYPE_KEY, type); } catch { }
      finish({ name: (nameBox?.value.trim() || `${name}'s game`).slice(0, 48), password: passBox?.value || '', type });
    });
    dlg.on('IDC_CANCEL_BUTTON', () => finish(null));
    dlg.on('IDC_DIALOG_CLOSE_BUTTON', () => finish(null));
  });
}

async function askPassword() {
  const dlg = await openDialog('IDD_ENTER_GAME_PASSWORD_DIALOG', SCREEN);
  if (!dlg) { const p = prompt(T('TEXT_ENTER_GAME_PASSWORD', 'Enter the password for this game:')); return p === null ? null : p; }
  const box = dlg.edit('IDC_INTERNET_GAME_PASSWORD_EDIT');
  if (box) { box.type = 'password'; box.maxLength = 24; box.focus(); }
  return new Promise(done => {
    const finish = v => { dlg.close(); done(v); };
    dlg.on('IDC_OK', () => finish(box?.value || ''));
    box?.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(box.value || ''); });
    dlg.on('IDC_CANCEL_BUTTON', () => finish(null));
    dlg.on('IDC_DIALOG_CLOSE_BUTTON', () => finish(null));
  });
}

const KINDS = {
  lan: {
    lobby: 'IDD_LAN_LOBBY_DIALOG', staging: 'IDD_LAN_STAGING_DIALOG',
    lobbyChat: 'IDC_LAN_CHAT_LIST', lobbyEdit: 'IDC_LAN_CHAT_EDIT', host: 'IDC_LAN_HOST_GAME_BUTTON', join: 'IDC_LAN_JOIN_GAME_BUTTON', exit: 'IDC_LAN_CANCEL_BUTTON',
    nameEdit: 'IDC_LAN_NAME_EDIT', refresh: null, off: ['IDC_SET_FILTER_BUTTON', 'IDC_LAN_COLOR_SELECT'],
    stagingChat: 'IDC_LAN_CHAT_LIST', stagingEdit: 'IDC_LAN_CHAT_EDIT', start: 'IDC_LAN_START_GAME_BUTTON', stagingOff: [],
  },
  internet: {
    lobby: 'IDD_INTERNET_LOBBY_DIALOG', staging: 'IDD_INTERNET_STAGING_DIALOG',
    lobbyChat: 'IDC_INTERNET_CHAT_LIST', lobbyEdit: 'IDC_INTERNET_CHAT_EDIT', host: 'IDC_INTERNET_HOST_GAME_BUTTON', join: 'IDC_INTERNET_JOIN_GAME_BUTTON', exit: 'IDC_INTERNET_EXIT_BUTTON',
    nameEdit: null, refresh: 'IDC_INTERNET_REFRESH_GAME_LIST_BUTTON',
    off: ['IDC_SET_FILTER_BUTTON', 'IDC_INTERNET_HOME_BUTTON', 'IDC_INTERNET_PLAYER_PROFILE_BUTTON', 'IDC_INTERNET_COMMUNITY_BUTTON', 'IDC_INTERNET_QUICK_MATCH_BUTTON', 'IDC_INTERNET_CUSTOM_MATCH_BUTTON', 'IDC_INTERNET_OPTIONS_BUTTON', 'IDC_INTERNET_BUDDIES_BUTTON', 'IDC_INTERNET_IGNORE_PLAYER_BUTTON', 'IDC_ROOM_LIST'],
    stagingChat: 'IDC_INTERNET_CHAT_LIST', stagingEdit: 'IDC_INTERNET_CHAT_EDIT', start: 'IDC_INTERNET_START_GAME_BUTTON', stagingOff: ['IDC_INTERNET_BUDDIES_BUTTON'],
  },
};

export async function openMultiplayer({ maps, landMaps = [], customMaps = { space: [], land: [] }, factions, audio, launch, back, version, join: invited = null, kind = 'internet' }) {
  const K = KINDS[kind] || KINDS.internet;
  const dlg = await openDialog(K.lobby, { ...SCREEN, modal: false });
  if (!dlg) return false;
  const data = dataFingerprint();
  const def = id => dlg.def.controls.find(c => c.id === id);
  {
    const list = def(K.lobbyChat), edit = def(K.lobbyEdit), players = def('IDC_PLAYER_LIST'), name = K.nameEdit && def(K.nameEdit);
    if (list && edit && list.y + list.h > edit.y) resizeFramed(dlg.ctl(K.lobbyChat), list.w, list.h, Math.min(list.w, edit.x + edit.w - list.x), edit.y - 4 - list.y);
    if (players && name) resizeFramed(dlg.ctl('IDC_PLAYER_LIST'), players.w, players.h, name.x + name.w - players.x, players.h);
    const shown = c => dlg.ctl(c.id) && !dlg.ctl(c.id).hidden;
    for (const l of dlg.def.controls.filter(c => c.kind === 'LISTBOX' && shown(c))) {
      const below = dlg.def.controls.filter(b => /PUSHBUTTON/.test(b.kind) && shown(b) && b.y > l.y + l.h / 2 && b.y < l.y + l.h && b.x < l.x + l.w && b.x + b.w > l.x);
      if (!below.length) continue;
      const box = dlg.ctl(l.id), w0 = parseFloat(box.style.width), h0 = parseFloat(box.style.height);
      const right = l.id === 'IDC_GAME_LIST' && list ? Math.min(w0, parseFloat(dlg.ctl(K.lobbyChat).style.width) + list.x - l.x) : w0;
      resizeFramed(box, w0, h0, right, Math.min(...below.map(b => b.y)) - 4 - l.y);
    }
  }
  const nameBox = K.nameEdit ? dlg.edit(K.nameEdit) : null;
  const fixedName = storedName() || 'Player' + (1000 + Math.floor(Math.random() * 9000));
  if (nameBox) nameBox.value = storedName() || 'Player' + (1000 + Math.floor(Math.random() * 9000));
  if (nameBox) nameBox.maxLength = 24;
  const myName = () => ((nameBox ? nameBox.value.trim() : fixedName) || 'Player').slice(0, 24);
  for (const id of K.off) dlg.enable(id, false);
  dlg.show('IDC_GAME_LIST2', false);

  const lines = [];
  const show = () => {
    dlg.list(K.lobbyChat, lines.map((l, i) => ({ key: i, label: l })));
    dlg.ctl(K.lobbyChat)?.querySelector('.dlg-row:last-child')?.scrollIntoView({ block: 'nearest' });
  };
  const say = text => { if (!text) return; lines.push(text); if (lines.length > 100) lines.shift(); show(); };
  const hall = new Hall(myName());
  hall.on('players', names => dlg.list('IDC_PLAYER_LIST', names.map((n, i) => ({ key: i, label: n }))));
  hall.on('chat', (who, text) => say(`${who}: ${text}`));
  if (nameBox) nameBox.onchange = () => { storeName(myName()); hall.rename(myName()); };
  const chatBox = dlg.edit(K.lobbyEdit);
  if (chatBox) {
    chatBox.maxLength = 200;
    chatBox.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const text = chatBox.value.trim(); chatBox.value = ''; if (text) hall.say(text); });
  }

  const columns = ['IDC_INTERNET_SERVER_NAME_BUTTON', 'IDC_INTERNET_GAME_TYPE_BUTTON', 'IDC_INTERNET_PLAYERS_BUTTON', 'IDC_INTERNET_MAP_NAME_BUTTON', 'IDC_INTERNET_PING_BUTTON'].map(def);
  const listX = (def('IDC_GAME_LIST')?.x || 20) + 3;
  const lay = (rowEl, parts) => {
    rowEl.replaceChildren();
    rowEl.style.position = 'relative'; rowEl.style.display = 'block'; rowEl.style.height = '1.4em';
    parts.forEach((text, k) => {
      const c = columns[k]; if (!c) return;
      const sp = document.createElement('span');
      sp.textContent = text;
      sp.style.cssText = `position:absolute;left:${Math.max(0, c.x - listX)}px;width:${c.w}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:${/BS_RIGHT/.test(c.style) ? 'right' : 'left'}`;
      if (k === 0) sp.style.width = (columns[1].x - c.x - 6) + 'px';
      rowEl.appendChild(sp);
    });
  };

  let games = [], picked = null, timer = 0, busy = false, shown = '';
  const priv = kind === 'lan';
  const mapName = mapTitle;
  const campaigns = await multiplayerCampaigns();
  const campaignName = n => { const c = campaigns.find(x => x.name.toUpperCase() === String(n).toUpperCase()); return c ? c.label : String(n).replace(/_/g, ' '); };
  const refresh = async () => {
    if (priv) {
      dlg.list('IDC_GAME_LIST', [
        { key: 'a', label: 'Games hosted here are private: they are not listed anywhere.' },
        { key: 'b', label: 'Host Game, then send the invite link from the game\'s chat to your friends.' },
        { key: 'c', label: 'To join a friend\'s game, open their invite link or paste it at Join Game.' },
      ]);
      return;
    }
    let failed = null;
    try { games = (await listGames()).filter(g => !g.started); }
    catch (e) { failed = e; games = []; }
    const ours = g => g.version === version && g.mod === data;
    const rows = games.map(g => ({ key: g.id, label: g.name, parts: [(g.locked ? '* ' : '') + g.name + (ours(g) ? '' : ' (other version)'), typeLabel(g.mode), `${g.players}/${g.slots}`, g.mode === 'galactic' ? campaignName(g.map) : mapName(g.map), ''] }));
    const sig = JSON.stringify(rows) + !!failed;
    if (sig === shown) return;
    shown = sig;
    const list = dlg.list('IDC_GAME_LIST', rows, row => { picked = games.find(g => g.id === row.key); }, row => { picked = games.find(g => g.id === row.key); join(); });
    const els = dlg.ctl('IDC_GAME_LIST')?.querySelectorAll('.dlg-row') || [];
    rows.forEach((r, i) => els[i] && lay(els[i], r.parts));
    if (picked && games.some(g => g.id === picked.id)) list?.select(picked.id); else picked = null;
    if (failed) say('The game list could not be reached: ' + failed.message);
    else if (!games.length) say(T('TEXT_LAN_NO_GAMES', 'No games are open. Host one, or wait for one to appear.'));
  };
  const stop = () => { clearInterval(timer); hall.close(); dlg.close(); };
  if (!priv) timer = setInterval(refresh, 5000);
  refresh();

  const enter = async (gameId, host, options = null, password = '') => {
    if (busy) return;
    busy = true;
    storeName(myName());
    const net = new NetSession();
    try { await net.connect(gameId, { host, name: myName() }); }
    catch (e) { busy = false; say((host ? 'Could not open the game: ' : 'Could not join: ') + e.message); return; }
    stop();
    const ok = await openStaging({ net, host, name: myName(), maps, landMaps, customMaps, campaigns, factions, audio, version, data, launch, K, kind, options, password, back:() => { openMultiplayer({ maps, landMaps, customMaps, factions, audio, launch, back, version, kind }); } });
    if (!ok) { net.close(); back(); }
  };
  const join = () => {
    if (priv) {
      const text = (prompt('Paste the invite link to the game:') || '').trim();
      if (!text) return;
      let id = text;
      try { id = new URL(text).searchParams.get('join') || ''; } catch { }
      if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) { say('That is not an invite link.'); return; }
      enter(id, false);
      return;
    }
    if (!picked) { say(T('TEXT_LAN_SELECT_GAME', 'Pick a game from the list first.')); return; }
    if (picked.version !== version || picked.mod !== data) { say('That game runs a different version of the game or its data.'); return; }
    if (picked.players >= picked.slots) { say('That game is full.'); return; }
    if (picked.locked) { const id = picked.id; askPassword().then(pw => { if (pw !== null) enter(id, false, null, pw); }); return; }
    enter(picked.id, false);
  };
  dlg.on(K.host, async () => { if (busy) return; const o = await hostOptions({ name: myName(), campaigns, landMaps, customMaps }); if (o) enter(newGameId(), true, o); });
  if (K.refresh) dlg.on(K.refresh, () => { shown = ''; refresh(); });
  if (invited && /^[A-Za-z0-9_-]{6,32}$/.test(invited)) {
    try { const u = new URL(location.href); u.searchParams.delete('join'); history.replaceState(null, '', u.pathname + '?' + u.searchParams.toString().replace(/=(&|$)/g, '$1')); } catch { }
    say('Joining the game you were invited to…');
    enter(invited, false);
  }
  dlg.on(K.join, join);
  dlg.on(K.exit, () => { stop(); back(); });
  return true;
}

async function campaignOptions(st, campaign) {
  const dlg = await openDialog('IDD_CAMPAIGN_ADVANCED_OPTIONS_DIALOG', SCREEN);
  if (!dlg) return false;
  const was = { ...st }, C = db.constants, custom = !campaign || campaign.bool('Supports_Custom_Settings', true);
  const lo = campaign?.num('Min_Custom_Starting_Credits', 1000) ?? 1000, hi = Math.max(lo + 500, campaign?.num('Max_Custom_Starting_Credits', 20000) ?? 20000);
  const tlo = campaign?.num('Min_Custom_Tech_Level', 1) ?? 1, thi = Math.max(tlo, campaign?.num('Max_Custom_Tech_Level', 5) ?? 5), tsteps = thi - tlo + 1;
  const clamp = () => { st.credits = Math.max(lo, Math.min(hi, st.credits)); st.tech = Math.max(tlo, Math.min(thi, st.tech)); st.maxTech = Math.max(st.tech, Math.min(thi, st.maxTech)); };
  const show = () => {
    clamp();
    dlg.slider('IDC_SKIRMISH_CREDITS_SLIDER', (st.credits - lo) / (hi - lo), v => { st.credits = Math.round((lo + v * (hi - lo)) / 500) * 500; dlg.setText('IDC_SKIRMISH_CREDITS_VALUE', st.credits.toLocaleString()); });
    dlg.setText('IDC_SKIRMISH_CREDITS_VALUE', st.credits.toLocaleString());
    dlg.slider('IDC_SKIRMISH_STARTING_TECH_LEVEL_SLIDER', tsteps > 1 ? (st.tech - tlo) / (tsteps - 1) : 0, v => { st.tech = tlo + Math.round(v * (tsteps - 1)); if (st.maxTech < st.tech) { st.maxTech = st.tech; show(); } dlg.setText('IDC_SKIRMISH_STARTING_TECH_LEVEL_VALUE', String(st.tech)); }, tsteps);
    dlg.setText('IDC_SKIRMISH_STARTING_TECH_LEVEL_VALUE', String(st.tech));
    dlg.slider('IDC_SKIRMISH_MAX_TECH_LEVEL_SLIDER', tsteps > 1 ? (st.maxTech - tlo) / (tsteps - 1) : 0, v => { st.maxTech = Math.max(st.tech, tlo + Math.round(v * (tsteps - 1))); dlg.setText('IDC_SKIRMISH_MAX_TECH_LEVEL_VALUE', String(st.maxTech)); }, tsteps);
    dlg.setText('IDC_SKIRMISH_MAX_TECH_LEVEL_VALUE', String(st.maxTech));
    dlg.combo('IDC_ALLOW_AUTORESOLVE_COMBO', [{ value: 0, label: T('TEXT_ALLOW_AUTORESOLVE_ALWAYS', 'Always') }, { value: 2, label: T('TEXT_ALLOW_AUTORESOLVE_ASK', 'Ask') }], st.autoResolve, v => { st.autoResolve = +v; });
    dlg.check('IDC_ALLOW_RANDOM_EVENTS', !!st.randomEvents, v => { st.randomEvents = v; });
  };
  for (const id of ['IDC_SKIRMISH_CREDITS_SLIDER', 'IDC_SKIRMISH_STARTING_TECH_LEVEL_SLIDER', 'IDC_SKIRMISH_MAX_TECH_LEVEL_SLIDER']) dlg.enable(id, custom);
  dlg.enable('IDC_ALLOW_RANDOM_EVENTS', false);
  show();
  return new Promise(done => {
    dlg.on('IDC_BUTTON_ACCEPT', () => { dlg.close(); done(true); });
    dlg.on('IDC_CANCEL_BUTTON', () => { Object.assign(st, was); dlg.close(); done(false); });
    dlg.on('IDC_DEFAULTS_BUTTON', () => { Object.assign(st, { credits: C.num('MP_Default_Credits', 6000), tech: C.num('MP_Default_Start_Tech_Level', 1), maxTech: C.num('MP_Default_Max_Tech_Level', 5), autoResolve: C.num('MP_Default_Allow_Auto_Resolve', 2) === 0 ? 0 : 2, randomEvents: C.bool('MP_Default_Random_Events', false) }); show(); });
  });
}

async function confirmBox(question) {
  const dlg = await openDialog('IDD_DIALOG_BOX_QUIT_CONFIRM', SCREEN);
  if (!dlg) return confirm(question);
  dlg.setText('IDC_CAPTION', question);
  for (const id of ['IDC_USER_TEXT_STRING_1', 'IDC_USER_TEXT_STRING_2', 'IDC_USER_TEXT_STRING_3']) dlg.show(id, false);
  dlg.setText('IDC_DIALOG_BOX_BUTTON_LEFT', T('TEXT_BUTTON_YES', 'Yes'));
  dlg.setText('IDC_DIALOG_BOX_BUTTON_RIGHT', T('TEXT_BUTTON_NO', 'No'));
  return new Promise(done => {
    dlg.on('IDC_DIALOG_BOX_BUTTON_LEFT', () => { dlg.close(); done(true); });
    dlg.on('IDC_DIALOG_BOX_BUTTON_RIGHT', () => { dlg.close(); done(false); });
  });
}

async function pickSave(type, tell) {
  const dlg = await openDialog('IDD_LOAD_GAME_DIALOG', SCREEN);
  if (!dlg) return null;
  dlg.show('IDC_CHECK_RECORDINGS', false);
  const when = iso => { try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };
  const rows = async () => (await listSaves()).filter(s => s.mp && s.mp.type === type)
    .map(s => ({ key: s.id, label: s.name, note: `${s.mp.slots.filter(x => x.human).map(x => x.name || '?').join(', ')}   ${when(s.saved)}` }));
  return new Promise(done => {
    let list = null;
    const finish = v => { dlg.close(); done(v); };
    const pick = () => { const on = !!list?.selected(); dlg.enable('IDC_LOAD_GAME_BUTTON', on); dlg.enable('IDC_DELETE_GAME_BUTTON', on); };
    const refresh = async () => { list = dlg.list('IDC_SAVE_GAME_LIST', await rows(), pick, row => finish(row.key)); pick(); };
    dlg.on('IDC_LOAD_GAME_BUTTON', () => { const cur = list?.selected(); if (cur) finish(cur.key); });
    dlg.on('IDC_LOAD_CANCEL_BUTTON', () => finish(null));
    dlg.on('IDC_DIALOG_CLOSE_BUTTON', () => finish(null));
    dlg.on('IDC_DELETE_GAME_BUTTON', async () => { const cur = list?.selected(); if (cur && await confirmBox(T('TEXT_DELETE_CONFIRM', 'Delete saved game?'))) { await deleteSave(cur.key); refresh(); } });
    const c = dlg.def.controls.find(x => x.id === 'IDC_SAVE_GAME_LIST'), like = dlg.ctl('IDC_LOAD_CANCEL_BUTTON');
    const file = document.createElement('input');
    file.type = 'file'; file.accept = '.swrsave,.json,application/json'; file.hidden = true;
    dlg.el.appendChild(file);
    file.onchange = async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      try {
        const { id, snap } = await importSaveFile(f);
        if (!snap.multiplayer || snap.multiplayer.type !== type) tell(snap.multiplayer ? 'That save is of another game type.' : 'That save is not of a multiplayer game.');
        await refresh(); list?.select(id); pick();
      } catch (e) { tell(e.message); }
    };
    if (c && like) {
      const b = like.cloneNode(true);
      b.style.left = (c.x + c.w - 150) + 'px'; b.style.top = '38px'; b.style.width = '150px';
      b.firstChild.textContent = 'Import'; b.classList.remove('off'); b.onclick = () => file.click();
      dlg.el.appendChild(b);
    }
    refresh();
  });
}

async function openStaging({ net, host, name, maps, landMaps = [], customMaps = { space: [], land: [] }, campaigns = [], factions, audio, version, data, launch, back, K, kind, options = null, password = '' }) {
  const dlg = await openDialog(K.staging, { ...SCREEN, modal: false });
  if (host) password = options?.password || '';
  for (const id of K.stagingOff) dlg.enable(id, false);
  if (!dlg) return false;
  const fLabel = f => T(db.faction(f).str('Text_ID'), f);
  const mapName = mapTitle;
  const factionsFor = [factions[0], factions.find(f => f !== factions[0]) || factions[0]];

  const isLand = m => landMaps.includes(m) || mapHeader(m)?.kind === 1;
  const mapPlayers = { get: m => mapHeader(m)?.players || 0 };
  const loadAllPlayers = Promise.resolve();
  const kindLabel = m => isLand(m) ? T('TEXT_LOBBY_LIST_GAME_TYPE_LAND', 'Land') : T('TEXT_LOBBY_LIST_GAME_TYPE_SPACE', 'Space');
  const C = db.constants, campaignOf = n => campaigns.find(c => c.name.toUpperCase() === String(n).toUpperCase());
  const allPlayable = [...db.factions.values()].filter(f => f.bool('Is_Playable')).map(f => f.name);
  const sidesOf = n => campaignOf(n)?.factions || allPlayable;
  const type0 = options?.type || 'space';
  let st = {
    type: type0, name: options?.name || `${name}'s game`,
    mapFile: type0 === 'campaign' ? campaigns[0]?.name : type0 === 'land' ? landMaps[0] : type0 === 'control' ? landMaps.find(controlMap) || landMaps[0] : maps.find(m => /KUAT/i.test(m)) || maps[0],
    teamFactions: factionsFor, credits: type0 === 'campaign' ? C.num('MP_Default_Credits', 6000) : 6000, popCap: 0, fog: true, preBuilt: true,
    tech: C.num('MP_Default_Start_Tech_Level', 1), maxTech: C.num('MP_Default_Max_Tech_Level', 5), autoResolve: C.num('MP_Default_Allow_Auto_Resolve', 2) === 0 ? 0 : 2, randomEvents: C.bool('MP_Default_Random_Events', false),
  };
  const campaign = () => st.type === 'campaign';
  const SLOTS = rowsOf(dlg) || ROWS;
  let slots = Array.from({ length: SLOTS }, (_, i) => ({ kind: i === 0 ? 'human' : i === 1 ? 'open' : 'closed', peer: i === 0 ? 0 : null, name: i === 0 ? name : '', team: i % 2, color: PALETTE[i], auto: true, ready: false, faction: (sidesOf(st.mapFile))[i % Math.max(1, sidesOf(st.mapFile).length)] }));
  const chat = [];
  let told = '';
  let left = false;

  const note = document.createElement('div');
  note.className = 'dlg-txt';
  {
    const ctl = id => dlg.def.controls.find(c => c.id === id), edit = ctl(K.stagingEdit), start = ctl(K.start);
    const top = edit ? edit.y + edit.h : 640, h = Math.max(12, (start ? start.y : top + 16) - top);
    note.style.cssText = `position:absolute;left:${edit ? edit.x : 10}px;top:${top}px;width:${edit ? edit.w : 930}px;height:${h}px;line-height:${h}px;text-align:center;color:#ff6a5a;font-size:11px;overflow:hidden;text-overflow:ellipsis`;
  }
  dlg.el.appendChild(note);
  const addChat = (who, text, link = null) => {
    chat.push({ key: chat.length, label: who ? `${who}: ${text}` : text, link });
    if (chat.length > 200) chat.shift();
    dlg.list(K.stagingChat, chat, row => {
      if (!row.link) return;
      const fallback = () => {
        const t = document.createElement('textarea');
        t.value = row.link; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch { }
        t.remove();
        addChat('', ok ? 'Invite link copied.' : 'Copy the link by hand: ' + row.link);
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(row.link).then(() => addChat('', 'Invite link copied.'), fallback); else fallback();
    });
    dlg.ctl(K.stagingChat)?.querySelector('.dlg-row:last-child')?.scrollIntoView({ block: 'nearest' });
  };
  const leave = why => {
    if (left) return;
    left = true;
    clearInterval(beat);
    net.close();
    dlg.close();
    if (why) alert(why);
    back();
  };

  const humans = () => slots.filter(s => s.kind === 'human');
  const listing = () => kind !== 'lan' && net.setListing({ name: st.name, host: name, map: st.mapFile, mode: campaign() ? 'galactic' : st.type === 'control' ? 'control' : isLand(st.mapFile) ? 'land' : 'space', locked: !!password, players: humans().length, slots: slots.filter(s => s.kind === 'human' || s.kind === 'open').length, version, mod: data });
  const single = () => campaign() && !!campaignOf(st.mapFile)?.variants, menuEntry = () => campaign() && !!campaignOf(st.mapFile)?.menu;
  const lead = () => slots.find(s => s.kind === 'human' && s.peer === 0)?.faction;
  const together = () => { if (!menuEntry() || st.save) return; for (const s of slots) if (s.kind === 'human' && lead()) s.faction = lead(); };
  const publish = () => { together(); autoColors(slots.filter(s => s.kind !== 'closed' && s.kind !== 'open'), st.teamFactions, PALETTE); net.broadcast({ k: 'state', st, slots }); listing(); render(); };
  const unready = () => { for (const s of slots) if (s.peer !== 0) s.ready = false; };
  if (host) {
    net.on('message', (from, m) => {
      const i = slots.findIndex(s => s.kind === 'human' && s.peer === from);
      if (m.k === 'hello') {
        if (m.version !== version || m.data !== data) { net.send(from, { k: 'refuse', why: 'Your game version or game data differs from the host\'s.' }); setTimeout(() => net.kick(from), 300); return; }
        if (password && m.password !== password) { net.send(from, { k: 'password', wrong: m.password !== undefined }); return; }
        if (slots.some(s => s.kind === 'human' && s.peer === from)) return;
        const who = String(m.name || 'Player').slice(0, 24);
        const free = slots.find(s => s.kind === 'open' && s.was && s.was === who) || slots.find(s => s.kind === 'open');
        if (!free) { net.send(from, { k: 'refuse', why: 'The game is full.' }); setTimeout(() => net.kick(from), 300); return; }
        Object.assign(free, { kind: 'human', peer: from, name: who, ready: false, auto: !free.saved });
        if (single() && lead() && !free.saved) free.faction = lead();
        unready(); publish();
        addChat('', `${free.name} joined the game.`); net.broadcast({ k: 'chat', name: '', text: `${free.name} joined the game.` });
      } else if (i < 0) return;
      else if (m.k === 'take') { if (take(i, m.slot)) { unready(); publish(); } }
      else if (m.k === 'mine') {
        const s = slots[i];
        if (s.saved) return;
        if (m.team === 0 || m.team === 1) s.team = m.team;
        if (typeof m.faction === 'string' && campaign() && menuEntry()) { }
        else if (typeof m.faction === 'string' && campaign() && sidesOf(st.mapFile).includes(m.faction)) s.faction = m.faction;
        else if (typeof m.faction === 'string' && factions.includes(m.faction)) st.teamFactions[s.team] = m.faction;
        if (typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color)) { s.color = m.color; s.auto = false; }
        unready(); publish();
      } else if (m.k === 'ready') { slots[i].ready = !!m.on; publish(); }
      else if (m.k === 'chat') { const text = String(m.text || '').slice(0, 200); if (text) { addChat(slots[i].name, text); net.broadcast({ k: 'chat', name: slots[i].name, text }); } }
    });
    net.on('leave', peer => {
      const s = slots.find(x => x.kind === 'human' && x.peer === peer);
      if (!s) return;
      addChat('', `${s.name} left the game.`); net.broadcast({ k: 'chat', name: '', text: `${s.name} left the game.` });
      Object.assign(s, { kind: 'open', peer: null, name: '', ready: false });
      publish();
    });
  } else {
    net.on('message', (from, m) => {
      if (m.k === 'state') { st = m.st; slots = m.slots; render(); }
      else if (m.k === 'chat') addChat(m.name, m.text);
      else if (m.k === 'refuse') leave(m.why);
      else if (m.k === 'password') {
        if (m.wrong) addChat('', T('TEXT_BAD_PASSWORD', 'The password is not right.'));
        askPassword().then(pw => { if (pw === null) leave(null); else net.send(0, { k: 'hello', name, version, data, password: pw }); });
      }
      else if (m.k === 'kicked') leave('The host removed you from the game.');
      else if (m.k === 'start') {
        if (!m.save) begin(m.setup);
        else { note.textContent = 'Opening the saved game...'; unpackSave(m.save).then(snap => begin({ ...m.setup, restore: snap.mode === 'galactic' ? snap.galaxy : snap }), e => leave('The saved game could not be read: ' + e.message)); }
      }
    });
    net.send(0, { k: 'hello', name, version, data, ...(password ? { password } : {}) });
  }
  net.on('closed', why => { if (!started) leave(why === 'host left' ? 'The host closed the game.' : 'The connection to the game was lost (' + why + ').'); });

  let loaded = null;
  const AI_KINDS = ['easy', 'medium', 'hard'];
  const wasLabel = (s, label) => (s.was && s.was !== s.name ? `${label} (was ${s.was})` : label);
  const take = (from, to) => {
    const a = slots[from], b = slots[to];
    if (!st.save || !a || !b || a === b || a.kind !== 'human' || b.kind !== 'open') return false;
    Object.assign(b, { kind: 'human', peer: a.peer, name: a.name, ready: false });
    Object.assign(a, { kind: 'open', peer: null, name: '', ready: false });
    return true;
  };
  const freshSlots = () => {
    const people = humans().sort((a, b) => a.peer - b.peer), sides = sidesOf(st.mapFile);
    slots = Array.from({ length: SLOTS }, (_, i) => ({ kind: i < people.length ? 'human' : i === people.length ? 'open' : 'closed', peer: people[i]?.peer ?? null, name: people[i]?.name || '', team: i % 2, color: PALETTE[i], auto: true, ready: false, faction: sides[i % Math.max(1, sides.length)] }));
  };
  const dropSave = () => { if (!st.save) return; st.save = null; loaded = null; freshSlots(); addChat('', 'A new game: the saved game is put away.'); };
  const useSave = async id => {
    const snap = await getSave(id);
    const why = !snap ? 'That save could not be read.' : validate(snap) || (!snap.multiplayer ? 'That save is not of a multiplayer game.' : snap.multiplayer.type !== st.type ? 'That save is of another game type.' : null);
    if (why) { addChat('', why); return; }
    const base = snap.setup, mp = snap.multiplayer;
    if (campaign()) {
      const want = String(base.campaign).toUpperCase();
      if (!(await loadCampaignData()).campaigns.has(want)) { addChat('', 'The campaign of that save is not in this game data.'); return; }
      st.mapFile = campaigns.find(c => c.name.toUpperCase() === want || c.variants?.some(v => v.name.toUpperCase() === want))?.name || base.campaign;
      const o = base.options || {};
      Object.assign(st, { credits: o.credits ?? st.credits, tech: o.tech ?? st.tech, maxTech: o.maxTech ?? st.maxTech, autoResolve: o.autoResolve ?? st.autoResolve });
    } else {
      if (![maps, landMaps, customMaps.space, customMaps.land].some(l => l.includes(base.mapFile))) { addChat('', 'The map of that save is not in this game data.'); return; }
      Object.assign(st, { mapFile: base.mapFile, teamFactions: base.teamFactions.slice(), credits: base.credits, popCap: base.popCap, fog: base.fog !== false, preBuilt: base.preBuilt !== false });
    }
    const people = humans().sort((a, b) => a.peer - b.peer);
    slots = mp.slots.map((x, i) => ({
      kind: x.human ? 'open' : AI_KINDS.includes(x.difficulty) ? x.difficulty : 'medium', peer: null, name: '', team: x.team ?? i % 2,
      color: String(x.color || PALETTE[i % PALETTE.length]).toLowerCase(), auto: false, ready: false, faction: x.faction,
      was: x.human ? x.name || `Player ${i + 1}` : '', saved: true,
    }));
    const own = h => slots.some(s => s.was === h.name);
    for (const h of [...people.filter(own), ...people.filter(h => !own(h))]) {
      const t = slots.find(s => s.kind === 'open' && s.was === h.name) || slots.find(s => s.kind === 'open') || slots.find(s => s.kind !== 'human');
      if (t) Object.assign(t, { kind: 'human', peer: h.peer, name: h.name, ready: false });
      else { net.send(h.peer, { k: 'refuse', why: 'The saved game the host loaded has no room for you.' }); setTimeout(() => net.kick(h.peer), 300); }
    }
    loaded = snap;
    st.save = { id, name: snap.name };
    addChat('', `Loaded "${snap.name}". Each slot keeps its side; whoever takes a slot plays it. Pick a map to start a new game instead.`);
    unready(); publish(); fillMaps();
  };
  const startSaved = async () => {
    const snap = loaded, base = snap.setup;
    const players = slots.map((s, i) => {
      const p = { ...(base.players[i] || {}) };
      for (const k of ['peer', 'peers', 'name', 'left', 'difficulty']) delete p[k];
      return s.kind === 'human' ? { ...p, human: true, peer: s.peer, name: s.name, color: s.color, auto: false } : { ...p, human: false, difficulty: s.kind, color: s.color, auto: false };
    });
    const setup = { ...base, mode: snap.mode, type: st.type, players, seed: crypto.getRandomValues(new Uint32Array(1))[0], restoreSlot: snap.multiplayer.saver, spaceWorker: new URLSearchParams(location.search).has('spaceworker') };
    note.textContent = 'Sending the saved game to the players...';
    const save = await packSave(snap);
    net.setListing(null);
    net.broadcast({ k: 'start', setup, save });
    begin({ ...setup, restore: snap.mode === 'galactic' ? snap.galaxy : snap });
  };
  let fillMaps = () => {};

  const mine = () => slots.findIndex(s => s.kind === 'human' && s.peer === net.id);
  const previews = new Map();
  const preview = async m => {
    if (!previews.has(m)) previews.set(m, loadTextureCanvas(m.replace(/\.TED$/i, '.tga')).then(cv => (cv ? cv.toDataURL() : '')).catch(() => ''));
    const url = await previews.get(m);
    if (st.mapFile === m) dlg.setImage('IDC_IMAGE', url);
  };
  dlg.enable('IDC_LOAD_GAME', host);
  for (const id of ['IDC_STAGING_MAP_LIST', 'IDC_SELECT_OFFICIAL_MAPS', 'IDC_SELECT_CUSTOM_MAPS']) dlg.show(id, host);
  for (const id of ['IDC_GAME_OPTIONS_CLIENT_DISPLAY_LEFT', 'IDC_GAME_OPTIONS_CLIENT_DISPLAY_RIGHT']) dlg.show(id, !host);
  if (!host) dlg.enable('IDC_SELECT_OPTIONS', false);
  if (host) {
    const byName = (a, b) => a.name.localeCompare(b.name);
    const row = m => ({ key: m, name: mapName(m), label: `${mapPlayers.get(m) ? `(${mapPlayers.get(m)}) ` : ''}${mapName(m)} (${kindLabel(m)})` });
    let custom = false;
    const pool = () => (custom ? customMaps : { space: maps, land: landMaps });
    const rows = () => { const P = pool(); return campaign() ? campaigns.map(c => ({ key: c.name, name: c.label, label: c.label })).sort(byName) : st.type === 'land' ? P.land.map(row).sort(byName) : st.type === 'control' ? P.land.filter(controlMap).map(row).sort(byName) : st.type === 'space' ? P.space.map(row).sort(byName) : [...P.space.map(row).sort(byName), ...P.land.map(row).sort(byName)]; };
    let filling = false;
    const fill = () => {
      filling = true;
      dlg.list('IDC_STAGING_MAP_LIST', rows(), r => { if (!filling && (st.mapFile !== r.key || st.save)) { dropSave(); st.mapFile = r.key; if (campaign()) { const sides = sidesOf(r.key); slots.forEach((s, i) => { if (!sides.includes(s.faction)) s.faction = sides[i % sides.length]; }); } unready(); publish(); } }).select(st.mapFile);
      filling = false;
      dlg.ctl('IDC_STAGING_MAP_LIST')?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    };
    fill();
    fillMaps = fill;
    const showCustom = on => {
      if (custom === on || campaign()) return;
      custom = on;
      const list = rows();
      if (!list.some(r => r.key === st.mapFile)) { dropSave(); st.mapFile = list[0]?.key || null; unready(); publish(); }
      fill();
    };
    dlg.on('IDC_SELECT_OFFICIAL_MAPS', () => showCustom(false));
    dlg.on('IDC_SELECT_CUSTOM_MAPS', () => showCustom(true));
    loadAllPlayers.then(() => { if (dlg.el.isConnected) fill(); });
  }
  if (!host) dlg.setText(K.start, T('TEXT_BUTTON_ACCEPT', 'Accept'));

  const extraRows = [];
  const kinds = [['open', T('TEXT_OPEN', 'Open')], ['closed', T('TEXT_CLOSED', 'Closed')], ['easy', T('TEXT_EASY_AI_PLAYER', 'Easy AI')], ['medium', T('TEXT_MEDIUM_AI_PLAYER', 'Medium AI')], ['hard', T('TEXT_HARD_AI_PLAYER', 'Hard AI')]];
  const render = () => {
    const me = mine();
    autoColors(slots.filter(s => s.kind !== 'closed' && s.kind !== 'open'), st.teamFactions, PALETTE);
    for (let r = 0; r < win.rows; r++) {
      const i = win.off + r, s = slots[i];
      for (const k of ['NAME', 'FACTION', 'COLOR', 'TEAM']) dlg.show(`IDC_PLAYER_${k}_${r}`, !!s);
      if (!s) { const mark = dlg.ctl(`IDC_ACCEPT_PLAYER_${r}`); if (mark) mark.hidden = true; continue; }
      const filled = s.kind !== 'closed' && s.kind !== 'open';
      const editable = host ? (s.kind !== 'human' || s.peer === 0 || true) : i === me;
      if (s.kind === 'human') {
        const opts = [{ value: 'me', label: wasLabel(s, s.name) }];
        if (host && s.peer !== 0) opts.push({ value: 'kick', label: T('TEXT_KICK', 'Kick') });
        dlg.combo(`IDC_PLAYER_NAME_${r}`, opts, 'me', v => { if (v === 'kick') net.kick(s.peer); });
        dlg.enable(`IDC_PLAYER_NAME_${r}`, host && s.peer !== 0);
      } else {
        const opts = kinds.filter(([value]) => !(s.saved && value === 'closed')).filter(([value]) => host || value === s.kind).map(([value, label]) => ({ value, label: wasLabel(s, label) }));
        const free = !!st.save && s.kind === 'open' && me >= 0;
        if (free) opts.push({ value: 'take', label: 'Take this slot' });
        dlg.combo(`IDC_PLAYER_NAME_${r}`, opts, s.kind, v => {
          if (v === 'take') { if (host) { if (take(me, i)) { unready(); publish(); } } else net.send(0, { k: 'take', slot: i }); return; }
          if (host) { s.kind = v; unready(); publish(); } else render();
        });
        dlg.enable(`IDC_PLAYER_NAME_${r}`, host || free);
      }
      const change = (what, v) => {
        if (host) {
          if (what === 'faction' && campaign()) s.faction = v; else if (what === 'faction') st.teamFactions[s.team] = v; else if (what === 'team') s.team = +v; else { s.color = v; s.auto = false; }
          unready(); publish();
        } else net.send(0, { k: 'mine', [what]: what === 'team' ? +v : v });
      };
      if (campaign()) dlg.combo(`IDC_PLAYER_FACTION_${r}`, sidesOf(st.mapFile).map(f => ({ value: f, label: fLabel(f) })), s.faction, v => change('faction', v));
      else dlg.combo(`IDC_PLAYER_FACTION_${r}`, factions.map(f => ({ value: f, label: fLabel(f) })), st.teamFactions[s.team], v => change('faction', v));
      const own = factionColor(campaign() ? s.faction : st.teamFactions[s.team]);
      const colours = [...new Set([own, ...PALETTE, ...(s.saved ? [s.color] : [])].filter(Boolean).map(c => c.toLowerCase()))];
      dlg.combo(`IDC_PLAYER_COLOR_${r}`, colours.map(c => ({ value: c, label: c, color: c })), String(s.color).toLowerCase(), v => change('color', v));
      dlg.combo(`IDC_PLAYER_TEAM_${r}`, [0, 1].map(t => ({ value: t, label: `${T('TEXT_TEAM', 'Team')} ${t + 1}` })), s.team, v => change('team', v));
      for (const k of ['FACTION', 'COLOR', 'TEAM']) dlg.enable(`IDC_PLAYER_${k}_${r}`, filled && editable && !s.saved);
      if (menuEntry() && s.kind === 'human' && s.peer !== 0) dlg.enable(`IDC_PLAYER_FACTION_${r}`, false);
      if (campaign()) dlg.show(`IDC_PLAYER_TEAM_${r}`, false);
      const mark = dlg.ctl(`IDC_ACCEPT_PLAYER_${r}`);
      if (mark) { mark.hidden = false; mark.style.background = s.kind === 'human' && (s.ready || s.peer === 0) ? 'radial-gradient(circle, #6f6 0 35%, transparent 40%)' : ''; }
    }
    win.update();
    dlg.show('IDC_ACCEPT_PLAYER_8', false);
    for (const k of ['NAME', 'FACTION', 'COLOR', 'TEAM']) dlg.show(`IDC_PLAYER_${k}_8`, false);
    if (!host) {
      const yes = T('TEXT_ON', 'On'), no = T('TEXT_OFF', 'Off');
      const rows = campaign() ? [[T('TEXT_GAME_TYPE', 'Game Type'), T('TEXT_GAME_TYPE_CAMPAIGN', 'Campaign')], [T('TEXT_MAP', 'Map'), campaignOf(st.mapFile)?.label || st.mapFile], [T('TEXT_SKIRMISH_CREDITS', 'Starting Credits'), st.credits.toLocaleString()], [T('TEXT_SKIRMISH_STARTING_TECH_LEVEL', 'Starting Tech Level'), String(st.tech)], [T('TEXT_SKIRMISH_MAX_TECH_LEVEL', 'Max Tech Level'), String(st.maxTech)], [T('TEXT_ALLOW_AUTORESOLVE', 'Auto-resolve combat'), st.autoResolve === 0 ? T('TEXT_ALLOW_AUTORESOLVE_ALWAYS', 'Always') : T('TEXT_ALLOW_AUTORESOLVE_ASK', 'Ask')]]
        : [[T('TEXT_MAP', 'Map'), `${mapPlayers.get(st.mapFile) ? `(${mapPlayers.get(st.mapFile)}) ` : ''}${mapName(st.mapFile)} (${kindLabel(st.mapFile)})`], [T('TEXT_CREDITS', 'Credits'), st.credits.toLocaleString()], [T('TEXT_POP_CAP', 'Unit Max'), String(st.popCap || 'Default')], ['Fog of War', st.fog ? yes : no]];
      if (isLand(st.mapFile)) rows.push([T('TEXT_PRE_BUILT_BASE', 'Pre-built base'), st.preBuilt !== false ? yes : no]);
      if (st.save) rows.unshift(['Saved game', st.save.name]);
      for (const e of extraRows.splice(0)) e.remove();
      ['IDC_GAME_OPTIONS_CLIENT_DISPLAY_LEFT', 'IDC_GAME_OPTIONS_CLIENT_DISPLAY_RIGHT'].forEach((cid, side) => {
        const base = dlg.ctl(cid);
        if (!base) return;
        rows.forEach((r, k) => {
          const e = k ? base.cloneNode(true) : base;
          if (k) { e.style.top = (parseFloat(base.style.top) + 26 * k) + 'px'; base.parentNode.appendChild(e); extraRows.push(e); }
          e.textContent = (side ? ' ' : '') + r[side] + (side ? '' : ':');
        });
      });
    }
    if (!campaign()) preview(st.mapFile); else dlg.setImage('IDC_IMAGE', '');
    if (host) dlg.enable('IDC_SELECT_OPTIONS', !single() && !st.save);
    const hint = !single() ? '' : menuEntry() ? 'Each player may take a side with the menu\'s faction buttons, else plays with the host. Only the host\'s side gets the story: briefings, objectives and the mod\'s player features.'
      : slots.some(s => s.kind === 'human' && s.faction !== lead()) ? 'Only the host\'s side gets the story: briefings, objectives and the mod\'s player features. Players on the host\'s side play it in co-op.' : '';
    if (hint && hint !== told) addChat('', hint);
    told = hint;
  };

  const win = slotWindow(dlg, {
    count: () => slots.length, draw: () => render(), like: 'IDC_SELECT_OPTIONS',
    add: host ? () => { const i = slots.length; if (i >= MAX_SLOTS || st.save) return; slots.push({ kind: 'closed', peer: null, name: '', team: i % 2, color: PALETTE[i % PALETTE.length], auto: true, ready: false }); unready(); publish(); } : null,
  });

  const chatBox = dlg.edit(K.stagingEdit);
  if (chatBox) {
    chatBox.maxLength = 200;
    chatBox.onkeydown = e => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const text = chatBox.value.trim(); chatBox.value = '';
      if (!text) return;
      if (host) { addChat(name, text); net.broadcast({ k: 'chat', name, text }); } else net.send(0, { k: 'chat', text });
    };
  }

  dlg.on('IDC_SELECT_OPTIONS', async () => { if (!host) return; if (campaign()) await campaignOptions(st, campaignOf(st.mapFile)?.campaign); else await advancedOptions(st); unready(); publish(); });
  dlg.show('IDC_LOAD_GAME', true);
  dlg.on('IDC_LOAD_GAME', async () => { if (!host) return; const id = await pickSave(st.type, text => addChat('', text)); if (id) useSave(id); });
  dlg.on('IDC_LAN_CANCEL_BUTTON', () => { net.setListing(null); leave(null); });
  dlg.on(K.start, () => {
    if (!host) { const s = slots[mine()]; net.send(0, { k: 'ready', on: !(s && s.ready) }); return; }
    if (!st.mapFile) return;
    const players = slots.filter(s => s.kind !== 'closed' && s.kind !== 'open');
    if (st.save && loaded) {
      const open = slots.find(s => s.kind === 'open');
      if (open) { note.textContent = `${open.was}'s slot needs a player or a computer.`; return; }
      if (players.some(s => s.kind === 'human' && s.peer !== 0 && !s.ready)) { note.textContent = 'Waiting for every player to accept.'; return; }
      note.textContent = '';
      startSaved().catch(e => { console.error(e); note.textContent = 'The saved game could not be sent: ' + e.message; });
      return;
    }
    if (campaign()) {
      if (players.some(s => s.kind === 'human' && s.peer !== 0 && !s.ready)) { note.textContent = 'Waiting for every player to accept.'; return; }
      const entry = campaignOf(st.mapFile);
      if (!entry) { note.textContent = 'Pick a campaign.'; return; }
      note.textContent = '';
      const variant = campaignVariant(entry, players.find(s => s.peer === 0)?.faction || players[0].faction);
      const humanTypes = entry.variants ? Object.fromEntries(players.filter(s => s.kind === 'human').map(s => [s.faction.toUpperCase(), (String(campaignVariant(entry, s.faction).str('Starting_Active_Player')).toUpperCase() === s.faction.toUpperCase() && campaignVariant(entry, s.faction).tuples('AI_Player_Control').find(t => String(t[0]).toUpperCase() === s.faction.toUpperCase())?.[1]) || 'Human'])) : null;
      const setup = {
        mode: 'galactic', type: 'campaign', campaign: variant.name, singlePlayerCampaign: !!entry.variants, humanTypes, seed: crypto.getRandomValues(new Uint32Array(1))[0],
        options: { credits: st.credits, tech: st.tech, maxTech: st.maxTech, autoResolve: st.autoResolve, randomEvents: !!st.randomEvents },
        players: players.map(s => s.kind === 'human' ? { human: true, peer: s.peer, name: s.name, faction: entry.menu || s.faction, color: s.color } : { human: false, faction: s.faction, difficulty: s.kind, color: s.color }),
      };
      net.setListing(null);
      net.broadcast({ k: 'start', setup });
      begin(setup);
      return;
    }
    if (![0, 1].every(t => players.some(p => p.team === t))) { note.textContent = 'Each team needs at least one player.'; return; }
    if (players.some(s => s.kind === 'human' && s.peer !== 0 && !s.ready)) { note.textContent = 'Waiting for every player to accept.'; return; }
    note.textContent = '';
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const setup = {
      mode: isLand(st.mapFile) ? 'land' : 'space', type: st.type, preBuilt: st.preBuilt !== false, mapFile: st.mapFile, credits: st.credits, popCap: st.popCap, fog: st.fog, teamFactions: st.teamFactions.slice(), seed,
      spaceWorker: new URLSearchParams(location.search).has('spaceworker'),
      players: players.map(s => s.kind === 'human'
        ? { human: true, peer: s.peer, name: s.name, team: s.team, color: s.color, auto: false }
        : { human: false, team: s.team, difficulty: s.kind, color: s.color, auto: false }),
    };
    net.setListing(null);
    net.broadcast({ k: 'start', setup });
    begin(setup);
  });

  let started = false;
  const begin = setup => {
    if (started) return;
    started = true;
    clearInterval(beat);
    dlg.close();
    audio?.unlock?.();
    launch({ ...setup, net: { session: net, me: net.id } });
  };

  if (host) publish(); else render();
  const beat = host && kind !== 'lan' ? setInterval(listing, 30000) : 0;
  if (host && st.type === 'campaign' && !campaigns.some(c => !c.variants)) addChat('', 'This game data has no multiplayer campaign: its single-player conquests are offered. Players on the host side play in co-op; other sides play without the story.');
  if (host && st.type === 'control') addChat('', 'Land Control plays as a Land battle here: winning by holding the control points is not in this version yet.');
  if (host) {
    const link = inviteLink(net.gameId, kind);
    addChat('', 'Invite link (click to copy, send it to whoever you want to play): ' + link, link);
  }
  return true;
}

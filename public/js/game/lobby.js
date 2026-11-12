import { db, factionColor, autoColors } from '../gamedata.js';
import { openDialog } from './dialogs.js';
import { Menus } from './menus.js';
import { loadMap, mapHeader, mapTitle, loadMapPreview } from '../ted.js';
import { iconUrl } from '../icons.js';
import { PALETTE, ROWS, slotWindow, rowsOf } from './slotrows.js';
import { leaveTo } from '../leaveguard.js';
import { DYNAMIC_SIZES, isDynamic, dynamicSize, resizeDynamic, liveMaps, seedBar, dockSeedBar } from './dynamicmap.js';

const T = (id, fallback) => db.t(id) || fallback;
const POP_MAX = 10000,
  POP_STEP = 50,
  SETUP_KEY = 'swr-skirmish-setup';
const KINDS = ['you', 'closed', 'easy', 'medium', 'hard'];
const MAX_TEAMS = 10;
export const SPECTATOR_TEAM = -1;

const loadSetup = () => {
  try {
    return JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
  } catch {
    return null;
  }
};
const saveSetup = setup => {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
  } catch {}
};

export async function openLobby({
  maps,
  landMaps = [],
  customMaps = { space: [], land: [] },
  factions,
  init,
  start,
  audio,
  cancel = null
}) {
  const dlg = await openDialog('IDD_SKIRMISH_STAGING_DIALOG', { modal: false });
  if (!dlg) return false;
  const saved = loadSetup() || {};
  const dynamic = maps.filter(isDynamic),
    official = { space: maps.filter(m => !isDynamic(m)), land: landMaps };
  const listFor = (custom, mode) =>
    mode === 'space' ? liveMaps([...(custom ? customMaps.space : official.space), ...dynamic]) : (custom ? customMaps : official)[mode];
  const onlyCustom = mode => !official[mode].length && !!customMaps[mode].length;
  const st = {
    preBuilt: typeof saved.preBuilt === 'boolean' ? saved.preBuilt : true,
    mode: 'space',
    custom: onlyCustom('space'),
    mapFile: init.mapFile,
    teamFactions: init.teamFactions.map((f, i) => (factions.includes(saved.teamFactions?.[i]) ? saved.teamFactions[i] : f)),
    credits: Number.isFinite(saved.credits) ? saved.credits : init.credits,
    popCap: Number.isFinite(saved.popCap) ? saved.popCap : init.popCap,
    fog: typeof saved.fog === 'boolean' ? saved.fog : init.fog
  };
  const lastMap = { space: init.mapFile, land: landMaps.find(m => /TATOOINE/i.test(m)) || landMaps[0] };
  const mapsOf = () => listFor(st.custom, st.mode);
  const lastKey = () => (st.custom ? 'custom ' : '') + st.mode;
  if (
    (saved.mode === 'space' || saved.mode === 'land') &&
    listFor(!!saved.custom || onlyCustom(saved.mode), saved.mode).includes(saved.mapFile)
  ) {
    st.mode = saved.mode;
    st.custom = !!saved.custom || onlyCustom(saved.mode);
    lastMap[lastKey()] = saved.mapFile;
  }
  const savedSlots =
    Array.isArray(saved.slots) &&
    saved.slots.filter(s => s?.kind === 'you').length === 1 &&
    saved.slots.every(
      s =>
        KINDS.includes(s?.kind) &&
        Number.isInteger(s.team) &&
        (s.team >= 0 || (s.kind === 'you' && s.team === SPECTATOR_TEAM)) &&
        s.team < MAX_TEAMS
    )
      ? saved.slots
      : null;
  const slots = [];
  for (let i = 0; i < Math.max(rowsOf(dlg) || ROWS, savedSlots?.length ?? init.players.length); i++) {
    const p = init.players[i],
      s = savedSlots?.[i];
    slots.push(
      s
        ? { kind: s.kind, team: s.team, color: typeof s.color === 'string' ? s.color : PALETTE[i % PALETTE.length], auto: s.auto !== false }
        : p && !savedSlots
          ? { kind: p.human ? 'you' : p.difficulty, team: p.team, color: p.color, auto: p.auto !== false }
          : { kind: 'closed', team: i % 2, color: PALETTE[i % PALETTE.length], auto: true }
    );
  }
  for (let t = 0; t < MAX_TEAMS; t++) if (!factions.includes(st.teamFactions[t])) st.teamFactions[t] = factions[t % factions.length];
  const fLabel = f => T(db.faction(f).str('Text_ID'), f);
  const mapName = mapTitle;
  let note = null;
  const playing = s => s.kind !== 'closed' && s.team !== SPECTATOR_TEAM;
  const teamsUsed = () => [...new Set(slots.filter(playing).map(s => s.team))].sort((a, b) => a - b);
  const mapOpts = () => ({ teams: Math.max(2, teamsUsed().length) });
  const viewKey = m => (isDynamic(m) ? `${m}|${mapOpts().teams}` : m);

  dlg.setText('IDC_SCENARIO_DESCRIPTION_TEXT_BOX', '');
  const type = dlg.def.controls.find(c => c.id === 'IDC_GAME_TYPE_LIST'),
    mapList = dlg.def.controls.find(c => c.id === 'IDC_STAGING_MAP_LIST');
  if (type && mapList) {
    const resize = (box, w0, h0, w1, h1) => {
      box.style.width = w1 + 'px';
      box.style.height = h1 + 'px';
      box.style.overflow = 'hidden';
      for (const part of box.children) {
        const x = parseFloat(part.style.left),
          y = parseFloat(part.style.top),
          w = parseFloat(part.style.width),
          h = parseFloat(part.style.height);
        if (x > w0 / 2) part.style.left = x - (w0 - w1) + 'px';
        else if (w > w0 / 2) part.style.width = w - (w0 - w1) + 'px';
        if (y > h0 / 2) part.style.top = y - (h0 - h1) + 'px';
        else if (h > h0 / 2) part.style.height = h - (h0 - h1) + 'px';
      }
    };
    resize(dlg.ctl('IDC_GAME_TYPE_LIST'), type.w, type.h, mapList.w, Math.min(type.h, mapList.y - 4 - type.y));
    for (const id of ['IDC_SELECT_OFFICIAL_MAPS', 'IDC_SELECT_CUSTOM_MAPS']) {
      const c = dlg.def.controls.find(x => x.id === id);
      if (c && c.x + c.w > mapList.x - 8) dlg.ctl(id).style.width = mapList.x - 8 - c.x + 'px';
    }
  }
  const players = { get: m => mapHeader(m)?.players || 0 };
  const mapRows = list =>
    list
      .map(m => ({ key: m, name: mapName(m), label: (players.get(m) ? `(${players.get(m)}) ` : '') + mapName(m) }))
      .sort(
        (a, b) =>
          isDynamic(b.key) - isDynamic(a.key) ||
          (isDynamic(a.key)
            ? DYNAMIC_SIZES.indexOf(dynamicSize(a.key)) - DYNAMIC_SIZES.indexOf(dynamicSize(b.key))
            : a.name.localeCompare(b.name))
      );
  const previews = new Map();
  const starts = new Map();
  const marks = [];
  const markStarts = async () => {
    const m = st.mapFile,
      key = viewKey(m);
    if (!starts.has(key)) {
      starts.set(
        key,
        loadMap(m, mapOpts())
          .then(map => {
            const at = [];
            for (const o of map.objects) {
              const t = /^TEAM_(\d\d)_(SPACE_STATION|BASE_POSITION_MARKER)$/.exec(
                o.role ? `TEAM_${String(o.team).padStart(2, '0')}_${o.role}` : o.type.name.toUpperCase()
              );
              if (t) at[+t[1]] = o.pos;
            }
            return { at, min: map.min, max: map.max };
          })
          .catch(() => null)
      );
    }
    const info = await starts.get(key);
    if (viewKey(st.mapFile) !== key) return;
    for (const e of marks.splice(0)) e.remove();
    if (!info) return;
    const box = dlg.ctl('IDC_IMAGE'),
      W = parseFloat(box.style.width),
      H = parseFloat(box.style.height),
      SIZE = 26;
    const used = teamsUsed();
    info.at.forEach((p, team) => {
      const f = st.teamFactions[isDynamic(m) ? used[team] : team];
      if (!p || !f) return;
      const icon = iconUrl(db.faction(f).str('Multiplayer_Map_Preview_Icon'));
      if (!icon) return;
      const u = (p[0] - info.min[0]) / (info.max[0] - info.min[0]),
        v = 1 - (p[1] - info.min[1]) / (info.max[1] - info.min[1]);
      const e = document.createElement('div');
      e.className = 'dlg-mark';
      e.style.cssText = `position:absolute;left:${u * W - SIZE / 2}px;top:${v * H - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;background:url(${icon}) center / 100% 100% no-repeat`;
      e.title = `${T('TEXT_TEAM', 'Team')} ${team + 1}`;
      box.appendChild(e);
      marks.push(e);
    });
  };
  const preview = async m => {
    const key = viewKey(m);
    seeds.update();
    if (!previews.has(key))
      previews.set(
        key,
        loadMapPreview(m, mapOpts())
          .then(cv => (cv ? cv.toDataURL() : ''))
          .catch(e => (console.warn('map preview', e), ''))
      );
    const url = await previews.get(key);
    if (viewKey(st.mapFile) === key) {
      dlg.setImage('IDC_IMAGE', url);
      markStarts();
    }
  };
  let shown = null;
  const freshPreview = () => {
    if (st.mapFile && shown !== viewKey(st.mapFile)) {
      shown = viewKey(st.mapFile);
      preview(st.mapFile);
    }
  };
  const seeds = seedBar({
    get: () => st.mapFile,
    set: next => {
      st.mapFile = lastMap[lastKey()] = next;
      fillMaps();
    },
    sound: () => audio?.play?.('GUI_Button_Press_2_SFX'),
    compact: true
  });
  dockSeedBar(dlg, seeds);
  const forceDynamic = () => {
    if (st.mode !== 'space' || teamsUsed().length <= 2 || isDynamic(st.mapFile)) return false;
    st.mapFile = lastMap[lastKey()] = mapsOf().find(isDynamic) || resizeDynamic('medium');
    if (note) note.textContent = 'Battles with more than two teams are played on a Dynamic Map.';
    return true;
  };
  const fillMaps = () => {
    if (onlyCustom(st.mode)) st.custom = true;
    dlg.enable('IDC_SELECT_OFFICIAL_MAPS', !!official[st.mode].length);
    const list = mapsOf();
    if (!list.includes(lastMap[lastKey()])) lastMap[lastKey()] = mapRows(list)[0]?.key;
    st.mapFile = lastMap[lastKey()] || null;
    forceDynamic();
    if (!st.mapFile) {
      for (const e of marks.splice(0)) e.remove();
      dlg.setImage('IDC_IMAGE', '');
    }
    dlg
      .list('IDC_STAGING_MAP_LIST', mapRows(list), row => {
        st.mapFile = lastMap[lastKey()] = row.key;
        if (forceDynamic()) {
          queueMicrotask(fillMaps);
          return;
        }
        if (note && !isDynamic(row.key)) note.textContent = '';
        freshPreview();
      })
      .select(st.mapFile);
    shown = null;
    freshPreview();
    const picked = dlg.ctl('IDC_STAGING_MAP_LIST').querySelector('.sel');
    if (picked) picked.scrollIntoView({ block: 'nearest' });
  };
  const kinds = [{ key: 'space', label: T('TEXT_GAME_TYPE_TEAM_SPACE', 'Space') }];
  if (landMaps.length || customMaps.land.length) kinds.push({ key: 'land', label: T('TEXT_GAME_TYPE_TEAM_LAND', 'Land') });
  dlg
    .list('IDC_GAME_TYPE_LIST', kinds, row => {
      if (st.mode !== row.key) {
        st.mode = row.key;
        fillMaps();
        refresh();
      }
    })
    .select(st.mode);
  fillMaps();
  const showCustom = on => {
    if (st.custom !== on) {
      st.custom = on;
      fillMaps();
    }
  };
  dlg.on('IDC_SELECT_OFFICIAL_MAPS', () => showCustom(false));
  dlg.on('IDC_SELECT_CUSTOM_MAPS', () => showCustom(true));

  const who = [
    ['closed', T('TEXT_CLOSED', 'Closed')],
    ['easy', T('TEXT_EASY_AI_PLAYER', 'Easy AI')],
    ['medium', T('TEXT_MEDIUM_AI_PLAYER', 'Medium AI')],
    ['hard', T('TEXT_HARD_AI_PLAYER', 'Hard AI')]
  ];
  const colours = (r, s) => {
    const own = factionColor(st.teamFactions[s.team]);
    const list = [...new Set([own, ...PALETTE].filter(Boolean).map(c => c.toLowerCase()))];
    dlg.combo(
      `IDC_PLAYER_COLOR_${r}`,
      list.map(c => ({ value: c, label: c, color: c })),
      list.includes(String(s.color).toLowerCase()) ? String(s.color).toLowerCase() : list[0],
      v => {
        s.color = v;
        s.auto = false;
      }
    );
  };
  const row = r => {
    const s = slots[win.off + r];
    for (const k of ['NAME', 'FACTION', 'COLOR', 'TEAM']) dlg.show(`IDC_PLAYER_${k}_${r}`, !!s);
    if (!s) return;
    const watching = s.team === SPECTATOR_TEAM;
    const teamOptions = [
      ...(s.kind === 'you' ? [{ value: SPECTATOR_TEAM, label: T('TEXT_SPECTATOR', 'Spectator') }] : []),
      ...[...Array(st.mode === 'space' ? MAX_TEAMS : 2).keys()].map(t => ({ value: t, label: `${T('TEXT_TEAM', 'Team')} ${t + 1}` }))
    ];
    if (s.kind === 'you') dlg.combo(`IDC_PLAYER_NAME_${r}`, [{ value: 'you', label: T('TEXT_PLAYER', 'Player') }], 'you', () => {});
    else
      dlg.combo(
        `IDC_PLAYER_NAME_${r}`,
        who.map(([value, label]) => ({ value, label })),
        s.kind,
        v => {
          s.kind = v;
          refresh();
        }
      );
    if (!watching) {
      dlg.combo(
        `IDC_PLAYER_FACTION_${r}`,
        factions.map(f => ({ value: f, label: fLabel(f) })),
        st.teamFactions[s.team],
        v => {
          st.teamFactions[s.team] = v;
          refresh();
        }
      );
      colours(r, s);
    }
    dlg.combo(`IDC_PLAYER_TEAM_${r}`, teamOptions, s.team, v => {
      s.team = +v;
      refresh();
    });
    const open = s.kind !== 'closed';
    dlg.enable(`IDC_PLAYER_NAME_${r}`, true);
    for (const k of ['FACTION', 'COLOR', 'TEAM']) dlg.enable(`IDC_PLAYER_${k}_${r}`, open);
    for (const k of ['FACTION', 'COLOR']) dlg.show(`IDC_PLAYER_${k}_${r}`, !watching);
  };
  const rows = () => {
    for (let r = 0; r < win.rows; r++) row(r);
  };
  const refresh = () => {
    if (st.mode !== 'space') for (const s of slots) if (s.team !== SPECTATOR_TEAM) s.team = Math.max(0, Math.min(1, s.team));
    autoColors(
      slots.filter(playing),
      st.teamFactions,
      PALETTE
    );
    rows();
    win.update();
    if (forceDynamic()) fillMaps();
    else if (isDynamic(st.mapFile)) freshPreview();
    markStarts();
  };
  const win = slotWindow(dlg, {
    count: () => slots.length,
    draw: rows,
    like: 'IDC_SELECT_OPTIONS',
    add: () => {
      const i = slots.length;
      slots.push({ kind: 'closed', team: i % 2, color: PALETTE[i % PALETTE.length], auto: true });
      refresh();
    }
  });
  refresh();

  const menus = new Menus({
    over: true,
    paused: false,
    audio,
    message: text => {
      note.textContent = text;
    }
  });
  note = document.createElement('div');
  note.className = 'dlg-txt';
  note.style.cssText = 'position:absolute;left:230px;top:362px;width:480px;text-align:center;color:#ff6a5a;font-size:11px';
  dlg.el.appendChild(note);
  const startBtn = dlg.def.controls.find(c => c.id === 'IDC_SKIRMISH_START_GAME_BUTTON'),
    opt = dlg.def.controls.find(c => c.id === 'IDC_SELECT_OPTIONS');
  menus.extra(
    dlg,
    'IDC_SELECT_OPTIONS',
    T('TEXT_BUTTON_LOAD_GAME', 'Load Game'),
    opt.x + opt.w + 12,
    opt.y,
    startBtn.x - opt.x - opt.w - 24,
    () => menus.load()
  );

  const remember = () =>
    saveSetup({
      mode: st.mode,
      custom: st.custom,
      mapFile: st.mapFile,
      preBuilt: st.preBuilt,
      credits: st.credits,
      popCap: st.popCap,
      fog: st.fog,
      teamFactions: st.teamFactions,
      slots: slots.map(({ kind, team, color, auto }) => ({ kind, team, color, auto }))
    });
  dlg.on('IDC_SELECT_OPTIONS', async () => {
    if (await advancedOptions(st)) remember();
  });
  dlg.on('IDC_CANCEL_BUTTON', () => {
    remember();
    if (cancel) {
      dlg.close();
      cancel();
    } else leaveTo('./');
  });
  dlg.on('IDC_SKIRMISH_START_GAME_BUTTON', () => {
    const spectate = slots.some(s => s.kind === 'you' && s.team === SPECTATOR_TEAM);
    const players = slots
      .filter(playing)
      .map(s =>
        s.kind === 'you'
          ? { human: true, team: s.team, color: s.color, auto: false }
          : { human: false, team: s.team, difficulty: s.kind, color: s.color, auto: false }
      );
    const used = [...new Set(players.map(p => p.team))].sort((a, b) => a - b);
    if (used.length < 2) {
      note.textContent = 'At least two teams need a player.';
      return;
    }
    if (forceDynamic()) {
      fillMaps();
      return;
    }
    if (!st.mapFile) return;
    for (const p of players) p.team = used.indexOf(p.team);
    remember();
    dlg.close();
    start({
      mode: st.mode,
      preBuilt: st.preBuilt,
      mapFile: st.mapFile,
      credits: st.credits,
      popCap: st.popCap,
      fog: st.fog,
      teamFactions: used.map(t => st.teamFactions[t]),
      players,
      ...(spectate ? { spectate: true } : {})
    });
  });
  return true;
}

export async function advancedOptions(st) {
  const dlg = await openDialog('IDD_INTERNET_STAGING_DIALOG_ADVANCED_SKIRMISH_OPTIONS');
  if (!dlg) return;
  const was = { ...st };
  const LO = 2000,
    HI = 15000,
    toV = c => (c - LO) / (HI - LO),
    toC = v => Math.round((LO + v * (HI - LO)) / 500) * 500;
  const show = () => {
    dlg.slider('IDC_SKIRMISH_CREDITS_SLIDER', toV(st.credits), v => {
      st.credits = toC(v);
      dlg.setText('IDC_SKIRMISH_CREDITS_VALUE', st.credits.toLocaleString());
    });
    dlg.setText('IDC_SKIRMISH_CREDITS_VALUE', st.credits.toLocaleString());
    fog.classList.toggle('on', !!st.fog);
    dlg.slider(
      'IDC_POP_CAP_SLIDER',
      Math.min(POP_MAX, st.popCap) / POP_MAX,
      v => {
        st.popCap = Math.round((v * POP_MAX) / POP_STEP) * POP_STEP;
        popText();
      },
      POP_MAX / POP_STEP + 1
    );
    popText();
  };
  for (const id of ['IDC_ALLOW_HEROES', 'IDC_ALLOW_STARTING_UNIT_PURCHASE', 'IDC_ALLOW_SUPER_WEAPONS']) dlg.enable(id, false);
  dlg.check('IDC_PRE_BUILT_BASE', st.preBuilt, v => {
    st.preBuilt = v;
  });
  dlg.check('IDC_ALLOW_HEROES', true, () => {});
  dlg.setText('IDC_WIN_CONDITION_TEXT', T('TEXT_POP_CAP', 'Unit Max'));
  const box = id => {
    const s = dlg.ctl(id)?.style;
    return s && { x: parseFloat(s.left), y: parseFloat(s.top), h: parseFloat(s.height) };
  };
  const combo = box('IDC_WIN_CONDITION_COMBO'),
    credits = box('IDC_SKIRMISH_CREDITS_SLIDER'),
    creditsText = box('IDC_SKIRMISH_CREDITS_VALUE');
  if (combo && credits && creditsText) {
    const y = combo.y + (combo.h - credits.h) / 2;
    dlg.show('IDC_WIN_CONDITION_COMBO', false);
    dlg.clone('IDC_SKIRMISH_CREDITS_SLIDER', 'IDC_POP_CAP_SLIDER', combo.x, y);
    dlg.clone('IDC_SKIRMISH_CREDITS_VALUE', 'IDC_POP_CAP_VALUE', creditsText.x, y + creditsText.y - credits.y);
  }
  const popText = () => dlg.setText('IDC_POP_CAP_VALUE', st.popCap ? st.popCap.toLocaleString() : T('TEXT_DEFAULT', 'Default'));
  const like = dlg.def.controls.find(c => c.id === 'IDC_ALLOW_HEROES');
  const fog = dlg.ctl('IDC_ALLOW_HEROES').cloneNode(true);
  fog.classList.remove('off', 'on');
  fog.style.left = like.x + 300 + 'px';
  fog.style.width = '220px';
  fog.lastChild.textContent = 'Fog of War';
  fog.onclick = () => {
    st.fog = !st.fog;
    fog.classList.toggle('on', st.fog);
  };
  dlg.el.appendChild(fog);
  const gun = fog.cloneNode(true);
  gun.style.top = parseFloat(fog.style.top || like.y) + 30 + 'px';
  gun.lastChild.textContent = 'Shooter mode (land)';
  gun.classList.toggle('on', !!st.shooter);
  gun.onclick = () => {
    st.shooter = !st.shooter;
    gun.classList.toggle('on', st.shooter);
  };
  dlg.el.appendChild(gun);
  show();
  return new Promise(done => {
    dlg.on('IDC_BUTTON_ACCEPT', () => {
      dlg.close();
      done(true);
    });
    dlg.on('IDC_CANCEL_BUTTON', () => {
      Object.assign(st, was);
      dlg.close();
      done(false);
    });
    dlg.on('IDC_DEFAULTS_BUTTON', () => {
      st.credits = 6000;
      st.popCap = 0;
      st.fog = true;
      st.shooter = false;
      gun.classList.toggle('on', false);
      show();
    });
  });
}

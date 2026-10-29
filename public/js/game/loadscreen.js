import { db } from '../gamedata.js';
import { iconUrl, iconCanvasRect } from '../icons.js';
import { loadTextureCanvas, canvasUrl } from '../dds.js';
import { openDialog } from './dialogs.js';

let active = null;

export const activeLoadScreen = () => active;

const pictures = new Map();
function textureUrl(name) {
  if (!name || /^none$/i.test(name)) return Promise.resolve(null);
  if (iconCanvasRect(name)) return Promise.resolve(iconUrl(name));
  const key = name.toUpperCase();
  if (!pictures.has(key))
    pictures.set(
      key,
      loadTextureCanvas(name)
        .catch(() => null)
        .then(cv => (cv ? canvasUrl(cv) : null))
    );
  return pictures.get(key);
}

export async function showLoadScreen({ setup, map, land, staged = false }) {
  const skirmish = !setup.campaign;
  const id = skirmish ? 'IDD_SKIRMISH_BATTLE_LOAD_DIALOG' : land ? 'IDD_LAND_BATTLE_LOAD_DIALOG' : 'IDD_SPACE_BATTLE_LOAD_DIALOG';
  const dlg = await openDialog(id, { modal: true, nativeImages: true, nativeFonts: true, nativeLists: true }).catch(() => null);
  if (!dlg) return null;
  dlg.veil.style.background = '#000';
  active = { dlg, staged };
  const planet = db.type(setup.campaign?.planetType || map.planet) || (skirmish ? db.type('ALDERAAN') : null) || null,
    str = k => (planet ? planet.str(k) : '');
  const text = k => {
    const key = str(k);
    return key ? db.t(key) || key : '';
  };
  dlg.show('IDC_DIALOG_CLOSE_BUTTON', false);
  if (skirmish)
    for (const c of ['IDC_CONTROLLING_FACTION_TEXT', 'IDC_CREDIT_PRODUCTION_TEXT', 'IDC_STATIC_FACTION', 'IDC_STATIC_CREDIT'])
      dlg.show(c, false);

  const picture = (cid, name) => {
    dlg.imageFrame(cid, false);
    textureUrl(name).then(url => {
      if (url && active?.dlg === dlg) dlg.setImage(cid, url);
    });
  };
  const weather = str('Encyclopedia_Weather_Icon');
  picture('IDC_WEATHER_ICON', /i_pa/i.test(weather) ? 'load' + weather.slice(4) : weather);
  dlg.show('IDC_MAP_ICON', false);
  const mapName = (setup.mapFile || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.ted$/i, '');
  textureUrl(mapName + '.dds').then(url => {
    if (url && active?.dlg === dlg) {
      dlg.setImage('IDC_MAP_ICON', url);
      dlg.show('IDC_MAP_ICON', true);
    }
  });
  picture('IDC_NATIVE_ICON', str('Native_Icon_Name'));
  picture('IDC_PLANET_OVERLAY', 'load_overlay.tga');

  const held = setup.campaign?.galaxy?.planets?.[setup.campaign.planet]?.owner,
    owner = held ? db.faction(held) : null,
    rgb = owner && owner.str('Color');
  const colour = rgb
    ? `rgb(${rgb
        .split(/[\s,]+/)
        .slice(0, 3)
        .join(',')})`
    : null;
  const name = planet ? db.t(planet.str('Text_ID')) || planet.name : db.t(map.textId) || map.planet || '';
  dlg.setText('IDC_STATIC_PLANET_NAME', `${db.t(land ? 'TEXT_PREPARE_FOR_LAND_BATTLE' : 'TEXT_PREPARE_FOR_SPACE_BATTLE')} ${name}`, colour);
  if (owner) dlg.setText('IDC_STATIC_FACTION', db.t(owner.str('Text_ID')) || owner.name, colour);
  if (!skirmish) dlg.setText('IDC_STATIC_CREDIT', planet ? String(Math.round(planet.num('Planet_Credit_Value', 0))).padStart(4) : '0');
  dlg.setText('IDC_STATIC_NATIVE', text('Describe_Population'));
  dlg.setText('IDC_STATIC_WILDLIFE', text('Describe_Wildlife'));
  dlg.setText('IDC_STATIC_TERRAIN', text('Describe_Terrain'));
  dlg.setText('IDC_STATIC_WEATHER', text('Describe_Weather'));
  if (!skirmish) {
    dlg.textList('IDC_LIST_TACTICAL', text('Describe_Tactical'), 'rgb(50,200,255)');
    dlg.textList('IDC_LIST_ADVANTAGE', text('Describe_Advantage'));
  }
  dlg.textList('IDC_LIST_REFERENCE', text('Describe_History'));

  if (setup.net) active.rows = playerRows(dlg, setup);
  else
    for (let i = 0; dlg.ctl('IDC_PLAYER_NAME_' + i); i++) {
      dlg.show('IDC_PLAYER_NAME_' + i, false);
      dlg.show('IDC_PROGRESS' + i, false);
    }
  dlg.show('IDC_PROGRESS_SOLO', !setup.net);
  dlg.progress('IDC_PROGRESS_SOLO', 0);
  dlg.show('IDC_BEGIN_BUTTON', false);
  return dlg;
}

export function loadProgress(frac) {
  if (!active) return;
  active.dlg.progress('IDC_PROGRESS_SOLO', frac);
  active.rows?.mine(frac);
}

function playerRows(dlg, setup) {
  const { session, me } = setup.net;
  const players = setup.players.map((p, i) => ({ p, i })).filter(({ p }) => p.human);
  const playerOf = new Map(players.flatMap(({ p, i }) => (p.peers || [p.peer]).filter(x => x !== undefined).map(peer => [peer, i])));
  const shares = new Map();
  const share = i => {
    const m = shares.get(i);
    return m && m.size ? Math.min(...m.values()) : 0;
  };
  let rows = 0;
  while (dlg.ctl('IDC_PLAYER_NAME_' + rows)) rows++;
  let off = 0;
  const max = () => Math.max(0, players.length - rows);
  const bars = () => {
    for (let r = 0; r < rows && off + r < players.length; r++) dlg.progress('IDC_PROGRESS' + r, share(players[off + r].i));
  };
  const draw = () => {
    for (let r = 0; r < rows; r++) {
      const e = players[off + r];
      dlg.show('IDC_PLAYER_NAME_' + r, !!e);
      dlg.show('IDC_PROGRESS' + r, !!e);
      if (e) dlg.setText('IDC_PLAYER_NAME_' + r, e.p.name || '');
    }
    bars();
    if (up) {
      up.classList.toggle('off', off <= 0);
      down.classList.toggle('off', off >= max());
      label.textContent = `Players ${off + 1}-${off + rows} of ${players.length}`;
    }
  };
  const go = n => {
    n = Math.max(0, Math.min(max(), n));
    if (n !== off) {
      off = n;
      draw();
    }
  };

  let up = null,
    down = null,
    label = null;
  const box = id => {
    const e = dlg.ctl(id);
    return e && { x: parseFloat(e.style.left), y: parseFloat(e.style.top), w: parseFloat(e.style.width), h: parseFloat(e.style.height) };
  };
  const all = [...Array(rows)].flatMap((_, r) => [box('IDC_PLAYER_NAME_' + r), box('IDC_PROGRESS' + r)]).filter(Boolean),
    like = dlg.ctl('IDC_BEGIN_BUTTON');
  if (all.length && max() > 0 && like) {
    const x0 = Math.min(...all.map(b => b.x)),
      x1 = Math.max(...all.map(b => b.x + b.w));
    const y0 = Math.min(...all.map(b => b.y)),
      y1 = Math.max(...all.map(b => b.y + b.h));
    const button = (text, y, fn) => {
      const b = like.cloneNode(true);
      b.removeAttribute('data-id');
      b.hidden = false;
      b.classList.remove('off');
      b.style.left = x1 + 6 + 'px';
      b.style.top = y + 'px';
      b.style.width = '28px';
      b.style.height = '22px';
      b.firstChild.textContent = text;
      b.onclick = ev => {
        ev.stopPropagation();
        fn();
      };
      dlg.el.appendChild(b);
      return b;
    };
    up = button('▲', y0, () => go(off - 1));
    down = button('▼', y1 - 22, () => go(off + 1));
    label = document.createElement('div');
    label.className = 'dlg-txt';
    label.style.cssText = `position:absolute;left:${x1 - 160}px;top:${y1 + 2}px;width:160px;text-align:right;font-size:11px;color:#c8b46a`;
    dlg.el.appendChild(label);
    dlg.el.addEventListener(
      'wheel',
      ev => {
        const r = dlg.el.getBoundingClientRect(),
          k = r.width / dlg.el.offsetWidth;
        const x = (ev.clientX - r.left) / k,
          y = (ev.clientY - r.top) / k;
        if (x < x0 || x > x1 || y < y0 || y > y1) return;
        ev.preventDefault();
        go(off + Math.sign(ev.deltaY));
      },
      { passive: false }
    );
  }
  draw();

  const set = (peer, f) => {
    const i = playerOf.get(peer);
    if (i === undefined || !Number.isFinite(f)) return;
    if (!shares.has(i)) shares.set(i, new Map());
    shares.get(i).set(peer, Math.max(0, Math.min(1, f)));
    bars();
  };
  const unhook = session.on('message', (from, m) => {
    if (m?.k !== 'loadp') return;
    if (session.host) {
      set(from, m.f);
      session.broadcast({ k: 'loadp', p: from, f: m.f }, from);
    } else if (from === 0) set(m.p, m.f);
  });
  let said = -1;
  return {
    mine(f) {
      set(me, f);
      const step = Math.floor(f * 50);
      if (step === said) return;
      said = step;
      if (session.host) session.broadcast({ k: 'loadp', p: me, f });
      else session.send(0, { k: 'loadp', f });
    },
    close() {
      unhook();
    }
  };
}

export async function endLoadScreen({ direct = false, hold = () => {}, unlock = () => {} } = {}) {
  const screen = active;
  if (!screen) return;
  const { dlg } = screen;
  dlg.progress('IDC_PROGRESS_SOLO', 1);
  screen.rows?.mine(1);
  screen.rows?.close();
  if (!direct) {
    dlg.show('IDC_BEGIN_BUTTON', true);
    window.game?.audio?.play?.('GUI_Text_Hint_SFX');
    hold(true);
    await new Promise(done => {
      const key = e => {
        if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
          e.stopPropagation();
          finish();
        }
      };
      const finish = () => {
        removeEventListener('keydown', key, true);
        done();
      };
      dlg.on('IDC_BEGIN_BUTTON', finish);
      addEventListener('keydown', key, true);
    });
    unlock();
    hold(false);
  }
  if (active === screen) active = null;
  dlg.close();
}

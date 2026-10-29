import { inApp } from './platform.js';
import { BUILD } from './build.js';

export const FEED = 'https://downloads.playeaw.com/latest.json';
export const DOWNLOAD = 'https://downloads.playeaw.com/EmpireAtWarBrowserEdition-setup.exe';
const SKIP = 'swr-update-skip';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const mb = n => (n / 1048576).toFixed(1) + ' MB';
const skipped = () => {
  try {
    return localStorage.getItem(SKIP) || '';
  } catch {
    return '';
  }
};

function strip({ badge, what, state, note = '', notes = '', acts = [] }) {
  $('desktop').classList.remove('hidden');
  $('deskBadge').textContent = badge;
  $('deskWhat').textContent = what;
  $('deskState').textContent = state;
  $('deskNote').textContent = note;
  $('deskNotes').textContent = notes;
  $('deskNotes').classList.toggle('hidden', !notes);
  $('deskActs').replaceChildren(...acts);
}
const hide = () => $('desktop').classList.add('hidden');

export function desktopStrip() {
  return inApp() ? inTheApp() : onTheSite();
}

async function onTheSite() {
  const get = el('a', 'launch', 'Download for Windows');
  get.href = DOWNLOAD;
  get.setAttribute('download', '');
  const say = note =>
    strip({
      badge: 'Desktop',
      what: 'Empire at War Browser Edition for Windows',
      state: 'Finds your game and mods by itself, and keeps itself up to date.',
      note,
      acts: [get]
    });
  say('Windows 10 and 11');
  try {
    const r = await fetch(FEED, { cache: 'no-store' });
    if (!r.ok) return;
    const f = await r.json();
    say(`Version ${f.version}${f.size ? ' · ' + mb(f.size) : ''} · Windows 10 and 11`);
  } catch {}
}

async function inTheApp() {
  const info = await fetch('api/app')
    .then(r => r.json())
    .catch(() => null);
  const line = $('appVersion');
  if (info) {
    line.classList.remove('hidden');
    const check = el('button', 'ask', 'Check for updates');
    line.replaceChildren(`Desktop app ${info.version} · build ${BUILD} `, check);
    check.onclick = () => look(true);
  }
  await look(false);
}

async function look(asked) {
  if (asked) strip({ badge: 'Update', what: 'Checking for updates', state: 'Asking downloads.playeaw.com…' });
  const u = await fetch('api/update/check')
    .then(r => r.json())
    .catch(e => ({ error: e.message }));
  if (!u || !u.available) {
    if (asked)
      strip({
        badge: 'Update',
        what: u && u.error ? 'Could not check for updates' : 'Up to date',
        state: u && u.error ? u.error : `Version ${u.current} is the newest.`,
        acts: [button('OK', hide)]
      });
    return;
  }
  if (!asked && u.version === skipped()) return;
  strip({
    badge: 'Update',
    what: 'An update is ready',
    state: `Version ${u.version} is out - you have ${u.current}. Install it now, or go on with this one.`,
    note: u.date ? 'Released ' + new Date(u.date.replace(/ \+00:00:00$/, 'Z')).toLocaleDateString() : '',
    notes: u.notes || '',
    acts: [
      button('Install and restart', install),
      button('Not now', hide, '', 'Asked again the next time the app starts'),
      button(
        'Skip this version',
        () => {
          try {
            localStorage.setItem(SKIP, u.version);
          } catch {}
          hide();
        },
        '',
        `Version ${u.version} is not offered again; a newer one will be`
      )
    ]
  });
}

function button(text, onclick, cls = '', title = '') {
  const b = el('button', cls, text);
  b.onclick = onclick;
  if (title) b.title = title;
  return b;
}

async function install() {
  const r = await fetch('api/update/install');
  if (!r.ok) {
    strip({ badge: 'Update', what: 'The update could not start', state: await r.text(), acts: [button('OK', hide)] });
    return;
  }
  for (;;) {
    const p = await fetch('api/update/progress')
      .then(r => r.json())
      .catch(() => null);
    if (!p) return;
    if (p.state.startsWith('failed')) {
      strip({
        badge: 'Update',
        what: 'The update failed',
        state: p.state.slice(8) || p.state,
        note: 'Nothing was changed: this version goes on as it was.',
        acts: [button('OK', hide)]
      });
      return;
    }
    const pct = p.total ? ` ${Math.floor((p.got / p.total) * 100)}%` : p.got ? ' ' + mb(p.got) : '';
    strip({
      badge: 'Update',
      what: p.state === 'installing' ? 'Installing' : 'Downloading the update',
      state: p.state === 'installing' ? 'The app closes, installs the new version and starts again by itself.' : `Downloading${pct}…`
    });
    await new Promise(res => setTimeout(res, 300));
  }
}

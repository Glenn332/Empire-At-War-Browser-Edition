import { inApp } from './platform.js';
import { BUILD } from './build.js';

const REPO = 'Glenn332/Empire-At-War-Browser-Edition';
const ASSET = 'EmpireAtWarBrowserEdition-setup.exe';
export const FEED = `https://api.github.com/repos/${REPO}/releases/latest`;
const downloadOf = asset => `https://github.com/${REPO}/releases/latest/download/${asset}`;
// the build offered on the site: the visitor's own system when the latest release has it, else Windows
const DESKTOP_STATE = 'Finds your game and mods by itself, and keeps itself up to date.';
const BUILDS = {
  windows: { asset: ASSET, name: 'Windows', badge: 'Desktop', needs: 'Windows 10 and 11', state: DESKTOP_STATE },
  macos: {
    asset: 'EmpireAtWarBrowserEdition-macos.dmg',
    name: 'macOS',
    badge: 'Desktop',
    needs: 'macOS 11 or newer, Apple silicon and Intel',
    state: DESKTOP_STATE
  },
  linux: {
    asset: 'EmpireAtWarBrowserEdition-linux-x86_64.AppImage',
    name: 'Linux',
    badge: 'Desktop',
    needs: 'Linux x86-64 AppImage',
    state: DESKTOP_STATE
  },
  android: {
    asset: 'EmpireAtWarBrowserEdition-android-arm64.apk',
    name: 'Android',
    badge: 'Android',
    needs: '64-bit Android phones and tablets',
    state: 'Make sure you get the game files onto your device.'
  }
};
const visitorSystem = () => {
  const agent = navigator.userAgent;
  if (/Android/.test(agent)) return 'android';
  if (/Windows/.test(agent) || /iPhone|iPad/.test(agent)) return 'windows';
  if (/Macintosh|Mac OS X/.test(agent)) return 'macos';
  if (/Linux|X11/.test(agent)) return 'linux';
  return 'windows';
};
let latestRelease = null;
const fetchLatestRelease = () =>
  (latestRelease ||= fetch(FEED, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } })
    .then(response => (response.ok ? response.json() : null))
    .catch(() => null));

/** The build for this visitor's system when the latest release has it, else Windows; with that release. */
async function offeredBuild() {
  const release = await fetchLatestRelease();
  const own = BUILDS[visitorSystem()];
  const build = release?.assets?.some(asset => asset.name === own.asset) ? own : BUILDS.windows;
  return { build, release };
}

/** Where the app download for this visitor's system is (the Windows installer when there is none). */
export async function ownDownload() {
  const { build } = await offeredBuild();
  return downloadOf(build.asset);
}

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
  const get = el('a', 'launch');
  get.setAttribute('download', '');
  const say = (build, note) => {
    get.textContent = `Download for ${build.name}`;
    get.href = downloadOf(build.asset);
    strip({ badge: build.badge, what: `Empire at War Browser Edition for ${build.name}`, state: build.state, note, acts: [get] });
  };
  say(BUILDS.windows, BUILDS.windows.needs);
  const { build, release } = await offeredBuild();
  if (!release) return;
  const file = release.assets?.find(asset => asset.name === build.asset);
  say(build, `Version ${release.tag_name.replace(/^v/, '')}${file?.size ? ' · ' + mb(file.size) : ''} · ${build.needs}`);
}

async function inTheApp() {
  const info = await fetch('api/app')
    .then(r => r.json())
    .catch(() => null);
  const line = $('appVersion');
  if (info) {
    line.classList.remove('hidden');
    const check = el('button', 'ask', 'Check for updates');
    check.onclick = () => look(true);
    const channel = await fetch('api/channel')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
    const nightly = channel?.channel === 'nightly';
    line.replaceChildren(`Desktop app ${info.version} · ${nightly ? 'nightly' : 'stable'} build ${BUILD} `, check);
    if (channel) channelSwitch(nightly, channel.site);
  }
  await look(false);
}

function channelSwitch(nightly, site) {
  const box = $('channel');
  if (!box) return;
  const option = (name, on, title, onclick) => {
    const b = button(name, on ? () => {} : onclick, on ? 'on' : '', title);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    return b;
  };
  $('channelOptions').replaceChildren(
    option('Stable', !nightly, 'The files this version of the app shipped with', () => switchChannel('stable')),
    option('Nightly', nightly, 'The newest test build from ' + site.replace(/^https?:\/\//, ''), () => offerNightly(site))
  );
  box.classList.remove('hidden');
}

function offerNightly(site) {
  strip({
    badge: 'Nightly',
    what: 'Run the nightly build',
    state: `The app loads the newest test build from ${site.replace(/^https?:\/\//, '')} instead of the files it shipped with. It has the latest changes and can be broken; multiplayer finds nightly players only.`,
    note: 'Files are downloaded as they are used and kept for offline play. Switch back here at any time.',
    acts: [button('Use nightly', () => switchChannel('nightly')), button('Cancel', hide)]
  });
}

async function switchChannel(channel) {
  strip({
    badge: channel === 'nightly' ? 'Nightly' : 'Stable',
    what: 'Switching',
    state: channel === 'nightly' ? 'Checking the nightly build…' : 'Going back to the shipped files…'
  });
  const r = await fetch('api/channel?set=' + channel, { method: 'POST', headers: { 'x-swr': '1' } }).catch(e => ({ ok: false, text: async () => e.message }));
  if (!r.ok) {
    strip({ badge: 'Nightly', what: 'Could not switch', state: await r.text(), acts: [button('OK', hide)] });
    return;
  }
  location.reload();
}

async function look(asked) {
  if (asked) strip({ badge: 'Update', what: 'Checking for updates', state: 'Asking GitHub…' });
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
  const r = await fetch('api/update/install', { method: 'POST', headers: { 'X-SWR': '1' } });
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

import { inApp, topFrame } from './platform.js';
import { lobbyUrl } from './net.js';
import { ownDownload } from './appupdate.js';

const CODE = /^[A-Za-z0-9_-]{6,32}$/;
const ASKED = 'swr-invite-asked';
const $ = id => document.getElementById(id);

const onWindowsDesktop = () => {
  const platform = navigator.userAgentData?.platform || navigator.userAgent;
  return /Windows/i.test(platform) && !/Mobile|Xbox/i.test(navigator.userAgent);
};

export function appLink(code, kind) {
  return `playeaw://join/${code}?lobby=${encodeURIComponent(lobbyUrl())}${kind === 'lan' ? '&kind=lan' : ''}`;
}

function choice(text, primary, onclick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'invite-choice' + (primary ? ' main' : '');
  button.textContent = text;
  button.onclick = onclick;
  return button;
}

/** An invite link opened in a browser on Windows asks once whether to open the game in the
 *  desktop app or go on in the browser. Resolves when the game should go on loading here. */
export function offerDesktopApp(params) {
  const code = params.get('join');
  if (inApp() || !topFrame() || !params.has('multiplayer') || !CODE.test(code || '') || !onWindowsDesktop()) return Promise.resolve();
  try {
    if (sessionStorage.getItem(ASKED) === code) return Promise.resolve();
    sessionStorage.setItem(ASKED, code);
  } catch {}
  const kind = params.get('multiplayer') === 'lan' ? 'lan' : 'internet';
  $('splash')?.classList.add('hidden');
  $('loading')?.classList.remove('hidden');
  const text = $('loadText');
  const row = document.createElement('div');
  row.className = 'invite-choices';
  text.after(row);
  const bar = $('loadBar')?.parentElement;
  bar?.classList.add('hidden');
  return new Promise(done => {
    const inBrowser = () => {
      row.remove();
      bar?.classList.remove('hidden');
      text.textContent = 'Starting…';
      done();
    };
    const ask = () => {
      text.textContent = 'You were invited to a multiplayer game. Join it in the desktop app, or play here in the browser?';
      row.replaceChildren(choice('Open in the desktop app', true, openApp), choice('Play in the browser', false, inBrowser));
    };
    const openApp = () => {
      location.href = appLink(code, kind);
      text.textContent =
        'Opening the desktop app… Allow your browser to open Empire at War Browser Edition. If nothing opened, the app is not installed.';
      const download = choice('Download the app', false, async () => (location.href = await ownDownload()));
      row.replaceChildren(choice('Try again', true, openApp), choice('Play in the browser', false, inBrowser), download);
    };
    ask();
  });
}

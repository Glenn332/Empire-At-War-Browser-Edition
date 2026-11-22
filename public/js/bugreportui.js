import { requestTabCapture, saveBugReport } from './bugreport.js';

export const BUG_REPORT_HOTKEY = 'Ctrl+Shift+B';
const BUTTON_LABEL = 'Report a bug';
const TOAST_MS = 15000;

const openMenus = new Set();
let button = null;
let toast = null;
let toastTimer = 0;
let busy = false;

function inGame() {
  const game = window.game;
  return !!game && !game.setup?.attract && !!(game.world || game.galactic || game.landBattle);
}

function ensureButton() {
  if (button) return button;
  button = document.createElement('button');
  button.type = 'button';
  button.className = 'bug-report-button';
  button.textContent = BUTTON_LABEL;
  button.title = `Save a bug report zip (${BUG_REPORT_HOTKEY})`;
  button.hidden = true;
  button.addEventListener('click', event => {
    event.stopPropagation();
    runBugReport();
  });
  document.body.appendChild(button);
  return button;
}

function showToast(text, kind = 'good') {
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'bug-report-toast';
    toast.addEventListener('click', () => (toast.hidden = true));
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.dataset.kind = kind;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), TOAST_MS);
}

function refreshButton() {
  const shown = openMenus.size > 0 || busy;
  if (!shown && !button) return;
  const element = ensureButton();
  element.hidden = !shown;
  element.disabled = busy;
  element.textContent = busy ? 'Collecting...' : BUTTON_LABEL;
}

export function setMenuOpen(owner, open) {
  if (open) openMenus.add(owner);
  else openMenus.delete(owner);
  refreshButton();
}

function elementsToHide() {
  const hidden = [button, toast];
  if (inGame()) hidden.push(...document.querySelectorAll('.dlg-veil'));
  return hidden;
}

export async function runBugReport() {
  if (busy) return;
  busy = true;
  const tabCapture = await requestTabCapture();
  refreshButton();
  if (toast) toast.hidden = true;
  try {
    const result = await saveBugReport({ game: window.game, hideDuringCapture: elementsToHide(), tabCapture });
    if (result.saved) {
      const where = result.where ? `Bug report saved to ${result.where}.` : `Bug report ${result.name} saved to your downloads.`;
      showToast(`${where} Attach it${result.picture ? '' : ' and a screenshot'} to your bug post.`);
    }
  } catch (error) {
    console.error('[bug report]', error);
    showToast(`The bug report could not be saved: ${error.message || error}`, 'bad');
  } finally {
    busy = false;
    refreshButton();
  }
}

function isHotkey(event) {
  return event.code === 'KeyB' && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
}

if (typeof window !== 'undefined' && !window.bugReportHotkey) {
  window.bugReportHotkey = true;
  addEventListener(
    'keydown',
    event => {
      if (!isHotkey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) runBugReport();
    },
    true
  );
}

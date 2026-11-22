import { requestTabCapture, saveBugReport } from './bugreport.js';
import { startPerfSampler } from './perfsampler.js';
import { addCommand, toggleConsole } from './aidebug.js';

export const BUG_REPORT_HOTKEY = 'Ctrl+Shift+B';
const TOAST_MS = 15000;

let toast = null;
let toastTimer = 0;
let busy = false;

function inGame() {
  const game = window.game;
  return !!game && !game.setup?.attract && !!(game.world || game.galactic || game.landBattle);
}

function showToast(text, kind = 'good', stays = false) {
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
  if (!stays) toastTimer = setTimeout(() => (toast.hidden = true), TOAST_MS);
}

function elementsToHide() {
  const hidden = [toast];
  if (inGame()) hidden.push(...document.querySelectorAll('.dlg-veil'));
  return hidden;
}

export async function runBugReport() {
  if (busy) return;
  busy = true;
  const tabCapture = await requestTabCapture();
  showToast('Collecting a bug report...', 'busy', true);
  try {
    const result = await saveBugReport({ game: window.game, hideDuringCapture: elementsToHide(), tabCapture });
    if (result.saved) {
      const where = result.where ? `Bug report saved to ${result.where}.` : `Bug report ${result.name} saved to your downloads.`;
      showToast(`${where} Attach it${result.picture ? '' : ' and a screenshot'} to your bug post.`);
    } else toast.hidden = true;
  } catch (error) {
    console.error('[bug report]', error);
    showToast(`The bug report could not be saved: ${error.message || error}`, 'bad');
  } finally {
    busy = false;
  }
}

function isHotkey(event) {
  return event.code === 'KeyB' && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
}

if (typeof window !== 'undefined' && !window.bugReportHotkey) {
  window.bugReportHotkey = true;
  startPerfSampler();
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

addCommand('bugreport', '', `saves a bug report zip (screenshot, logs, game state, save, replay, performance) to attach to a bug post; ${BUG_REPORT_HOTKEY} does the same`, (args, print) => {
  print('collecting a bug report, the message in the bottom-left corner says where it was saved');
  toggleConsole(false);
  runBugReport();
});

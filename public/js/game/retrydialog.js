import { db } from '../gamedata.js';
import { openDialog } from './dialogs.js';
import { stageStart, toMainMenu } from './transit.js';

const T = (id, fallback) => {
  const t = db.t(id);
  return t && t !== id ? t : fallback;
};

export async function openRetryDialog(game) {
  if (game.retryDialog) return;
  game.retryDialog = true;
  game.tacticalCinematics?.stop?.();
  game.cine?.stop?.();
  const dlg = await openDialog('IDD_RETRY_DIALOG', { nativeImages: true, nativeFonts: true, nativeLists: true }).catch(() => null);
  const done = () => {
    dlg?.close();
    game.retryDialog = false;
  };
  if (!dlg) {
    game.retryDialog = false;
    return;
  }
  dlg.on('IDC_RETRY_BUTTON', () => {
    done();
    retryMission(game);
  });
  dlg.on('IDC_QUIT_BUTTON', () => {
    done();
    confirmQuit(game);
  });
}

export function retryMission(game) {
  if (window.parent !== window && window.parent.game?.linkedMission?.frame?.contentWindow === window) {
    location.reload();
    return;
  }
  stageStart(game.setup);
}

async function confirmQuit(game) {
  const dlg = await openDialog('IDD_DIALOG_BOX_QUIT_CONFIRM').catch(() => null);
  const quit = () => toMainMenu();
  if (!dlg) {
    quit();
    return;
  }
  dlg.setText('IDC_CAPTION', T('TEXT_QUIT_SURE', 'Quit Current Game?'));
  for (const id of ['IDC_USER_TEXT_STRING_1', 'IDC_USER_TEXT_STRING_2', 'IDC_USER_TEXT_STRING_3']) dlg.show(id, false);
  dlg.setText('IDC_DIALOG_BOX_BUTTON_LEFT', T('TEXT_BUTTON_YES', 'Yes'));
  dlg.setText('IDC_DIALOG_BOX_BUTTON_RIGHT', T('TEXT_BUTTON_NO', 'No'));
  dlg.on('IDC_DIALOG_BOX_BUTTON_LEFT', () => {
    dlg.close();
    quit();
  });
  dlg.on('IDC_DIALOG_BOX_BUTTON_RIGHT', () => {
    dlg.close();
    openRetryDialog(game);
  });
}

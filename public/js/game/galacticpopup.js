import { db } from '../gamedata.js';
import { openDialog } from './dialogs.js';

export class GalacticNeutralizePopup {
  constructor(game) { this.game = game; this.opened = false; this.generation = 0; this.dialog = null; }

  async open(rows, choose) {
    if (this.opened) return;
    const generation = ++this.generation; this.opened = true;
    this.game.keys?.clear(); this.game.drag = null;
    const dialog = await openDialog('IDD_NEUTRALIZE_HERO_DIALOG', { nativeFonts: true, nativeLists: true });
    if (generation !== this.generation || !this.opened) { dialog?.close(); return; }
    if (!dialog) { this.opened = false; return; }
    this.dialog = dialog;
    let selected = rows[0];
    const commit = row => { if (choose(row)) this.close(); };
    const list = dialog.list('IDC_NEUTRALIZE_HERO_LISTBOX', rows.map((r, index) => ({ ...r, key: index,
      icon: r.type.str('Icon_Name'), columns: [
        { text: (db.t(r.type.str('Text_ID')) || r.type.name) + (r.active ? ' (active!)' : ''), at: 0 },
        { text: r.cost + ' credits', at: 0.6 },
      ] })), row => { selected = row; }, commit);
    list?.select(0);
    dialog.on('IDC_NEUTRALIZE_HERO_BUTTON', () => commit(selected));
    for (const id of ['IDC_NEUTRALIZE_HERO_CANCEL_BUTTON', 'IDC_DIALOG_CLOSE_BUTTON']) dialog.on(id, () => this.close());
    for (const id of ['IDC_NEUTRALIZE_HERO_BUTTON', 'IDC_NEUTRALIZE_HERO_CANCEL_BUTTON']) {
      const button = dialog.ctl(id); if (button) { button.setAttribute('role', 'button'); button.tabIndex = 0; button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); button.click(); } }); }
    }
  }

  close() { ++this.generation; this.opened = false; this.dialog?.close(); this.dialog = null; this.game.keys?.clear(); }
}

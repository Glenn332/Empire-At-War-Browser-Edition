import { db } from '../gamedata.js';
import { openDialog, loadDialogs } from './dialogs.js';
import { toMainMenu, loadSaved } from './transit.js';
import { gfx, storeGfx, presets } from '../gfx.js';
import { snapshot, snapshotNow, defaultName, listSaves, putSave, getSave, deleteSave, downloadSave, importSaveFile } from './savegame.js';
import { STRATEGIC_FRAMES, STRATEGIC_DEFAULT, strategicIndexOf, strategicMultiplier, saveStrategicIndex } from './galacticspeed.js';
import { enterFullscreen } from '../pointertrap.js';
import {
  ACTIONS,
  MAX_KEYS,
  bindings,
  defaultBindings,
  setBindings,
  modifierOf,
  comboFrom,
  sameCombo,
  keyName,
  keyNames,
  actionName,
  bothButtonsRotate,
  setBothButtonsRotate
} from './keybinds.js';

const T = (id, fallback) => db.t(id) || fallback;
const $ = id => document.getElementById(id);

function setInput(id, value) {
  const el = $(id);
  if (!el) return;
  if (el.type === 'checkbox') {
    el.checked = !!value;
    el.dispatchEvent(new Event('change'));
  } else {
    el.value = value;
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  }
}

const TWEAKS = [
  { id: 'IDC_TWEAK_CAPTURE_BARS', input: 'optCaptureBars', label: 'Show capture progress bars' },
  { id: 'IDC_TWEAK_ALL_UNIT_ICONS', input: 'optAllUnitIcons', label: 'Show unit icon on all units' },
  { id: 'IDC_TWEAK_MULTI_PLACE', input: 'optMultiPlace', label: 'Call in several reinforcements at once' },
  { id: 'IDC_TWEAK_REINFORCE_TURN', input: 'optReinforceTurn', label: 'Turn reinforcements with the wheel and by dragging' },
  { id: 'IDC_TWEAK_LINE_MOVE', input: 'optLineMove', label: 'Send selected units to a line with a right-drag' },
  { id: 'IDC_TWEAK_DIRECT_CONTROL', input: 'optDirectControl', label: 'Direct control of a unit' }
];

export class Menus {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.listening = false;
    this.wasPaused = false;
    this.pauseHeld = false;
    this.ready = loadDialogs()
      .then(d => !!(d && d.dialogs.has('IDD_GAME_OPTIONS_DIALOG')))
      .catch(() => false);
  }

  get open() {
    return this.stack.length > 0;
  }

  async push(id, opts) {
    const dlg = await openDialog(id, opts);
    if (!dlg) return null;
    const below = this.stack[this.stack.length - 1];
    if (below) below.veil.style.display = 'none';
    this.stack.push(dlg);
    return dlg;
  }

  async swap(id, opts) {
    const dlg = await openDialog(id, opts);
    if (!dlg) return null;
    const old = this.stack.pop();
    if (old) old.close();
    this.stack.push(dlg);
    return dlg;
  }

  pop() {
    const dlg = this.stack.pop();
    if (dlg) dlg.close();
    const below = this.stack[this.stack.length - 1];
    if (below) below.veil.style.display = '';
    else this.releasePause();
  }

  closeAll() {
    while (this.stack.length) this.stack.pop().close();
    this.releasePause();
  }

  releasePause() {
    if (!this.pauseHeld) return;
    this.pauseHeld = false;
    if (this.game.pauseGalactic) this.game.pauseGalactic(false);
    else if (!this.game.over) this.game.paused = this.wasPaused;
    this.game.setUIPause?.('menu', false);
  }

  async toggle() {
    if (this.open) {
      this.pop();
      return true;
    }
    if (!(await this.ready)) return false;
    return this.main();
  }

  async main() {
    const g = this.game,
      wasPaused = g.paused,
      dlg = await this.push('IDD_GAME_OPTIONS_DIALOG');
    if (!dlg) return false;
    if (!g.over) {
      this.wasPaused = wasPaused;
      this.pauseHeld = true;
      if (g.pauseGalactic) g.pauseGalactic(true);
      else if (!g.lock) g.paused = true;
      g.setUIPause?.('menu', true);
    }
    dlg.enable('IDC_SAVE_GAME', !g.over && !g.setup.benchmark && !g.noSave && !(g.setup.net && g.setup.campaign));
    dlg.enable('IDC_LOAD_GAME', !g.setup.net);
    dlg.on('IDC_SAVE_GAME', () => this.save());
    dlg.on('IDC_LOAD_GAME', () => this.load());
    dlg.on('IDC_INGAME_OPTIONS', () => this.options());
    dlg.on('IDC_GAME_OPTIONS_QUIT', () => this.confirm(T('TEXT_QUIT_SURE', 'Quit Current Game?'), () => toMainMenu()));
    dlg.on('IDC_GAME_OPTIONS_RESUME', () => this.pop());
    return true;
  }

  async confirm(question, yes) {
    const dlg = await this.push('IDD_DIALOG_BOX_QUIT_CONFIRM');
    if (!dlg) {
      yes();
      return;
    }
    dlg.setText('IDC_CAPTION', question);
    for (const id of ['IDC_USER_TEXT_STRING_1', 'IDC_USER_TEXT_STRING_2', 'IDC_USER_TEXT_STRING_3']) dlg.show(id, false);
    dlg.setText('IDC_DIALOG_BOX_BUTTON_LEFT', T('TEXT_BUTTON_YES', 'Yes'));
    dlg.setText('IDC_DIALOG_BOX_BUTTON_RIGHT', T('TEXT_BUTTON_NO', 'No'));
    dlg.on('IDC_DIALOG_BOX_BUTTON_LEFT', () => {
      this.pop();
      yes();
    });
    dlg.on('IDC_DIALOG_BOX_BUTTON_RIGHT', () => this.pop());
  }

  async ask(caption, lines, yes, no = null) {
    const dlg = await this.push('IDD_DIALOG_BOX_QUIT_CONFIRM');
    if (!dlg) {
      yes();
      return;
    }
    dlg.setText('IDC_CAPTION', caption);
    ['IDC_USER_TEXT_STRING_1', 'IDC_USER_TEXT_STRING_2', 'IDC_USER_TEXT_STRING_3'].forEach((id, i) => {
      if (lines[i]) dlg.setText(id, lines[i]);
      else dlg.show(id, false);
    });
    dlg.setText('IDC_DIALOG_BOX_BUTTON_LEFT', T('TEXT_BUTTON_YES', 'Yes'));
    dlg.setText('IDC_DIALOG_BOX_BUTTON_RIGHT', T('TEXT_BUTTON_NO', 'No'));
    dlg.on('IDC_DIALOG_BOX_BUTTON_LEFT', () => {
      this.pop();
      yes();
    });
    dlg.on('IDC_DIALOG_BOX_BUTTON_RIGHT', () => {
      this.pop();
      if (no) no();
    });
  }

  listenKeys(command, current) {
    return new Promise(async done => {
      const LEFT = 'IDC_DIALOG_BOX_BUTTON_LEFT',
        ADD = 'IDC_DIALOG_BOX_BUTTON_SWR_ADD',
        UNSET = 'IDC_DIALOG_BOX_BUTTON_SWR_UNSET',
        RIGHT = 'IDC_DIALOG_BOX_BUTTON_RIGHT';
      const at = { [LEFT]: 14, [ADD]: 92, [UNSET]: 170, [RIGHT]: 248 };
      const dlg = await this.push('IDD_DIALOG_BOX_QUIT_CONFIRM', {
        extra: [ADD, UNSET].map(id => ({ kind: 'PUSHBUTTON', text: '', id, x: at[id], y: 95, w: 75, h: 24, style: '' })),
        adjust: c => (c.id in at ? { ...c, x: at[c.id], w: 75 } : null)
      });
      if (!dlg) {
        done(null);
        return;
      }
      const held = new Set();
      let mods = [],
        codes = [];
      const combo = () => (codes.length ? comboFrom(mods, codes) : null);
      const paint = () => {
        const c = combo();
        dlg.setText('IDC_USER_TEXT_STRING_2', c ? keyName(c) : '...');
        dlg.enable(LEFT, !!c);
        dlg.enable(ADD, !!c && current.length > 0 && current.length < MAX_KEYS && !current.some(k => sameCombo(k, c)));
      };
      const finish = r => {
        this.listening = false;
        removeEventListener('keydown', down, true);
        removeEventListener('keyup', up, true);
        removeEventListener('blur', lost);
        this.pop();
        done(r);
      };
      const down = e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === 'Escape') {
          finish(null);
          return;
        }
        const m = modifierOf(e.code);
        if (e.repeat || m === null) return;
        if (!held.size) {
          mods = [];
          codes = [];
        }
        held.add(e.code);
        if (m) {
          if (!mods.includes(m)) mods.push(m);
        } else if (!codes.includes(e.code) && codes.length < 4) codes.push(e.code);
        paint();
      };
      const up = e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        held.delete(e.code);
      };
      const lost = () => held.clear();
      this.listening = true;
      addEventListener('keydown', down, true);
      addEventListener('keyup', up, true);
      addEventListener('blur', lost);
      dlg.setText('IDC_CAPTION', command);
      dlg.setText('IDC_USER_TEXT_STRING_1', 'Hold the keys for this command together.');
      dlg.setText('IDC_USER_TEXT_STRING_3', 'Now: ' + keyNames(current));
      dlg.setText(LEFT, 'Set');
      dlg.setText(ADD, 'Add');
      dlg.setText(UNSET, 'Unset');
      dlg.setText(RIGHT, T('TEXT_BUTTON_CANCEL', 'Cancel'));
      dlg.enable(UNSET, current.length > 0);
      dlg.on(LEFT, () => {
        const c = combo();
        if (c) finish({ combo: c, add: false });
      });
      dlg.on(ADD, () => {
        const c = combo();
        if (c) finish({ combo: c, add: true });
      });
      dlg.on(UNSET, () => finish({ combo: null }));
      dlg.on(RIGHT, () => finish(null));
      paint();
    });
  }

  async keyboard(page = 0, work = bindings(), swap = false) {
    const PAGES = [
      'IDD_KEYBOARD_OPTIONS_DIALOG',
      'IDD_KEYBOARD_OPTIONS_DIALOG_2',
      'IDD_KEYBOARD_OPTIONS_DIALOG_3',
      'IDD_KEYBOARD_OPTIONS_DIALOG_4',
      'IDD_KEYBOARD_OPTIONS_DIALOG_5',
      'IDD_KEYBOARD_OPTIONS_DIALOG_4'
    ];
    const TABS = [
      'IDC_KEYBOARD_OPTIONS_1',
      'IDC_KEYBOARD_OPTIONS_2',
      'IDC_KEYBOARD_OPTIONS_3',
      'IDC_KEYBOARD_OPTIONS_4',
      'IDC_KEYBOARD_OPTIONS_5',
      'IDC_KEYBOARD_OPTIONS_SWR'
    ];
    const own = page === 5,
      rows = ACTIONS.filter(a => a.page === page);
    const editOf = a => a.edit || 'IDC_EDIT_SWR_' + a.id;
    const extra = [
      {
        kind: 'CONTROL',
        text: '',
        id: TABS[5],
        skin: TABS[0],
        cls: 'Button',
        style: 'BS_AUTORADIOBUTTON | BS_PUSHLIKE',
        x: 246,
        y: 24,
        w: 93,
        h: 18
      },
      ...rows
        .filter(a => a.extra)
        .flatMap(a => [
          { kind: 'LTEXT', text: a.label, id: 'IDC_STATIC_SWR_' + a.id, x: a.extra.col ? 459 : 30, y: a.extra.y, w: 235, h: 23, style: '' },
          {
            kind: 'EDITTEXT',
            text: '',
            id: editOf(a),
            x: a.extra.col ? 729 : 303,
            y: a.extra.y - 5,
            w: 108,
            h: 15,
            style: 'ES_CENTER | ES_AUTOHSCROLL'
          }
        ])
    ];
    const dlg = swap ? await this.swap(PAGES[page], { extra }) : await this.push(PAGES[page], { extra });
    if (!dlg) return;
    dlg.setText(TABS[5], 'Other');
    for (const a of rows) if (a.extra) dlg.setText('IDC_STATIC_SWR_' + a.id, a.label);
    const fit = inp => {
      inp.style.fontSize = '';
      const px = parseFloat(getComputedStyle(inp).fontSize);
      for (let k = 0.95; inp.scrollWidth > inp.clientWidth && k >= 0.6; k -= 0.05) inp.style.fontSize = px * k + 'px';
    };
    const show = () => {
      for (const a of rows) {
        const inp = dlg.edit(editOf(a));
        if (inp) {
          inp.value = keyNames(work[a.id]);
          inp.title = inp.value;
          fit(inp);
        }
      }
    };
    const set = (a, k, from, add) => {
      if (from) work[from.id] = work[from.id].filter(x => !sameCombo(x, k));
      work[a.id] = add ? [...work[a.id].filter(x => !sameCombo(x, k)), k].slice(-MAX_KEYS) : [k];
      show();
    };
    const mine = new Set(rows.map(editOf));
    if (own) {
      dlg.setText('IDC_STATIC_MEDIUM', 'Other Commands');
      for (const e of dlg.el.querySelectorAll('.dlg-txt[data-id="IDC_STATIC"], .dlg-edit')) if (!mine.has(e.dataset.id)) e.hidden = true;
    }
    for (const c of dlg.def.controls) {
      if (c.kind !== 'EDITTEXT' || mine.has(c.id)) continue;
      dlg.enable(c.id, false);
      const inp = dlg.edit(c.id);
      if (inp) {
        inp.disabled = true;
        inp.value = '';
      }
    }
    for (const a of rows) {
      const inp = dlg.edit(editOf(a));
      if (!inp) continue;
      inp.readOnly = true;
      inp.style.caretColor = 'transparent';
      inp.style.cursor = 'pointer';
      const listen = async () => {
        const r = await this.listenKeys(actionName(a.id), work[a.id]);
        if (!r) return;
        if (!r.combo) {
          work[a.id] = [];
          show();
          return;
        }
        const k = r.combo;
        if (!r.add && work[a.id].length === 1 && sameCombo(work[a.id][0], k)) return;
        const from = ACTIONS.find(o => o !== a && work[o.id].some(x => sameCombo(x, k)));
        if (!from) {
          set(a, k, null, r.add);
          return;
        }
        const name = keyName(k);
        this.ask(
          T('TEXT_KEYBOARD_OPTIONS', 'Keyboard'),
          [
            T('TEXT_KEYBIND_WARNING_0', '##0 is already assigned to the game command ##1.')
              .replace(/##0/g, name)
              .replace(/##1/g, actionName(from.id)),
            T('TEXT_KEYBIND_WARNING_1', 'Do you want to re-assign ##0 to game command ##2?')
              .replace(/##0/g, name)
              .replace(/##2/g, actionName(a.id))
          ],
          () => set(a, k, from, r.add)
        );
      };
      inp.addEventListener('click', listen);
      inp.addEventListener('keydown', e => {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          listen();
        }
      });
    }
    show();
    dlg.radios(TABS, TABS[page], id => this.keyboard(TABS.indexOf(id), work, true));
    dlg.on('IDC_OK', () => this.pop());
    dlg.on('IDC_APPLY', () => {
      setBindings(work);
      this.pop();
    });
    dlg.on('IDC_RESTORE_DEFAULTS', () => {
      Object.assign(work, defaultBindings());
      show();
    });
  }

  extra(dlg, like, label, x, y, w, fn) {
    const src = dlg.ctl(like);
    const b = src.cloneNode(true);
    b.style.left = x + 'px';
    b.style.top = y + 'px';
    b.style.width = w + 'px';
    b.firstChild.textContent = label;
    b.classList.remove('off');
    b.onclick = fn;
    dlg.el.appendChild(b);
    return b;
  }

  async saveRows() {
    const when = iso => {
      try {
        return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      } catch {
        return '';
      }
    };
    const net = this.game.setup.net,
      type = this.game.setup.type;
    return (await listSaves())
      .filter(s => (net ? s.mp && (!type || s.mp.type === type) : !s.mp))
      .map(s => ({ key: s.id, label: s.name, note: `${(s.summary.factions || []).join(' vs ')}   ${when(s.saved)}`, save: s }));
  }

  async save() {
    const g = this.game,
      dlg = await this.push('IDD_SAVE_GAME_DIALOG');
    if (!dlg) return;
    const name = dlg.edit('IDC_SAVE_GAME_NAME_EDIT');
    name.value = defaultName(g);
    let list;
    const refresh = async () => {
      list = dlg.list('IDC_SAVE_GAME_LIST', await this.saveRows(), row => {
        name.value = row.label;
        pick();
      });
      pick();
    };
    const pick = () => {
      const on = !!(list && list.selected());
      dlg.enable('IDC_DELETE_GAME_BUTTON', on);
      down.classList.toggle('off', !on);
    };
    const write = async id => {
      try {
        await putSave(await snapshotNow(g, name.value.trim()), id);
      } catch (error) {
        console.error(error);
        g.message(error.message || String(error), 'bad');
        return;
      }
      g.message(`${T('TEXT_SAVE_GAME_TITLE', 'Save Game')}: ${name.value.trim()}`, 'good');
      this.pop();
    };
    dlg.on('IDC_SAVE_CANCEL_BUTTON', () => this.pop());
    dlg.on('IDC_SAVE_GAME_BUTTON', () => {
      if (!name.value.trim()) return;
      const cur = list && list.selected();
      if (cur && cur.label === name.value.trim()) this.confirm(T('TEXT_SAVE_CONFIRM', 'Overwrite Save Game?'), () => write(cur.key));
      else write(null);
    });
    dlg.on('IDC_DELETE_GAME_BUTTON', () => {
      const cur = list.selected();
      if (cur)
        this.confirm(T('TEXT_DELETE_CONFIRM', 'Delete saved game?'), async () => {
          await deleteSave(cur.key);
          refresh();
        });
    });
    const c = dlg.def.controls.find(x => x.id === 'IDC_SAVE_GAME_LIST');
    const down = this.extra(dlg, 'IDC_SAVE_CANCEL_BUTTON', 'Download', c.x + c.w - 150, 38, 150, async () => {
      const cur = list.selected();
      const s = cur && (await getSave(cur.key));
      if (s) downloadSave(s);
    });
    await refresh();
    name.focus();
    name.select();
  }

  async load() {
    const dlg = await this.push('IDD_LOAD_GAME_DIALOG');
    if (!dlg) return;
    dlg.show('IDC_CHECK_RECORDINGS', false);
    let list;
    const go = row => loadSaved(row.key);
    const pick = () => {
      const on = !!(list && list.selected());
      dlg.enable('IDC_LOAD_GAME_BUTTON', on);
      dlg.enable('IDC_DELETE_GAME_BUTTON', on);
      down.classList.toggle('off', !on);
    };
    const refresh = async () => {
      list = dlg.list('IDC_SAVE_GAME_LIST', await this.saveRows(), pick, go);
      pick();
    };
    dlg.on('IDC_LOAD_CANCEL_BUTTON', () => this.pop());
    dlg.on('IDC_LOAD_GAME_BUTTON', () => {
      const cur = list.selected();
      if (cur) go(cur);
    });
    dlg.on('IDC_DELETE_GAME_BUTTON', () => {
      const cur = list.selected();
      if (cur)
        this.confirm(T('TEXT_DELETE_CONFIRM', 'Delete saved game?'), async () => {
          await deleteSave(cur.key);
          refresh();
        });
    });
    const c = dlg.def.controls.find(x => x.id === 'IDC_SAVE_GAME_LIST');
    const down = this.extra(dlg, 'IDC_LOAD_CANCEL_BUTTON', 'Download', c.x + c.w - 150, 38, 150, async () => {
      const cur = list.selected();
      const s = cur && (await getSave(cur.key));
      if (s) downloadSave(s);
    });
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.swrsave,.json,application/json';
    file.hidden = true;
    dlg.el.appendChild(file);
    file.onchange = async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      try {
        const { id } = await importSaveFile(f);
        await refresh();
        list.select(id);
      } catch (e) {
        this.game.message(e.message, 'bad');
      }
    };
    this.extra(dlg, 'IDC_LOAD_CANCEL_BUTTON', 'Import', c.x + c.w - 310, 38, 150, () => file.click());
    await refresh();
  }

  async options() {
    const def = (await loadDialogs())?.dialogs.get('IDD_IN_GAME_OPTIONS_DIALOG');
    const okC = def && def.controls.find(c => c.id === 'IDC_OK_IN_GAME');
    const above = okC && def.controls.filter(c => /^IDC_IN_GAME_OPTIONS_/.test(c.id) && c.y < okC.y).sort((a, b) => b.y - a.y)[0];
    const ok = okC || { x: 41, y: 275, w: 239, h: 21 },
      step = above ? ok.y - above.y : 43;
    const dlg = await this.push('IDD_IN_GAME_OPTIONS_DIALOG', {
      size: { w: def ? def.w : 321, h: (def ? def.h : 328) + step },
      extra: [{ kind: 'PUSHBUTTON', text: '', id: 'IDC_IN_GAME_OPTIONS_TWEAKS', x: ok.x, y: ok.y, w: ok.w, h: ok.h, style: '' }],
      adjust: c => (c.id === 'IDC_OK_IN_GAME' ? { ...c, y: ok.y + step } : null)
    });
    if (!dlg) return;
    dlg.setText('IDC_IN_GAME_OPTIONS_TWEAKS', 'Tweaks');
    dlg.on('IDC_IN_GAME_OPTIONS_TWEAKS', () => this.tweaks());
    dlg.on('IDC_IN_GAME_OPTIONS_AUDIO', () => this.audio());
    dlg.on('IDC_IN_GAME_OPTIONS_VIDEO', () => this.video());
    dlg.on('IDC_IN_GAME_OPTIONS_GAMEPLAY', () => this.gameplay());
    dlg.enable('IDC_IN_GAME_OPTIONS_NETWORK', false);
    dlg.on('IDC_IN_GAME_OPTIONS_KEYBOARD', () => this.keyboard());
    dlg.on('IDC_OK_IN_GAME', () => this.pop());
  }

  async tweaks() {
    const W = 520,
      top = 50,
      row = 26,
      VISIBLE = 10,
      panelH = VISIBLE * row + 8,
      back = top + panelH + 18,
      shift = (W - 321) / 2;
    const dlg = await this.push('IDD_IN_GAME_OPTIONS_DIALOG', {
      size: { w: W, h: back + 53 },
      extra: TWEAKS.map((t, i) => ({
        kind: 'CONTROL',
        text: '',
        id: t.id,
        cls: 'Button',
        style: 'BS_AUTOCHECKBOX | WS_TABSTOP',
        x: 0,
        y: i * row,
        w: W - 64,
        h: 23
      })),
      adjust: c =>
        c.id === 'IDC_OK_IN_GAME'
          ? { ...c, x: c.x + shift, y: back }
          : c.id === 'IDC_STATIC_IN_GAME_OPTIONS'
            ? { ...c, kind: 'LTEXT', x: 24 }
            : TWEAKS.some(t => t.id === c.id)
              ? null
              : { ...c, x: c.x + shift }
    });
    if (!dlg) return;
    dlg.setText('IDC_STATIC_IN_GAME_OPTIONS', 'Tweaks');
    for (const id of [
      'IDC_IN_GAME_OPTIONS_AUDIO',
      'IDC_IN_GAME_OPTIONS_VIDEO',
      'IDC_IN_GAME_OPTIONS_NETWORK',
      'IDC_IN_GAME_OPTIONS_KEYBOARD',
      'IDC_IN_GAME_OPTIONS_GAMEPLAY'
    ])
      dlg.show(id, false);
    const panel = document.createElement('div');
    panel.className = 'dlg-tweaks';
    panel.style.cssText =
      `position:absolute;left:20px;top:${top}px;width:${W - 40}px;height:${panelH}px;overflow-y:auto;overflow-x:hidden;` +
      'box-sizing:border-box;background:rgba(0,0,0,0.35);border:1px solid rgba(140,170,200,0.35);scrollbar-width:thin;scrollbar-color:rgba(160,190,220,0.6) transparent';
    const inner = document.createElement('div');
    inner.style.cssText = `position:relative;left:8px;top:4px;height:${TWEAKS.length * row + 4}px`;
    panel.appendChild(inner);
    dlg.el.appendChild(panel);
    for (const t of TWEAKS) {
      const input = $(t.input),
        c = dlg.ctl(t.id);
      if (c) inner.appendChild(c);
      dlg.setText(t.id, t.label);
      if (input?.parentElement?.title && c) c.title = input.parentElement.title;
      dlg.check(t.id, !!input?.checked, on => setInput(t.input, on));
    }
    dlg.on('IDC_OK_IN_GAME', () => this.pop());
  }

  async audio() {
    const A = this.game.audio,
      dlg = await this.push('IDD_AUDIO_OPTIONS_DIALOG');
    if (!dlg) return;
    const was = { master: A.masterVolume, sfx: A.sfxVolume, voice: A.voiceVolume, music: A.musicVolume };
    const storeMaster = () => {
      try {
        localStorage.setItem('swr-master', String(A.masterVolume));
      } catch {}
    };
    const show = () => {
      dlg.slider('IDC_SLIDER_MASTER_VOLUME', A.masterVolume, v => A.setMasterVolume(v));
      dlg.slider('IDC_SLIDER_SOUND_EFFECTS_VOLUME', A.sfxVolume, v => setInput('sfxVol', v));
      dlg.slider('IDC_SLIDER_DIALOG_VOLUME', A.voiceVolume, v => setInput('voiceVol', v));
      dlg.slider('IDC_SLIDER_MUSIC_VOLUME', A.musicVolume, v => setInput('musicVol', v));
    };
    show();
    for (const id of ['IDC_TEXT_AUDIO_3D_TECHNOLOGY', 'IDC_USE_MOVIE_SUBTITLES']) dlg.show(id, false);
    const put = v => {
      A.setMasterVolume(v.master);
      setInput('sfxVol', v.sfx);
      setInput('voiceVol', v.voice);
      setInput('musicVol', v.music);
    };
    dlg.on('IDC_OK', () => {
      storeMaster();
      this.pop();
    });
    dlg.on('IDC_CANCEL', () => {
      put(was);
      this.pop();
    });
    dlg.on('IDC_RESTORE_DEFAULT', () => {
      put({ master: 1, sfx: 0.7, voice: 0.9, music: 0.45 });
      show();
    });
  }

  async video() {
    const dlg = await this.push('IDD_VIDEO_OPTIONS_DIALOG');
    if (!dlg) return;
    const was = { ...gfx };
    const apply = () => {
      storeGfx();
      if (window.applyGraphics) window.applyGraphics(window.game && window.game.renderer);
    };
    const levels = await presets();
    const dpr = Math.min(devicePixelRatio, 2),
      scales = [1, 0.85, 0.75, 0.66, 0.5];
    const rows = scales.map(k => ({
      key: k,
      label: Math.round(innerWidth * dpr * k) + ' x ' + Math.round(innerHeight * dpr * k),
      note: Math.round(k * 100) + '%'
    }));
    const res = dlg.list('IDC_RESOLUTION_LIST', rows, row => {
      if (gfx.scale !== row.key) {
        gfx.scale = row.key;
        apply();
      }
    });
    const show = () => {
      if (res) res.select(scales.reduce((best, k) => (Math.abs(k - gfx.scale) < Math.abs(best - gfx.scale) ? k : best), 1));
      dlg.slider('IDC_ANTI_ALIAS_SLIDER', gfx.aa !== false ? 1 : 0, v => {
        const on = v >= 0.5;
        if (on !== gfx.aa) {
          gfx.aa = on;
          apply();
        }
      });
      dlg.slider('IDC_GAMMA_SLIDER', gfx.gamma, v => {
        gfx.gamma = v;
        apply();
      });
      if (levels.length > 1)
        dlg.slider('IDC_DETAIL_LEVEL_SLIDER', gfx.level >= 0 ? gfx.level / (levels.length - 1) : 1, v => {
          const i = Math.round(v * (levels.length - 1));
          if (i === gfx.level) return;
          Object.assign(gfx, levels[i], { level: i });
          apply();
        });
      dlg.check('IDC_WINDOWED_MODE', !document.fullscreenElement, on => {
        try {
          if (on) document.exitFullscreen();
          else enterFullscreen();
        } catch {}
      });
    };
    show();
    if (levels.length < 2) dlg.enable('IDC_DETAIL_LEVEL_SLIDER', false);
    for (const id of ['IDC_HARDWARE_MOUSE', 'IDC_VSYNC_ENABLED', 'IDC_WIDESCREEN', 'IDC_AUTO_DETECT']) dlg.enable(id, false);
    dlg.show('IDC_DEVICE_DESC_STATIC', false);
    dlg.on('IDC_ADVANCED', () => this.videoAdvanced());
    dlg.on('IDC_OK', () => this.pop());
    dlg.on('IDC_APPLY', () => {});
    dlg.on('IDC_CANCEL', () => {
      Object.assign(gfx, was);
      apply();
      this.pop();
    });
  }

  async videoAdvanced() {
    const dlg = await this.push('IDD_ADVANCED_VIDEO_OPTIONS_DIALOG');
    if (!dlg) return;
    const was = { ...gfx };
    const apply = () => {
      storeGfx();
      if (window.applyGraphics) window.applyGraphics(window.game && window.game.renderer);
    };
    const checks = { IDC_SOFT_SHADOWS: 'shadows', IDC_BLOOM: 'bloom', IDC_HEAT_DISTORTIONS: 'heat' };
    const step = (id, key, max, flip = false) =>
      dlg.slider(id, flip ? 1 - gfx[key] / max : gfx[key] / max, v => {
        const n = Math.round((flip ? 1 - v : v) * max);
        if (n !== gfx[key]) {
          gfx[key] = n;
          apply();
        }
      });
    const heat = dlg.def.controls.find(c => c.id === 'IDC_HEAT_DISTORTIONS'),
      bloom = dlg.def.controls.find(c => c.id === 'IDC_BLOOM');
    const flare = dlg.ctl('IDC_HEAT_DISTORTIONS').cloneNode(true);
    flare.style.top = heat.y + (heat.y - bloom.y) + 'px';
    flare.lastChild.textContent = 'Lens Flare';
    flare.onclick = () => {
      gfx.flare = !gfx.flare;
      flare.classList.toggle('on', gfx.flare);
      apply();
    };
    dlg.el.appendChild(flare);
    const show = () => {
      for (const id in checks)
        dlg.check(id, gfx[checks[id]], on => {
          gfx[checks[id]] = on;
          apply();
        });
      flare.classList.toggle('on', !!gfx.flare);
      dlg.slider('IDC_PARTICLE_DETAIL_SLIDER', gfx.particle, v => {
        gfx.particle = Math.round(v * 20) / 20;
        apply();
      });
      step('IDC_TEXTURE_MIP_DETAIL_SLIDER', 'texMip', 2, true);
      step('IDC_SHADER_DETAIL_SLIDER', 'shader', 3);
      step('IDC_SHADOW_DETAIL_SLIDER', 'shadow', 3);
    };
    show();
    for (const id of ['IDC_MESH_DETAIL_SLIDER', 'IDC_WATER_DETAIL_SLIDER', 'IDC_ENVIRONMENT_DETAIL_SLIDER', 'IDC_AUTO_DETECT'])
      dlg.enable(id, false);
    dlg.on('IDC_OK', () => this.pop());
    dlg.on('IDC_APPLY', () => {});
    dlg.on('IDC_CANCEL', () => {
      Object.assign(gfx, was);
      apply();
      this.pop();
    });
  }

  async gameplay() {
    const g = this.game,
      dlg = await this.push('IDD_GAMEPLAY_OPTIONS_DIALOG');
    if (!dlg) return;
    let simplified = false;
    try {
      simplified = localStorage.getItem('swr-simplified-faction-colors') === '1';
    } catch {}
    let delayed = !!g.delayTooltips;
    if (g.delayTooltips === undefined) {
      try {
        delayed = localStorage.getItem('swr-delay-tooltips') === '1';
      } catch {}
      g.delayTooltips = delayed;
    }
    let autoResolve = !!g.autoResolveOption;
    const setAutoResolve = on => {
      autoResolve = on;
      g.autoResolveOption = on;
      try {
        localStorage.setItem('swr-auto-resolve', on ? '1' : '0');
      } catch {}
    };
    const strategic = !!g.galactic,
      was = { speed: g.speed, auto: $('optAutofire').checked, simplified, autoResolve, delayed, both: bothButtonsRotate() };
    const setDelayed = on => {
      delayed = on;
      g.delayTooltips = on;
      try {
        localStorage.setItem('swr-delay-tooltips', on ? '1' : '0');
      } catch {}
    };
    const setSimplified = on => {
      simplified = on;
      g.simplifiedFactionColors = on;
      try {
        localStorage.setItem('swr-simplified-faction-colors', on ? '1' : '0');
      } catch {}
    };
    const toV = s => (s - 0.5) / 1.5,
      toS = v => Math.round((0.5 + 1.5 * v) * 20) / 20;
    const show = () => {
      if (strategic)
        dlg.slider(
          'IDC_STRATEGIC_GAME_SPEED_SLIDER',
          strategicIndexOf(g.speed) / (STRATEGIC_FRAMES.length - 1),
          v => {
            const i = Math.round(v * (STRATEGIC_FRAMES.length - 1));
            g.setSpeed(strategicMultiplier(i));
            saveStrategicIndex(i);
          },
          STRATEGIC_FRAMES.length
        );
      else dlg.slider('IDC_GAME_SPEED_SLIDER', toV(Math.max(0.5, Math.min(2, g.speed))), v => g.setSpeed(toS(v)));
      dlg.check('IDC_ABILITIES_DEFAULT_TO_AUTOFIRE', $('optAutofire').checked, on => setInput('optAutofire', on));
      dlg.check('IDC_SIMPLIFIED_FACTION_COLORS', simplified, setSimplified);
      dlg.check('IDC_DELAY_TOOLTIPS', delayed, setDelayed);
      dlg.check('IDC_BOTH_MOUSE_BUTTONS_ROTATE', bothButtonsRotate(), setBothButtonsRotate);
      if (g.galactic) dlg.check('IDC_AUTORESOLVE', autoResolve, setAutoResolve);
    };
    show();
    for (const id of [
      ...(strategic ? ['IDC_GAME_SPEED_SLIDER'] : ['IDC_STRATEGIC_GAME_SPEED_SLIDER']),
      'IDC_SCROLL_SPEED_SLIDER',
      'IDC_ALTERNATE_MOUSE_CONTROLS',
      'IDC_ABSOLUTE_SCROLLING',
      ...(g.galactic ? [] : ['IDC_AUTORESOLVE']),
      'IDC_RIGHT_BUTTON_SCROLL',
      'IDC_GALACTIC_GAME_SPEED_TEXT',
      'IDC_SCROLL_SPEED'
    ])
      dlg.enable(id, false);
    for (const id of ['IDC_RADIO_BLANK', 'IDC_RADIO_BLANK2', 'IDC_RADIO_BLANK3']) dlg.show(id, false);
    dlg.on('IDC_BUTTON_ACCEPT', () => this.pop());
    dlg.on('IDC_CANCEL_BUTTON', () => {
      g.setSpeed(was.speed);
      if (strategic) saveStrategicIndex(strategicIndexOf(was.speed));
      setInput('optAutofire', was.auto);
      setSimplified(was.simplified);
      setDelayed(was.delayed);
      setBothButtonsRotate(was.both);
      if (g.galactic) setAutoResolve(was.autoResolve);
      this.pop();
    });
    dlg.on('IDC_DEFAULTS_BUTTON', () => {
      g.setSpeed(1);
      if (strategic) saveStrategicIndex(STRATEGIC_DEFAULT);
      setInput('optAutofire', true);
      setSimplified(false);
      setDelayed(false);
      setBothButtonsRotate(false);
      if (g.galactic) setAutoResolve(false);
      show();
    });
  }
}

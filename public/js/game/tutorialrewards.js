import { db } from '../gamedata.js';
import { openDialog } from './dialogs.js';
import { toMainMenu } from './transit.js';
import { TutorialFx } from './tutorialfx.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const atoi = s => parseInt(String(s ?? '').trim(), 10) || 0;
const present = s => s !== undefined && String(s).length > 0;
const FLASH_KINDS = [
  '',
  'AFFILIATION',
  'FLEET',
  'TROOPS',
  'PLANET_NAME',
  'BASE_BARS',
  'CREDITS',
  'PRODUCTION',
  'COINS',
  'SMUGGLER',
  'SMUGGLED',
  'PLANET_VALUE',
  'WEATHER',
  'PLANET',
  'ABILITY_SLOT'
];
const SLOT_KINDS = {
  SHOW_SMUGGLE_SLOT: 'smuggle',
  HIDE_SMUGGLE_SLOT: 'smuggle',
  SHOW_RAID_SLOT: 'raid',
  HIDE_RAID_SLOT: 'raid',
  SHOW_STEAL_SLOT: 'steal',
  HIDE_STEAL_SLOT: 'steal'
};
const SPECIAL_SLOTS = ['', 'raid', 'smuggle', 'steal', 'blackmarket', 'sabotage'];

export const tutorialFx = game => (game.tutorialFx ||= new TutorialFx(game));

export function tutorialReward(host, e) {
  const game = host.game,
    p = e.rewards,
    fx = () => tutorialFx(game);
  const g = game.galaxy,
    planetOf = name => g?.planets.find(q => key(q.type.name) === key(name) || key(q.name) === key(name));
  switch (e.reward) {
    case 'FLASH_GUI': {
      const dual = game.dualFlash;
      if (dual) {
        if (dual.queue.length < 2) dual.queue.push({ name: p[0], tag: p[1] || '' });
        return true;
      }
      fx().flashComponent(p[0], { tag: p[1] || '' });
      return true;
    }
    case 'DUAL_FLASH':
      game.dualFlash = { time: parseFloat(p[0]) || 0, rate: parseFloat(p[1]) || 1, queue: [], turn: 0, next: 0 };
      return true;
    case 'HIDE_TUTORIAL_CURSOR':
      fx().hideArrow(p[0] || '');
      game.dualFlash = null;
      return true;
    case 'FLASH_PLANET_GUI': {
      const planet = planetOf(p[0]),
        kind = FLASH_KINDS[atoi(p[1])] || key(p[1]);
      if (!planet || !game.overlayPoint) return true;
      const at = planetPoint(game, planet, kind, atoi(p[2] || '-1'));
      if (at && kind !== 'PLANET') fx().flashElement(floating(game, at), '', {});
      if (present(p[4]) || kind === 'PLANET')
        fx().pointAt(kind === 'PLANET' ? { planet, tag: p[3] || '' } : { at: () => at(), tag: p[3] || '' });
      return true;
    }
    case 'FLASH_FLEET_WITH_UNIT': {
      const t = key(p[0]),
        fleet = g?.fleets.find(f => !f.leg && f.units.some(u => key((u.carries || u.type).name) === t || key(u.type.name) === t));
      if (!fleet) return true;
      const at = () => {
        const s = (game.lastSpots || []).find(s => s.f === fleet);
        return s ? [s.x, s.y] : null;
      };
      fx().flashElement(floating(game, at), '', {});
      fx().pointAt({ at, tag: p[1] || '' });
      return true;
    }
    case 'FLASH_PRODUCTION_CHOICE': {
      const el = [...document.querySelectorAll('[data-component^="B_CREATE_"]')].find(b => key(b._type?.name) === key(p[0]));
      if (el) {
        fx().flashElement(el, '', {});
        fx().pointAt({ el, tag: p[1] || '' });
      }
      return true;
    }
    case 'FLASH_SPECIAL_ABILITY': {
      const el = [...document.querySelectorAll('[data-component^="SPECIAL_BUTTON_"]')].find(b => key(b._ability || b.title) === key(p[0]));
      if (el) {
        fx().flashElement(el, '', {});
        fx().pointAt({ el, tag: p[1] || '' });
      }
      return true;
    }
    case 'FLASH_ADVANCED_MAP_OBJECT': {
      const el = [...document.querySelectorAll('[data-component^="BUILD_PAD"]')].find(b => key(b._type?.name) === key(p[0]));
      if (el) fx().flashElement(el, '', { count: 6 });
      return true;
    }
    case 'HIGHLIGHT_OBJECT': {
      const on = atoi(p[1]) !== 0,
        id = present(p[2]) ? atoi(p[2]) : -1;
      const planet = planetOf(p[0]);
      if (planet && game.planetViews) {
        const scene = game.scene || game.renderer?.scene;
        if (scene) fx().highlight(planet, on, { scene, position: { x: planet.pos[0], y: planet.pos[1], z: planet.pos[2] || 0 } });
        if (id !== -1) fx().marker(id, on ? { planet } : null);
        return true;
      }
      const unit = (game.world?.units || []).find(u => !u.dead && key(u.type?.name) === key(p[0]));
      if (unit) {
        const parent = unit.holder || unit.mesh || unit.inst?.root;
        if (parent) fx().highlight(unit, on, { parent });
        if (id !== -1) fx().marker(id, on ? { unit } : null);
      }
      return true;
    }
    case 'SHOW_COMMAND_BAR': {
      const show = atoi(p[0]) !== 0,
        names = g ? ['I_MAIN_COMMANDBAR'] : ['I_MAIN_SKIRMISH', 'I_MAIN_REINFORCE'];
      document.body.classList.toggle('commandbar-hidden', !show);
      for (const n of names)
        for (const el of document.querySelectorAll(`[data-component="${n}"]`)) el.style.visibility = show ? '' : 'hidden';
      return true;
    }
    case 'TUTORIAL_DIALOG':
      openTutorialDialog(game, p[0], atoi(p[1]) !== 0);
      return true;
    case 'SHOW_SPECIAL_SLOT': {
      const planet = planetOf(p[0]),
        kind =
          SPECIAL_SLOTS[atoi(p[1])] ||
          {
            RAID_SLOT: 'raid',
            SMUGGLE_SLOT: 'smuggle',
            STEAL_SLOT: 'steal',
            BLACK_MARKET_SLOT: 'blackmarket',
            SABOTAGE_SLOT: 'sabotage',
            CORRUPTION_SLOT: 'corrupt'
          }[key(p[1])];
      if (!kind) return true;
      const slots = (game.forcedSlots ||= {});
      if (present(p[2]) && atoi(p[2]) === 0) delete slots[kind];
      else if (planet) slots[kind] = planet.index;
      return true;
    }
    case 'SHOW_SMUGGLE_SLOT':
    case 'SHOW_RAID_SLOT':
    case 'SHOW_STEAL_SLOT': {
      const planet = planetOf(p[0]);
      if (planet) (game.forcedSlots ||= {})[SLOT_KINDS[e.reward]] = planet.index;
      return true;
    }
    case 'HIDE_SMUGGLE_SLOT':
    case 'HIDE_RAID_SLOT':
    case 'HIDE_STEAL_SLOT':
      if (game.forcedSlots) delete game.forcedSlots[SLOT_KINDS[e.reward]];
      return true;
    default:
      return false;
  }
}

export function stepDualFlash(game, dt) {
  const d = game.dualFlash;
  if (!d || d.queue.length < 2) return;
  d.time -= dt;
  d.next -= dt;
  if (d.time <= 0) {
    game.dualFlash = null;
    return;
  }
  if (d.next <= 0) {
    const q = d.queue[d.turn++ % 2];
    tutorialFx(game).flashComponent(q.name, { tag: q.tag });
    d.next = d.rate;
  }
}

function planetPoint(game, planet, kind, slot) {
  const scale = () => game.overlayScale?.() || 1,
    base = () => game.overlayPoint?.(planet.pos);
  switch (kind) {
    case 'FLEET':
      return () => {
        const list = (game.lastSpots || []).filter(s => s.p === planet.index);
        const s = list[slot >= 0 ? slot : 0] || list[0];
        return s ? [s.x, s.y] : null;
      };
    case 'TROOPS':
      return () => {
        const s = (game.lastSurfaceSpots || []).find(s => s.p === planet.index);
        return s ? [s.x, s.y] : null;
      };
    case 'ABILITY_SLOT':
      return () => {
        const s = (game.lastSpecialSpots || []).find(s => s.p === planet.index);
        return s ? [s.x, s.y] : null;
      };
    case 'PLANET_NAME':
      return () => {
        const b = base(),
          o = game.nameStyle?.offset || [0, 0];
        return b ? [b.x + o[0] * scale(), b.y - o[1] * scale()] : null;
      };
    case 'PLANET_VALUE':
    case 'WEATHER':
      return () => {
        const b = base(),
          o = game.valueStyle?.offset || [0, 0];
        return b ? [b.x + o[0] * scale(), b.y - o[1] * scale()] : null;
      };
    case 'AFFILIATION':
    case 'CREDITS':
    case 'COINS':
      return null;
    default:
      return () => {
        const b = base();
        return b ? [b.x, b.y] : null;
      };
  }
}

function floating(game, at) {
  const el = document.createElement('div'),
    s = () => game.overlayScale?.() || 1;
  el.style.cssText = 'position:fixed;pointer-events:none;z-index:8;border-radius:50%';
  const place = () => {
    const p = at();
    if (!p) {
      el.style.display = 'none';
      return;
    }
    const r = 36 * s();
    Object.assign(el.style, { display: '', left: p[0] - r / 2 + 'px', top: p[1] - r / 2 + 'px', width: r + 'px', height: r + 'px' });
  };
  place();
  document.body.appendChild(el);
  const timer = setInterval(place, 50);
  setTimeout(() => {
    clearInterval(timer);
    el.remove();
  }, 1600);
  return el;
}

async function openTutorialDialog(game, textId, showContinue) {
  game.tutorialDialog?.close?.();
  const dlg = await openDialog('IDD_TUTORIAL_DIALOG', { nativeImages: true, nativeFonts: true, nativeLists: true }).catch(() => null);
  if (!dlg) return;
  game.tutorialDialog = dlg;
  dlg.textList('IDC_TUTORIAL_TEXT', () => db.t(textId) || String(textId || ''), '#fff');
  dlg.show?.('IDC_CONTINUE', !!showContinue);
  const quit = () => {
    dlg.close();
    toMainMenu();
  };
  dlg.on('IDC_CONTINUE', () => {
    dlg.close();
    game.tutorialDialog = null;
    game.story?.generic?.('Continue_Tutorial');
    game.tacticalStory?.generic?.('Continue_Tutorial');
  });
  for (const id of ['IDC_DIALOG_CLOSE_BUTTON', 'IDC_QUIT_TO_MAIN']) dlg.on(id, quit);
}

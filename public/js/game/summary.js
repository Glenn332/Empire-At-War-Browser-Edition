import { db } from '../gamedata.js';
import { iconUrl } from '../icons.js';
import { openDialog } from './dialogs.js';
import { battlePlanetName } from './battleplanet.js';

const isHero = ty => [...ty.categories()].some(c => c.includes('HERO'));
let ranked = null, rankedFor = -1;
const rank = ty => {
  if (rankedFor !== db.types.size) { ranked = new Map(); let i = 0; for (const t of db.types.values()) ranked.set(t, i++); rankedFor = db.types.size; }
  return ranked.get(ty) ?? Infinity;
};

export function summaryRows(lost) {
  const all = [...(lost || new Map())].filter(([ty, n]) => n > 0 && ty.num('Score_Cost_Credits', 0) >= 1).sort((a, b) => rank(a[0]) - rank(b[0]));
  return { heroes: all.filter(([ty]) => isHero(ty)), units: all.filter(([ty]) => !isHero(ty)) };
}

export function bountyLine(collected, collects) {
  if (!(collected >= 1) && !collects) return null;
  return (db.t('TEXT_SUMMARY_BOUNTY_COLLECTED') || 'Salvage collected: $ %d').replace('%d', String(Math.trunc(collected || 0)));
}

export function fillSummary(dlg, { title, time, planet, yours, enemy, bounty = 0, collects = false, icon = ty => ty.str('Icon_Name') }) {
  dlg.setText('IDC_TITLE_STATIC', title);
  dlg.setText('IDC_TIME_STATIC', time);
  dlg.setText('IDC_BATTLE_END_PLANET_STATIC', planet || '');
  for (const id of ['IDC_LAND_INVADE_BUTTON', 'IDC_SAVE_REPLAY_BUTTON', 'IDC_COUNTDOWN_TIMER']) dlg.show(id, false);
  for (const id of ['IDC_RIGHT_ARROW1', 'IDC_RIGHT_ARROW2']) { dlg.setImage(id, iconUrl('i_tree_arrow_right.tga')); dlg.imageFrame(id, false); }
  const line = bountyLine(bounty, collects);
  dlg.show('IDC_STATIC_BOUNTY', line !== null);
  if (line !== null) dlg.setText('IDC_STATIC_BOUNTY', line);
  const fill = (side, lost) => {
    const { heroes, units } = summaryRows(lost);
    const put = (prefix, namePrefix, list, from = 0) => {
      let i = 0;
      for (; dlg.ctl(prefix + i); i++) {
        const it = list[from + i];
        dlg.show(prefix + i, !!it);
        if (namePrefix && dlg.ctl(namePrefix + i)) dlg.show(namePrefix + i, !!it);
        dlg.imageText(prefix + i, it && it[1] > 1 ? String(it[1]) : '');
        if (!it) continue;
        const [ty] = it, c = dlg.ctl(prefix + i);
        dlg.setImage(prefix + i, iconUrl(icon(ty)));
        dlg.imageFrame(prefix + i, false);
        c.title = db.t(ty.str('Text_ID')) || ty.name;
        if (namePrefix) dlg.setText(namePrefix + i, c.title);
      }
      return i;
    };
    put(`IDC_${side}_HERO`, null, heroes);
    const slots = put(`IDC_${side}_UNIT`, `IDC_${side}_UNIT_NAME`, units);
    const first = dlg.def.controls.find(c => c.id === `IDC_${side}_UNIT0`), bar = dlg.def.controls.find(c => c.id === `IDC_${side}_SCROLLBAR`);
    const over = first && bar ? { x: first.x, y: bar.y, w: bar.x - first.x, h: bar.h } : null;
    dlg.scroll(`IDC_${side}_SCROLLBAR`, units.length - slots, v => put(`IDC_${side}_UNIT`, `IDC_${side}_UNIT_NAME`, units, v), over);
  };
  fill('YOUR', yours);
  fill('ENEMY', enemy);
}

export function openSummary() {
  return openDialog('IDD_BATTLE_END_DIALOG', { nativeImages: true, nativeFonts: true, nativeLists: true }).catch(() => null);
}

export function battleTime(seconds) {
  const t = Math.max(0, Math.floor(seconds || 0)), two = n => String(n).padStart(2, '0');
  return `${db.t('TEXT_BATTLE_TIME') || 'Battle Time:'} ${two(Math.floor(t / 3600))}:${two(Math.floor(t / 60) % 60)}:${two(t % 60)}`;
}

export async function showSummary(game, won, me) {
  const dlg = await openSummary();
  if (!dlg) return false;
  const t = game.world.time;
  const scored = game.scripts && game.scripts.losses ? game.scripts.losses() : null;
  const losses = scored && [...scored.values()].some(m => m.size) ? scored : game.losses;
  const foe = new Map();
  for (const [team, m] of losses) if (team !== me) for (const [ty, n] of m) foe.set(ty, (foe.get(ty) || 0) + n);
  fillSummary(dlg, {
    title: db.t(won ? 'TEXT_WIN_BATTLE' : 'TEXT_LOST_BATTLE') || (won ? 'Victory!' : 'Defeat!'),
    time: battleTime(t),
    planet: game.setup?.campaign ? battlePlanetName(game) : '',
    yours: losses.get(me), enemy: foe,
    bounty: game.human ? game.human.bounty : game.world?.collected?.[game.me] || 0, collects: !!(game.human?.faction || db.faction(game.factions?.[game.me]))?.bool('Benefits_From_Corruption'),
  });
  const au = game.audio, hush = au ? au.menuOnly : false, held = game.paused;
  if (au) { au.menuOnly = true; au.stopLoops?.(); }
  if (!game.lock) game.paused = true;
  game.endScreen = true;
  const resume = () => { if (au) au.menuOnly = hush; if (!game.lock) game.paused = held; game.endScreen = false; };
  dlg.on('IDC_CONTINUE_BUTTON', () => { dlg.close(); resume(); game.tacticalStory?.generic('battle_end_closed'); if (game.campaignOutcome) game.returnToGalaxy(); else game.toggleMenu(); });
  game.summary = dlg;
  return true;
}

import { db } from '../gamedata.js';
import { openDialog } from './dialogs.js';
import { autoCombatant, resolveAutoBattle, unpackContrast } from './galacticautoresolve.js';

const key = s => String(s || '').toUpperCase();

export function spaceRosters(world, campaign) {
  const side = teamIndex => {
    const team = world.teams[teamIndex], out = [];
    for (const u of world.units) {
      if (u.dead || u.isPad || u.underConstruction || u.player.team !== team || u.player.id < 0) continue;
      const c = autoCombatant(u.type, u.player.factionName, { station: !!u.isStation, space: true });
      c.entity = u; out.push(c);
    }
    return out;
  };
  return [side(campaign.attacker.team), side(campaign.defender.team)];
}

export function landRosters(world, factions, sides) {
  const side = index => {
    const out = [];
    for (const u of world.units) {
      if (u.dead || u.structure || u.side !== index) continue;
      const c = autoCombatant(u.type, factions[index], { space: false });
      c.entity = u; out.push(c);
    }
    return out;
  };
  return sides.map(side);
}

export function resolveTactical(rosters, campaign, { space = true, random = Math.random } = {}) {
  const contrast = unpackContrast(campaign.autoResolve?.contrast);
  const scale = Math.fround(db.constants.num('Auto_Resolve_Tactical_Multiplier', 1));
  const result = resolveAutoBattle(rosters[0], rosters[1], contrast, { space, random, scale });
  const doomed = [];
  rosters.forEach((roster, i) => { for (const u of roster) if (!result.sides[i].alive.has(u)) doomed.push(u.entity); });
  return { winner: result.winner, doomed };
}

export async function openRetreatDialog({ retreat, autoResolve }) {
  const dlg = await openDialog('IDD_RETREAT_DIALOG').catch(() => null);
  if (!dlg) return false;
  dlg.setText('IDC_RETREAT_HEADER', db.t('TEXT_RETREAT_DIALOG'));
  const close = then => () => { dlg.close(); then?.(); };
  dlg.on('IDC_RETREAT', close(retreat));
  dlg.on('IDC_RETRY_CANCEL', close());
  dlg.on('IDC_AUTORESOLVE', close(autoResolve));
  return dlg;
}

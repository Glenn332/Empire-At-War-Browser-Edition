import { db } from '../gamedata.js';
const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();

export const sandboxGate = game => {
  const c = game.setup?.campaign;
  if (!c || c.linked || game.setup.linkedTactical || game.setup.tacticalStoryPlot) return false;
  const me = key(localFaction(game)),
    player = (c.galaxy?.players || []).find(p => key(p.faction) === me);
  return !player?.tutorial;
};
const localFaction = game =>
  game.human?.factionName || game.factions?.[game.me] || game.setup?.teamFactions?.[game.setup.players?.find(p => p.human)?.team ?? 0];
const defends = game => key(localFaction(game)) === key(game.setup?.teamFactions?.[1]);
const isSpace = game => game.setup?.mode !== 'land';

const isCapturePoint = o => [...o.type.list('Behavior'), ...o.type.list('LandBehavior')].some(b => key(b) === 'CAPTURE_POINT');

export function sandboxPlot(game) {
  if (isSpace(game) || defends(game)) return 'SANDBOX_STANDARD.XML';
  const structure = game.sandboxStructure;
  if (structure) return isCapturePoint(structure) ? 'SANDBOX_LAND_CAPTURE.XML' : 'SANDBOX_LAND_DESTROY.XML';
  return 'SANDBOX_STANDARD.XML';
}

function presentTypes(game) {
  const out = new Set();
  for (const u of game.world?.units || []) {
    if (u.dead) continue;
    if (u.type?.name) out.add(key(u.type.name));
    if (u.squad?.type?.name) out.add(key(u.squad.type.name));
  }
  for (const q of game.world?.squads || []) if (!q.dead && q.type?.name) out.add(key(q.type.name));
  return out;
}

export function setSandboxObjectives(host, game, plot, constants) {
  if (!plot) return false;
  const ev = name => plot.events.get(key(name)),
    C = constants,
    me = key(localFaction(game)),
    space = isSpace(game);
  const good = key(C.str('Good_Side_Name')),
    evil = key(C.str('Evil_Side_Name'));
  const goodLeader = C.str('Good_Side_Leader_Name').trim(),
    evilLeader = C.str('Evil_Side_Leader_Name').trim();
  const corrupt = C.str('Corrupt_Side_Leader_Name').trim().split(/\s+/).filter(Boolean);
  const here = presentTypes(game),
    has = n => here.has(key(n));
  const goodHere = space && has(goodLeader),
    evilHere = has(evilLeader),
    corruptHere = corrupt.find(has);
  let protect = null,
    kill = null;
  if (me === good) {
    if (goodHere) protect = { text: 'TEXT_TACTICAL_PRIMARY_PROTECT_GOOD_LEADER', list: [goodLeader] };
    if (evilHere) kill = { text: 'TEXT_TACTICAL_PRIMARY_KILL_EVIL_LEADER', list: [evilLeader] };
    if (corruptHere) kill = { text: 'TEXT_TACTICAL_PRIMARY_KILL_CORRUPT_LEADER', list: [...(kill?.list || []), corruptHere] };
  } else if (me === evil) {
    if (evilHere) protect = { text: 'TEXT_TACTICAL_PRIMARY_PROTECT_EVIL_LEADER', list: [evilLeader] };
    if (goodHere) kill = { text: 'TEXT_TACTICAL_PRIMARY_KILL_EVIL_LEADER', list: [goodLeader] };
    if (corruptHere) kill = { text: 'TEXT_TACTICAL_PRIMARY_KILL_CORRUPT_LEADER', list: [...(kill?.list || []), corruptHere] };
  } else {
    if (corruptHere) protect = { text: 'TEXT_TACTICAL_PRIMARY_PROTECT_CORUPT_LEADER', list: [corruptHere] };
    const list = [goodHere && goodLeader, evilHere && evilLeader].filter(Boolean);
    if (list.length) kill = { text: 'TEXT_TACTICAL_PRIMARY_KILL_EVIL_LEADER', list };
  }
  const primary = 'TEXT_TACTICAL_PRIMARY_' + (space ? 'SPACE' : 'LAND') + (defends(game) ? '_DEFEND' : '_ATTACK');
  for (const name of ['Sandbox_Objective_1', 'Sandbox_Objective_1_Complete']) {
    const e = ev(name);
    if (e) e.rewards[0] = primary;
  }
  const done1 = ev('Sandbox_Objective_1_Complete');
  if (done1) done1.params[0] = localFaction(game);
  const structure = !space && game.sandboxStructure;
  if (structure) {
    const text = structure.type.str('Secondary_Objective').trim();
    const o2 = ev('Sandbox_Objective_2');
    if (o2) o2.rewards[0] = text;
    const done2 = ev('Sandbox_Objective_2_Complete');
    if (done2) {
      done2.rewards[0] = text;
      done2.params[0] = structure.type.name;
      if (isCapturePoint(structure)) done2.params[1] = localFaction(game);
      else done2.params[2] = '1';
    }
  }
  if (protect) {
    for (const name of ['Sandbox_Objective_3', 'Sandbox_Objective_3_Complete', 'Sandbox_Objective_3_Failed']) {
      const e = ev(name);
      if (e) e.rewards[0] = protect.text;
    }
    const failed = ev('Sandbox_Objective_3_Failed');
    if (failed) {
      failed.params[0] = protect.list.join(',');
      failed.params[2] = '1';
    }
  }
  if (kill) {
    for (const name of ['Sandbox_Objective_4', 'Sandbox_Objective_4_Complete']) {
      const e = ev(name);
      if (e) e.rewards[0] = kill.text;
    }
    const done = ev('Sandbox_Objective_4_Complete');
    if (done) {
      done.params[0] = kill.list.join(',');
      done.params[2] = '1';
    }
  }
  if (protect) {
    const e = ev('Sandbox_Objective_3_Enable');
    if (e) host.fire(e);
  }
  if (kill) {
    const e = ev('Sandbox_Objective_4_Enable');
    if (e) host.fire(e);
  }
  if (!space) {
    const w = game.world?.weather,
      table = game.world?.tables?.weather;
    const now = table?.get((w && (w.level ?? w.strength) > 0.5 ? w.name : 'clear') || 'clear') || table?.get('clear');
    if (now?.objective) host.objectives.add(now.objective, true);
    const c = game.setup?.campaign,
      planet = c?.galaxy?.planets?.[c.planet],
      type = db.type(planet?.type || c?.planetType);
    const meP = (c?.galaxy?.players || []).find(q => key(q.faction) === me);
    if (type && planet && key(planet.owner) !== me && !(meP?.captureRewards || []).some(n => key(n) === key(type.name))) {
      const text = db
        .t('TEXT_TACTICAL_PLANETARY_CREDIT_BONUS')
        .replace(/%d/, String(Math.trunc(type.num('Planet_Capture_Bonus_Reward', 0))));
      host.objectives.add('TEXT_TACTICAL_PLANETARY_CREDIT_BONUS', true, text);
    }
    const w0 = game.world,
      side = game.me ?? 0;
    for (const u of (w0?.units || []).filter(x => !x.dead && x.structure && x.type?.has?.('Spawned_Indigenous_Units_Type'))) {
      const friendly = w0.ally?.(u.side, side),
        texts = u.type
          .str(friendly ? 'Friendly_Spawn_Text' : 'Enemy_Spawn_Text')
          .trim()
          .split(/\s+/)
          .filter(Boolean);
      const at = Math.max(
          0,
          [...db.factions.keys()].findIndex(k => key(k) === me)
        ),
        text = texts.length ? texts[Math.min(at, texts.length - 1)] : '';
      if (!text) continue;
      const hostile = !friendly;
      host.objectives.add(text, !hostile);
      if (!hostile || ev(u.type.name + '_00')) continue;
      host.addEvent(plot, {
        name: u.type.name + '_00',
        type: 'STORY_CHECK_DESTROYED',
        params: [localFaction(game), 'DESTROY_ALL_INDIGENOUS_SPAWNERS', u.type.name],
        reward: 'OBJECTIVE_COMPLETE',
        rewards: [text]
      });
      host.addEvent(plot, {
        name: u.type.name + '_01',
        type: 'STORY_TRIGGER',
        prereqs: [[u.type.name + '_00']],
        reward: 'CREDITS',
        rewards: [String(Math.trunc(C.num('Indigenous_Spawn_Destruction_Reward', 0)))]
      });
    }
  }
  return true;
}

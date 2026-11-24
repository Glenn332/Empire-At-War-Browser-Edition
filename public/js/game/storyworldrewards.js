// Story rewards that change the battle itself, kept apart from the page-only tutorial effects so they can run
// wherever the battle is stepped. Returns true when the reward was one of these.
import { setSkirmishRules } from './tacticalrules.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const atoi = s => parseInt(String(s ?? '').trim(), 10) || 0;
const present = s => s !== undefined && String(s).length > 0;

export function storyWorldReward(host, e) {
  const game = host.game,
    p = e.rewards || [];
  switch (e.reward) {
    case 'SKIRMISH_RULES':
      if (!present(p[0])) host.errors?.set(e.name, 'SKIRMISH_RULES takes one parameter, and param = 0 or 1');
      else {
        game.skirmishRules = atoi(p[0]) !== 0;
        if (game.world?.tacticalRules) {
          game.world.tacticalRules = setSkirmishRules(game.skirmishRules);
          game.mirror?.setRules?.(game.world.tacticalRules);
        }
      }
      return true;
    case 'BOMBARD_DELAY':
      if (!present(p[0])) host.errors?.set(e.name, 'BOMBARD_DELAY takes one parameter');
      else if (game.world) game.world.bombardDelay = parseFloat(p[0]) || 0;
      return true;
    case 'SET_HEALTH': {
      if (!present(p[0]) || !present(p[1])) return true;
      const pct = atoi(p[1]),
        list = (game.world?.units || []).filter(u => !u.dead && key((u.type || u.def)?.name) === key(p[0]));
      if (!list.length) {
        host.errors?.set(e.name, "Can't find type " + key(p[0]));
        return true;
      }
      let n = present(p[2]) ? atoi(p[2]) : 1;
      if (n === 0) n = list.length;
      for (const u of list.slice(0, Math.max(0, n))) if (u.maxHealth > 0) u.health = (u.maxHealth * pct) / 100;
      return true;
    }
  }
  return false;
}

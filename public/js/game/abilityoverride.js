const key = s => String(s || '').toUpperCase();
const yes = v => !/^(no|false|0)$/i.test(String(v ?? 'Yes').trim());

export const overrideState = { any: false };

export function setAbilityOverride(player, type, ability, disabled) {
  if (!player) return false;
  overrideState.any = true;
  const map = (player.abilityOverrides ||= {}),
    k = key(type) + '|' + key(ability),
    was = map[k];
  map[k] = !!disabled;
  return was !== !!disabled;
}

export function abilityEnabled(g, owner, type, ability) {
  const player = g?.players?.find(p => key(p.faction) === key(owner)),
    map = player?.abilityOverrides,
    name = ability?.attrs?.Name || ability?.val?.('Name') || '';
  if (map && type) {
    const k = key(type.name || type) + '|' + key(name);
    if (k in map) return !map[k];
  }
  return yes(ability?.val?.('Initially_Enabled', 'Yes'));
}

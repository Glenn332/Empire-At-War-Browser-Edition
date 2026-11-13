const MODE_BITS = { POWER_TO_WEAPONS: 2, ROCKET_ATTACK: 4, TURBO: 8, DEFEND: 16 };
const DELAY_TAGS = {
  DEFEND: 'Defend_Mode_Weapon_Delay_Multiplier',
  TURBO: 'Turbo_Mode_Weapon_Delay_Multiplier',
  POWER_TO_WEAPONS: 'Power_To_Weapons_Mode_Weapon_Delay_Multiplier',
  FULL_SALVO: 'Full_Salvo_Weapon_Delay_Multiplier'
};
export const ALL_MODES = 31;

export function hardpointModes(def) {
  return (
    (def.bool('Fire_When_In_Normal_Attack_Mode', true) ? 1 : 0) |
    (def.bool('Fire_When_In_Power_To_Weapons_Mode', true) ? 2 : 0) |
    (def.bool('Fire_When_In_Rocket_Attack_Mode', true) ? 4 : 0) |
    (def.bool('Fire_When_In_Turbo_Mode', true) ? 8 : 0) |
    (def.bool('Fire_When_In_Defend_Mode', true) ? 16 : 0)
  );
}

export function hardpointDelays(def) {
  let out = null;
  for (const kind in DELAY_TAGS) {
    const v = def.num(DELAY_TAGS[kind], 1);
    if (v !== 1) (out ||= {})[kind] = v;
  }
  return out;
}

export function modeAllows(modes, abilities) {
  if (modes === ALL_MODES) return true;
  let rocket = false;
  for (let i = 0, n = Math.min(2, abilities.length); i < n; i++) {
    const st = abilities[i];
    if (!st.active) continue;
    const bit = MODE_BITS[st.def.kind];
    if (bit === 4) rocket = true;
    else if (bit && !(modes & bit)) return false;
  }
  return !!(modes & (rocket ? 4 : 1));
}

export function modeDelay(hp, abilities) {
  if (!hp.delays) return 1;
  let k = 1;
  for (let i = 0, n = Math.min(2, abilities.length); i < n; i++) {
    const st = abilities[i];
    if (st.active && hp.delays[st.def.kind] !== undefined) k *= hp.delays[st.def.kind];
  }
  return k;
}

export const rechargeDelay = (hp, abilities) => Math.min(1, modeDelay(hp, abilities));

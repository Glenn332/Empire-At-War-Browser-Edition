const MODE_BITS = { POWER_TO_WEAPONS: 2, ROCKET_ATTACK: 4, TURBO: 8 };

export function hardpointModes(def) {
  return (
    (def.bool('Fire_When_In_Normal_Attack_Mode', true) ? 1 : 0) |
    (def.bool('Fire_When_In_Power_To_Weapons_Mode', true) ? 2 : 0) |
    (def.bool('Fire_When_In_Rocket_Attack_Mode', true) ? 4 : 0) |
    (def.bool('Fire_When_In_Turbo_Mode', true) ? 8 : 0)
  );
}

export function fireMode(abilities) {
  let m = 0;
  for (const st of abilities) if (st.active) m |= MODE_BITS[st.def.kind] || 0;
  return m || 1;
}

export const SALVO_DELAY = 0.15;

export function modeDelay(hp, abilities) {
  let k = 1;
  for (const st of abilities)
    if (st.active) {
      if (st.def.kind === 'FULL_SALVO') k *= hp.salvoDelay / SALVO_DELAY;
      else if (st.def.kind === 'POWER_TO_WEAPONS') k *= hp.ptwDelay;
    }
  return k;
}

export function modeAllows(modes, abilities) {
  if (modes === 15) return true;
  const m = fireMode(abilities);
  return (modes & m) === m;
}

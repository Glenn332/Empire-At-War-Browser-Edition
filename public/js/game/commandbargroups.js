// How the tactical command bar lays out a selection, read from the engine:
// - a stack is the selected units of one type (and owner) whose primary ability is in the same state;
// - a panel is every stack whose primary ability (the type's first unit ability) is the same, so different
//   types share a panel; units with no ability form their own panel, units held inside another ship go last;
// - panels run in the engine's ability order, stacks in the order their first unit was selected;
// - inside a panel the slots run down each column (top, then bottom), and a panel always ends on a column
//   boundary, so it takes ceil(slots / 2) columns and gets one border piece and its ability buttons over them;
// - every unit has its own slot until the bar is too full; then the biggest stack not yet collapsed becomes one
//   slot with a count, again and again until everything fits. What still does not fit is left off the bar by
//   the engine; ours scrolls instead (see layoutSelectionPanels).

// The engine's unit ability numbering, which orders the panels.
const ABILITY_ORDER = [
  'DEFEND', 'DEPLOY', 'INTERDICT', 'HARASS', 'BARRAGE', 'HUNT', 'SPREAD_OUT', 'AFTERBURNER', 'TURBO', 'LURE',
  'ROCKET_ATTACK', 'AVOID_DANGER', 'FORCE_TELEKINESIS', 'FORCE_WHIRLWIND', 'FORCE_LIGHTNING', 'FLAME_THROWER',
  'JET_PACK', 'CAPTURE_VEHICLE', 'TARGETED_INVULNERABILITY', 'TARGETED_HACK', 'TARGETED_REPAIR', 'STICKY_BOMB',
  'AREA_EFFECT_STUN', 'AREA_EFFECT_HEAL', 'AREA_EFFECT_CONVERT', 'DISTRACT', 'CABLE_ATTACK', 'FOW_REVEAL_PING',
  'POWER_TO_WEAPONS', 'TRACTOR_BEAM', 'ENERGY_WEAPON', 'MISSILE_SHIELD', 'INVULNERABILITY', 'LUCKY_SHOT',
  'HARMONIC_BOMB', 'UNTARGETED_STICKY_BOMB', 'CONCENTRATE_FIRE', 'DEPLOY_TROOPERS', 'SELF_DESTRUCT', 'SPRINT',
  'ION_CANNON_SHOT', 'WEAKEN_ENEMY', 'SPOILER_LOCK', 'REPLENISH_WINGMEN', 'MAXIMUM_FIREPOWER',
  'EJECT_VEHICLE_THIEF', 'FIRE_LOBBING_SUPERWEAPON', 'STEALTH', '', 'RADIOACTIVE_CONTAMINATE', 'BERSERKER',
  'FORCE_SIGHT', 'SABER_THROW', 'FORCE_CLOAK', 'SUPER_LASER', 'LASER_DEFENSE', 'FORCE_CONFUSE', 'LEECH_SHIELDS',
  'TACTICAL_BRIBE', 'SWAP_WEAPONS', 'CLUSTER_BOMB', 'FULL_SALVO', 'SENSOR_JAMMING', 'PLACE_REMOTE_BOMB',
  'DETONATE_REMOTE_BOMB', 'INFECTION', 'PROXIMITY_MINES', 'STIM_PACK', 'DRAIN_LIFE', 'BLAST', 'BUZZ_DROIDS',
  'SHIELD_FLARE', 'SUMMON', 'CORRUPT_SYSTEMS', 'DEPLOY_SQUAD'
];
const ABILITY_RANK = new Map(ABILITY_ORDER.map((kind, i) => [kind, i + 1]).filter(([kind]) => kind));
const NO_ABILITY_RANK = 0;
const HELD_RANK = ABILITY_ORDER.length + 1;
const UNKNOWN_ABILITY_RANK = HELD_RANK - 0.5;

const COLUMNS = 12;

function primaryAbility(unit) {
  return unit.abilities[0] || null;
}

function abilityStateKey(ability) {
  if (!ability) return 0;
  if (ability.active) return 1;
  if (ability.cooldown > 0) return 2;
  return 3;
}

function panelRank(unit, held) {
  if (held) return HELD_RANK;
  const ability = primaryAbility(unit);
  if (!ability) return NO_ABILITY_RANK;
  return ABILITY_RANK.get(ability.def.kind) ?? UNKNOWN_ABILITY_RANK;
}

function buildPanels(units, heldBy) {
  const panels = new Map();
  for (const unit of units) {
    const held = heldBy.has(unit),
      ability = held ? null : primaryAbility(unit);
    const panelKey = held ? 'held' : ability ? ability.def.kind : '';
    let panel = panels.get(panelKey);
    if (!panel) {
      panel = { rank: panelRank(unit, held), held, stacks: new Map(), units: [] };
      panels.set(panelKey, panel);
    }
    const stackKey = unit.type.name + '|' + unit.player.id + '|' + abilityStateKey(ability);
    let stack = panel.stacks.get(stackKey);
    if (!stack) panel.stacks.set(stackKey, (stack = { units: [], collapsed: false }));
    stack.units.push(unit);
    panel.units.push(unit);
  }
  return [...panels.values()].sort((a, b) => a.rank - b.rank).map(panel => ({ ...panel, stacks: [...panel.stacks.values()] }));
}

function panelSlotCount(panel) {
  return panel.stacks.reduce((count, stack) => count + (stack.collapsed ? 1 : stack.units.length), 0);
}

function slotsNeeded(panels) {
  return panels.reduce((count, panel) => count + Math.ceil(panelSlotCount(panel) / 2) * 2, 0);
}

function collapseUntilFits(panels, capacity) {
  while (slotsNeeded(panels) > capacity) {
    let biggest = null;
    for (const panel of panels)
      for (const stack of panel.stacks)
        if (!stack.collapsed && stack.units.length > 1 && (!biggest || stack.units.length > biggest.units.length)) biggest = stack;
    if (!biggest) return;
    biggest.collapsed = true;
  }
}

function abilityDefsOf(panel) {
  if (panel.held) return [];
  const lead = panel.units[0];
  return lead.abilities.map(ability => ability.def);
}

// Lays the selected units out on the 12 x 2 slot bar. `skipColumns` columns on the left are covered by other
// controls. Stacks are collapsed until the selection fits, as the engine does; a selection that still does not fit
// (more stacks than slots) scrolls, our own addition where the engine leaves the rest off: `scrollColumns` is how
// many columns the view is moved right. Returns the 24 slot items, one record per shown column and how many
// columns the whole selection takes.
export function layoutSelectionPanels(units, heldBy, skipColumns, scrollColumns = 0) {
  const visibleColumns = COLUMNS - skipColumns;
  const panels = buildPanels(units, heldBy);
  collapseUntilFits(panels, visibleColumns * 2);
  const allItems = [],
    allColumns = [];
  for (const panel of panels) {
    const firstSlot = allItems.length;
    for (const stack of panel.stacks) {
      if (stack.collapsed) allItems.push({ unit: stack.units[0], group: stack.units, held: heldBy.get(stack.units[0]), panel: panel.units, selection: units });
      else for (const unit of stack.units) allItems.push({ unit, held: heldBy.get(unit), panel: panel.units, selection: units });
    }
    if (allItems.length === firstSlot) continue;
    if (allItems.length % 2) allItems.push(null);
    allColumns.push({ first: firstSlot / 2, last: allItems.length / 2 - 1, units: panel.units, defs: abilityDefsOf(panel), held: panel.held });
  }
  const totalColumns = allItems.length / 2,
    scroll = Math.max(0, Math.min(totalColumns - visibleColumns, scrollColumns)),
    shift = skipColumns - scroll;
  const items = new Array(COLUMNS * 2).fill(null),
    columns = [];
  for (let slot = 0; slot < visibleColumns * 2; slot++) items[skipColumns * 2 + slot] = allItems[scroll * 2 + slot] || null;
  for (const panel of allColumns) {
    const first = Math.max(panel.first, scroll) + shift,
      last = Math.min(panel.last, scroll + visibleColumns - 1) + shift;
    if (last < first) continue;
    const span = last - first + 1;
    for (let col = first; col <= last; col++)
      columns.push({
        col,
        first,
        span,
        units: panel.units,
        defs: panel.defs,
        held: panel.held,
        part: span === 1 ? 0 : col === first ? 1 : col === last ? 3 : 2
      });
  }
  return { items, columns, totalColumns, scrollColumns: scroll };
}

// What a click on a unit slot selects, narrowing step by step: while the bar shows more than one panel, the
// whole panel of the clicked unit (every unit sharing its primary ability); once one panel is left, every unit of
// the clicked type (and owner); once one type is left, the clicked slot alone (a unit, or the stack behind a count).
export function slotClickSelection(entry) {
  const slotUnits = entry.group || [entry.unit];
  if (!entry.panel || !entry.selection) return slotUnits;
  if (entry.panel.length < entry.selection.length) return entry.panel;
  const sameType = entry.panel.filter(unit => unit.type === entry.unit.type && unit.player === entry.unit.player);
  if (sameType.length < entry.panel.length) return sameType;
  return slotUnits;
}

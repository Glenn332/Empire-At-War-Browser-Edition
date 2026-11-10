export const MOD = Object.freeze({
  DEFENSE: 0,
  DAMAGE: 1,
  HEALTH: 2,
  SHIELD: 3,
  ENERGY: 4,
  SPEED: 5,
  FIRE_RATE: 6,
  SIGHT: 7,
  RANGE: 8,
  RECHARGE: 9,
  BUILD: 10
});
const COUNT = 11;
const LOW = [-Infinity, -1, -0.99, -1, -1, -0.99, -0.99, -Infinity, -Infinity, -0.99, -0.99];
const HIGH = [0.75, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
const OWN_ONLY = [false, false, false, false, false, true, false, false, false, true, true];

function best(list) {
  let v = list[0].value;
  for (let i = 1; i < list.length; i++) if (list[i].value > v) v = list[i].value;
  return v;
}

function total(mine, other) {
  let sum = 0;
  if (!other || !other.size) {
    const keys = mine.size > 1 ? [...mine.keys()].sort((a, b) => a - b) : mine.keys();
    for (const k of keys) sum += best(mine.get(k));
    return sum;
  }
  const keys = [...new Set([...mine.keys(), ...other.keys()])].sort((a, b) => a - b);
  for (const k of keys) {
    const a = mine.get(k),
      b = other.get(k);
    sum += a && b ? Math.max(best(a), best(b)) : best(a || b);
  }
  return sum;
}

export class CombatMods {
  constructor(sides = null, owner = null) {
    this.lists = Array.from({ length: COUNT }, () => new Map());
    this.sides = sides && owner ? sides : null;
    this.owner = owner;
    this.size = 0;
    this.version = 0;
    this.memo = new Float64Array(COUNT);
    this.memoAt = new Int32Array(COUNT).fill(-2);
    this.memoWith = new Array(COUNT).fill(null);
  }

  changed(type) {
    this.version++;
    this.memoAt[type] = -2;
  }

  add(type, key, source, value) {
    const m = this.lists[type];
    let list = m.get(key);
    if (!list) m.set(key, (list = []));
    list.push({ source, value });
    this.size++;
    this.changed(type);
    return true;
  }

  set(type, key, source, value) {
    const list = this.lists[type].get(key);
    const e = list && list.find(x => x.source === source);
    if (!e) return this.add(type, key, source, value);
    if (e.value === value) return false;
    e.value = value;
    this.changed(type);
    return true;
  }

  remove(type, key, source) {
    const m = this.lists[type],
      list = m.get(key);
    if (!list) return false;
    const kept = list.filter(x => x.source !== source);
    if (kept.length === list.length) return false;
    this.size -= list.length - kept.length;
    if (kept.length) m.set(key, kept);
    else m.delete(key);
    this.changed(type);
    return true;
  }

  drop(source) {
    let hit = false;
    for (let t = 0; t < COUNT; t++) for (const k of [...this.lists[t].keys()]) if (this.remove(t, k, source)) hit = true;
    return hit;
  }

  shared(type) {
    return OWN_ONLY[type] || this.sides === null ? null : this.sides[this.owner.side] || null;
  }

  sum(type, shared) {
    if (shared === undefined) shared = OWN_ONLY[type] || this.sides === null ? null : this.sides[this.owner.side] || null;
    if (this.memoWith[type] === shared && this.memoAt[type] === (shared === null ? -1 : shared.version)) return this.memo[type];
    const at = shared === null ? -1 : shared.version;
    let v = this.size || (shared && shared.size) ? total(this.lists[type], shared && shared.lists[type]) : 0;
    if (v < LOW[type]) v = LOW[type];
    if (v > HIGH[type]) v = HIGH[type];
    this.memo[type] = v;
    this.memoAt[type] = at;
    this.memoWith[type] = shared;
    return v;
  }

  factor(type, shared) {
    return 1 + this.sum(type, shared);
  }
}

const BONUS_FIELDS = [
  ['Health_Bonus_Percentage', MOD.HEALTH],
  ['Damage_Bonus_Percentage', MOD.DAMAGE],
  ['Energy_Pool_Bonus_Percentage', MOD.ENERGY],
  ['Shield_Bonus_Percentage', MOD.SHIELD],
  ['Movement_Speed_Bonus_Percentage', MOD.SPEED],
  ['Defense_Bonus_Percentage', MOD.DEFENSE],
  ['Ability_Recharge_Bonus_Percentage', MOD.RECHARGE],
  ['Fire_Range_Bonus_Percentage', MOD.RANGE],
  ['Tactical_Build_Time_Bonus_Percentage', MOD.BUILD]
];
const bonuses = new WeakMap();
export function combatBonus(node) {
  if (bonuses.has(node)) return bonuses.get(node);
  const mods = [];
  for (const [field, type] of BONUS_FIELDS) {
    let v = node.num(field, 0);
    if (type === MOD.DEFENSE ? v > 1 : v <= -1) v = 0;
    if (v) mods.push([type, v]);
  }
  const out = { key: Math.trunc(node.num('Stacking_Category', 0)) || 0, mods };
  bonuses.set(node, out);
  return out;
}

export const SPACE = 1,
  LAND = 2;
const STYLE_MODES = {
  GLOBAL_AUTOMATIC: SPACE | LAND,
  COMBAT_AUTOMATIC: SPACE | LAND,
  GALACTIC_AUTOMATIC: SPACE | LAND,
  SPACE_AUTOMATIC: SPACE,
  GROUND_AUTOMATIC: LAND
};
const words = s =>
  String(s || '')
    .split(/[\s,|]+/)
    .filter(Boolean)
    .map(x => x.toUpperCase());
const sourceDefs = new WeakMap();
const NONE = Object.freeze([]);

function allSourceDefs(type) {
  let all = sourceDefs.get(type);
  if (all) return all;
  all = { [SPACE]: [], [LAND]: [] };
  const abilities = type && type.sub ? type.sub('Abilities').flatMap(x => x.all('Combat_Bonus_Ability')) : [];
  const self = abilities.length > 0 && type.bool('Apply_Special_Ability_To_Self_On_Creation'),
    unique = new Set([type.str('Unique_Space_Unit'), type.str('Unique_Ground_Unit')].map(s => s.trim().toUpperCase()).filter(Boolean));
  abilities.forEach((node, index) => {
    const b = combatBonus(node);
    if (!b.mods.length || /^(no|false)$/i.test(node.val('Initially_Enabled').trim())) return;
    const modes = STYLE_MODES[node.val('Activation_Style').trim().toUpperCase() || 'COMBAT_AUTOMATIC'] || 0;
    const def = {
      node,
      index,
      key: b.key,
      mods: b.mods,
      types: new Set(words(node.val('Applicable_Unit_Types'))),
      cats: words(node.val('Applicable_Unit_Categories')),
      exTypes: new Set(words(node.val('Excluded_Unit_Types'))),
      exCats: words(node.val('Excluded_Unit_Categories')),
      faction: node.val('Specific_Faction').trim().toUpperCase(),
      self,
      unique
    };
    if (modes & SPACE) all[SPACE].push(def);
    if (modes & LAND) all[LAND].push(def);
  });
  if (!all[SPACE].length) all[SPACE] = NONE;
  if (!all[LAND].length) all[LAND] = NONE;
  sourceDefs.set(type, all);
  return all;
}

export function bonusSourceDefs(type, mode) {
  return type ? allSourceDefs(type)[mode] : NONE;
}

export function bonusTypeFits(def, type, alias = '') {
  const cats = type.categories();
  if (!cats.size) return false;
  const name = type.name.toUpperCase();
  if (def.unique.has(name)) return false;
  if (def.types.has(name) || (alias && def.types.has(alias))) return true;
  if (!def.cats.length || def.exTypes.has(name)) return false;
  let any = false;
  for (const c of def.cats) if (cats.has(c)) any = true;
  if (!any) return false;
  for (const c of def.exCats) if (cats.has(c)) return false;
  return true;
}

export function bonusOwnerFits(def, targetFaction, allied) {
  return def.faction ? String(targetFaction || '').toUpperCase() === def.faction : allied;
}

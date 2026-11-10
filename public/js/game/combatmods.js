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
const OWN_ONLY = [false, false, false, false, false, true, false, false, false, false, true];

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

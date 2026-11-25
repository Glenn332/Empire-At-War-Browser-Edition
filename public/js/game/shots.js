// Shots in flight keep what changes every step (where they are, where they are going, how long and how far they have
// flown) in columns of numbers, one row per shot (ours). A big battle has ten thousand shots in the air, nearly all of
// them plain bolts that fly straight until they hit something or run out: those are stepped from the columns alone,
// and the shot itself is only looked at when it ends. A Shot reads and writes its row through ordinary properties, so
// the rest of the game uses it as before.

// Kinds of shot the step can tell apart from the columns.
// anything with behaviour of its own: homing, a path, a point to reach, a delay, a bomb
export const SHOT_GENERAL = 0;
// flies straight and can hit
export const SHOT_PLAIN = 1;

// A row is not given to a new shot until this many steps after its shot ended, so that whatever still holds the
// ended shot for a moment (an effect following it, a frame being drawn) reads that shot's last place, not another's.
const STEPS_BEFORE_REUSE = 4;

export class ShotStore {
  constructor() {
    this.capacity = 0;
    this.used = 0;
    this.homing = 0;
    this.free = [];
    this.ended = [];
    this.endedAt = [];
    this.step = 0;
    this.grow(4096);
  }

  grow(capacity) {
    const numbers = name => {
      const column = new Float64Array(capacity);
      if (this[name]) column.set(this[name]);
      this[name] = column;
    };
    for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'flown', 'speed', 'reach', 'life']) numbers(name);
    for (const name of ['kind', 'dead', 'hidden', 'homingFlag']) {
      const column = new Uint8Array(capacity);
      if (this[name]) column.set(this[name]);
      this[name] = column;
    }
    const ids = new Float64Array(capacity);
    if (this.id) ids.set(this.id);
    this.id = ids;
    this.team = this.team || [];
    this.capacity = capacity;
  }

  // A row for a new shot.
  take() {
    if (this.free.length) return this.free.pop();
    if (this.used === this.capacity) this.grow(this.capacity * 2);
    return this.used++;
  }

  // The shot of this row ended; the row comes back into use a few steps later.
  release(row) {
    if (this.homingFlag[row]) this.homing--;
    this.homingFlag[row] = 0;
    this.team[row] = null;
    this.ended.push(row);
    this.endedAt.push(this.step);
  }

  // Once a step: rows whose shots ended long enough ago are free again.
  nextStep() {
    this.step++;
    let given = 0;
    while (given < this.ended.length && this.step - this.endedAt[given] >= STEPS_BEFORE_REUSE) this.free.push(this.ended[given++]);
    if (given) {
      this.ended.splice(0, given);
      this.endedAt.splice(0, given);
    }
  }
}

export class Shot {
  // made: the shot as World.launch and World.launchPoint describe it (see there for what each field means);
  // kind: SHOT_PLAIN when the step may fly it from the columns alone.
  constructor(store, made, kind) {
    const row = store.take();
    this.store = store;
    this.row = row;
    this.def = made.def;
    this.speed = made.speed;
    this.cat = made.cat;
    this.target = made.target;
    this.targetHp = made.targetHp;
    this.ox = made.ox;
    this.oy = made.oy;
    this.oz = made.oz;
    this.sx = made.sx;
    this.sy = made.sy;
    this.sz = made.sz;
    this.aim = made.aim;
    this.point = made.point;
    this.wait = made.wait;
    this.reach = made.reach;
    this.fall = made.fall;
    this.team = made.team;
    this.path = made.path;
    this.damage = made.damage;
    this.mult = made.mult;
    this.blastRange = made.blastRange;
    this.blastDamage = made.blastDamage;
    this.ion = made.ion;
    this.ionSpeed = made.ionSpeed;
    this.ionDelay = made.ionDelay;
    this.damageType = made.damageType;
    this.owner = made.owner;
    this.from = made.from;
    this.shields = made.shields;
    this.hull = made.hull;
    this.homing = made.homing;
    this.turn = made.turn;
    this.scan = made.scan;
    this.width = made.width;
    this.length = made.length;
    this.fx = made.fx;
    this.r = made.r;
    this.g = made.g;
    this.b = made.b;
    this.missile = made.missile;
    this.life = made.life;
    this.end = made.end;
    this.fxs = null;
    this.fxSeen = 0;
    this.hitDone = false;
    store.id[row] = made.id;
    store.x[row] = made.x;
    store.y[row] = made.y;
    store.z[row] = made.z;
    store.vx[row] = made.vx;
    store.vy[row] = made.vy;
    store.vz[row] = made.vz;
    store.age[row] = 0;
    store.flown[row] = 0;
    store.speed[row] = made.speed;
    store.reach[row] = made.reach;
    store.life[row] = made.life > 0 ? made.life : 0;
    store.kind[row] = kind;
    store.dead[row] = 0;
    store.hidden[row] = 0;
    store.team[row] = made.team;
    store.homingFlag[row] = made.homing ? 1 : 0;
    if (made.homing) store.homing++;
  }

  get id() {
    return this.store.id[this.row];
  }
  get x() {
    return this.store.x[this.row];
  }
  set x(value) {
    this.store.x[this.row] = value;
  }
  get y() {
    return this.store.y[this.row];
  }
  set y(value) {
    this.store.y[this.row] = value;
  }
  get z() {
    return this.store.z[this.row];
  }
  set z(value) {
    this.store.z[this.row] = value;
  }
  get vx() {
    return this.store.vx[this.row];
  }
  set vx(value) {
    this.store.vx[this.row] = value;
  }
  get vy() {
    return this.store.vy[this.row];
  }
  set vy(value) {
    this.store.vy[this.row] = value;
  }
  get vz() {
    return this.store.vz[this.row];
  }
  set vz(value) {
    this.store.vz[this.row] = value;
  }
  get age() {
    return this.store.age[this.row];
  }
  set age(value) {
    this.store.age[this.row] = value;
  }
  get flown() {
    return this.store.flown[this.row];
  }
  set flown(value) {
    this.store.flown[this.row] = value;
  }
  get dead() {
    return this.store.dead[this.row] === 1;
  }
  set dead(value) {
    this.store.dead[this.row] = value ? 1 : 0;
  }
  get hidden() {
    return this.store.hidden[this.row] === 1;
  }
  set hidden(value) {
    this.store.hidden[this.row] = value ? 1 : 0;
  }
}

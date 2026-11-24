// Collects the fighters that asked to move this step, packs them and the obstacles they steer around, moves
// them all (on the job threads when the battle has them) and writes the results back. The packing and the
// kernel are the same with and without job threads, so a battle plays out the same either way.
import { F, O, MoveScene, moveFighter, flyRow } from './fighterflight.js';
import { MOVE_CAP, MOVE_HEAD, readMoveHead, sharedMoveScene } from './scanjobs.js';

const grown = (array, Type, size) => (array && array.length >= size ? array : new Type(Math.max(size, array ? array.length * 2 : 1024)));

export class FighterMoves {
  constructor(world) {
    this.world = world;
    this.fighters = [];
    this.requests = [];
    this.local = { head: new Float64Array(8), fighters: null, obstacles: null, keys: null, starts: null, items: null };
    this.obstacleRows = new Map();
    this.sortedKeys = [];
  }

  // Called from a fighter's step once it knows where it wants to go.
  request(unit, goalX, goalY, goalZ, goalZDefault, want, wantIfHit, turnFactor, loopAllowed, leader) {
    const r = (unit.fstate.move ||= { goalX: 0, goalY: 0, goalZ: 0, goalZDefault: 0, want: 0, wantIfHit: 0, turnFactor: 1, loopAllowed: 1, leader: 0 });
    r.goalX = goalX;
    r.goalY = goalY;
    r.goalZ = goalZ;
    r.goalZDefault = goalZDefault;
    r.want = want;
    r.wantIfHit = wantIfHit;
    r.turnFactor = turnFactor;
    r.loopAllowed = loopAllowed ? 1 : 0;
    r.leader = leader ? 1 : 0;
    this.fighters.push(unit);
  }

  // Flies one fighter toward a point for one step with no obstacle check, as the step's flight does.
  flyOne(unit, x, y, z, want, dt, turnFactor = 1, loopAllowed = true) {
    const store = this.localStore(1),
      w = this.world;
    this.request(unit, x, y, z, z, want, NaN, turnFactor, loopAllowed, false);
    this.fighters.pop();
    this.packFighters(store, [unit]);
    const scene = new MoveScene(store.fighters, store.obstacles, store.keys, store.starts, store.items, () => null);
    scene.minX = w.min.x;
    scene.minY = w.min.y;
    scene.maxX = w.max.x;
    scene.maxY = w.max.y;
    scene.dt = dt;
    flyRow(scene, 0, x, y, z, want);
    this.unpack(store, [unit]);
  }

  // Moves every fighter that asked this step and returns them, in the order they asked.
  run(dt) {
    const list = this.fighters;
    this.fighters = [];
    let count = 0;
    for (const u of list) if (!u.dead && !u.suspended) list[count++] = u;
    list.length = count;
    if (!count) return list;
    const w = this.world,
      ahead = w.ahead,
      shared = ahead && ahead.moveShared();
    const fits = shared && count <= MOVE_CAP.FIGHTERS && w.obstacles.length <= MOVE_CAP.OBSTACLES;
    const store = fits ? shared : this.localStore(count);
    if (!this.packObstacles(store, fits)) return this.runLocal(list, dt);
    this.packFighters(store, list);
    const h = store.head;
    h[MOVE_HEAD.MIN_X] = w.min.x;
    h[MOVE_HEAD.MIN_Y] = w.min.y;
    h[MOVE_HEAD.MAX_X] = w.max.x;
    h[MOVE_HEAD.MAX_Y] = w.max.y;
    h[MOVE_HEAD.DT] = dt;
    const meshes = ahead ? ahead.meshList : [];
    const scene = fits ? sharedMoveScene(store, meshes) : new MoveScene(store.fighters, store.obstacles, store.keys, store.starts, store.items, ref => meshes[ref] || null);
    if (fits) ahead.runMoves(count, scene);
    else {
      readMoveHead(scene, store);
      for (let i = 0; i < count; i++) moveFighter(scene, i);
    }
    this.unpack(store, list);
    return list;
  }

  runLocal(list, dt) {
    const store = this.localStore(list.length);
    this.packObstacles(store, false);
    this.packFighters(store, list);
    const w = this.world,
      h = store.head,
      meshes = w.ahead ? w.ahead.meshList : [];
    h[MOVE_HEAD.MIN_X] = w.min.x;
    h[MOVE_HEAD.MIN_Y] = w.min.y;
    h[MOVE_HEAD.MAX_X] = w.max.x;
    h[MOVE_HEAD.MAX_Y] = w.max.y;
    h[MOVE_HEAD.DT] = dt;
    const scene = new MoveScene(store.fighters, store.obstacles, store.keys, store.starts, store.items, ref => meshes[ref] || null);
    readMoveHead(scene, store);
    for (let i = 0; i < list.length; i++) moveFighter(scene, i);
    this.unpack(store, list);
    return list;
  }

  localStore(count) {
    const L = this.local,
      w = this.world;
    L.fighters = grown(L.fighters, Float64Array, count * F.STRIDE);
    L.obstacles = grown(L.obstacles, Float64Array, Math.max(1, w.obstacles.length) * O.STRIDE);
    return L;
  }

  // The battle's probe grid, cell by cell in ascending key order, with each obstacle's pose now. False when
  // it does not fit the shared columns.
  packObstacles(store, shared) {
    const w = this.world,
      grid = w.obstacleGrid,
      rows = this.obstacleRows,
      keys = this.sortedKeys,
      ahead = w.ahead;
    rows.clear();
    keys.length = 0;
    let items = 0;
    if (grid)
      for (const [key, list] of grid)
        if (list.length) {
          keys.push(key);
          items += list.length;
        }
    keys.sort((a, b) => a - b);
    if (shared && (keys.length > MOVE_CAP.CELLS || items > MOVE_CAP.ITEMS)) return false;
    if (!shared) {
      store.keys = grown(store.keys, Float64Array, keys.length);
      store.starts = grown(store.starts, Int32Array, keys.length + 1);
      store.items = grown(store.items, Int32Array, items);
    }
    const ob = store.obstacles;
    let at = 0;
    for (let c = 0; c < keys.length; c++) {
      store.keys[c] = keys[c];
      store.starts[c] = at;
      for (const o of grid.get(keys[c])) {
        let row = rows.get(o);
        if (row === undefined) {
          row = rows.size;
          rows.set(o, row);
          const r = row * O.STRIDE,
            cull = o.cull,
            box = o.lookBox;
          ob[r + O.ID] = o.id;
          ob[r + O.X] = o.x;
          ob[r + O.Y] = o.y;
          ob[r + O.Z] = o.z;
          ob[r + O.HEADING] = o.heading || 0;
          ob[r + O.PITCH] = o.pitch || 0;
          ob[r + O.ROLL] = o.roll || 0;
          ob[r + O.SCALE] = o.scale || 1;
          ob[r + O.HAS_CULL] = cull ? 1 : 0;
          if (cull) for (let i = 0; i < 6; i++) ob[r + O.CULL + i] = cull[i];
          ob[r + O.HAS_BOX] = box ? 1 : 0;
          if (box) for (let i = 0; i < 6; i++) ob[r + O.BOX + i] = box[i];
          ob[r + O.MESH] = !box && o.coll && ahead ? ahead.meshRef(o.coll) : -1;
        }
        store.items[at++] = row;
      }
    }
    store.starts[keys.length] = at;
    store.head[MOVE_HEAD.CELLS] = keys.length;
    return true;
  }

  packFighters(store, list) {
    const fi = store.fighters,
      w = this.world;
    for (let i = 0; i < list.length; i++) {
      const u = list[i],
        st = u.fstate,
        r = st.move,
        row = i * F.STRIDE,
        fly = w.flight(u);
      fi[row + F.ID] = u.id;
      fi[row + F.X] = u.x;
      fi[row + F.Y] = u.y;
      fi[row + F.Z] = u.z;
      fi[row + F.HEADING] = u.heading;
      fi[row + F.PITCH] = u.pitch === undefined ? NaN : u.pitch;
      fi[row + F.ROLL] = u.roll === undefined ? NaN : u.roll;
      fi[row + F.SPEED] = u.speed;
      fi[row + F.TURN_RATE] = u.turnRate;
      fi[row + F.ACCEL] = u.accel === undefined ? NaN : u.accel;
      fi[row + F.LIFT] = fly.lift;
      fi[row + F.ROLL_RATE] = fly.roll;
      fi[row + F.THRUST] = fly.thrust;
      fi[row + F.BANK] = fly.bank;
      fi[row + F.GOAL_X] = r.goalX;
      fi[row + F.GOAL_Y] = r.goalY;
      fi[row + F.GOAL_Z] = r.goalZ;
      fi[row + F.GOAL_Z_DEFAULT] = r.goalZDefault;
      fi[row + F.WANT] = r.want;
      fi[row + F.WANT_IF_HIT] = r.wantIfHit;
      fi[row + F.TURN_FACTOR] = r.turnFactor;
      fi[row + F.LOOP_ALLOWED] = r.loopAllowed;
      fi[row + F.LEADER] = r.leader;
      fi[row + F.LOOP] = st.loop === undefined ? NaN : st.loop;
      fi[row + F.AVOID] = st.avoid === undefined ? NaN : st.avoid;
      fi[row + F.FLIPPED] = 0;
    }
  }

  unpack(store, list) {
    const fi = store.fighters;
    for (let i = 0; i < list.length; i++) {
      const u = list[i],
        st = u.fstate,
        row = i * F.STRIDE,
        pitch = fi[row + F.PITCH],
        loop = fi[row + F.LOOP],
        avoid = fi[row + F.AVOID];
      u.x = fi[row + F.X];
      u.y = fi[row + F.Y];
      u.z = fi[row + F.Z];
      u.heading = fi[row + F.HEADING];
      u.pitch = pitch === pitch ? pitch : undefined;
      u.roll = fi[row + F.ROLL];
      u.speed = fi[row + F.SPEED];
      st.loop = loop === loop ? loop : undefined;
      st.avoid = avoid === avoid ? avoid : undefined;
      if (fi[row + F.FLIPPED]) u.flip = true;
      u.syncObj();
    }
  }
}

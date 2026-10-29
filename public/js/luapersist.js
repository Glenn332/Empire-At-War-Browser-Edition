import { LuaRef } from './lua.js';

const T = {
  NIL: 0,
  BOOLEAN: 1,
  LIGHT: 2,
  NUMBER: 3,
  STRING: 4,
  TABLE: 5,
  LCL: 6,
  USERDATA: 7,
  THREAD: 8,
  LCF: 22,
  CCL: 38,
  NUMINT: 19,
  NUMFLT: 3,
  LNGSTR: 20,
  SHRSTR: 4
};
const CIST_LUA = 2;
const latin1 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096)
    s += String.fromCharCode.apply(null, bytes.subarray ? bytes.subarray(i, i + 4096) : bytes.slice(i, i + 4096));
  return s;
};
const unlatin1 = s => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
};

const packInts = ints => {
  const u = new Uint8Array(new Int32Array(ints).buffer);
  let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return btoa(s);
};
const unpackInts = text => {
  const s = atob(text),
    u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return Array.from(new Int32Array(u.buffer));
};

const MASK1 = (n, p) => ~(~0 << n) << p;
const decodeInstruction = ins => ({
  code: ins,
  opcode: (ins >> 0) & MASK1(6, 0),
  A: (ins >> 6) & MASK1(8, 0),
  B: (ins >> 23) & MASK1(9, 0),
  C: (ins >> 14) & MASK1(9, 0),
  Bx: (ins >> 14) & MASK1(18, 0),
  Ax: (ins >> 6) & MASK1(26, 0),
  sBx: ((ins >> 14) & MASK1(18, 0)) - 131071
});

export class LuaPersist {
  constructor(vm) {
    this.vm = vm;
    this.L = vm.L;
    this.hooks = { describe: () => undefined, resolve: () => undefined };
    this.perms = new Map();
    this.byName = new Map();
    this.probe();
  }

  probe() {
    const { lua, aux } = this.vm,
      L = this.L,
      F = this.vm.F;
    const top = () => L.stack[L.top - 1],
      tv0 = top;
    const base = L.top;
    this.TValue = (L.stack[0] || L.stack[base - 1] || top()).constructor;
    lua.lua_newtable(L);
    this.Table = top().value.constructor;
    aux.luaL_loadstring(L, F.to_luastring('local a = 1; return function() return a end'));
    this.LClosure = top().value.constructor;
    this.Proto = top().value.p.constructor;
    lua.lua_call(L, 0, 1);
    lua.lua_pushinteger(L, 1);
    lua.lua_pushcclosure(L, () => 0, 1);
    this.CClosure = top().value.constructor;
    lua.lua_pushstring(L, F.to_luastring('s'));
    this.TString = top().value.constructor;
    lua.lua_newuserdata(L, 0);
    this.Udata = top().value.constructor;
    lua.lua_newthread(L);
    const th = top().value;
    this.Thread = th.constructor;
    this.CallInfo = th.ci.constructor;
    lua.lua_settop(L, base);
  }

  refValue(ref) {
    const { lua, L } = this.vm;
    const reg = L.l_G.l_registry.value,
      e = reg.strong.get(ref);
    return e ? e.value : this.nilValue();
  }
  nilValue() {
    return new this.TValue(T.NIL, null);
  }
  newRef(tv) {
    const { lua, aux, L } = this.vm;
    this.pushValue(L, tv);
    return aux.luaL_ref(L, lua.LUA_REGISTRYINDEX);
  }
  pushValue(L, tv) {
    this.vm.lua.lua_checkstack(L, 4);
    L.stack[L.top] = new this.TValue(tv.type, tv.value);
    L.top++;
  }

  freezePerms() {
    this.perms.clear();
    this.byName.clear();
    const { visit, table, name } = this.walker();
    const g = this.L.l_G;
    visit(g.l_registry, 'R');
    g.mt.forEach((m, i) => {
      if (m) table(m, 'MT' + i);
    });
    name(this.L, 'main');
    this.nameInternals();
    this.signatures = new Map();
    for (const [obj] of this.perms) if (obj instanceof this.Table) this.signatures.set(obj, this.signature(obj));
  }

  adoptGlobals() {
    const { lua, L } = this.vm;
    lua.lua_pushglobaltable(L);
    const G = L.stack[L.top - 1].value;
    lua.lua_pop(L, 1);
    const path = this.perms.get(G);
    if (!path) return;
    const { visit, keyName } = this.walker();
    let n = 0;
    for (let e = G.f; e; e = e.n) {
      if (!this.perms.has(e.value.value)) visit(e.value, path + '.' + keyName(e.key, n));
      n++;
    }
    for (const [obj] of this.perms)
      if (obj instanceof this.Table && !this.signatures.has(obj)) this.signatures.set(obj, this.signature(obj));
    this.signatures.set(G, this.signature(G));
  }

  walker() {
    const seen = this.perms;
    const name = (obj, path) => {
      if (seen.has(obj)) return false;
      seen.set(obj, path);
      this.byName.set(path, obj);
      return true;
    };
    const keyName = (k, n) =>
      k.type === T.NUMINT || k.type === T.NUMFLT
        ? 'n' + k.value
        : k.type === T.LNGSTR || k.type === T.SHRSTR
          ? 's' + latin1(k.value.realstring)
          : 'k' + n;
    const visit = (tv, path) => {
      const v = tv.value;
      switch (tv.type) {
        case T.TABLE:
          return table(v, path);
        case T.LCL:
          return closure(v, path);
        case T.CCL:
          return cclosure(v, path);
        case T.LCF:
          if (name(v, path)) this.byName.set(path, v);
          return;
        case T.LIGHT:
          if (v && typeof v === 'object') name(v, path);
          else if (typeof v === 'function') name(v, path);
          return;
        case T.THREAD:
          name(v, path);
          return;
        case T.USERDATA:
          if (name(v, path) && v.metatable) table(v.metatable, path + '#m');
          return;
      }
    };
    const table = (t, path) => {
      if (!name(t, path)) return;
      if (t.metatable) table(t.metatable, path + '#m');
      let n = 0;
      for (let e = t.f; e; e = e.n) {
        visit(e.value, path + '.' + keyName(e.key, n));
        if (e.key.type >= T.TABLE && e.key.type !== T.LNGSTR && e.key.type !== T.NUMINT) visit(e.key, path + '.k' + n);
        n++;
      }
    };
    const closure = (c, path) => {
      if (!name(c, path)) return;
      c.upvals.forEach((u, i) => visit(u, path + '^' + i));
    };
    const cclosure = (c, path) => {
      if (!name(c, path)) return;
      name(c.f, path + '.f');
      c.upvalue.forEach((u, i) => visit(u, path + '^' + i));
    };
    return { visit, table, name, keyName };
  }

  signature(t) {
    let n = 0,
      h = 0;
    for (let e = t.f; e; e = e.n) {
      n++;
      h = (h * 31 + (e.value.type | 0) + (typeof e.value.value === 'number' ? e.value.value | 0 : 0)) | 0;
    }
    return n + ':' + h + ':' + (t.metatable ? 1 : 0);
  }

  changed() {
    const out = [];
    for (const [t, sig] of this.signatures) {
      const name = this.perms.get(t);
      if (name !== 'R' && !name.includes('^') && this.signature(t) !== sig) out.push(name);
    }
    return out;
  }

  nameInternals() {
    const { lua, aux, L } = this.vm,
      F = this.vm.F,
      base = L.top;
    const note = (f, n) => {
      if (typeof f === 'function' && !this.perms.has(f)) {
        this.perms.set(f, n);
        this.byName.set(n, f);
      }
    };
    const run = (src, n) => {
      if (aux.luaL_loadstring(L, F.to_luastring(src)) !== 0 || lua.lua_pcall(L, 0, n, 0) !== 0) {
        lua.lua_settop(L, base);
        return [];
      }
      const out = [];
      for (let i = L.top - n; i < L.top; i++) out.push(L.stack[i]);
      return out;
    };
    for (const [src, label] of [
      ['local co = coroutine.create(function() pcall(coroutine.yield) end); coroutine.resume(co); return co', 'pcall'],
      ['local co = coroutine.create(function() xpcall(coroutine.yield, print) end); coroutine.resume(co); return co', 'xpcall']
    ]) {
      const [co] = run(src, 1);
      if (co) for (let ci = co.value.base_ci; ci; ci = ci.next) if (ci.c_k) note(ci.c_k, 'int:cont:' + label);
      lua.lua_settop(L, base);
    }
    const [wrapped] = run('return coroutine.wrap(function() end)', 1);
    if (wrapped && wrapped.type === T.CCL) note(wrapped.value.f, 'int:auxwrap');
    lua.lua_settop(L, base);
    const [gm] = run("return string.gmatch('a', 'a')", 1);
    if (gm && gm.type === T.CCL) {
      note(gm.value.f, 'int:gmatch');
      this.gmatchFn = gm.value.f;
    }
    lua.lua_settop(L, base);
    const [ip] = run('return ipairs({})', 1);
    if (ip && ip.type === T.LCF) note(ip.value, 'int:ipairsaux');
    lua.lua_settop(L, base);
  }

  begin() {
    return new Session(this);
  }
  restore(data) {
    return new Restored(this, data);
  }
}

class Session {
  constructor(p) {
    this.p = p;
    this.nodes = [];
    this.ids = new Map();
    this.todo = [];
    this.trail = [];
    this.protoIds = new Map();
    this.protoKeys = new Map();
    this.tplIds = new Map();
  }

  id(obj, kind) {
    let id = this.ids.get(obj);
    if (id === undefined) {
      id = this.nodes.length;
      this.nodes.push(null);
      this.ids.set(obj, id);
      this.todo.push([id, obj, kind]);
    }
    return id;
  }

  enc(tv) {
    const p = this.p,
      v = tv.value;
    switch (tv.type) {
      case T.NIL:
        return null;
      case T.BOOLEAN:
        return v;
      case T.NUMINT:
        return v;
      case T.NUMFLT:
        return Number.isFinite(v) && !Number.isInteger(v)
          ? v
          : { f: Object.is(v, -0) ? '-0' : Number.isNaN(v) ? 'nan' : v === Infinity ? 'inf' : v === -Infinity ? '-inf' : String(v) };
      case T.SHRSTR:
      case T.LNGSTR:
        return latin1(v.realstring);
      case T.TABLE:
      case T.LCL:
      case T.CCL:
      case T.THREAD:
      case T.USERDATA: {
        const perm = p.perms.get(v);
        if (perm !== undefined) return { p: perm };
        return { r: this.id(v, tv.type) };
      }
      case T.LCF:
        return this.fn(v);
      case T.LIGHT: {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return { l: [typeof v, v] };
        if (v === null || v === undefined) return { l: ['undefined'] };
        const perm = p.perms.get(v);
        if (perm !== undefined) return { p: perm };
        const d = p.hooks.describe(v);
        if (d === undefined)
          throw new Error(
            'a Lua value holds an object of the engine that cannot be saved (' +
              (v.__name || v.constructor?.name || typeof v) +
              ') at ' +
              this.where()
          );
        return { h: d };
      }
      default:
        throw new Error('cannot save a Lua value of type ' + tv.type + ' at ' + this.where());
    }
  }

  fn(f) {
    const p = this.p,
      perm = p.perms.get(f);
    if (perm !== undefined) return { p: perm };
    const origin = f.__obj ? { obj: f.__obj, key: f.__key } : p.vm.origins?.get(f);
    if (origin?.require)
      return { q: [this.enc({ type: T.TABLE, value: origin.require.env }), this.enc({ type: T.TABLE, value: origin.require.loaded })] };
    if (origin) {
      const d = p.hooks.describe(origin.obj);
      if (d === undefined)
        throw new Error(
          'a function of an engine object that cannot be saved (' + (origin.obj.__name || '?') + '.' + origin.key + ') at ' + this.where()
        );
      return { o: [d, origin.key] };
    }
    throw new Error(
      'a JavaScript function in the Lua state that has no name' + (f.name ? ' (' + f.name + ')' : '') + ' at ' + this.where()
    );
  }

  where() {
    return this.trail.slice(-6).join(' > ');
  }

  js(v) {
    const p = this.p;
    if (v === undefined) return { u: 1 };
    if (v === null) return null;
    switch (typeof v) {
      case 'boolean':
      case 'string':
        return v;
      case 'number':
        return Number.isFinite(v) ? v : { n: Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf' };
      case 'object': {
        if (v instanceof LuaRef) return { lr: this.enc(p.refValue(v.ref)) };
        if (Array.isArray(v)) return { a: v.map(x => this.js(x)) };
        if (v instanceof Map) return { m: [...v].map(([k, x]) => [this.js(k), this.js(x)]) };
        if (v instanceof Set) return { st: [...v].map(x => this.js(x)) };
        if (v.__wrap) {
          const perm = p.perms.get(v);
          if (perm !== undefined) return { pw: perm };
          const d = p.hooks.describe(v);
          if (d === undefined) throw new Error('a story value is an object of the engine that cannot be saved: ' + (v.__name || '?'));
          return { w: d };
        }
        if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) {
          const o = {};
          for (const k of Object.keys(v)) o[k] = this.js(v[k]);
          return { o };
        }
        throw new Error('a story value cannot be saved: ' + (v.constructor?.name || 'object'));
      }
      default:
        throw new Error('a story value cannot be saved: a ' + typeof v);
    }
  }

  cell(tv) {
    return this.id(tv, 'cell');
  }

  end() {
    while (this.todo.length) {
      const [id, obj, kind] = this.todo.pop();
      this.nodes[id] = this.node(obj, kind);
    }
    return { nodes: this.nodes };
  }

  node(obj, kind) {
    const p = this.p;
    switch (kind) {
      case 'cell': {
        this.trail.push('cell');
        const v = this.enc(obj);
        this.trail.pop();
        return { k: 'c', v };
      }
      case T.TABLE: {
        this.trail.push('table#' + obj.id);
        const bound = p.hooks.bound?.(obj),
          info = p.vm.envInfo.get(obj);
        const e = [];
        let n = 0;
        for (let en = obj.f; en; en = en.n) {
          const kname = en.key.type === T.LNGSTR || en.key.type === T.SHRSTR ? latin1(en.key.value.realstring) : null;
          if (bound && info && kname !== null && info.host.has(kname) && info.host.get(kname) === en.value.value) {
            n++;
            continue;
          }
          this.trail.push(kname ?? '#' + n);
          e.push([this.enc(en.key), this.enc(en.value)]);
          this.trail.pop();
          n++;
        }
        this.trail.pop();
        const keepMeta = obj.metatable && !(bound && info && info.meta === obj.metatable);
        return { k: 't', ...(bound ? { b: bound } : {}), m: keepMeta ? this.enc({ type: T.TABLE, value: obj.metatable }) : null, e };
      }
      case T.LCL: {
        this.trail.push('closure@' + obj.p.linedefined + ' ' + (obj.p.source ? latin1(obj.p.source.realstring) : ''));
        const out = { k: 'l', p: this.proto(obj.p), u: obj.upvals.map(c => this.cell(c)) };
        this.trail.pop();
        return out;
      }
      case T.CCL: {
        if (p.gmatchFn && obj.f === p.gmatchFn) {
          const [s, pat, gm] = obj.upvalue;
          return { k: 'gm', s: latin1(s.value.realstring), p: latin1(pat.value.realstring), src: gm.value.src, last: gm.value.lastmatch };
        }
        return { k: 'cc', f: this.fn(obj.f), u: obj.upvalue.map(c => this.cell(c)) };
      }
      case T.THREAD:
        return this.thread(obj);
      case T.USERDATA:
        throw new Error('a full userdata in the Lua state cannot be saved');
      default:
        throw new Error('unknown node ' + kind);
    }
  }

  proto(pr) {
    let id = this.protoIds.get(pr);
    if (id !== undefined) return id;
    if (pr.tpl !== undefined) {
      id = this.tplIds.get(pr.tpl);
      if (id !== undefined) {
        this.protoIds.set(pr, id);
        return id;
      }
    }
    const s = x => (x && x.realstring ? latin1(x.realstring) : x ? latin1(x) : null);
    const node = {
      k: 'p',
      code: packInts(pr.code.map(i => i.code)),
      kk: pr.k.map(c => this.enc(c)),
      pp: pr.p.map(c => this.proto(c)),
      li: packInts(pr.lineinfo),
      up: pr.upvalues.map(u => [s(u.name), u.instack ? 1 : 0, u.idx]),
      np: pr.numparams,
      va: pr.is_vararg ? 1 : 0,
      ms: pr.maxstacksize,
      lv: pr.locvars.map(v => [s(v.varname), v.startpc, v.endpc]),
      ld: pr.linedefined,
      lld: pr.lastlinedefined,
      src: s(pr.source)
    };
    const text = JSON.stringify(node);
    id = this.protoKeys.get(text);
    if (id === undefined) {
      id = this.nodes.length;
      this.nodes.push(node);
      this.protoKeys.set(text, id);
    }
    this.protoIds.set(pr, id);
    if (pr.tpl !== undefined) this.tplIds.set(pr.tpl, id);
    return id;
  }

  thread(L1) {
    if (L1.errorJmp) throw new Error('a coroutine that is running cannot be saved');
    this.trail.push('thread#' + L1.id);
    let limit = L1.top;
    const frames = [];
    for (let ci = L1.base_ci; ci; ci = ci.next) {
      limit = Math.max(limit, ci.top | 0);
      frames.push(ci);
      if (ci === L1.ci) break;
    }
    limit = Math.min(limit, L1.stack.length);
    const stack = [];
    for (let i = 0; i < L1.stack.length; i++) stack.push(i < limit && L1.stack[i] ? this.cell(L1.stack[i]) : null);
    const out = {
      k: 'th',
      len: L1.stack.length,
      stack,
      top: L1.top,
      oldpc: Number.isNaN(L1.oldpc) ? null : L1.oldpc,
      ncc: L1.nCcalls,
      hm: L1.hookmask,
      bhc: L1.basehookcount,
      ah: L1.allowhook,
      hc: L1.hookcount,
      nny: L1.nny,
      st: L1.status,
      ef: L1.errfunc,
      ci: frames.map(ci => ({
        fo: ci.funcOff,
        top: ci.top,
        lb: Number.isNaN(ci.l_base) ? null : ci.l_base,
        pc: Number.isNaN(ci.l_savedpc) ? null : ci.l_savedpc,
        k: ci.c_k ? this.fn(ci.c_k) : null,
        oe: ci.c_old_errfunc,
        cx: ci.c_ctx === undefined ? null : ci.c_ctx,
        nr: Number.isNaN(ci.nresults) ? null : ci.nresults,
        cs: Number.isNaN(ci.callstatus) ? null : ci.callstatus,
        ex: ci.extra === undefined ? null : ci.extra
      }))
    };
    this.trail.pop();
    return out;
  }
}

class Restored {
  constructor(p, data) {
    this.p = p;
    this.data = data;
    this.objs = new Array(data.nodes.length);
    const { lua } = p.vm,
      L = p.L,
      nodes = data.nodes;
    nodes.forEach((n, i) => {
      switch (n.k) {
        case 't': {
          if (n.b) {
            const t = p.hooks.boundTable(n.b);
            if (!t) throw new Error('a table the host makes is not there to load into: ' + n.b);
            this.objs[i] = t;
            break;
          }
          lua.lua_createtable(L, 0, 0);
          this.objs[i] = L.stack[L.top - 1].value;
          lua.lua_pop(L, 1);
          break;
        }
        case 'c':
          this.objs[i] = new p.TValue(T.NIL, null);
          break;
        case 'l':
          this.objs[i] = new p.LClosure(L, n.u.length);
          break;
        case 'cc':
          this.objs[i] = null;
          break;
        case 'gm': {
          lua.lua_getglobal(L, p.vm.str('string'));
          lua.lua_getfield(L, -1, p.vm.str('gmatch'));
          lua.lua_pushstring(L, unlatin1(n.s));
          lua.lua_pushstring(L, unlatin1(n.p));
          lua.lua_call(L, 2, 1);
          const cl = L.stack[L.top - 1].value;
          cl.upvalue[2].value.src = n.src;
          cl.upvalue[2].value.lastmatch = n.last;
          this.objs[i] = cl;
          lua.lua_settop(L, L.top - 3);
          break;
        }
        case 'p':
          this.objs[i] = new p.Proto(L);
          break;
        case 'th': {
          const th = lua.lua_newthread(L);
          lua.lua_pop(L, 1);
          this.objs[i] = th;
          break;
        }
      }
    });
    nodes.forEach((n, i) => {
      if (n.k === 'cc') this.objs[i] = new p.CClosure(L, this.fn(n.f), n.u.length);
    });
    nodes.forEach((n, i) => {
      if (n.k !== 'th') this.fill(n, this.objs[i]);
    });
    nodes.forEach((n, i) => {
      if (n.k === 'th') this.fill(n, this.objs[i]);
    });
  }

  str(s) {
    return s === null ? null : new this.p.TString(this.p.L, unlatin1(s));
  }

  js(e) {
    if (e === null) return null;
    switch (typeof e) {
      case 'boolean':
      case 'string':
      case 'number':
        return e;
    }
    const p = this.p;
    if (e.u) return undefined;
    if (e.n !== undefined) return e.n === 'nan' ? NaN : e.n === 'inf' ? Infinity : -Infinity;
    if (e.lr !== undefined) return p.vm.refOf(p.newRef(this.value(e.lr)));
    if (e.a) return e.a.map(x => this.js(x));
    if (e.m) return new Map(e.m.map(([k, x]) => [this.js(k), this.js(x)]));
    if (e.st) return new Set(e.st.map(x => this.js(x)));
    if (e.pw !== undefined) {
      const o = p.byName.get(e.pw);
      if (!o) throw new Error('a permanent engine object is not in this machine: ' + e.pw);
      return o;
    }
    if (e.w !== undefined) {
      const o = p.hooks.resolve(e.w);
      if (o === undefined) throw new Error('an engine object of the saved story cannot be found: ' + JSON.stringify(e.w));
      return o;
    }
    if (e.o) {
      const o = {};
      for (const k of Object.keys(e.o)) o[k] = this.js(e.o[k]);
      return o;
    }
    throw new Error('bad saved story value');
  }

  fn(e) {
    if (e.p !== undefined) {
      const f = this.p.byName.get(e.p);
      if (typeof f !== 'function') throw new Error('a function of the saved machine is not in this one: ' + e.p);
      return f;
    }
    if (e.q) {
      const p = this.p,
        env = p.newRef(this.value(e.q[0])),
        loaded = p.newRef(this.value(e.q[1]));
      p.vm.loadedOf.set(env, loaded);
      const f = p.vm.requireFunction(env, loaded);
      p.vm.origins.set(f, { require: { env: this.value(e.q[0]).value, loaded: this.value(e.q[1]).value } });
      return f;
    }
    if (e.o) {
      const obj = this.p.hooks.resolve(e.o[0]);
      if (!obj) throw new Error('an engine object of a saved function cannot be found: ' + JSON.stringify(e.o[0]));
      return this.p.vm.member(obj, e.o[1]);
    }
    throw new Error('bad function reference');
  }

  value(e) {
    const { TValue } = this.p;
    if (e === null || e === undefined) return new TValue(T.NIL, null);
    switch (typeof e) {
      case 'boolean':
        return new TValue(T.BOOLEAN, e);
      case 'number':
        return new TValue(Number.isInteger(e) ? T.NUMINT : T.NUMFLT, e);
      case 'string':
        return new TValue(T.LNGSTR, this.str(e));
    }
    if (e.f !== undefined)
      return new TValue(
        T.NUMFLT,
        e.f === 'nan' ? NaN : e.f === 'inf' ? Infinity : e.f === '-inf' ? -Infinity : e.f === '-0' ? -0 : Number(e.f)
      );
    if (e.r !== undefined) return this.heap(e.r);
    if (e.p !== undefined) return this.perm(e.p);
    if (e.h !== undefined) {
      const o = this.p.hooks.resolve(e.h);
      if (o === undefined) throw new Error('an engine object of the saved game cannot be found: ' + JSON.stringify(e.h));
      return new TValue(T.LIGHT, o);
    }
    if (e.l !== undefined) return new TValue(T.LIGHT, e.l[0] === 'undefined' ? undefined : e.l[1]);
    if (e.o !== undefined || e.q !== undefined) return new TValue(T.LCF, this.fn(e));
    throw new Error('bad saved value');
  }

  perm(name) {
    const o = this.p.byName.get(name);
    if (o === undefined) throw new Error('a permanent object of the saved machine is not in this one: ' + name);
    const { TValue } = this.p;
    if (o instanceof this.p.Table) return new TValue(T.TABLE, o);
    if (o instanceof this.p.LClosure) return new TValue(T.LCL, o);
    if (o instanceof this.p.CClosure) return new TValue(T.CCL, o);
    if (o instanceof this.p.Thread) return new TValue(T.THREAD, o);
    if (typeof o === 'function') return new TValue(T.LCF, o);
    return new TValue(T.LIGHT, o);
  }

  heap(id) {
    const o = this.objs[id],
      { TValue } = this.p;
    if (o instanceof this.p.Table) return new TValue(T.TABLE, o);
    if (o instanceof this.p.LClosure) return new TValue(T.LCL, o);
    if (o instanceof this.p.CClosure) return new TValue(T.CCL, o);
    if (o instanceof this.p.Thread) return new TValue(T.THREAD, o);
    throw new Error('a saved reference does not name a Lua value: ' + id);
  }

  fill(n, o) {
    const p = this.p,
      { lua } = p.vm,
      L = p.L;
    switch (n.k) {
      case 't': {
        if (n.m) o.metatable = this.value(n.m).value;
        else if (!n.b) o.metatable = null;
        const tv = new p.TValue(T.TABLE, o);
        for (const [k, v] of n.e) {
          p.pushValue(L, tv);
          p.pushValue(L, this.value(k));
          p.pushValue(L, this.value(v));
          lua.lua_rawset(L, -3);
          lua.lua_pop(L, 1);
        }
        break;
      }
      case 'c': {
        const v = this.value(n.v);
        o.type = v.type;
        o.value = v.value;
        break;
      }
      case 'l':
        o.p = this.objs[n.p];
        n.u.forEach((c, i) => {
          o.upvals[i] = this.objs[c];
        });
        break;
      case 'cc':
        n.u.forEach((c, i) => {
          o.upvalue[i] = this.objs[c];
        });
        break;
      case 'p': {
        o.code = unpackInts(n.code).map(decodeInstruction);
        o.k = n.kk.map(c => this.value(c));
        o.p = n.pp.map(c => this.objs[c]);
        o.lineinfo = unpackInts(n.li);
        o.upvalues = n.up.map(([name, instack, idx]) => ({ name: this.str(name), instack: !!instack, idx }));
        o.numparams = n.np;
        o.is_vararg = !!n.va;
        o.maxstacksize = n.ms;
        o.locvars = n.lv.map(([name, startpc, endpc]) => ({ varname: this.str(name), startpc, endpc }));
        o.linedefined = n.ld;
        o.lastlinedefined = n.lld;
        o.source = this.str(n.src);
        break;
      }
      case 'th':
        this.fillThread(n, o);
        break;
    }
  }

  fillThread(n, L1) {
    const p = this.p;
    L1.stack = new Array(n.len);
    n.stack.forEach((c, i) => {
      if (c !== null) L1.stack[i] = this.objs[c];
    });
    L1.top = n.top;
    L1.stack_last = n.len - 5;
    L1.oldpc = n.oldpc === null ? NaN : n.oldpc;
    L1.nCcalls = n.ncc;
    L1.hookmask = n.hm;
    L1.basehookcount = n.bhc;
    L1.allowhook = n.ah;
    L1.hookcount = n.hc;
    L1.nny = n.nny;
    L1.status = n.st;
    L1.errfunc = n.ef;
    L1.errorJmp = null;
    L1.hook = null;
    let prev = null,
      first = null;
    n.ci.forEach((c, i) => {
      const ci = i === 0 ? L1.base_ci : new p.CallInfo();
      ci.funcOff = c.fo;
      ci.func = L1.stack[c.fo];
      ci.top = c.top;
      ci.l_base = c.lb === null ? NaN : c.lb;
      ci.l_savedpc = c.pc === null ? NaN : c.pc;
      ci.c_k = c.k ? this.fn(c.k) : null;
      ci.c_old_errfunc = c.oe;
      ci.c_ctx = c.cx;
      ci.nresults = c.nr === null ? NaN : c.nr;
      ci.callstatus = c.cs === null ? NaN : c.cs;
      if (c.ex !== null) ci.extra = c.ex;
      ci.l_code = ci.callstatus & CIST_LUA && ci.func && ci.func.value && ci.func.value.p ? ci.func.value.p.code : null;
      ci.previous = prev;
      ci.next = null;
      if (prev) prev.next = ci;
      prev = ci;
      if (i === 0) first = ci;
    });
    L1.ci = prev;
    if (!first) throw new Error('a saved coroutine has no frames');
  }
}

export { LuaRef };

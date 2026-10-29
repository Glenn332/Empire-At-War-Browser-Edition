import { simRandom } from './game/simrandom.js';

let F = null;
export async function loadFengari() {
  if (F) return F;
  if (globalThis.fengari) return (F = globalThis.fengari);
  if (typeof WorkerGlobalScope !== 'undefined') {
    const text = await (await fetch(new URL('../vendor/fengari/fengari-web.js', import.meta.url))).text();
    new Function('window', text)(globalThis);
    return (F = globalThis.fengari);
  }
  if (typeof document === 'undefined') {
    const m = await import('fengari');
    return (F = m.default || m);
  }
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/fengari/fengari-web.js', import.meta.url).href;
    s.onload = res;
    s.onerror = () => rej(new Error('the Lua machine did not load'));
    document.head.appendChild(s);
  });
  return (F = globalThis.fengari);
}

export class LuaRef {
  constructor(vm, ref) {
    this.vm = vm;
    this.ref = ref;
  }
}

export const luaTrace = { on: false, call: null, event: null, error: null, script: null };
export class Multi {
  constructor(...values) {
    this.values = values;
  }
}

const COMPAT = `
table.getn = function(t) return #t end
table.setn = function() end
-- Lua 5.0 ltablib.c luaB_tremove accepts out-of-range positions. In
-- particular pos>n still clears the last array slot; 5.3 raises an error.
-- Battle casualties exercise original mod cleanup loops relying on this.
table.remove = function(t, pos)
  assert(type(t) == "table", "table expected")
  local n = table.getn(t)
  if n <= 0 then return end
  if pos == nil then pos = n else
    pos = assert(tonumber(pos), "number expected")
    pos = pos >= 0 and math.floor(pos) or math.ceil(pos)
  end
  local value = rawget(t, pos)
  for i = pos, n - 1 do rawset(t, i, rawget(t, i + 1)) end
  rawset(t, n, nil)
  return value
end
table.foreach = function(t, f) for k, v in pairs(t) do local r = f(k, v) if r ~= nil then return r end end end
table.foreachi = function(t, f) for i = 1, #t do local r = f(i, t[i]) if r ~= nil then return r end end end
string.gfind = string.gmatch
math.mod = math.fmod
-- (Lua 5.0's unpack goes by the table's n where it has one: the arg table of a vararg function keeps its nils)
unpack = function(t, i, j) return table.unpack(t, i or 1, j or (type(t) == "table" and rawget(t, "n")) or #t) end
loadstring = load
gcinfo = function() return collectgarbage("count") end
-- (the VM has no collector to drive - lua_gc is not there: every option is answered, "count" with a size, the rest with 0; the stock GameScoring asks)
collectgarbage = function(o) if o == "count" then return 0, 0 end return 0 end
function setfenv() end
-- string.format("%d", 2.7) gave "2" in Lua 5.0 (the game's library floors numbers that way); 5.3 refuses it.
-- (which arguments of a format are whole-number conversions is worked out once per format string: a script formats the same few strings all the time)
do
  local fmt, floor, ceil, mtype, plans, count = string.format, math.floor, math.ceil, math.type, {}, 0
  local function plan(f)
    local idx, i = {}, 0
    for spec in string.gmatch(f, "%%[-+ #0]*%d*%.?%d*([%a%%])") do
      if spec ~= "%" then
        i = i + 1
        if spec == "d" or spec == "i" or spec == "u" or spec == "c" or spec == "x" or spec == "X" or spec == "o" then idx[#idx + 1] = i end
      end
    end
    return #idx > 0 and idx or false
  end
  string.format = function(f, ...)
    local p = plans[f]
    if p == nil then
      if count > 4000 then plans, count = {}, 0 end
      p = plan(f); plans[f] = p; count = count + 1
    end
    if not p then return fmt(f, ...) end
    local a, n = { ... }, select("#", ...)
    for k = 1, #p do
      local i = p[k]
      local v = a[i]
      if mtype(v) == "float" then a[i] = (v >= 0 and floor(v) or ceil(v)) end
    end
    return fmt(f, table.unpack(a, 1, n))
  end
end
function getfenv() return _G end
function __where(msg) return debug.traceback(tostring(msg), 2) end
`;

const RUN_LIMIT = 1e9,
  RUN_EVERY = 100e3;

export class LuaVM {
  constructor(fengari, { source, log = () => {} }) {
    const { lua, lauxlib, lualib } = fengari;
    this.F = fengari;
    this.lua = lua;
    this.aux = lauxlib;
    this.source = source;
    this.log = log;
    this.need = new Set();
    this.chunkCount = 0;
    this.origins = new WeakMap();
    this.envInfo = new WeakMap();
    this.loadedInfo = new WeakMap();
    this.loadedOf = new Map();
    this.held =
      typeof FinalizationRegistry === 'undefined'
        ? null
        : new FinalizationRegistry(ref => {
            try {
              this.aux.luaL_unref(this.L, this.lua.LUA_REGISTRYINDEX, ref);
            } catch {}
          });
    const L = (this.L = lauxlib.luaL_newstate());
    lualib.luaL_openlibs(L);
    this.str = s => fengari.to_luastring(String(s));
    this.exec(COMPAT, 'compat');
    lua.lua_getglobal(L, this.str('math'));
    lua.lua_pushjsfunction(L, L2 => {
      const n = lua.lua_gettop(L2),
        r = simRandom();
      if (n === 0) {
        lua.lua_pushnumber(L2, r);
        return 1;
      }
      const lo = n >= 2 ? lauxlib.luaL_checkinteger(L2, 1) : 1,
        hi = lauxlib.luaL_checkinteger(L2, n >= 2 ? 2 : 1);
      lauxlib.luaL_argcheck(L2, lo <= hi, n >= 2 ? 2 : 1, 'interval is empty');
      lua.lua_pushinteger(L2, lo + Math.floor(r * (hi - lo + 1)));
      return 1;
    });
    lua.lua_setfield(L, -2, this.str('random'));
    lua.lua_pushjsfunction(L, () => 0);
    lua.lua_setfield(L, -2, this.str('randomseed'));
    lua.lua_pop(L, 1);
    lua.lua_pushjsfunction(L, L2 => {
      if (lua.lua_type(L2, 1) !== lua.LUA_TTABLE) {
        lua.lua_settop(L2, 3);
        return 3;
      }
      lua.lua_settop(L2, 1);
      lua.lua_getglobal(L2, this.str('pairs'));
      lua.lua_insert(L2, 1);
      lua.lua_call(L2, 1, 3);
      return 3;
    });
    lua.lua_setglobal(L, this.str('__iter'));
    lua.lua_pushlightuserdata(L, { __wrap: true });
    lua.lua_newtable(L);
    const set = (name, fn) => {
      lua.lua_pushjsfunction(L, this.guard(fn));
      lua.lua_setfield(L, -2, this.str(name));
    };
    set('__index', L2 => {
      const u = lua.lua_touserdata(L2, 1),
        key = lua.lua_type(L2, 2) === lua.LUA_TSTRING ? lua.lua_tojsstring(L2, 2) : null;
      let v = u && key !== null ? u[key] : undefined;
      if (v === undefined && u && key !== null && typeof u.__missing === 'function') v = u.__missing(key);
      if (typeof v === 'function') {
        const g = v.__raw ? this.raw(v, key, u) : this.fn(v, key, u);
        g.__obj = u;
        g.__key = key;
        lua.lua_pushjsfunction(L2, g);
        return 1;
      }
      this.push(v, L2);
      return 1;
    });
    set('__call', L2 => {
      const u = lua.lua_touserdata(L2, 1);
      if (!u || typeof u.__call !== 'function')
        return lauxlib.luaL_error(L2, this.str('attempt to call something of the engine that cannot be called'));
      const args = [];
      for (let i = 2, n = lua.lua_gettop(L2); i <= n; i++) args.push(this.get(i, L2));
      return this.ret(u.__call(...args), L2);
    });
    set('__tostring', L2 => {
      const u = lua.lua_touserdata(L2, 1);
      this.push(u && u.__name ? String(u.__name) : 'userdata', L2);
      return 1;
    });
    lua.lua_setmetatable(L, -2);
    lua.lua_pop(L, 1);
  }

  member(u, key) {
    let v = u[key];
    if (v === undefined && typeof u.__missing === 'function') v = u.__missing(key);
    if (typeof v !== 'function') throw new Error('an engine object has no function ' + key);
    const g = v.__raw ? this.raw(v, key, u) : this.fn(v, key, u);
    this.origins.set(g, { obj: u, key });
    return g;
  }

  refOf(slot) {
    const r = new LuaRef(this, slot);
    if (this.held) this.held.register(r, slot, r);
    return r;
  }

  guard(fn) {
    return L => {
      let out,
        err = null;
      try {
        out = fn(L);
      } catch (e) {
        if (e && e.status !== undefined && e.message === undefined) throw e;
        err = e;
      }
      if (err) return this.aux.luaL_error(L, this.str(err && err.message ? err.message : String(err)));
      return out;
    };
  }
  fn(f, key, obj) {
    return this.guard(L => {
      const args = [];
      for (let i = 1, n = this.lua.lua_gettop(L); i <= n; i++) args.push(this.get(i, L));
      if (!luaTrace.on) return this.ret(f(...args), L);
      let out;
      try {
        out = f(...args);
      } catch (e) {
        if (!(e && e.status !== undefined && e.message === undefined))
          luaTrace.call(this, key || f.__luaName || f.name, obj, args, undefined, e);
        throw e;
      }
      luaTrace.call(this, key || f.__luaName || f.name, obj, args, out instanceof Multi ? out.values : out, null);
      return this.ret(out, L);
    });
  }
  raw(f, key, obj) {
    return this.guard(L => {
      if (!luaTrace.on) return f(L);
      const args = [];
      for (let i = 1, n = this.lua.lua_gettop(L); i <= n; i++) args.push(this.get(i, L));
      let n;
      try {
        n = f(L);
      } catch (e) {
        if (!(e && e.status !== undefined && e.message === undefined))
          luaTrace.call(this, key || f.__luaName || f.name, obj, args, undefined, e);
        throw e;
      }
      const now = typeof n === 'number' && n >= 0 && n <= this.lua.lua_gettop(L);
      luaTrace.call(this, key || f.__luaName || f.name, obj, args, now && n ? this.get(-n, L) : undefined, null, !now);
      return n;
    });
  }
  ret(v, L) {
    if (v instanceof Multi) {
      for (const x of v.values) this.push(x, L);
      return v.values.length;
    }
    if (v === undefined) return 0;
    this.push(v, L);
    return 1;
  }

  push(v, L = this.L) {
    const lua = this.lua;
    if (v === undefined || v === null) lua.lua_pushnil(L);
    else if (typeof v === 'boolean') lua.lua_pushboolean(L, v);
    else if (typeof v === 'number') {
      if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) lua.lua_pushinteger(L, v);
      else lua.lua_pushnumber(L, v);
    } else if (typeof v === 'string') lua.lua_pushstring(L, this.str(v));
    else if (typeof v === 'function') lua.lua_pushjsfunction(L, v.__raw ? this.raw(v) : this.fn(v));
    else if (v instanceof LuaRef) lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, v.ref);
    else if (v.__wrap) lua.lua_pushlightuserdata(L, v);
    else if (Array.isArray(v)) {
      lua.lua_createtable(L, v.length, 0);
      v.forEach((x, i) => {
        this.push(x, L);
        lua.lua_rawseti(L, -2, i + 1);
      });
    } else {
      lua.lua_newtable(L);
      for (const k of Object.keys(v)) {
        if (typeof v[k] === 'function' && v[k].__luaName === undefined) v[k].__luaName = k;
        this.push(v[k], L);
        lua.lua_setfield(L, -2, this.str(k));
      }
    }
  }

  get(i, L = this.L, depth = 0) {
    const lua = this.lua;
    switch (lua.lua_type(L, i)) {
      case lua.LUA_TNIL:
      case lua.LUA_TNONE:
        return undefined;
      case lua.LUA_TBOOLEAN:
        return lua.lua_toboolean(L, i);
      case lua.LUA_TNUMBER:
        return lua.lua_tonumber(L, i);
      case lua.LUA_TSTRING:
        return lua.lua_tojsstring(L, i);
      case lua.LUA_TLIGHTUSERDATA:
        return lua.lua_touserdata(L, i);
      case lua.LUA_TFUNCTION: {
        lua.lua_pushvalue(L, i);
        const r = new LuaRef(this, this.aux.luaL_ref(L, lua.LUA_REGISTRYINDEX));
        if (this.held) this.held.register(r, r.ref, r);
        return r;
      }
      case lua.LUA_TTABLE: {
        if (depth > 6) return undefined;
        const at = lua.lua_absindex(L, i),
          obj = {};
        let n = 0,
          list = true;
        lua.lua_pushnil(L);
        while (lua.lua_next(L, at) !== 0) {
          const kt = lua.lua_type(L, -2),
            key = kt === lua.LUA_TNUMBER ? lua.lua_tonumber(L, -2) : kt === lua.LUA_TSTRING ? lua.lua_tojsstring(L, -2) : null;
          if (key !== null) {
            obj[key] = this.get(-1, L, depth + 1);
            n++;
            if (typeof key !== 'number') list = false;
          }
          lua.lua_pop(L, 1);
        }
        if (!list || !n) return n ? obj : [];
        const arr = [];
        for (let k = 1; k <= n; k++) {
          if (!(k in obj)) return obj;
          arr.push(obj[k]);
        }
        return arr;
      }
      default:
        return undefined;
    }
  }

  exec(src, name) {
    const { lua, aux, L } = this;
    if (aux.luaL_loadbuffer(L, this.str(src), null, this.str('=' + name)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
      const msg = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 1);
      throw new Error(msg);
    }
  }
  pairsLua50() {
    const { lua, aux, L } = this,
      up = lua.lua_upvalueindex;
    const step = L2 => {
      const count = lua.lua_tointeger(L2, up(2));
      if (!lua.lua_toboolean(L2, up(4))) {
        let index = lua.lua_tointeger(L2, up(3));
        while (index < count) {
          index++;
          if (lua.lua_rawgeti(L2, up(1), index) !== lua.LUA_TNIL) {
            lua.lua_pushinteger(L2, index);
            lua.lua_replace(L2, up(3));
            lua.lua_pushinteger(L2, index);
            lua.lua_insert(L2, -2);
            return 2;
          }
          lua.lua_pop(L2, 1);
        }
        lua.lua_pushinteger(L2, index);
        lua.lua_replace(L2, up(3));
        lua.lua_pushboolean(L2, true);
        lua.lua_replace(L2, up(4));
      }
      lua.lua_pushvalue(L2, up(5));
      for (;;) {
        if (!lua.lua_next(L2, up(1))) {
          lua.lua_pushnil(L2);
          lua.lua_replace(L2, up(5));
          lua.lua_pushnil(L2);
          return 1;
        }
        let inArray = false;
        if (lua.lua_type(L2, -2) === lua.LUA_TNUMBER) {
          const k = lua.lua_tonumber(L2, -2);
          inArray = k >= 1 && k <= count && Math.floor(k) === k;
        }
        if (!inArray) {
          lua.lua_pushvalue(L2, -2);
          lua.lua_replace(L2, up(5));
          return 2;
        }
        lua.lua_pop(L2, 1);
      }
    };
    lua.lua_pushjsfunction(L, step);
    lua.lua_getglobal(L, this.str('next'));
    lua.lua_pushjsclosure(
      L,
      L2 => {
        lua.lua_len(L2, 1);
        const count = lua.lua_tointeger(L2, -1);
        lua.lua_pop(L2, 1);
        if (count === 0) {
          lua.lua_pushvalue(L2, up(2));
          lua.lua_pushvalue(L2, 1);
          lua.lua_pushnil(L2);
          return 3;
        }
        aux.luaL_checktype(L2, 1, lua.LUA_TTABLE);
        lua.lua_pushvalue(L2, 1);
        lua.lua_pushinteger(L2, count);
        lua.lua_pushinteger(L2, 0);
        lua.lua_pushboolean(L2, false);
        lua.lua_pushnil(L2);
        lua.lua_pushjsclosure(L2, step, 5);
        return 1;
      },
      2
    );
    lua.lua_setglobal(L, this.str('pairs'));
  }
  global(name, v) {
    if (typeof v === 'function' && v.__luaName === undefined) v.__luaName = name;
    this.push(v);
    this.lua.lua_setglobal(this.L, this.str(name));
  }

  load(src, name, env, L = this.L) {
    const { lua, aux } = this;
    const made = (this.compiled ||= new Map()).get(src);
    if (made) {
      if (aux.luaL_loadbuffer(L, made, made.length, this.str('@' + name)) !== lua.LUA_OK) {
        const msg = lua.lua_tojsstring(L, -1);
        lua.lua_pop(L, 1);
        throw new Error(msg);
      }
      this.tag(L, made);
      lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, env);
      if (lua.lua_setupvalue(L, -2, 1) === null) lua.lua_pop(L, 1);
      return;
    }
    const text = src;
    src = src.replace(/(function\s*[\w.:]*\s*\([^)]*\.\.\.\s*\))/g, '$1 local arg = { n = select("#", ...), ... };');
    src = src.replace(/(\bfor\s+[A-Za-z_][\w \t,]*?\s+in\s+)([^\n]+?)(\s+do\b)/g, '$1__iter($2)$3');
    if (aux.luaL_loadbuffer(L, this.str(src), null, this.str('@' + name)) !== lua.LUA_OK) {
      const msg = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 1);
      throw new Error(msg);
    }
    try {
      const parts = [];
      if (
        lua.lua_dump(
          L,
          (L2, b, size) => {
            parts.push(Uint8Array.from(b.subarray ? b.subarray(0, size) : b.slice(0, size)));
            return 0;
          },
          null,
          false
        ) === 0
      ) {
        const all = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
        let at = 0;
        for (const x of parts) {
          all.set(x, at);
          at += x.length;
        }
        this.compiled.set(text, all);
      }
    } catch {}
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, env);
    if (lua.lua_setupvalue(L, -2, 1) === null) lua.lua_pop(L, 1);
  }

  tag(L, chunk) {
    const closure = L.stack[L.top - 1].value;
    if (!closure || !closure.p) return;
    let id = (this.chunkIds ||= new WeakMap()).get(chunk);
    if (id === undefined) {
      id = ++this.chunkCount;
      this.chunkIds.set(chunk, id);
    }
    const walk = (pr, path) => {
      pr.tpl = id + path;
      pr.p.forEach((c, i) => walk(c, path + '.' + i));
    };
    walk(closure.p, '');
  }

  compile(src, name) {
    if (this.compiled && this.compiled.has(src)) return;
    try {
      this.load(src, name, (this.spare ??= this.environment()));
      this.lua.lua_pop(this.L, 1);
    } catch {}
  }

  environment(values = {}) {
    const { lua, aux, L } = this;
    lua.lua_newtable(L);
    const envObject = L.stack[L.top - 1].value,
      hostEntries = new Map();
    lua.lua_newtable(L);
    const metaObject = L.stack[L.top - 1].value;
    lua.lua_pushglobaltable(L);
    lua.lua_setfield(L, -2, this.str('__index'));
    lua.lua_setmetatable(L, -2);
    lua.lua_pushvalue(L, -1);
    lua.lua_setfield(L, -2, this.str('_G'));
    hostEntries.set('_G', envObject);
    lua.lua_pushvalue(L, -1);
    const env = aux.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    lua.lua_newtable(L);
    const loadedObject = L.stack[L.top - 1].value;
    const loaded = aux.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    this.loadedOf.set(env, loaded);
    const require = this.requireFunction(env, loaded);
    this.origins.set(require, { require: { env: envObject, loaded: loadedObject } });
    lua.lua_pushjsfunction(L, require);
    hostEntries.set('require', require);
    lua.lua_setfield(L, -2, this.str('require'));
    for (const k of Object.keys(values)) {
      if (typeof values[k] === 'function' && values[k].__luaName === undefined) values[k].__luaName = k;
      this.push(values[k]);
      hostEntries.set(k, L.stack[L.top - 1].value);
      lua.lua_setfield(L, -2, this.str(k));
    }
    lua.lua_pop(L, 1);
    this.envInfo.set(envObject, { meta: metaObject, loaded: loadedObject, host: hostEntries, ref: env, loadedRef: loaded });
    this.loadedInfo.set(loadedObject, envObject);
    return env;
  }

  requireFunction(env, loaded) {
    const { lua, aux } = this;
    return this.guard(L2 => {
      const name = lua.lua_tojsstring(L2, 1) || '',
        key = name
          .replace(/\.lua$/i, '')
          .replace(/[\\.]/g, '/')
          .toUpperCase();
      lua.lua_rawgeti(L2, lua.LUA_REGISTRYINDEX, loaded);
      lua.lua_getfield(L2, -1, this.str(key));
      if (lua.lua_type(L2, -1) !== lua.LUA_TNIL) return 1;
      lua.lua_pop(L2, 1);
      const src = this.source(key);
      if (src === undefined) {
        this.need.add(key);
        return aux.luaL_error(L2, this.str('@@need ' + key));
      }
      if (src === null) return aux.luaL_error(L2, this.str(`module '${name}' not found`));
      lua.lua_pushboolean(L2, true);
      lua.lua_setfield(L2, -2, this.str(key));
      this.load(src, name, env, L2);
      lua.lua_call(L2, 0, 1);
      if (lua.lua_type(L2, -1) === lua.LUA_TNIL) {
        lua.lua_pop(L2, 1);
        lua.lua_pushboolean(L2, true);
      }
      lua.lua_pushvalue(L2, -1);
      lua.lua_setfield(L2, -3, this.str(key));
      return 1;
    });
  }

  run(src, name, env) {
    const { lua, L } = this;
    if (luaTrace.on) {
      (this.envNames ||= new Map()).set(env, name);
      luaTrace.script(this, 'started', name);
    }
    try {
      this.load(src, name, env);
    } catch (e) {
      if (luaTrace.on) luaTrace.error(this, name, e.message);
      return e.message;
    }
    if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
      const msg = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 1);
      if (luaTrace.on) luaTrace.error(this, name, msg);
      return msg;
    }
    return null;
  }
  call(env, name, ...args) {
    const { lua, L } = this;
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, env);
    lua.lua_getfield(L, -1, this.str(name));
    lua.lua_remove(L, -2);
    if (lua.lua_type(L, -1) !== lua.LUA_TFUNCTION) {
      lua.lua_pop(L, 1);
      return { ok: false, missing: true };
    }
    lua.lua_getglobal(L, this.str('__where'));
    lua.lua_insert(L, -2);
    if (luaTrace.on) luaTrace.event(this, 'call', name, args);
    for (const a of args) this.push(a);
    this.limitRun(L);
    if (lua.lua_pcall(L, args.length, 1, -2 - args.length) !== lua.LUA_OK) {
      const error = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 2);
      if (luaTrace.on) luaTrace.error(this, name, error);
      return { ok: false, error };
    }
    const value = this.get(-1);
    lua.lua_pop(L, 2);
    return { ok: true, value };
  }
  callRef(ref, ...args) {
    const { lua, L } = this;
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref.ref);
    if (luaTrace.on) luaTrace.event(this, 'callback', '', args);
    for (const a of args) this.push(a);
    if (lua.lua_pcall(L, args.length, 1, 0) !== lua.LUA_OK) {
      const error = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 1);
      if (luaTrace.on) luaTrace.error(this, 'a callback', error);
      return { ok: false, error };
    }
    const value = this.get(-1);
    lua.lua_pop(L, 1);
    return { ok: true, value };
  }
  ref(env, name) {
    const { lua, L } = this;
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, env);
    lua.lua_getfield(L, -1, this.str(name));
    const v = lua.lua_type(L, -1) === lua.LUA_TFUNCTION ? this.get(-1) : null;
    lua.lua_pop(L, 2);
    return v;
  }
  set(env, name, v) {
    const { lua, L } = this;
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, env);
    this.push(v);
    lua.lua_setfield(L, -2, this.str(name));
    lua.lua_pop(L, 1);
  }
  read(env, name) {
    const { lua, L } = this;
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, env);
    lua.lua_getfield(L, -1, this.str(name));
    const v = this.get(-1);
    lua.lua_pop(L, 2);
    return v;
  }

  thread(env, name) {
    const { lua, aux, L } = this;
    const co = lua.lua_newthread(L),
      ref = aux.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    lua.lua_rawgeti(co, lua.LUA_REGISTRYINDEX, env);
    lua.lua_getfield(co, -1, this.str(name));
    lua.lua_remove(co, -2);
    if (lua.lua_type(co, -1) !== lua.LUA_TFUNCTION) {
      aux.luaL_unref(L, lua.LUA_REGISTRYINDEX, ref);
      return null;
    }
    if (luaTrace.on) luaTrace.event(this, 'thread', name, []);
    return { co, ref, started: false, name };
  }
  limitRun(Lx) {
    const { lua } = this;
    this.steps = 0;
    this.hook ||= Ls => {
      if (++this.steps * RUN_EVERY > RUN_LIMIT) {
        this.steps = 0;
        this.aux.luaL_error(Ls, this.str('script ran too long without yielding (a loop that never ends?)'));
      }
    };
    lua.lua_sethook(Lx, this.hook, lua.LUA_MASKCOUNT, RUN_EVERY);
  }
  resume(t, ...args) {
    const { lua, L } = this;
    let n = 0;
    if (!t.started)
      for (const a of args) {
        this.push(a, t.co);
        n++;
      }
    this.limitRun(t.co);
    const status = lua.lua_resume(t.co, L, n);
    t.started = true;
    if (status === lua.LUA_YIELD) {
      const value = lua.lua_gettop(t.co) ? this.get(-1, t.co) : undefined;
      lua.lua_settop(t.co, 0);
      return { done: false, value };
    }
    if (status === lua.LUA_OK) {
      lua.lua_settop(t.co, 0);
      return { done: true };
    }
    let error = lua.lua_tojsstring(t.co, -1);
    try {
      this.aux.luaL_traceback(L, t.co, this.str(error || ''), 0);
      error = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 1);
    } catch {}
    if (luaTrace.on) luaTrace.error(this, t.name || 'a thread', error);
    return { done: true, error };
  }
  free(ref) {
    if (ref instanceof LuaRef) {
      if (ref.ref === undefined) return;
      if (this.held) this.held.unregister(ref);
      const n = ref.ref;
      ref.ref = undefined;
      this.aux.luaL_unref(this.L, this.lua.LUA_REGISTRYINDEX, n);
      return;
    }
    this.aux.luaL_unref(this.L, this.lua.LUA_REGISTRYINDEX, ref);
    const loaded = this.loadedOf.get(ref);
    if (loaded !== undefined) {
      this.loadedOf.delete(ref);
      this.aux.luaL_unref(this.L, this.lua.LUA_REGISTRYINDEX, loaded);
    }
    const name = this.envNames && this.envNames.get(ref);
    if (name !== undefined) {
      this.envNames.delete(ref);
      if (luaTrace.on) luaTrace.script(this, 'ended', name);
    }
  }
}

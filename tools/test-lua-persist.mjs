import assert from 'node:assert/strict';
import fengariPkg from 'fengari';
const F = fengariPkg.default || fengariPkg;
const { LuaVM } = await import('../public/js/lua.js');
const { LuaPersist } = await import('../public/js/luapersist.js');

const engineObjects = new Map();
function machine() {
  const vm = new LuaVM(F, { source: () => null });
  vm.global('Double', x => x * 2);
  vm.global('Engine', { __wrap: true, __name: 'Engine', Answer: () => 42 });
  const persist = new LuaPersist(vm);
  const make = id => {
    let o = engineObjects.get(id);
    if (!o) engineObjects.set(id, (o = { __wrap: true, __name: 'Thing', id, Get_Id: () => id, Twice: () => id * 2 }));
    return o;
  };
  persist.hooks.describe = o => (o.__name === 'Thing' ? { thing: o.id } : undefined);
  persist.hooks.resolve = d => (d.thing !== undefined ? make(d.thing) : undefined);
  persist.freezePerms();
  return { vm, persist, make };
}

const A = machine();
const env = A.vm.environment({});
const script = `
counter = 0
local shared = 10
function inc(n) shared = shared + n; counter = counter + 1; return shared end
function get() return shared end
Meta = setmetatable({}, { __index = function(t, k) return k .. '!' end })
Data = { 'a', 'b', x = 1, y = { 1, 2, 3 }, f = 1.5, w = 2.0, big = 12345678, neg = -7, s = 'text\\0with\\255bytes' }
Data.self = Data
Order = {}
for _, k in ipairs({ 'zeta', 'alpha', 'mid', 'beta' }) do Order[k] = #k end
Fn = Double
Eng = Engine
function Bind(t) Thing = t; ThingId = t.Get_Id; ThingTwice = t.Twice end
function Worker()
  local i = 0
  local log = {}
  while true do
    i = i + 1
    local ok, v = pcall(coroutine.yield, i)
    inc(i)
    for k, v in pairs({ p = 1, q = 2 }) do total = (total or 0) + v end
    log[#log + 1] = i
    Log = log
  end
end
function Gen() local co = coroutine.wrap(function() for n = 1, 100 do coroutine.yield(n * 3) end end); Wrapped = co; return co() end
function Words() local it = string.gmatch('one two three four', '%a+'); Iter = it; return it() end
function Shared() local n = 0; Bump = function() n = n + 1; return n end; while true do n = n + 10; coroutine.yield(n) end end
function Sorted() local keys = {} for k in pairs(Order) do keys[#keys + 1] = k end return table.concat(keys, ',') end
`;
assert.equal(A.vm.run(script, 'test', env), null);
const call = (m, e, name, ...a) => {
  const r = m.vm.call(e, name, ...a);
  assert(r.ok, name + ': ' + r.error);
  return r.value;
};
call(A, env, 'Bind', A.make(7));
const t1 = A.vm.thread(env, 'Worker');
for (let i = 0; i < 3; i++) A.vm.resume(t1);
assert.equal(call(A, env, 'Gen'), 3);
assert.equal(call(A, env, 'Words'), 'one');
const t3 = A.vm.thread(env, 'Shared');
A.vm.resume(t3);
A.vm.resume(t3);
call(A, env, 'Bump');
const sortedBefore = call(A, env, 'Sorted');
assert.equal(sortedBefore, 'zeta,alpha,mid,beta', 'insertion order is what pairs gives');

const session = A.persist.begin();
const envEnc = session.enc(A.persist.refValue(env));
const threadEnc = session.enc({ type: 8, value: t1.co });
const sharedEnc = session.enc({ type: 8, value: t3.co });
const data = JSON.parse(JSON.stringify(session.end()));
assert(data.nodes.length > 10);

const B = machine();
const restored = B.persist.restore(data);
const envB = B.persist.newRef(restored.value(envEnc));
const coB = restored.value(threadEnc).value;
const t2 = { co: coB, ref: B.persist.newRef(restored.value(threadEnc)), started: true };

const t4 = { co: restored.value(sharedEnc).value, started: true };
assert.equal(call(B, envB, 'get'), call(A, env, 'get'));
assert.equal(call(B, envB, 'Sorted'), sortedBefore);
assert.equal(B.vm.read(envB, 'counter'), A.vm.read(env, 'counter'));
const check = `
assert(Data.self == Data, 'cycle')
assert(math.type(Data.big) == 'integer' and math.type(Data.f) == 'float' and math.type(Data.w) == 'float', 'number kinds')
assert(Data.neg == -7 and Data.s == 'text\\0with\\255bytes' and #Data.s == 15, 'strings')
assert(Meta.foo == 'foo!', 'metatable with a function')
assert(Fn == Double and Eng == Engine, 'permanent host values')
assert(ThingId() == 7 and ThingTwice() == 14 and Thing.Get_Id() == 7, 'host object and its members')
function Check() return true end
`;
assert.equal(B.vm.run(check, 'check', envB), null);
assert.equal(call(B, envB, 'Check'), true);

const before = call(A, env, 'get');
const ra = [A.vm.resume(t1), A.vm.resume(t1), A.vm.resume(t1)].map(r => r.value);
const rb = [B.vm.resume(t2), B.vm.resume(t2), B.vm.resume(t2)].map(r => r.value);
assert.deepEqual(rb, ra, 'the yields continue from the same place');
assert.deepEqual(rb, [4, 5, 6]);
assert.equal(call(B, envB, 'get'), call(A, env, 'get'));
assert.notEqual(call(B, envB, 'get'), before);
assert.deepEqual(B.vm.read(envB, 'Log'), A.vm.read(env, 'Log'), 'the local table of the coroutine');
assert.equal(B.vm.run('assert(Wrapped() == 6 and Wrapped() == 9)', 'w', envB), null);
assert.equal(B.vm.run("assert(Iter() == 'two' and Iter() == 'three')", 'i', envB), null);
assert.equal(call(B, envB, 'Bump'), call(A, env, 'Bump'));
assert.equal(B.vm.resume(t4).value, A.vm.resume(t3).value);
assert.equal(call(B, envB, 'Bump'), call(A, env, 'Bump'), 'the closure sees what the coroutine did to the shared local');
console.log('ok', data.nodes.length, 'nodes', JSON.stringify(data).length, 'bytes');

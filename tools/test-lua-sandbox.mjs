// The Lua sandbox: no way out to the network or the host, and a script that never ends can't keep the page.
import assert from 'node:assert/strict';
import fengariPkg from 'fengari';
const F = fengariPkg.default || fengariPkg;
const { LuaVM } = await import('../public/js/lua.js');

const vm = new LuaVM(F, { source: () => null });
vm.runLimit = 3e6;
const env = vm.environment({});
const value = code => {
  assert.equal(vm.run(`function Probe() ${code} end`, 'probe', env), null);
  const r = vm.call(env, 'Probe');
  assert.ok(r.ok, r.error);
  return r.value;
};

for (const name of [
  'loadfile',
  'dofile',
  'io',
  'debug.sethook',
  'debug.gethook',
  'debug.getregistry',
  'debug.setmetatable',
  'debug.getupvalue',
  'debug.debug',
  'package.loadlib',
  'package.searchpath',
  'os.execute',
  'os.exit',
  'os.remove',
  'os.getenv'
])
  assert.equal(value(`return type(${name}) == "nil"`), true, name + ' is out of reach');
assert.equal(value('return type(debug.traceback) == "function" and type(os.time) == "function" and type(os.clock) == "function"'), true);

// an error still carries its traceback
vm.run('function Fails() error("boom") end', 'fails', env);
const failed = vm.call(env, 'Fails');
assert.equal(failed.ok, false);
assert.match(failed.error, /boom/);
assert.match(failed.error, /traceback/);

const stops = (code, what) => {
  vm.run(`function Spin() ${code} end`, 'spin', env);
  const t0 = Date.now(),
    r = vm.call(env, 'Spin');
  assert.equal(r.ok, false, what);
  assert.match(r.error, /ran too long/, what);
  assert.ok(Date.now() - t0 < 20000, what + ' ends soon after the limit');
  assert.equal(value('local n = 0 for i = 1, 1000 do n = n + i end return n'), 500500, 'the next call runs normally after ' + what);
};
stops('while true do end', 'a plain endless loop');
stops('while true do pcall(function() while true do end end) end', 'an endless loop that catches the limit error');
stops('local n = 0 while true do local ok = pcall(error, "x") n = n + 1 end', 'an endless loop of pcalls');
stops(
  'local f = coroutine.wrap(function() while true do pcall(function() while true do end end) end end) f()',
  'an endless loop in a coroutine that catches the limit error'
);
stops('while true do xpcall(function() while true do end end, function(e) while true do end end) end', 'an endless error handler');

// a thread that yields keeps its full budget per resume
vm.run('function Ticker() local n = 0 while true do for i = 1, 1000 do n = n + 1 end coroutine.yield(n) end end', 'ticker', env);
const t = vm.thread(env, 'Ticker');
for (let i = 0; i < 5; i++) assert.equal(vm.resume(t).done, false);
console.log('lua sandbox ok');

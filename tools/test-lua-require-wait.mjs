import assert from 'node:assert/strict';
import fengariPkg from 'fengari';
const F = fengariPkg.default || fengariPkg;
const { LuaVM } = await import('../public/js/lua.js');

let ready = false;
const vm = new LuaVM(F, { source: key => (key === 'LATE' ? (ready ? 'LateValue = 41 return { answer = 42 }' : undefined) : null) });
const env = vm.environment({});
assert.equal(
  vm.run(
    `function Worker()
  local m = require("Late")
  Got = m.answer
  return true
end`,
    'test',
    env
  ),
  null
);
const t = vm.thread(env, 'Worker');
let r = vm.resume(t);
assert.ok(!r.error, r.error);
assert.equal(r.done, false, 'a module that is still loading makes the thread wait');
assert.ok(vm.need.has('LATE'));
r = vm.resume(t);
assert.equal(r.done, false, 'it keeps waiting while the source is not there');
ready = true;
r = vm.resume(t);
assert.ok(!r.error, r.error);
assert.equal(r.done, true, 'once the source arrives the require completes and the thread goes on');
assert.equal(vm.read(env, 'Got'), 42);
console.log('ok');

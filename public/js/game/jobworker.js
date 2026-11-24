import { CTL, JOB, Grid, work, moveWork, sharedMoveScene } from './scanjobs.js';

let sh = null,
  slot = 0,
  moveScene = null;
const grid = new Grid(),
  scratch = [];

function loop() {
  const ctl = sh.ctl;
  let seen = Atomics.load(ctl, CTL.GEN);
  for (;;) {
    Atomics.wait(ctl, CTL.GEN, seen);
    const g = Atomics.load(ctl, CTL.GEN);
    seen = g;
    if (g & 1) continue;
    Atomics.add(ctl, CTL.ACTIVE, 1);
    if (Atomics.load(ctl, CTL.GEN) === g) {
      if (Atomics.load(ctl, CTL.KIND) === JOB.MOVE) {
        if (sh.move) moveWork(sh, (moveScene ||= sharedMoveScene(sh.move)));
      } else {
        grid.build(sh, Atomics.load(ctl, CTL.UNITS), g);
        work(sh, grid, slot, scratch);
      }
    }
    if (Atomics.sub(ctl, CTL.ACTIVE, 1) === 1) Atomics.notify(ctl, CTL.ACTIVE);
  }
}

self.onmessage = e => {
  sh = e.data.sh;
  slot = e.data.slot;
  Atomics.add(sh.ctl, CTL.READY, 1);
  loop();
};

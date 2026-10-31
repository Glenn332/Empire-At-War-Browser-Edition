const waiting = new Map();
let next = 0;

function ask(op, args = []) {
  const id = ++next;
  return new Promise(res => {
    waiting.set(id, res);
    postMessage({ k: 'vfs', id, op, args });
  });
}

if (typeof WorkerGlobalScope !== 'undefined' && typeof postMessage === 'function') {
  addEventListener('message', e => {
    const m = e.data;
    if (!m || m.k !== 'vfsr') return;
    const res = waiting.get(m.id);
    waiting.delete(m.id);
    if (res) res(m.result);
  });
  globalThis.SWR_OVERLAY = ask('meta').then(meta =>
    meta
      ? {
          names: meta.names,
          whole: meta.whole,
          read: (key, language, bytes) => ask('read', [key, language, bytes]),
          readGame: key => ask('readGame', [key]),
          infoFor: key => ask('infoFor', [key]),
          rank: key => ask('rank', [key]),
          find: (regex, list) => ask('find', [regex, list])
        }
      : null
  );
}

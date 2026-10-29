import { snapshot, snapshotNow, putSave, getSave, deleteSave } from './savegame.js';

const ID = 'resume',
  MARK = 'swr-resume',
  KEEP = 24 * 3600e3;
const setMark = v => {
  try {
    if (v) localStorage.setItem(MARK, JSON.stringify(v));
    else localStorage.removeItem(MARK);
  } catch {}
};
const getMark = () => {
  try {
    return JSON.parse(localStorage.getItem(MARK) || 'null');
  } catch {
    return null;
  }
};

function saveable(g) {
  const s = g && g.setup;
  return !!(s && !g.over && !g.noSave && !g.net && !s.attract && !s.benchmark && !s.net && !s.linkedTactical && window.parent === window);
}

export function watchForResume(game) {
  let leaving = false,
    writing = null,
    wrote = false;
  const drop = () => {
    if (!wrote) return;
    wrote = false;
    setMark(null);
    deleteSave(ID).catch(() => {});
  };
  addEventListener('pagehide', e => {
    if (!e.persisted) {
      leaving = true;
      drop();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!leaving) drop();
      return;
    }
    const g = game();
    if (leaving || writing || !saveable(g)) return;
    let snap;
    try {
      snap = g.mirror ? null : snapshot(g);
    } catch (e) {
      console.warn('resume save', e);
      return;
    }
    wrote = true;
    writing = (snap ? Promise.resolve(snap) : snapshotNow(g))
      .then(s => putSave((snap = s), ID))
      .then(
        () => {
          if (!leaving && document.visibilityState === 'hidden') setMark({ at: Date.now(), name: snap.name });
          else {
            wrote = false;
            deleteSave(ID).catch(() => {});
          }
        },
        e => console.warn('resume save', e)
      )
      .finally(() => {
        writing = null;
      });
  });
}

export async function pendingResume() {
  const m = getMark();
  setMark(null);
  if (!m || !(Date.now() - m.at < KEEP)) return null;
  return (await getSave(ID).catch(() => null)) ? { id: ID, name: m.name || '' } : null;
}

export function forgetResume() {
  return deleteSave(ID).catch(() => {});
}

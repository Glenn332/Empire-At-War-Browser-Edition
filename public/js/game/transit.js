const DB = 'swr-transit',
  STORE = 'blobs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function put(key, value) {
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}
async function take(key) {
  const db = await open();
  const value = await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite'),
      store = tx.objectStore(STORE),
      r = store.get(key);
    r.onsuccess = () => {
      store.delete(key);
      res(r.result);
    };
    tx.onerror = () => rej(tx.error);
  });
  db.close();
  return value;
}

async function stashed(setup) {
  const snap = setup && setup.restore;
  if (!snap || !snap.storyLua || typeof indexedDB === 'undefined') return JSON.stringify(setup);
  const key = 'story' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    await put(key, snap.storyLua);
  } catch (error) {
    console.warn('The story state could not be set aside, it goes in the setup:', error);
    return JSON.stringify(setup);
  }
  return JSON.stringify({ ...setup, restore: { ...snap, storyLua: null, storyLuaKey: key } });
}

const LARGE = 500000;

let inPlace = null;
export function setInPlace(hooks) {
  inPlace = hooks;
}
const canInPlace = () => inPlace && window.parent === window && !(window.game?.setup?.net || window.game?.net);

function carried(setup) {
  const snap = setup && setup.restore,
    lua = snap && snap.storyLua;
  const copy = JSON.parse(JSON.stringify(lua ? { ...setup, restore: { ...snap, storyLua: null } } : setup));
  if (lua) copy.restore.storyLua = lua;
  return copy;
}

export function loadSaved(id) {
  if (canInPlace()) {
    inPlace.load(id);
    return;
  }
  try {
    sessionStorage.setItem('swr-load', id);
  } catch {}
  location.assign(location.pathname);
}

export function toMainMenu() {
  if (canInPlace()) {
    inPlace.menu();
    return;
  }
  const top = window.top || window;
  top.location.assign(top.location.pathname);
}

export async function stageStart(setup, go = () => location.assign(location.pathname)) {
  if (canInPlace()) {
    inPlace.start(carried(setup));
    return;
  }
  let text;
  try {
    text = await stashed(setup);
  } catch (error) {
    console.error(error);
    text = JSON.stringify(setup);
  }
  if (text.length > LARGE && typeof indexedDB !== 'undefined') {
    const key = 'setup' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      await put(key, text);
      sessionStorage.setItem('swr-start', JSON.stringify({ transitKey: key }));
      go();
      return;
    } catch (error) {
      console.warn('The setup could not be set aside in the database, it goes in the session store:', error);
    }
  }
  try {
    sessionStorage.setItem('swr-start', text);
  } catch (error) {
    console.warn('The setup of the next page is too large for the session store:', error);
    try {
      const { storyLua, ...rest } = setup.restore || {};
      sessionStorage.setItem('swr-start', JSON.stringify({ ...setup, ...(setup.restore ? { restore: rest } : {}) }));
    } catch (e2) {
      console.error(e2);
    }
  }
  go();
}

export async function unstash(setup) {
  if (setup && setup.transitKey) {
    try {
      setup = JSON.parse(await take(setup.transitKey));
    } catch (error) {
      console.error('The setup of this page is gone from the database:', error);
      return null;
    }
  }
  const snap = setup && setup.restore;
  if (snap && snap.storyLuaKey) {
    try {
      snap.storyLua = await take(snap.storyLuaKey);
    } catch (error) {
      console.warn('The story state of the saved game is gone:', error);
      snap.storyLua = null;
    }
    delete snap.storyLuaKey;
  }
  return setup;
}

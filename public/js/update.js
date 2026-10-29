import { BUILD } from './build.js';

const get = (store, key) => { try { return store.getItem(key); } catch { return null; } };
const set = (store, key, v) => { try { store.setItem(key, v); } catch {} };

export async function ensureCurrentBuild() {
  if (BUILD === 'dev') return BUILD;
  try {
    const r = await fetch('build.json', { cache: 'no-store' });
    const live = r.ok ? (await r.json()).build : null;
    if (live && live !== BUILD && get(sessionStorage, 'swr-reloaded-for') !== live) {
      set(sessionStorage, 'swr-reloaded-for', live);
      if (self.caches) for (const k of await caches.keys()) if (k.startsWith('swr-shell-')) await caches.delete(k);
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update().catch(() => {});
      const mods = performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(location.origin) && /\.(js|css|html)$/.test(new URL(u).pathname));
      await Promise.all([location.href, ...mods].map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
      location.reload();
      return new Promise(() => {});
    }
  } catch {}
  return BUILD;
}

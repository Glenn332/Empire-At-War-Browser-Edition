import { channel } from './galacticmpbattle.js';

export function startGalaxyFrame(setup) {
  const session = setup.net.session, me = setup.net.me;
  const host = window.mpGalaxy = { gen: 0, frame: null, setup: null, link: null };
  const open = s => {
    const gen = host.gen++, link = channel(session, 'g' + gen);
    host.link = link;
    host.setup = { ...s, net: { session: link, me } };
    const frame = host.frame = document.createElement('iframe');
    frame.title = 'Galactic conquest'; frame.allow = 'autoplay';
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483645;background:#000';
    const url = new URL('../../play.html', import.meta.url);
    url.searchParams.set('mp-galaxy', String(gen));
    frame.src = url.href; document.body.appendChild(frame); frame.focus();
  };
  host.next = s => {
    const old = host.frame, oldLink = host.link, game = old?.contentWindow?.game;
    if (game) {
      game.over = true; game.modeSuspended = true; game.net?.stop?.();
      game.mpBattles?.current?.frame && game.mpBattles.closeFrame(game.mpBattles.current);
      game.story?.dispose?.(); game.ai?.dispose?.(); game.audio?.stopMusic?.(); game.audio?.ctx?.close?.();
      const r = game.renderer?.renderer || game.renderer; r?.dispose?.(); r?.forceContextLoss?.();
    }
    oldLink?.close();
    setTimeout(() => { old?.remove(); open(s); }, 0);
  };
  try { Object.defineProperty(window, 'game', { configurable: true, get: () => host.frame?.contentWindow?.game }); } catch { }
  open(setup);
  return host;
}

export function galaxyFrameSetup() {
  if (typeof window === 'undefined' || window.parent === window) return null;
  try { const h = window.parent.mpGalaxy; return h?.frame?.contentWindow === window ? h.setup : null; } catch { return null; }
}

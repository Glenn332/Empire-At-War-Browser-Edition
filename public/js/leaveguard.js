const inGame = () => {
  const g = window.game;
  return !!g && !g.setup?.attract && !g.setup?.benchmark;
};

export function leaveTo(url, w = window) {
  w.swrLeaving = true;
  w.location.assign(url);
}

export function reloadPage() {
  window.swrLeaving = true;
  location.reload();
}

export function guardLeaving() {
  if (window.top !== window) return;
  addEventListener('beforeunload', e => {
    if (window.swrLeaving || !inGame()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  addEventListener('pageshow', () => {
    window.swrLeaving = false;
  });
}

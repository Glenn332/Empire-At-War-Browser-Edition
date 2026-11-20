export const env = { programSources: null, lighting: null, softDepth: { name: 'softDepth' }, soft: true };

const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
export const webkit = /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);

const DROPPED = 'swr-webgpu-dropped';

const dropped = () => {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DROPPED) === '1';
  } catch {
    return false;
  }
};

export function wantGPU() {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.gpu &&
    !(typeof location !== 'undefined' && /[?&]webgl(&|$)/.test(location.search)) &&
    !dropped()
  );
}

let dropping = false;
export function dropGPU() {
  if (dropping) return;
  dropping = true;
  if (typeof window === 'undefined') {
    postMessage({ gpuLost: true });
    return;
  }
  console.warn('webgpu: the graphics device keeps failing, reloading with WebGL');
  try {
    sessionStorage.setItem(DROPPED, '1');
  } catch {}
  window.swrLeaving = true;
  location.reload();
}

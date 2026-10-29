export const env = { programSources: null, lighting: null };

const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
export const webkit = /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);

export function wantGPU() {
  return typeof navigator !== 'undefined' && !!navigator.gpu && !(typeof location !== 'undefined' && /[?&]webgl(&|$)/.test(location.search));
}

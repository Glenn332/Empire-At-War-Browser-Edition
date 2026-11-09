export function movieSubtitles() {
  try {
    return localStorage.getItem('swr-subtitles') !== '0';
  } catch {
    return true;
  }
}
export function setMovieSubtitles(on) {
  try {
    localStorage.setItem('swr-subtitles', on ? '1' : '0');
  } catch {}
}

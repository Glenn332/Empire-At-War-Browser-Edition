import { db } from './gamedata.js';

const $ = id => document.getElementById(id);

export function showSplash() {
  const el = $('splash');
  if (!el) return;
  const text = db.text?.get('TEXT_SAVELOAD_LOADING_MSG');
  if (text && el.firstElementChild) el.firstElementChild.textContent = text;
  el.classList.remove('hidden');
  $('loading')?.classList.add('hidden');
}

export const hideSplash = () => $('splash')?.classList.add('hidden');

export function showMessage(text) {
  hideSplash();
  $('loading')?.classList.remove('hidden');
  $('loadText').textContent = text;
}

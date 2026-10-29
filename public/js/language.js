export const LANGUAGES = Object.freeze(['ENGLISH','GERMAN','FRENCH','SPANISH','ITALIAN','JAPANESE','KOREAN','CHINESE','RUSSIAN','POLISH','THAI']);
export let activeLanguage = 0;
export let languageRevision = 0;
const views = new Map();
export function onLanguageChange(refresh, phase = 1) {
  views.set(refresh, phase);return () => views.delete(refresh);
}
export async function refreshLanguageViews(change) {
  languageRevision++;
  const errors=[];
  for (const phase of [...new Set(views.values())].sort((a,b)=>a-b)) {
    const results = await Promise.allSettled([...views].filter(([,p])=>p===phase).map(([fn])=>Promise.resolve().then(()=>views.has(fn)&&fn(change))));
    errors.push(...results.filter(r=>r.status==='rejected').map(r=>r.reason));
  }
  if(errors.length)throw new AggregateError(errors,'Language refresh failed');
}
export function languageId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = /^\d+$/.test(String(value)) ? Number(value) : LANGUAGES.indexOf(String(value).toUpperCase());
  return Number.isInteger(id) && id >= 0 && id < LANGUAGES.length ? id : null;
}
export function setActiveLanguage(value) { activeLanguage = languageId(value) ?? 0; }
export const textFile = id => `Data/Text/MasterTextFile_${LANGUAGES[id]}.dat`;

export async function resolveLanguageText(read, requested = 0) {
  const original = languageId(requested) ?? 0;
  for (const language of new Set([original, 0, ...LANGUAGES.map((_, i) => i)])) {
    const bytes = await read(textFile(language));
    if (bytes) return {language, bytes};
  }
  return {language: original, bytes: null};
}

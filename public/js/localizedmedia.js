import { activeLanguage, languageId, LANGUAGES } from './language.js';

const suffixes=['ENG','GER','FRE','SPA','ITA','JAP','KOR','CHI','RUS','POL','THA'];
export function languageName(language=activeLanguage) {
  const name=LANGUAGES[languageId(language)??0];return name[0]+name.slice(1).toLowerCase();
}

export function localizedAudioFile(file,language=activeLanguage) {
  file=String(file??'');const id=languageId(language)??0;if(!id)return file;
  const upper=file.toUpperCase();
  for(const extension of ['WAV','MP3']){
    const at=upper.indexOf('_ENG.'+extension);
    if(at>=0)return upper.slice(0,at)+'_'+suffixes[id]+'.'+extension;
  }
  return file;
}
export function speechFile(file,language=activeLanguage) {
  return 'Data/Audio/Speech/'+languageName(language)+'/'+localizedAudioFile(file,language).replace(/\\/g,'/');
}

export function menuOverlayFile(constants,language=activeLanguage) {
  const name=LANGUAGES[languageId(language)??0];let file='';
  for(const row of constants?.tuples('Localized_Menu_Overlay')||[])
    if(String(row[0]).toUpperCase()===name&&row[1]?.trim())file=row[1].trim();
  return file||'Menuback_Overlay.TGA';
}

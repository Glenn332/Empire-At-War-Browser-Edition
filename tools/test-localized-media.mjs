import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LANGUAGES,setActiveLanguage,refreshLanguageViews} from '../public/js/language.js';
import {localizedAudioFile,speechFile,languageName,menuOverlayFile} from '../public/js/localizedmedia.js';
import {MenuArtwork} from '../public/js/game/menuartwork.js';
import {Audio} from '../public/js/audio.js';
import {db,ObjType} from '../public/js/gamedata.js';
import {fetchBinary} from '../public/js/vfs.js';
import {openGame} from './megfs.mjs';
import {scanGame} from '../public/js/mods.js';

const suffixes=['ENG','GER','FRE','SPA','ITA','JAP','KOR','CHI','RUS','POL','THA'];
for(const [id,name]of LANGUAGES.entries()){
  const expected=id?'LINE_'+suffixes[id]+'.WAV':'line_ENG.wav';
  assert.equal(localizedAudioFile('line_ENG.wav',id),expected);
  assert.equal(localizedAudioFile('line_ENG.wav',name),expected);
  assert.equal(localizedAudioFile('mixed_Custom.mp3',id),'mixed_Custom.mp3');
  assert.equal(speechFile('line_ENG.wav',id),'Data/Audio/Speech/'+languageName(id)+'/'+expected);
}
assert.equal(localizedAudioFile('a_ENG.mp3_tail_ENG.WAV_more','French'),'A_ENG.MP3_TAIL_FRE.WAV','WAV search precedes MP3, even when later in the filename');
assert.equal(localizedAudioFile('a_ENG.mp3.trailing','French'),'A_FRE.MP3');
assert.equal(localizedAudioFile('a_ENG.WAV_more_ENG.WAV','German'),'A_GER.WAV');
const constants=rows=>({tuples:()=>rows});
assert.equal(menuOverlayFile(constants([['ENGLISH','custom.tga']]),2),'Menuback_Overlay.TGA','Absent locale does not use a custom English mapping');
assert.equal(menuOverlayFile(constants([['FRENCH','a.tga'],['FRENCH','b.tga'],['FRENCH',''],['unknown','x.tga']]),2),'b.tga');

let rows=[['ENGLISH','english.tga'],['FRENCH','french.tga'],['RUSSIAN','missing.tga']];
const root={style:{display:'none'},dataset:{}},loads=[];
const art=new MenuArtwork(root,{constants:()=>constants(rows),load:async file=>{loads.push(file);return file==='missing.tga'?null:{toDataURL:()=>file,getContext:()=>{throw Error('Artwork must not be cropped');}};}});
setActiveLanguage(0);await art.refresh();const original=root.style.backgroundImage;
setActiveLanguage(2);await refreshLanguageViews({language:2});assert.equal(root.dataset.texture,'french.tga');assert.equal(root.style.display,'none');assert.notEqual(root.style.backgroundImage,original);
setActiveLanguage(0);await refreshLanguageViews({language:0});assert.equal(root.style.backgroundImage,original);assert.equal(loads.length,2,'Previously decoded artwork is reused');
setActiveLanguage(8);await refreshLanguageViews({language:8});assert.equal(root.style.backgroundImage,'');assert.deepEqual(loads,['english.tga','french.tga','missing.tga'],'Missing authored art never retries English/default');art.dispose();
let release;const raceRoot={style:{},dataset:{}},race=new MenuArtwork(raceRoot,{constants:()=>constants(rows),load:file=>file==='english.tga'?new Promise(r=>release=r):Promise.resolve({toDataURL:()=>file})});
setActiveLanguage(0);const old=race.refresh();await Promise.resolve();setActiveLanguage(2);await race.refresh();release({toDataURL:()=> 'stale'});await old;assert.equal(raceRoot.dataset.texture,'french.tga');race.dispose();
setActiveLanguage(0);await refreshLanguageViews({language:0});assert.equal(raceRoot.dataset.texture,'french.tga','Disposed artwork unsubscribes');

class Context {
  constructor(){this.currentTime=0;this.state='running';}
  createBufferSource(){return {playbackRate:{value:1},connect(){},disconnect(){},start(){},stop(){}};}
  createGain(){return {gain:{value:1,linearRampToValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}},connect(){},disconnect(){}};}
}
const event=(name,props)=>{const e=new ObjType('SFXEvent',name);for(const[k,v]of Object.entries(props))e.props.set(k.toLowerCase(),[String(v)]);db.sfx.set(name,e);return e;};
event('LOCAL',{Samples:'custom/line_ENG.wav',Localize:true});event('LITERAL',{Samples:'literal_ENG.wav',Is_HUD_VO:true,Localize:false});event('HUD',{Samples:'queue_ENG.wav',Is_HUD_VO:true,Localize:true});event('LOOP',{Samples:'loop_ENG.wav',Localize:true});
const audio=new Audio(),loaded=[];audio.ctx=new Context();audio.master={};audio.buffer=async(file,language)=>{loaded.push([file,language]);return {duration:1};};
setActiveLanguage(2);audio.play('LOCAL');audio.play('LITERAL');await new Promise(r=>setImmediate(r));assert.deepEqual(loaded.slice(0,2),[['CUSTOM/LINE_FRE.WAV',2],['literal_ENG.wav',2]],'Only Localize, not voice flags, substitutes SFX');
audio.hudUntil=3;audio.play('HUD');setActiveLanguage(0);audio.ctx.currentTime=3;audio.nextHud();await new Promise(r=>setImmediate(r));assert.deepEqual(loaded.at(-1),['QUEUE_FRE.WAV',2],'Queued announcer keeps its captured language');
setActiveLanguage(2);audio.setLoops([{id:1,event:'LOOP',x:0,y:0}]);await new Promise(r=>setImmediate(r));assert.deepEqual(loaded.at(-1),['LOOP_FRE.WAV',2]);const count=loaded.length;setActiveLanguage(0);audio.setLoops([{id:1,event:'LOOP',x:0,y:0}]);assert.equal(loaded.length,count,'Active loops do not restart after switching');audio.stopLoops();
const fetched=[];globalThis.fetch=async url=>{fetched.push(String(url));return new Response(new Uint8Array([new URL(String(url),'http://test').searchParams.get('language')==='2'?2:0]));};
assert.equal(new Uint8Array(await fetchBinary('same.wav',{language:0}))[0],0);assert.equal(new Uint8Array(await fetchBinary('same.wav',{language:2}))[0],2);await fetchBinary('same.wav',{language:0});assert.equal(fetched.length,2,'VFS cache separates language archive views');

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'swr-media-'));
const write=(name,bytes)=>{const file=path.join(temporary,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
function meg(entries){const values=Object.entries(entries),head=Buffer.alloc(8),names=values.map(([key])=>{const b=Buffer.from(key),out=Buffer.alloc(b.length+2);out.writeUInt16LE(b.length);b.copy(out,2);return out;});head.writeUInt32LE(values.length);head.writeUInt32LE(values.length,4);let at=8+names.reduce((n,b)=>n+b.length,0)+values.length*20;const table=Buffer.alloc(values.length*20),content=[];values.forEach(([,text],i)=>{const b=Buffer.from(text);table.writeUInt32LE(b.length,i*20+8);table.writeUInt32LE(at,i*20+12);table.writeUInt32LE(i,i*20+16);at+=b.length;content.push(b);});return Buffer.concat([head,...names,table,...content]);}
class Handle {
  constructor(file){this.file=file;this.name=path.basename(file);this.kind=fs.statSync(file).isDirectory()?'directory':'file';}
  async *entries(){for(const name of fs.readdirSync(this.file))yield [name,new Handle(path.join(this.file,name))];}
  async getFile(){return new File([fs.readFileSync(this.file)],this.name);}
}
let mounted;
try{
  for(const root of ['GameData','corruption'])write(root+'/Data/megafiles.xml','<Mega_Files/>');
  write('GameData/Data/Audio/SFX/sfx2d_non_localized.meg',meg({'CLICK.WAV':'common'}));
  write('GameData/Data/Audio/SFX/sfx2d_english.meg',meg({'SAME.WAV':'english','ONLY_ENG.WAV':'English only'}));
  write('GameData/Data/Audio/SFX/sfx2d_french.meg',meg({'SAME.WAV':'french','DELETE.WAV':'gone'}));
  write('corruption/Data/Audio/SFX/sfx2d_french.meg',meg({'SAME.WAV':'expansion'}));
  mounted=openGame(temporary);const french=mounted.forLanguage(2);assert.strictEqual(mounted.forLanguage('French'),french);assert.equal(french.read(french.resolve('SAME.WAV')).toString(),'expansion');assert.equal(french.resolve('ONLY_ENG.WAV'),null);assert(french.resolve('CLICK.WAV'));mounted.close();mounted=null;
  const found=await scanGame(new Handle(temporary),()=>{},2),entry=found.files['SAME.WAV'];assert(found.megs[entry[0]].includes('corruption'));assert(!found.files['ONLY_ENG.WAV']);assert(found.files['CLICK.WAV']);
  write('mod/Data/SAME.WAV','mod');write('mod/Data/DELETE.WAV','');
  write('GameData/Data/Audio/SFX/sfx2d_french.meg',meg({'DATA\\SAME.WAV':'base','DATA\\DELETE.WAV':'deleted'}));
  mounted=openGame(temporary,[path.join(temporary,'mod')],{language:2});assert.equal(mounted.read(mounted.resolve('Data/SAME.WAV')).toString(),'mod');assert.equal(mounted.resolve('Data/DELETE.WAV'),null);
  const englishView=mounted.forLanguage(0);assert.strictEqual(englishView.forLanguage(2),mounted,'Views share the original mount cache');assert.equal(englishView.read(englishView.resolve('Data/SAME.WAV')).toString(),'mod');assert.equal(englishView.resolve('Data/DELETE.WAV'),null);mounted.close();mounted=null;
  write('GameData/Data/megafiles.xml','<Mega_Files><File>Data/Audio/SFX/sfx2d_english.meg</File></Mega_Files>');
  mounted=openGame(temporary);assert(mounted.forLanguage(2).resolve('ONLY_ENG.WAV'),'Explicit manifest archives remain mounted independently of the automatic localized archive');
  const explicit=await scanGame(new Handle(temporary),()=>{},2);assert(explicit.files['ONLY_ENG.WAV'],'Folder mounts preserve explicit manifest entries too');
}finally{mounted?.close();const target=path.resolve(temporary);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});}
setActiveLanguage(0);
console.log('All 11 media policies, full artwork/cache/races, localized SFX, captured queues/loops, VFS cache and Node/browser archive mounts passed');

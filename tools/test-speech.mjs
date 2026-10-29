import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';
const mod=process.argv.indexOf('--mod');
const archive=openGame(fileURLToPath(new URL('../../Star Wars Empire at War',import.meta.url)),mod<0?[]:[process.argv[mod+1]]);
globalThis.fetch=async input=>{const name=archive.resolve(decodeURIComponent(String(input).replace(/^asset\//,''))),bytes=name&&archive.read(name);return new Response(bytes||null,{status:bytes?200:404});};
const {SpeechPlayer,loadSpeechEvents,parseSpeechEvents,speechFile}=await import('../public/js/speech.js');
const {setActiveLanguage}=await import('../public/js/language.js');
const events=await loadSpeechEvents(),event=events.get('TAR_EVENT_CONQUER_00');assert(event);
assert(event.files.includes('ERND_TAR0106_ENG.MP3'));assert(archive.resolve(speechFile(event.files[0])));
assert(events.size>100);assert([...events.values()].some(e=>e.files.length>1));
const schema=parseSpeechEvents('<SpeechEvents><SpeechEvent Name="Bounds"><Files>a.mp3 b.wav</Files><Text_ID>A B</Text_ID><Volume_Percent>200</Volume_Percent></SpeechEvent><SpeechEvent Name="Low"><Volume_Percent>-2</Volume_Percent></SpeechEvent><SpeechEvent Name="Default"/></SpeechEvents>');
assert.equal(schema.get('BOUNDS').volume,100);assert.equal(schema.get('LOW').volume,0);assert.equal(schema.get('DEFAULT').volume,100);
assert.deepEqual(schema.get('BOUNDS').files,['a.mp3','b.wav']);assert.deepEqual(schema.get('BOUNDS').textIds,['A','B']);
assert.equal(speechFile('line_ENG.mp3','French'),'Data/Audio/Speech/French/LINE_FRE.MP3');

class Context {
  constructor(){this.state='running';this.currentTime=0;this.sources=[];}
  createBufferSource(){const ctx=this,source={buffer:null,playbackRate:{value:1},onended:null,stopped:false,connect(){},disconnect(){},start(at,offset){this.offset=offset;this.at=ctx.currentTime;},stop(){this.stopped=true;this.onended?.();}};this.sources.push(source);return source;}
  createGain(){return {gain:{value:0},connect(){},disconnect(){}};}
  advance(dt){this.currentTime+=dt;for(const s of this.sources)if(!s.stopped&&s.at!==undefined&&this.currentTime>=s.at+s.buffer.duration-s.offset){s.stopped=true;s.onended?.();}}
}
const ctx=new Context(),audio={ctx,master:{},voiceVolume:.8},loaded=[];
const speech=new SpeechPlayer(audio,{events,random:()=>.75,readBuffer:file=>{loaded.push(file);return {duration:4};}});
const done=[],story=[];speech.on('done',r=>done.push(r.name));speech.on('storydone',r=>story.push(r.name));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const alternatives=new SpeechPlayer(audio,{events:schema,random:()=>.75,readBuffer:()=>({duration:4})});
const selected=alternatives.enqueue('bounds');alternatives.update();await flush();
assert.equal(selected.file,'Data/Audio/Speech/English/b.wav');assert.equal(selected.textId,'B');assert.equal(selected.gain.gain.value,.8);alternatives.clear(false);
const first=speech.enqueue(event.name.toLowerCase()),second=speech.enqueue(event.name);setActiveLanguage('French');
speech.update();await flush();assert.equal(first.state,'playing');assert.equal(second.state,'queued');assert(first.file.includes('/English/'));
assert.equal(first.source.playbackRate.value,1);assert.equal(first.gain.gain.value,event.volume/100*.8);
ctx.advance(3.9);speech.update();assert.equal(done.length,0,'No estimated-duration completion');
ctx.advance(.1);speech.update();assert.equal(done.length,1);assert.equal(second.state,'queued','Native processes one front transition per update');
speech.update();await flush();assert.equal(second.state,'playing');
ctx.advance(1);speech.suspend();speech.suspend();const offset=second.offset;
ctx.advance(30);speech.update();assert.equal(second.state,'paused');assert.equal(second.offset,offset);
speech.resume();speech.update();assert.equal(second.state,'paused');speech.resume();speech.update();assert.equal(second.source.offset,offset);
audio.voiceVolume=.25;speech.setVolume();assert.equal(second.gain.gain.value,event.volume/100*.25);
speech.enqueue(event.name);speech.clear(true);assert.equal(speech.queue.length,0);assert.equal(done.length,1);assert.equal(story.length,3,'Kill reports both active and pending names without natural callbacks');
speech.enqueue(event.name);speech.enqueue(event.name);speech.update();await flush();speech.stopActive();speech.update();assert.equal(done.length,2);assert.equal(speech.queue.length,1,'Stop_All_Speech retains pending entries');speech.clear(false);
assert.equal(speech.enqueue('unknown speech'),null);assert.equal(done.length,2);
const fail=new SpeechPlayer(audio,{events,readBuffer:()=>null});let failures=0;fail.on('done',()=>failures++);fail.enqueue(event.name);fail.update();await flush();fail.update();assert.equal(failures,1,'Open failure releases completion waits');
const translatedPaths=[],translatedLanguages=[],translated=new SpeechPlayer(audio,{events,readBuffer:(file,language)=>{translatedPaths.push(file);translatedLanguages.push(language);return null;}});
const french=translated.enqueue(event.name);setActiveLanguage('English');translated.update();await flush();translated.update();
assert.equal(french.language,'French');assert.deepEqual(translatedPaths,[speechFile(event.files[french.sample],'French')]);assert.equal(translated.queue.length,0,'Missing translation completes without an English retry');
assert.deepEqual(translatedLanguages,['French'],'The archive lookup uses the queued language too');
const english=translated.enqueue(event.name);translated.update();await flush();translated.update();assert.equal(english.language,'English');assert.equal(translatedPaths.at(-1),speechFile(event.files[english.sample],'English'),'New enqueues follow the newly selected language');
let resolveSlow;const slow=new SpeechPlayer(audio,{events,readBuffer:()=>new Promise(resolve=>resolveSlow=resolve)});
slow.enqueue(event.name);slow.update();await flush();slow.clear(false);resolveSlow({duration:4});await flush();assert.equal(slow.queue.length,0);assert(!ctx.sources.some(s=>!s.stopped),'Late decode cannot resurrect cancelled speech');

const {GalacticStoryDialog}=await import('../public/js/game/galacticstorydialog.js');
audio.speech=speech;let movieStops=0;const game={audio,movies:{stop:()=>movieStops++},paused:true};
const panel=new GalacticStoryDialog(game),lines=[];panel.open=true;panel.summary=true;
panel.dialog={setText(){},el:{setAttribute(){}},close(){}};panel.list={set:rows=>lines.push(rows.map(r=>typeof r.text==='function'?r.text():r.text).join('|')),dispose(){}};
panel.replay([{op:'DIALOG',value:event.name},{op:'TEXT',value:'Before'},{op:'WAIT',value:'SPEECH'},{op:'TEXT',value:'After'}],{});
speech.update();await flush();assert.equal(lines.at(-1),'Before');ctx.advance(4);speech.update();assert.equal(lines.at(-1),'Before|After');assert(movieStops>0);
panel.replay([{op:'DIALOG',value:event.name},{op:'WAIT',value:'SPEECH'},{op:'TEXT',value:'Wrong'}],{});speech.clear(true);assert(!lines.at(-1).includes('Wrong'),'Cancellation does not release the summary wait');
panel.summary=false;panel.replay([{op:'DIALOG',value:event.name},{op:'WAIT_SPEECH',value:''},{op:'TEXT',value:'Choice continues'}],{});assert.equal(lines.at(-1),'Choice continues','The narrow choice dialog does not wait for speech');speech.clear(false);
const timeout=globalThis.setTimeout;let milliseconds;
globalThis.setTimeout=(callback,delay)=>{milliseconds=delay;return 0;};panel.replay([{op:'WAIT',value:'500.9'},{op:'TEXT',value:'Later'}],{});globalThis.setTimeout=timeout;assert.equal(milliseconds,500,'Numeric chapter WAIT is integer UI milliseconds');
speech.enqueue(event.name);const removeCloseListener=speech.on('storydone',()=>{panel.open=false;panel.generation++;panel.list=null;});
assert.doesNotThrow(()=>panel.replay([{op:'DIALOG',value:event.name},{op:'TEXT',value:'Stale chapter'}],{}),'A cancellation story event can close the panel reentrantly');removeCloseListener();speech.clear(false);
panel.open=false;panel.dispose();
console.log(JSON.stringify({mod:mod>=0,events:events.size,sample:event.files[0],result:'FIFO, original files, language capture, real EOF, pause offsets, live volume, cancellation, stream failure and chapter waits passed'}));

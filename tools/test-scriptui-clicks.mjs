import assert from 'node:assert/strict';
import { ScriptUI } from '../public/js/game/scriptui.js';

class Button {
  constructor(name){this.dataset={control:name};this.disabled=false;this.listeners=[];this.flags=new Set();this.classList={contains:n=>this.flags.has(n),toggle:(n,on)=>on?this.flags.add(n):this.flags.delete(n)};}
  addEventListener(type,fn,capture=false){this.listeners.push({fn,capture});}
  click(){const event={preventDefault(){},stopImmediatePropagation(){this.stopped=true;}};
    for(const listener of this.listeners.filter(l=>l.capture)){listener.fn(event);if(event.stopped)return;}
    if(!this.disabled&&!this.flags.has('dis'))this.onclick?.();
    for(const listener of this.listeners.filter(l=>!l.capture))listener.fn(event);
  }
}
globalThis.document={createElementNS:()=>({style:{},setAttribute(){}}),body:{appendChild(){}}};
const pause=new Button('b_play_pause'),tab=new Button('b_space_tab'),signals=[],sounds=[],buttons=[pause,tab];
const component={val:()=>''},comps=new Map([['B_PLAY_PAUSE',component],['B_SPACE_TAB',component]]);
const game={paused:false,ui:{root:{querySelectorAll:()=>buttons}},story:{clickGUI:name=>signals.push(name)}};
pause.onclick=()=>{game.paused=!game.paused;sounds.push('pause');};tab.onclick=()=>sounds.push('tab');
const ui=new ScriptUI(game,{comps,shell:new Map()});
ui.click('b_play_pause',true);ui.click('b_play_pause',true);
assert.equal(game.paused,false);assert.deepEqual(sounds,['pause','pause']);assert.deepEqual(signals,[],
  'Forced native activation retains callback and sound without generating generic story input');
pause.click();assert.equal(game.paused,true);assert.deepEqual(signals,['B_PLAY_PAUSE'],'Real input emits one story signal after its callback');
pause.onclick=()=>{game.paused=!game.paused;sounds.push('pause');ui.click('b_space_tab',true);};
ui.click('b_play_pause',true);assert.equal(game.paused,false);assert.equal(ui.forcedNativeDepth,0);assert.equal(signals.length,1,'Nested forced callbacks do not leak input notifications');
pause.click();assert.equal(signals.length,2);assert.deepEqual(signals,['B_PLAY_PAUSE','B_PLAY_PAUSE']);
pause.onclick=()=>{throw new Error('callback failed');};
assert.throws(()=>ui.click('b_play_pause',true),/callback failed/);assert.equal(ui.forcedNativeDepth,0,'Callback failure restores input routing');
pause.onclick=()=>{};pause.click();assert.equal(signals.length,3);
console.log('Script UI clicks passed: native callbacks and sounds, real-input story signals, forced-input separation, nested callbacks and exception cleanup.');

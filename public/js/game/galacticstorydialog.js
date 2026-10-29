import { db } from '../gamedata.js';
import { fetchText } from '../vfs.js';
import { loadTextureCanvas } from '../dds.js';
import { openDialog, loadDialogs } from './dialogs.js';

const key = s => String(s || '').toUpperCase(), rgba = c => `rgba(${c.slice(0,3).join(',')},${(c[3] ?? 255)/255})`;
const scripts = new Map(), pictures = new Map();
const unquote = s => s.replace(/^"([\s\S]*)"$/, '$1');

async function chapterScript(name, chapter = 0) {
  const file = String(name || '').replace(/\\/g, '/');
  const path = /^Data\//i.test(file) ? file : 'Data/Scripts/Story/' + file.replace(/\.txt$/i, '') + '.txt';
  if (!scripts.has(key(path))) scripts.set(key(path), fetchText(path));
  return parseStoryDialog(await scripts.get(key(path)), chapter);
}

export function storySummaryHeader(commands, options = {}) {
  let color = null, title = '';
  for (const c of commands) {
    if (c.op === 'TEXTCOLOR') color = c.value.split(/\s+/).slice(0,4).map(Number);
    if (c.op === 'TEXT') { title = storyDialogEntry({text:c.value, params:options.variable ? [options.variable] : []}); break; }
  }
  return { title, color };
}

export function storySummaryColors(color,record) {
  const top=color ? color.map(v=>record.read||record.completed?Math.trunc(v*.66):v) : record.read||record.completed?[128,128,128,255]:[128,128,255,255];
  return {top,bottom:record.read&&!record.completed?[172,172,255,255]:top};
}

export function parseStoryDialog(source, chapter = 0) {
  let active = false; const out = [];
  for (const raw of String(source || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const header = line.match(/^\[CHAPTER\s+(-?\d+)\s*\]/i);
    if (header) { active = +header[1] === +chapter; continue; }
    if (!active) continue;
    const match = line.match(/^(\w+)\s*([\s\S]*)$/); if (match) out.push({ op: key(match[1]), value: unquote(match[2].trim()) });
  }
  return out;
}

function parameter(value) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  const candidate = value.type || value.__type;
  const name = typeof candidate === 'string' ? candidate : typeof value.__name === 'string' ? value.__name : typeof value.name === 'string' ? value.name : '';
  const type = typeof candidate?.str === 'function' ? candidate : typeof value.str === 'function' ? value : db.type(name);
  return type ? db.t(type.str('Text_ID')) : name;
}
export function storyDialogEntry(entry) {
  const source = typeof entry === 'string' ? entry : String(entry?.text ?? entry?.key ?? '');
  const template = db.text.get(key(source).trim()) ?? source;
  const params = typeof entry === 'object' ? entry.params || entry.values || [] : [];
  let index = 0;
  return template.replace(/%%|%(?:\d+\$)?[-+0 #]*\d*(?:\.\d+)?[sSdiufg]/g, token => {
    if (token === '%%') return '%';
    const position = token.match(/^%(\d+)\$/), value = params[position ? +position[1]-1 : index++];
    if (value === undefined) return token;
    return /[diu]$/.test(token) ? String(Math.trunc(Number(value) || 0)) : /[fg]$/.test(token) ? String(Number(value) || 0) : parameter(value);
  });
}

export function storyDialogLines(commands, entries = [], variable = '') {
  const lines = []; let color = [255,255,255,255];
  for (const c of commands) {
    if (c.op === 'TEXTCOLOR') color = c.value.split(/\s+/).slice(0,4).map(Number);
    else if (c.op === 'CLEARTEXT') lines.length = 0;
    else if (c.op === 'NEWLINE') for (let i=0;i<Math.max(0,parseInt(c.value)||0);i++) lines.push({ text:' ', color:color.slice() });
    else if (c.op === 'TEXT') lines.push({ text:storyDialogEntry({text:c.value,params:variable ? [variable] : []}),color:color.slice() });
    else if (c.op === 'EXTRA_TEXT') for (const e of entries) lines.push({text:storyDialogEntry(e),color:color.slice()});
  }
  return lines;
}

function coloredList(d,id) {
  return {set(items){d.coloredTextList(id,()=>items.map(item=>({text:typeof item.text==='function'?item.text():item.text,color:rgba(item.color),wrap:true})),{follow:false});},dispose(){}};
}

export class GalacticStoryDialog {
  constructor(game) {
    this.game=game;this.open=false;this.dialog=null;this.generation=0;this.timer=0;this.list=null;this.options=null;this.wasPaused=false;this.summary=false;this.summaryTab=false;this.summaryRows=null;this.summaryRowsOrder=[];this.summarySelected=null;this.refreshGeneration=0;
    this.speechFinished=true;this.speechWait=null;
    this.titleSource=null;
    this.unsubscribeSpeech=game.audio?.speech?.on('done',()=>{
      this.speechFinished=true;if(this.open&&this.summary)game.movies?.stop();
      const resume=this.speechWait;this.speechWait=null;resume?.();
    });
  }
  get opened() { return this.open; }

  async show(options = {}) {
    if (!options.choice) return this.showSummary(options);
    if (this.open) return false;
    const name=String(options.name || '').replace(/\\/g,'/'), path=/^Data\//i.test(name)?name:'Data/Scripts/Story/'+name.replace(/\.txt$/i,'')+'.txt';
    if (!scripts.has(key(path))) scripts.set(key(path),fetchText(path));
    const source=await scripts.get(key(path)); if (!source || this.open) return false;
    const commands=parseStoryDialog(source,options.chapter||0); if (!commands.length) return false;
    this.open=true;this.options=options;this.wasPaused=!!this.game.paused;if(this.game.pauseGalactic)this.game.pauseGalactic(true);else this.game.paused=true;const generation=++this.generation;
    this.game.keys?.clear();if(this.game.mouse)this.game.mouse.in=false;
    try {
      const skin=await loadDialogs(),def=skin?.dialogs.get('IDD_STORY_DIALOG');if(!def){this.close();return false;}
      const d=await openDialog('IDD_STORY_DIALOG',{cls:'galactic-story-dialog',nativeImages:true,nativeLists:true,nativeFonts:true});
      if (!d){this.close();return false;}
      if (!this.open || generation!==this.generation){d.close();return false;}
      this.dialog=d;this.list=coloredList(d,'IDC_STORY_TEXT',skin);d.el.setAttribute('role','dialog');d.el.setAttribute('aria-modal','true');
      d.onLanguageRefresh(()=>{if(this.titleSource)d.el.setAttribute('aria-label',this.titleSource());});
      d.show('IDC_DIALOG_CLOSE_BUTTON',false);d.show('IDC_STORY_DIALOG_ACCEPT',!!options.choice);d.show('IDC_STORY_DIALOG_CANCEL',!!options.choice);d.show('IDC_STORY_DIALOG_CLOSE_BUTTON',!options.choice);
      for(const [id,result]of[['IDC_STORY_DIALOG_CLOSE_BUTTON','close'],['IDC_STORY_DIALOG_ACCEPT','accept'],['IDC_STORY_DIALOG_CANCEL','cancel']]){
        const ctl=d.ctl(id);if(ctl){ctl.tabIndex=0;ctl.setAttribute('role','button');ctl.onkeydown=e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();ctl.click();}};}
        d.on(id,()=>this.close(result));
      }
      this.keyHandler=e=>{if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.close(options.choice?'accept':'close');}};addEventListener('keydown',this.keyHandler,true);
      d.ctl(options.choice?'IDC_STORY_DIALOG_ACCEPT':'IDC_STORY_DIALOG_CLOSE_BUTTON')?.focus();
      this.replay(commands,options);return true;
    }catch(error){this.close();throw error;}
  }

  async showSummary(options = null) {
    if (this.open) {
      if(options){if(options.id)(this.popupRequests||=[]).push(options);await this.refreshSummary();return true;}
      this.close();return false;
    }
    this.open=true; this.summary=true; this.summaryTab=false; this.options=null; this.popupRequests=options?.id?[options]:[];
    this.speechFinished=true;
    this.wasPaused=!!this.game.paused;if(this.game.pauseGalactic)this.game.pauseGalactic(true);else this.game.paused=true;const generation=++this.generation;
    this.game.keys?.clear(); if (this.game.mouse) this.game.mouse.in=false;
    try {
      const skin=await loadDialogs();
      const d=await openDialog('IDD_STORY_SUMMARY_DIALOG',{cls:'galactic-story-summary',nativeImages:true,nativeLists:true,nativeFonts:true});
      if (!d) {this.close();return false;}
      if (!this.open || generation!==this.generation) {d.close();return false;}
      this.dialog=d; this.list=coloredList(d,'IDC_STORY_RECAP',skin);
      d.el.setAttribute('role','dialog');d.el.setAttribute('aria-modal','true');d.el.setAttribute('aria-label',db.t('TEXT_STORY_GOALS'));
      d.onLanguageRefresh(()=>d.el.setAttribute('aria-label',db.t('TEXT_STORY_GOALS')));
      d.show('IDC_DIALOG_CLOSE_BUTTON',false);d.show('IDC_SUMMARY_DIALOG_ABANDON',false);
      d.show('IDC_RADIO_COMPLETED',this.game.galaxy.campaign.bool('Show_Completed_Tab',true));
      d.radios(['IDC_RADIO_ACTIVE','IDC_RADIO_COMPLETED'],'IDC_RADIO_ACTIVE',id=>{this.summaryTab=id==='IDC_RADIO_COMPLETED';this.summarySelected=null;this.refreshSummary();});
      const close=d.ctl('IDC_SUMMARY_DIALOG_CLOSE_BUTTON');
      if(close){close.tabIndex=0;close.setAttribute('role','button');close.onkeydown=e=>{if(e.code==='Enter'||e.code==='Space'){e.preventDefault();this.close();}};}
      d.on('IDC_SUMMARY_DIALOG_CLOSE_BUTTON',()=>this.close());
      this.keyHandler=e=>{if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.close();}};addEventListener('keydown',this.keyHandler,true);
      await this.refreshSummary(options); close?.focus(); return true;
    } catch(error) {this.close();throw error;}
  }

  async refreshSummary(preferred = null,selectedIndex=null) {
    if (!this.open || !this.summary || !this.dialog) return;
    if(!preferred&&selectedIndex===null&&this.summarySelected!==null)selectedIndex=this.summaryRowsOrder.indexOf(this.summarySelected);
    const generation=++this.refreshGeneration, records=(this.game.story?.storyGoals || []).filter(g=>!!g.completed===this.summaryTab&&(!g.audience||!this.game.setup?.net||String(g.audience).toUpperCase()===String(this.game.me).toUpperCase()));
    const chapters=await Promise.all(records.map(async record=>{
      const commands=await chapterScript(record.name,record.chapter), header=storySummaryHeader(commands,record);
      return {record,commands,header};
    }));
    let currentColor=null;
    const rows=chapters.map(({record,commands,header})=>{
      if(header.color)currentColor=header.color;
      const colors=storySummaryColors(currentColor,record);
      return { key:record.id,label:header.title,color:rgba(colors.top),bottomColor:rgba(colors.bottom),record,commands };
    });
    if(!this.open||!this.summary||generation!==this.refreshGeneration)return;
    this.summaryRowsOrder=rows.map(row=>row.key);
    this.summaryRows=this.dialog.list('IDC_GOAL_LIST',()=>rows.map(row=>({...row,label:storySummaryHeader(row.commands,row.record).title})),row=>this.selectSummary(row));
    const selected=(selectedIndex!==null?rows[Math.max(0,selectedIndex)]:rows.find(row=>row.key===(preferred?.id ?? this.summarySelected))) || rows[0];
    if(selected)this.summaryRows?.select(selected.key);else{this.generation++;clearTimeout(this.timer);this.speechWait=null;this.summarySelected=null;this.dialog.setText('IDC_STATIC','');this.list.set([]);this.game.movies?.stop();}
  }

  selectSummary(row) {
    if (!this.open || !this.summary || this.summarySelected===row.key) return;
    this.summarySelected=row.key;row.record.read=true;
    this.dialog.setText('IDC_STATIC','');this.replay(row.commands,row.record);
  }

  replay(commands,options) {
    clearTimeout(this.timer);this.speechWait=null;const generation=++this.generation,d=this.dialog;
    let cursor=0,color=[255,255,255,255],lines=[];this.list.set([]);
    const run=()=>{
      if(!this.open||generation!==this.generation)return;
      while(cursor<commands.length&&this.open&&generation===this.generation){const c=commands[cursor++];switch(c.op){
        case 'TITLE':{const title=()=>db.text.get(key(c.value))??c.value;d.setText('IDC_STATIC',title);if(!this.summary){d.el.setAttribute('aria-label',title());this.titleSource=title;}break;}
        case 'TEXTCOLOR':color=c.value.split(/\s+/).slice(0,4).map(Number);break;
        case 'TEXT':lines.push({text:()=>storyDialogEntry({text:c.value,params:options.variable?[options.variable]:[]}),color:color.slice()});break;
        case 'NEWLINE':for(let i=0;i<Math.max(0,parseInt(c.value)||0);i++)lines.push({text:' ',color:color.slice()});break;
        case 'EXTRA_TEXT':for(const e of options.entries||[])lines.push({text:()=>storyDialogEntry(e),color:color.slice()});break;
        case 'CLEARTEXT':lines=[];break;
        case 'IMAGE':this.image(c.value,generation);break;
        case 'CLEARIMAGE':d.setImage('IDC_IMAGE',null);break;
        case 'SFX':this.game.audio?.play(c.value);break;
        case 'DIALOG':this.speechFinished=false;this.game.audio?.speech?.replace(c.value);break;
        case 'MOVIE':case 'MOVIE_ONCE':if(this.summary)this.game.movies?.play(c.value,c.op==='MOVIE');break;
        case 'STOPMOVIE':if(this.summary)this.game.movies?.stop();break;
        case 'WAIT_SPEECH':
          if(this.summary&&!this.speechFinished){this.list.set(lines);this.speechWait=run;return;}break;
        case 'WAIT':
          if(key(c.value)==='SPEECH'){
            if(this.summary&&!this.speechFinished){this.list.set(lines);this.speechWait=run;return;}
          }else if(parseInt(c.value,10)>0){this.list.set(lines);this.timer=setTimeout(run,parseInt(c.value,10));return;}
          break;
      }}
      if(this.open&&generation===this.generation)this.list.set(lines);
    };run();
  }

  async image(name,generation){if(!pictures.has(key(name)))pictures.set(key(name),loadTextureCanvas(name).then(c=>c?.toDataURL()).catch(()=>null));const url=await pictures.get(key(name));if(this.open&&generation===this.generation)this.dialog?.setImage('IDC_IMAGE',url);}
  close(result='close') {
    if(!this.open)return;const popups=this.popupRequests||[];this.popupRequests=[];if(this.game.setup?.net){for(const popup of popups)this.game.order?.({c:'dialog',id:popup.id});}else this.game.story?.generic?.('close_story_dialog');const summary=this.summary,killSpeech=!summary||!this.speechFinished;
    this.open=false;this.generation++;clearTimeout(this.timer);this.speechWait=null;this.list?.dispose();this.list=null;this.dialog?.close();this.dialog=null;
    removeEventListener('keydown',this.keyHandler,true);if(this.game.pauseGalactic)this.game.pauseGalactic(false);else this.game.paused=this.wasPaused;const options=this.options;this.options=null;
    if(this.summary&&this.game.story)this.game.story.storyGoals=this.game.story.storyGoals.filter(g=>!g.removeAfterRead||!g.read);
    this.summary=false;this.summarySelected=null;this.summaryRows=null;this.summaryRowsOrder=[];this.refreshGeneration++;this.titleSource=null;
    if(summary)this.game.movies?.stop();
    if(killSpeech)this.game.audio?.speech?.clear(true);
    if(result==='accept')options?.onAccept?.();else if(result==='cancel')options?.onCancel?.();options?.onClose?.(result);
  }
  dispose(){this.unsubscribeSpeech?.();this.close();}
}

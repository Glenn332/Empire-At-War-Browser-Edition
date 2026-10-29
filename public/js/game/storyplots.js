import {parseXML} from '../xml.js';
import {fetchText} from '../vfs.js';
import {resetCombatEvent} from './galacticbattleevents.js';
import {ObjectiveList,objectiveReward} from './objectives.js';
import {objectivePanel} from './objectivepanel.js';
const key=s=>String(s||'').replace(/\\/g,'/').toUpperCase();
const yes=s=>/^(true|yes|1)$/i.test(String(s));
const split=s=>String(s||'').split(',').map(s=>s.trim()).filter(Boolean);
const prereqNames=s=>String(s||'').split(/[\s,]+/).filter(Boolean);
const nameSets=new Map();
const wantedNames=s=>{let set=nameSets.get(s);if(!set){set=new Set(split(s).map(n=>key(n)));if(nameSets.size>4096)nameSets.clear();nameSets.set(s,set);}return set;};
const xmlPath=s=>/^DATA\//i.test(key(s))?String(s).replace(/\\/g,'/'):'Data/XML/'+String(s).replace(/\\/g,'/');
export class StoryPlots {
  async readPlot(name, scriptName = '', owner = '') {
    const existing=[...this.plots.values()].find(p=>key(p.name)===key(name)&&key(p.owner)===key(owner));if(existing)return existing;
    const id=this.plots.has(key(name))?key(name)+'|'+key(owner):key(name);
    const plot = { name, scriptName, owner, events: new Map(), instance: null };
    this.plots.set(id, plot);
    const src = await fetchText(xmlPath(name));
    if (!src) { this.errors.set(name, 'Story plot file was not found'); return plot; }
    for (const root of parseXML(src).children) {
      for (const node of root.children) {
        if (/^Lua_Script$/i.test(node.tag)) scriptName = node.text.trim();
        else if (/^Active_Plot$/i.test(node.tag)) {
          const child = await this.readPlot(node.text.trim(), scriptName, owner);
          child.parent = plot;
          scriptName='';
        } else if (/^Event$/i.test(node.tag) && node.attrs.Name) {
          const params = [], rewards = [];
          for (const n of node.children) {
            const m = n.tag.match(/^Event_Param(\d+)$/i), r = n.tag.match(/^Reward_Param(\d+)$/i);
            if (m) params[+m[1] - 1] = n.text.trim(); if (r) rewards[+r[1] - 1] = n.text.trim();
          }
          const event = { name: node.attrs.Name, plot, type: key(node.val('Event_Type')), params, rewards,
            reward: key(node.val('Reward_Type')), prereqs: node.all('Prereq').map(n => prereqNames(n.text)),
            branch: node.val('Branch'), perpetual: yes(node.val('Perpetual')), completed: false, disabled: false, elapsedFrom: null,
            dialog: node.val('Story_Dialog'), chapter: node.num('Story_Chapter', 0), tag: node.val('Story_Tag'),
            popup: node.child('Story_Dialog_Popup') ? yes(node.val('Story_Dialog_Popup')) : true,
            dialogSFX: node.child('Story_Dialog_SFX') ? yes(node.val('Story_Dialog_SFX')) : true, entries: [] };
          event.active = !event.prereqs.length; event.dependents = [];
          this.dropEvent(plot.events.get(key(event.name)));
          plot.events.set(key(event.name), event);
          const list = this.eventTypes.get(event.type) || []; list.push(event); this.eventTypes.set(event.type, list);
          if (event.type === 'STORY_ELAPSED'||event.type==='STORY_FLAG') this.timedEvents.add(event);
        }
      }
    }
    for (const event of plot.events.values()) for (const name of new Set(event.prereqs.flat().map(key))) {
      plot.events.get(name)?.dependents.push(event);
    }
    return plot;
  }

  combatSnapshot(){return [...this.plots.values()].map(p=>({name:p.name,owner:p.owner,events:[...p.events.values()].map(e=>({name:e.name,battleCount:e.battleCount||0,remainingCounts:e.remainingCounts?.slice()||null,completed:e.completed,active:e.active,disabled:e.disabled,elapsedFrom:e.elapsedFrom,params:e.params.slice(),rewards:e.rewards.slice(),reward:e.reward}))}));}
  async restoreCombatEvents(savedPlots){
    for(const saved of savedPlots){const plot=await this.readPlot(saved.name,'',saved.owner);for(const state of saved.events){const event=plot.events.get(key(state.name));if(event)Object.assign(event,{...state,params:state.params.slice(),rewards:state.rewards.slice(),remainingCounts:state.remainingCounts?.slice()||null});}}
  }

  plotWrapper(name) {
    const owner=(this.currentStoryPlot?.()||this.current?.plot)?.owner;
    const plot=[...this.plots.values()].find(p=>key(p.name)===key(name)&&(owner===undefined||key(p.owner)===key(owner)));if(!plot)return undefined;
    return this.plotWrapperOf(plot);
  }
  plotWrapperOf(plot) {
    if(!plot)return undefined;
    return { __wrap: true, __name: plot.name, __plotRef: plot, Is_Valid: () => true, Get_Event: n => {
      const e = plot.events.get(key(n)); if (!e) return undefined;
      return this.eventWrapperOf(plot, e);
    }, __missing: this.absent('StoryPlot') };
  }
  eventWrapperOf(plot, e) {
    {
      return { __wrap: true, __name: e.name, __eventRef: e, Is_Valid: () => true,
        Set_Reward_Parameter: (i, v) => { e.rewards[+i] = v?.__planet ? v.__planet.type.name : v?.__type ? v.__type.name : v?.__object ? v.__object.type.name : String(v ?? ''); },
        Set_Event_Parameter: (i, v) => { e.params[+i] = v?.__type ? v.__type.name : v?.__object ? v.__object.type.name : String(v ?? '');if(e.type==='STORY_DESTROY'&&+i===2||['STORY_DEFEAT_HERO','STORY_CONQUER'].includes(e.type)&&+i===1)e.remainingCounts=null; },
        Set_Reward_Type: v => { e.reward = key(v); },
        Set_Dialog: v => { e.dialog = String(v); }, Set_Story_Dialog: v => { e.dialog = String(v); },
        Add_Dialog_Text: (text, ...params) => e.entries.push({ text: String(text ?? ''), params }), Clear_Dialog_Text: () => { e.entries.length = 0; },
        __missing: this.absent('StoryEvent') };
    }
  }

  prerequisites(e) {
    return !e.prereqs.length || e.prereqs.some(names => names.every(n => e.plot.events.get(key(n))?.completed));
  }
  fire(e, force = false) {
    if (e.disabled || (!force && (e.completed || !(e.active ?? this.prerequisites(e))))) return false;
    if(!force&&e.plot?.active===false)return false;
    if(e.plot?.instance)this.invokeStoryCallback(e.plot.instance,e.name);
    e.completed = true;
    if (e.type === 'STORY_ELAPSED') e.elapsedFrom = this.time;
    if (!e.perpetual) this.timedEvents.delete(e);
    const firing = this.firingPlot; this.firingPlot = e.plot;
    try { this.reward(e); } finally { this.firingPlot = firing; }
    if (e.dialog) {
      const request = { id: ++this.storyGoalId, name: e.dialog, chapter: e.chapter, tag: e.tag || `${e.dialog}_${e.chapter}`,
        entries: e.entries.slice(), popup: e.popup, eventName: e.name, completed: false, read: false, removeAfterRead: !e.tag,
        ...(this.game.storyAudience ? { audience: this.game.storyLocal?.(e.plot?.owner) } : {}) };
      this.storyGoals.unshift(request); this.storyGoalAt = this.time;
      const shown = !this.game.storyAudience || this.game.storyAudience(e.plot?.owner);
      if (e.popup) this.game.holdForDialog?.(request, e.plot?.owner);
      if (shown && e.popup) this.game.showStoryDialog?.(request);
      else if (shown) this.game.notifyStoryGoal?.(request, e.dialogSFX !== false);
      this.game.storyDialog?.refreshSummary();
    }
    for (const dependent of e.dependents || []) if (!dependent.active && !dependent.completed && this.prerequisites(dependent)) {
      dependent.active = true;
      if (dependent.type === 'STORY_ELAPSED' && dependent.elapsedFrom === null) dependent.elapsedFrom = this.time;
      if (dependent.type === 'STORY_TRIGGER') this.fire(dependent);
    }
    if (e.perpetual) { e.completed = false; e.active = e.type !== 'STORY_TRIGGER' || !e.prereqs.length; resetCombatEvent(e); }
    return true;
  }
  signal(type, value) {
    const target = key(value);
    for (const e of this.eventTypes.get(type) || []) {
      const wanted = type === 'STORY_AI_NOTIFICATION' ? (e.params[1] || e.params[0]) : e.params[0];
      if(type==='STORY_VICTORY'&&!wanted)continue;
      if (!wanted || wantedNames(wanted).has(target)) this.fire(e);
    }
  }
  signalCorruption(type, planet, value) {
    for (const e of this.eventTypes.get(type) || []) {
      const names = split(e.params[0]).map(key), name = key(e.params[1]).replace(/^CORRUPTION_/, '');
      const wanted = name === 'NONE' ? -1 : name === 'ANY' ? 8 : Math.max(0, ['INTIMIDATION', 'PIRACY', 'KIDNAPPING', 'RACKETEERING', 'CORRUPT_MILITIA', 'BRIBERY', 'BLACK_MARKET', 'BONDED_CITIZENS'].indexOf(name));
      if (!names.includes(key(planet.type.name)) && !names.includes(key(planet.name))) continue;
      if (value === wanted || (wanted === 8 && value !== -1)) this.fire(e);
    }
  }
  signalCapture(typeName, faction) {
    const target = key(typeName), side = key(faction);
    for (const e of this.eventTypes.get('STORY_CAPTURE_STRUCTURE') || []) if (wantedNames(e.params[0] || '').has(target) && key(e.params[1]) === side) this.fire(e);
  }
  clickGUI(name) { this.signal('STORY_CLICK_GUI', name); }

  generic(name){this.signal('STORY_GENERIC',name);}
  dropEvent(e){if(!e)return;const list=this.eventTypes.get(e.type);if(list){const i=list.indexOf(e);if(i>=0)list.splice(i,1);}this.timedEvents.delete(e);}
  addEvent(plot,{name,type,params=[],rewards=[],reward='',prereqs=[]}){
    const event={name,plot,type:key(type),params,rewards,reward:key(reward),prereqs,branch:'',perpetual:false,completed:false,disabled:false,elapsedFrom:null,dialog:'',chapter:0,tag:'',popup:true,dialogSFX:true,entries:[],active:!prereqs.length,dependents:[]};
    this.dropEvent(plot.events.get(key(name)));
    plot.events.set(key(name),event);
    const list=this.eventTypes.get(event.type)||[];list.push(event);this.eventTypes.set(event.type,list);
    for(const n of new Set(prereqs.flat().map(key)))plot.events.get(n)?.dependents.push(event);
    return event;
  }
  get objectives(){return this._objectives||=new ObjectiveList((list,sound)=>{if(this.game&&typeof document!=='undefined')objectivePanel(this.game).update(list,sound);});}
  commonReward(e){
    const p=e.rewards;
    if(objectiveReward(this.objectives,e.reward,p))return true;
    switch(e.reward){
      case 'DISABLE_STORY_EVENT': {
        if (!p[0] || !p[1]) break;
        for (const plot of parseInt(p[2],10) ? this.plots.values() : [e.plot]) {
          const event = plot.events.get(key(p[0])); if (event) event.disabled = !!parseInt(p[1],10);
        }
        break;
      }
      case 'DISABLE_BRANCH': case 'ENABLE_BRANCH':
        if (!p[0] || e.reward === 'DISABLE_BRANCH' && !p[1]) break;
        for (const event of e.plot.events.values()) if (event.branch === p[0]) event.disabled = e.reward === 'DISABLE_BRANCH' && !!parseInt(p[1],10);
        break;
      case 'RESET_BRANCH': {
        if (!p[0]) break;
        if (this.resetDepth >= 3) { this.errors.set(e.name, 'Story event reset recursion limit exceeded'); break; }
        this.resetDepth++;
        try {
          for (const event of e.plot.events.values()) if (event.branch === p[0]) {
            event.completed = false; event.active = !event.prereqs.length; event.elapsedFrom = null;
            resetCombatEvent(event);
            if (event.type === 'STORY_ELAPSED'||event.type==='STORY_FLAG') this.timedEvents.add(event);
          }
          const trigger = p[1] && e.plot.events.get(key(p[1])); if (trigger) this.fire(trigger, true);
        } finally { this.resetDepth--; }
        break;
      }
      case 'SET_FLAG': this.flags.set(p[0],p[1]); break;
      case 'INCREMENT_FLAG': if(!this.flags.increment(p[0],p[1]))this.errors.set(e.name,'Cannot increment undefined XML story flag: '+p[0]); break;
      default:return false;
    }
    return true;
  }

  startTactical(planet,space){
    const requests=[];
    for(const e of this.eventTypes.get(space?'STORY_SPACE_TACTICAL':'STORY_LAND_TACTICAL')||[]){
      if(e.disabled||e.completed||!e.active||e.plot.active===false)continue;
      const names=split(e.params[1]).map(key);if(names.length&&!names.includes(key(planet.name)))continue;
      this.fire(e);
      if(e.params[0])requests.push({name:e.params[0],owner:e.plot.owner});
    }
    return requests;
  }

  pollEvents(flagsOnly=false){
    for(const e of this.timedEvents){
      if(e.disabled||e.completed||!e.active||e.plot?.active===false||e.plot?.instance?.state==='new')continue;
      if(e.type==='STORY_ELAPSED'){
        if(flagsOnly)continue;
        if(e.elapsedFrom===null)e.elapsedFrom=this.time;
        if(this.time-e.elapsedFrom>=(+e.params[0]||0))this.fire(e);
      }else if(e.type==='STORY_FLAG'){
        const target=(parseInt(e.params[1],10)||0)|0,mode=String(e.params[2]||'').trim();
        for(const name of split(e.params[0])){
          const value=this.flags.get(name);if(value===undefined||value===-99999999)continue;
          const match=!mode||mode==='EQUAL_TO'?value===target:mode==='LESS_THAN'?value<target:mode==='GREATER_THAN_EQUAL_TO'?value>=target:mode==='LESS_THAN_EQUAL_TO'?value<=target:mode==='NOT_EQUAL_TO'?false:value>target;
          if(match)this.fire(e,true);
        }
      }
    }
  }

}

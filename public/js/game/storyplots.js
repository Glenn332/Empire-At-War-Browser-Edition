import { parseXML } from '../xml.js';
import { EngineHash, crc32 } from './enginehash.js';
import { db } from '../gamedata.js';
import { fetchText } from '../vfs.js';
import { resetCombatEvent } from './galacticbattleevents.js';
import { ObjectiveList, objectiveReward } from './objectives.js';
const TIMED = new Set(['STORY_ELAPSED', 'STORY_FLAG', 'STORY_OBJECTIVE_TIMEOUT']);
const eventAlias = type => (type === 'STORY_CORRUPTION_INCREASED' ? 'STORY_CORRUPTION_CHANGED' : type);
import { objectivePanel } from './objectivepanel.js';
const key = s =>
  String(s || '')
    .replace(/\\/g, '/')
    .toUpperCase();
const yes = s => /^(true|yes|1)$/i.test(String(s));
const split = s =>
  String(s || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const prereqNames = s =>
  String(s || '')
    .split(/[\s,]+/)
    .filter(Boolean);
const nameSets = new Map();
const FILTERS = [
  'FILTER_NONE',
  'FILTER_FRIENDLY_ONLY',
  'FILTER_NEUTRAL_ONLY',
  'FILTER_ENEMY_ONLY',
  'FILTER_FRIENDLY_AND_NEUTRAL',
  'FILTER_ENEMY_AND_NEUTRAL',
  'FILTER_FRIENDLY_AND_ENEMY'
];
const flag = s => (parseInt(String(s ?? '').trim(), 10) || 0) !== 0;
const wantedNames = s => {
  let set = nameSets.get(s);
  if (!set) {
    set = new Set(split(s).map(n => key(n)));
    if (nameSets.size > 4096) nameSets.clear();
    nameSets.set(s, set);
  }
  return set;
};
const xmlPath = s => (/^DATA\//i.test(key(s)) ? String(s).replace(/\\/g, '/') : 'Data/XML/' + String(s).replace(/\\/g, '/'));
export class StoryPlots {
  async readPlot(name, scriptName = '', owner = '') {
    const existing = [...this.plots.values()].find(p => key(p.name) === key(name) && key(p.owner) === key(owner));
    if (existing) return existing;
    const id = this.plots.has(key(name)) ? key(name) + '|' + key(owner) : key(name);
    const plot = { name, scriptName, owner, events: new Map(), instance: null };
    this.plots.set(id, plot);
    this.hashPlot(id, plot);
    const src = await fetchText(xmlPath(name));
    if (!src) {
      this.errors.set(name, 'Story plot file was not found');
      return plot;
    }
    for (const root of parseXML(src).children) {
      for (const node of root.children) {
        if (/^Lua_Script$/i.test(node.tag)) scriptName = node.text.trim();
        else if (/^Active_Plot$/i.test(node.tag)) {
          const child = await this.readPlot(node.text.trim(), scriptName, owner);
          child.parent = plot;
          scriptName = '';
        } else if (/^Event$/i.test(node.tag) && node.attrs.Name) {
          const params = [],
            rewards = [];
          for (const n of node.children) {
            const m = n.tag.match(/^Event_Param(\d+)$/i),
              r = n.tag.match(/^Reward_Param(\d+)$/i);
            if (m) params[+m[1] - 1] = n.text.trim();
            if (r) rewards[+r[1] - 1] = n.text.trim();
          }
          const event = {
            name: node.attrs.Name,
            plot,
            type: eventAlias(key(node.val('Event_Type'))),
            params,
            rewards,
            reward: key(node.val('Reward_Type')),
            position: node.child('Reward_Position')
              ? node
                  .val('Reward_Position')
                  .split(/[\s,]+/)
                  .filter(Boolean)
                  .map(Number)
              : null,
            rewardList: node.all('Reward_Param_List').flatMap(n => n.text.split(/[\s,|]+/)).filter(Boolean),
            prereqs: node.all('Prereq').map(n => prereqNames(n.text)),
            branch: node.val('Branch'),
            perpetual: yes(node.val('Perpetual')),
            completed: false,
            disabled: false,
            elapsedFrom: null,
            dialog: node.val('Story_Dialog'),
            chapter: node.num('Story_Chapter', 0),
            tag: node.val('Story_Tag'),
            popup: node.child('Story_Dialog_Popup') ? yes(node.val('Story_Dialog_Popup')) : true,
            dialogSFX: node.child('Story_Dialog_SFX') ? yes(node.val('Story_Dialog_SFX')) : true,
            entries: []
          };
          event.active = !event.prereqs.length;
          event.dependents = [];
          this.dropEvent(plot.events.get(key(event.name)));
          plot.events.set(key(event.name), event);
          (plot.eventHash ||= new EngineHash()).add(key(event.name), crc32(key(event.name)));
          const list = this.eventTypes.get(event.type) || [];
          list.push(event);
          this.eventTypes.set(event.type, list);
          if (TIMED.has(event.type)) this.timedEvents.add(event);
        }
      }
    }
    this.orderPlot(plot);
    return plot;
  }

  hashPlot(id, plot) {
    (this.plotHash ||= new EngineHash()).add(id, crc32(String(plot.name || '').trim()));
    this.orderPlots();
  }
  unhashPlot(id) {
    this.plotHash?.delete(id);
    this.orderPlots();
  }
  orderPlots() {
    const hash = this.plotHash;
    if (!hash) return;
    const ids = [...hash.order().filter(id => this.plots.has(id)), ...[...this.plots.keys()].filter(id => !hash.ids.has(id))];
    const entries = ids.map(id => [id, this.plots.get(id)]);
    this.plots.clear();
    entries.forEach(([id, p], i) => {
      p.rank = i;
      this.plots.set(id, p);
    });
    this.sortTypeLists();
  }
  orderPlot(plot) {
    const hash = plot.eventHash;
    if (hash) {
      const ids = [...hash.order().filter(id => plot.events.has(id)), ...[...plot.events.keys()].filter(id => !hash.ids.has(id))];
      const entries = ids.map(id => [id, plot.events.get(id)]);
      plot.events.clear();
      entries.forEach(([id, e], i) => {
        e.rank = i;
        plot.events.set(id, e);
      });
    }
    for (const e of plot.events.values()) e.dependents = [];
    for (const e of plot.events.values())
      for (const name of new Set(e.prereqs.flat().map(key))) {
        const list = plot.events.get(name)?.dependents;
        if (list && !list.includes(e)) list.push(e);
      }
    this.sortTypeLists();
  }
  storyRank(e) {
    return (e.plot?.rank ?? 1e6) * 1e6 + (e.rank ?? 1e5);
  }
  sortTypeLists() {
    for (const list of this.eventTypes.values()) list.sort((a, b) => this.storyRank(a) - this.storyRank(b));
  }

  replaceEventParameter(from, to) {
    const want = key(from);
    for (const plot of this.plots.values())
      for (const e of plot.events.values()) {
        if (e.type === 'STORY_DEFEAT_HERO') continue;
        for (let i = 0; i < 3; i++) {
          if (e.params[i] === undefined) continue;
          const parts = split(e.params[i]);
          if (!parts.some(n => key(n) === want)) continue;
          e.params[i] = parts.map(n => (key(n) === want ? to : n)).join(',');
          if ((e.type === 'STORY_DESTROY' && i === 2) || (e.type === 'STORY_CONQUER' && i === 1)) e.remainingCounts = null;
        }
      }
  }
  resetEvent(event) {
    event.completed = false;
    event.active = !event.prereqs.length;
    event.elapsedFrom = null;
    resetCombatEvent(event);
    if (TIMED.has(event.type)) this.timedEvents.add(event);
  }

  combatSnapshot() {
    return [...this.plots.values()].map(p => ({
      name: p.name,
      owner: p.owner,
      ...(p.generated ? { generated: this.generatedSave?.(p) } : {}),
      events: [...p.events.values()].map(e => ({
        name: e.name,
        battleCount: e.battleCount || 0,
        remainingCounts: e.remainingCounts?.slice() || null,
        completed: e.completed,
        active: e.active,
        disabled: e.disabled,
        elapsedFrom: e.elapsedFrom,
        params: e.params.slice(),
        rewards: e.rewards.slice(),
        reward: e.reward
      }))
    }));
  }
  async restoreCombatEvents(savedPlots) {
    for (const saved of savedPlots) {
      const plot = saved.generated ? this.restoreGenerated?.(saved) : await this.readPlot(saved.name, '', saved.owner);
      if (!plot) continue;
      for (const state of saved.events) {
        const event = plot.events.get(key(state.name));
        if (event)
          Object.assign(event, {
            ...state,
            params: state.params.slice(),
            rewards: state.rewards.slice(),
            remainingCounts: state.remainingCounts?.slice() || null
          });
      }
    }
  }

  plotWrapper(name) {
    const owner = (this.currentStoryPlot?.() || this.current?.plot)?.owner,
      named = [...this.plots.values()].filter(p => key(p.name) === key(name));
    const plot = named.find(p => owner === undefined || key(p.owner) === key(owner)) || named[0];
    if (!plot) return undefined;
    return this.plotWrapperOf(plot);
  }
  plotWrapperOf(plot) {
    if (!plot) return undefined;
    return {
      __wrap: true,
      __name: plot.name,
      __plotRef: plot,
      Is_Valid: () => true,
      Get_Event: n => {
        const e = plot.events.get(key(n));
        if (!e) return undefined;
        return this.eventWrapperOf(plot, e);
      },
      __missing: this.absent('StoryPlot')
    };
  }
  eventWrapperOf(plot, e) {
    {
      return {
        __wrap: true,
        __name: e.name,
        __eventRef: e,
        Is_Valid: () => true,
        Set_Reward_Parameter: (i, v) => {
          e.rewards[+i] = v?.__planet
            ? v.__planet.type.name
            : v?.__type
              ? v.__type.name
              : v?.__object
                ? v.__object.type.name
                : String(v ?? '');
        },
        Set_Event_Parameter: (i, v) => {
          e.params[+i] = v?.__type ? v.__type.name : v?.__object ? v.__object.type.name : String(v ?? '');
          if ((e.type === 'STORY_DESTROY' && +i === 2) || (['STORY_DEFEAT_HERO', 'STORY_CONQUER'].includes(e.type) && +i === 1))
            e.remainingCounts = null;
        },
        Set_Reward_Type: v => {
          e.reward = key(v);
        },
        Set_Dialog: v => {
          e.dialog = String(v);
        },
        Set_Story_Dialog: v => {
          e.dialog = String(v);
        },
        Add_Dialog_Text: (text, ...params) => e.entries.push({ text: String(text ?? ''), params }),
        Clear_Dialog_Text: () => {
          e.entries.length = 0;
        },
        __missing: this.absent('StoryEvent')
      };
    }
  }

  prerequisites(e) {
    return !e.prereqs.length || e.prereqs.some(names => names.every(n => e.plot.events.get(key(n))?.completed));
  }
  fire(e, force = false, subject = null) {
    if (e.disabled || (!force && (e.completed || !(e.active ?? this.prerequisites(e))))) return false;
    if (!force && e.plot?.active === false) return false;
    if (e.plot?.instance) this.invokeStoryCallback(e.plot.instance, e.name);
    e.completed = true;
    if (e.type === 'STORY_ELAPSED') e.elapsedFrom = this.time;
    if (!e.perpetual) this.timedEvents.delete(e);
    const firing = this.firingPlot,
      was = this.firingSubject;
    this.firingPlot = e.plot;
    this.firingSubject = subject;
    try {
      this.reward(e);
    } finally {
      this.firingPlot = firing;
      this.firingSubject = was;
    }
    if (e.dialog) {
      const request = {
        id: ++this.storyGoalId,
        name: e.dialog,
        chapter: e.chapter,
        tag: e.tag || `${e.dialog}_${e.chapter}`,
        entries: e.entries.slice(),
        popup: e.popup,
        eventName: e.name,
        completed: false,
        read: false,
        removeAfterRead: !e.tag,
        ...(this.game.storyAudience ? { audience: this.game.storyLocal?.(e.plot?.owner) } : {})
      };
      this.storyGoals.unshift(request);
      this.storyGoalAt = this.time;
      const shown = !this.game.storyAudience || this.game.storyAudience(e.plot?.owner);
      if (e.popup) this.game.holdForDialog?.(request, e.plot?.owner);
      if (shown && e.popup) this.game.showStoryDialog?.(request);
      else if (shown) this.game.notifyStoryGoal?.(request, e.dialogSFX !== false);
      this.game.storyDialog?.refreshSummary();
    }
    for (const dependent of e.dependents || [])
      if (!dependent.active && !dependent.completed && this.prerequisites(dependent)) {
        dependent.active = true;
        if (dependent.type === 'STORY_ELAPSED' && dependent.elapsedFrom === null) dependent.elapsedFrom = this.time;
        if (dependent.type === 'STORY_TRIGGER') this.fire(dependent);
      }
    if (e.perpetual) {
      e.completed = false;
      e.active = e.type !== 'STORY_TRIGGER' || !e.prereqs.length;
      resetCombatEvent(e);
    }
    return true;
  }
  levelEvents(type, owner, level) {
    for (const e of this.eventTypes.get(type) || []) {
      if (owner && e.plot?.owner && key(e.plot.owner) !== key(owner)) continue;
      if (level >= (parseInt(e.params[0], 10) || 0)) this.fire(e);
    }
  }
  signalTech(owner, level) {
    this.levelEvents('STORY_TECH_LEVEL', owner, level);
  }
  signalEra(level) {
    this.levelEvents('STORY_BEGIN_ERA', null, level);
  }
  signalReinforce(owner, name) {
    const target = key(name);
    for (const e of this.eventTypes.get('STORY_REINFORCE') || []) {
      if (key(this.reinforceOwner ? this.reinforceOwner(e) : this.plotOwner(e)) !== key(owner)) continue;
      if (wantedNames(e.params[0]).has(target)) this.fire(e);
    }
  }
  signalCredits(owner, credits) {
    const value = Math.trunc(credits);
    for (const e of this.eventTypes.get('STORY_ACCUMULATE') || []) {
      if (e.plot?.owner && key(e.plot.owner) !== key(owner)) continue;
      const want = parseInt(e.params[0], 10) || 0,
        mode = ['', 'GREATER_THAN', 'LESS_THAN', 'EQUAL_TO', 'NOT_EQUAL_TO', 'GREATER_THAN_EQUAL_TO', 'LESS_THAN_EQUAL_TO'].indexOf(
          key(e.params[1])
        );
      const hit =
        mode <= 1
          ? value > want
          : mode === 2
            ? value < want
            : mode === 3
              ? value === want
              : mode === 5
                ? value >= want
                : mode === 6
                  ? value <= want
                  : false;
      if (hit) this.fire(e);
    }
  }
  signal(type, value) {
    const target = key(value);
    for (const e of this.eventTypes.get(type) || []) {
      const wanted = type === 'STORY_AI_NOTIFICATION' ? e.params[1] || e.params[0] : e.params[0];
      if (type === 'STORY_VICTORY' && !wanted) continue;
      if (!wanted || wantedNames(wanted).has(target)) this.fire(e);
    }
  }
  plotOwner(e) {
    return e.plot?.owner || this.game?.me;
  }
  storyFilter(name, owner, plotOwner) {
    const code = Math.max(0, FILTERS.indexOf(key(name))),
      same = key(owner) === key(plotOwner),
      neutral = !!db.faction(owner)?.bool('Is_Neutral');
    if (code === 1) return same;
    if (code === 2) return neutral;
    if (code === 3) return !same && !neutral;
    if (code === 4) return neutral || same;
    if (code === 5) return neutral || !same;
    if (code === 6) return !neutral;
    return true;
  }
  arrivalMatches(e, planet, object = null) {
    const p = e.params,
      planets = split(p[0]).map(key);
    if (!planets.length) return true;
    if (!planets.includes(key(planet.type.name))) return false;
    if (object && !this.storyFilter(p[1], object.owner, this.plotOwner(e))) return false;
    if (object) {
      const need = split(p[2]).map(key);
      if (flag(p[6])) {
        if (!object.raid) return false;
      } else if (need.length) {
        if (!need.every(n => object.types.has(n))) return false;
        if (flag(p[5]) && object.count !== need.length) return false;
      }
    }
    const present = split(p[3]).map(key);
    return !present.length || present.some(n => this.presentTypes?.(planet).has(n));
  }
  signalArrival(type, planet, object = null, owner = null) {
    for (const e of this.eventTypes.get(type) || []) {
      if (owner && key(e.plot?.owner) !== key(owner)) continue;
      if (this.arrivalMatches(e, planet, object)) this.fire(e);
    }
  }
  heroMatches(e, hero, planet) {
    return wantedNames(e.params[0]).has(key(hero)) && wantedNames(e.params[1]).has(key(planet.type.name));
  }
  signalHero(type, hero, planet) {
    for (const e of this.eventTypes.get(type) || []) if (this.heroMatches(e, hero, planet)) this.fire(e);
  }
  waiting(e) {
    return !e.disabled && !e.completed && !!(e.active ?? this.prerequisites(e)) && e.plot?.active !== false;
  }
  signalCorruption(type, planet, value) {
    for (const e of this.eventTypes.get(type) || []) {
      const names = split(e.params[0]).map(key),
        name = key(e.params[1]).replace(/^CORRUPTION_/, '');
      const wanted =
        name === 'NONE'
          ? -1
          : name === 'ANY'
            ? 8
            : Math.max(
                0,
                [
                  'INTIMIDATION',
                  'PIRACY',
                  'KIDNAPPING',
                  'RACKETEERING',
                  'CORRUPT_MILITIA',
                  'BRIBERY',
                  'BLACK_MARKET',
                  'BONDED_CITIZENS'
                ].indexOf(name)
              );
      if (!names.includes(key(planet.type.name)) && !names.includes(key(planet.name))) continue;
      if (value === wanted || (wanted === 8 && value !== -1)) this.fire(e);
    }
  }
  signalCapture(typeName, faction) {
    const target = key(typeName),
      side = key(faction);
    for (const e of this.eventTypes.get('STORY_CAPTURE_STRUCTURE') || [])
      if (wantedNames(e.params[0] || '').has(target) && key(e.params[1]) === side) this.fire(e);
  }
  clickGUI(name) {
    this.signal('STORY_CLICK_GUI', name);
  }

  generic(name) {
    this.signal('STORY_GENERIC', name);
  }
  dropEvent(e) {
    if (!e) return;
    const list = this.eventTypes.get(e.type);
    if (list) {
      const i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
    }
    this.timedEvents.delete(e);
  }
  addEvent(plot, { name, type, params = [], rewards = [], reward = '', prereqs = [] }) {
    const event = {
      name,
      plot,
      type: key(type),
      params,
      rewards,
      reward: key(reward),
      prereqs,
      branch: '',
      perpetual: false,
      completed: false,
      disabled: false,
      elapsedFrom: null,
      dialog: '',
      chapter: 0,
      tag: '',
      popup: true,
      dialogSFX: true,
      entries: [],
      active: !prereqs.length,
      dependents: []
    };
    this.dropEvent(plot.events.get(key(name)));
    plot.events.set(key(name), event);
    (plot.eventHash ||= new EngineHash()).add(key(name), crc32(key(name)));
    const list = this.eventTypes.get(event.type) || [];
    list.push(event);
    this.eventTypes.set(event.type, list);
    this.orderPlot(plot);
    return event;
  }
  get objectives() {
    return (this._objectives ||= new ObjectiveList((list, sound) => {
      if (this.game && typeof document !== 'undefined') objectivePanel(this.game).update(list, sound);
    }));
  }
  commonReward(e) {
    const p = e.rewards;
    if (objectiveReward(this.objectives, e.reward, p)) return true;
    switch (e.reward) {
      case 'DISABLE_STORY_EVENT': {
        if (!p[0] || !p[1]) break;
        for (const plot of parseInt(p[2], 10) ? this.plots.values() : [e.plot]) {
          const event = plot.events.get(key(p[0]));
          if (event) event.disabled = !!parseInt(p[1], 10);
        }
        break;
      }
      case 'DISABLE_BRANCH':
      case 'ENABLE_BRANCH':
        if (!p[0] || (e.reward === 'DISABLE_BRANCH' && !p[1])) break;
        for (const event of e.plot.events.values())
          if (event.branch === p[0]) event.disabled = e.reward === 'DISABLE_BRANCH' && !!parseInt(p[1], 10);
        break;
      case 'RESET_BRANCH': {
        if (!p[0]) break;
        if (this.resetDepth >= 3) {
          this.errors.set(e.name, 'Story event reset recursion limit exceeded');
          break;
        }
        this.resetDepth++;
        try {
          for (const event of e.plot.events.values()) if (event.branch === p[0]) this.resetEvent(event);
          const trigger = p[1] && e.plot.events.get(key(p[1]));
          if (trigger) this.fire(trigger, true);
        } finally {
          this.resetDepth--;
        }
        break;
      }
      case 'RESET_EVENT':
        for (const name of [...(p[0] ? [p[0]] : []), ...(e.rewardList || [])]) {
          const event = e.plot.events.get(key(name));
          if (event) this.resetEvent(event);
        }
        break;
      case 'DISABLE_AUTORESOLVE':
        this.errors.set(e.name, 'DISABLE AUTORESOLVE in no longer working.  This should not be used.');
        break;
      case 'INFORMATION':
        break;
      case 'ENABLE_OVERWHELMING_ODDS':
      case 'ENABLE_COMBAT_CINEMATIC':
        this.errors.set(e.name, 'Reward for event ' + e.name + ' needs some code support!');
        break;
      case 'SET_FLAG':
        this.flags.set(p[0], p[1]);
        break;
      case 'INCREMENT_FLAG':
        if (!this.flags.increment(p[0], p[1])) this.errors.set(e.name, 'Cannot increment undefined XML story flag: ' + p[0]);
        break;
      default:
        return false;
    }
    return true;
  }

  startTactical(planet, space) {
    const requests = [];
    for (const e of this.eventTypes.get(space ? 'STORY_SPACE_TACTICAL' : 'STORY_LAND_TACTICAL') || []) {
      if (e.disabled || e.completed || !e.active || e.plot.active === false) continue;
      const names = split(e.params[1]).map(key);
      if (names.length && !names.includes(key(planet.name))) continue;
      this.fire(e);
      if (e.params[0]) requests.push({ name: e.params[0], owner: e.plot.owner });
    }
    return requests;
  }

  pollEvents(flagsOnly = false, phase = 'all') {
    const ordered = [...this.timedEvents].sort((a, b) => this.storyRank(a) - this.storyRank(b)),
      kinds = phase === 'elapsed' ? ['STORY_ELAPSED'] : phase === 'late' ? ['STORY_FLAG', 'STORY_OBJECTIVE_TIMEOUT'] : ['STORY_ELAPSED', 'STORY_FLAG', 'STORY_OBJECTIVE_TIMEOUT'];
    for (const kind of kinds) for (const e of ordered) if (e.type === kind) this.pollEvent(e, flagsOnly);
  }
  pollEvent(e, flagsOnly) {
    {
      if (e.disabled || e.completed || !e.active || e.plot?.active === false || e.plot?.instance?.state === 'new') return;
      if (e.type === 'STORY_ELAPSED') {
        if (flagsOnly) return;
        if (e.elapsedFrom === null) e.elapsedFrom = this.time;
        if (this.time - e.elapsedFrom >= (+e.params[0] || 0)) this.fire(e);
      } else if (e.type === 'STORY_OBJECTIVE_TIMEOUT') {
        if (flagsOnly) return;
        if (e.elapsedFrom === null || e.elapsedFrom === undefined) e.elapsedFrom = this.time;
        if (this.time - e.elapsedFrom < (parseFloat(e.params[0]) || 0)) return;
        const objective = this.objectives.items.find(o => o.id === String(e.params[1] ?? '').trim());
        if (objective && objective.state === 0) this.fire(e);
        else e.disabled = true;
      } else if (e.type === 'STORY_FLAG') {
        const target = (parseInt(e.params[1], 10) || 0) | 0,
          mode = String(e.params[2] || '').trim();
        for (const name of split(e.params[0])) {
          const value = this.flags.get(name);
          if (value === undefined || value === -99999999) continue;
          const match =
            !mode || mode === 'EQUAL_TO'
              ? value === target
              : mode === 'LESS_THAN'
                ? value < target
                : mode === 'GREATER_THAN_EQUAL_TO'
                  ? value >= target
                  : mode === 'LESS_THAN_EQUAL_TO'
                    ? value <= target
                    : mode === 'NOT_EQUAL_TO'
                      ? false
                      : value > target;
          if (match) this.fire(e, true);
        }
      }
    }
  }
}

import { db } from '../gamedata.js';
import { simRandom } from './simrandom.js';
import { relation } from './galacticrelation.js';
import { groundLevel } from './galacticproduction.js';
import { planetMaxStarbase } from './planetstats.js';
import { registerStoryScript, dropStoryScript } from './galacticstorydialog.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const pad2 = n => String(n).padStart(2, '0');

const state = { count: 0, used: null, faction: null };

export function resetRandomStory() {
  state.count = 0;
  state.used = null;
  state.faction = null;
}

export function rand(lo, hi) {
  if (lo > hi) [lo, hi] = [hi, lo];
  return Math.min(hi, Math.floor(lo + simRandom() * (hi - lo + 1)));
}
const pick = list => list[rand(0, list.length - 1)];

function setup(local) {
  const C = db.constants,
    empire = key(local) !== 'REBEL',
    side = empire ? 'Empire' : 'Rebel',
    words = tag => (C ? C.list(tag) : []);
  return {
    triggers: words('Random_Story_Triggers'),
    max: C ? C.num('Random_Story_Max_Triggers', 3) : 3,
    rewards: words('Random_Story_Rewards'),
    construction: words('Random_Story_' + side + '_Construction'),
    destroy: words('Random_Story_' + side + '_Destroy'),
    buildable: words('Random_Story_Reward_' + side + '_Buildable'),
    unit: words('Random_Story_Reward_' + side + '_Unit'),
    dialog: empire ? 'EC0%2.2d_TAR%2.2d0' : 'RC0%2.2d_MON%2.2d0',
    image: empire ? 'Tarkin.tga' : 'Mon_Mothma.tga',
    text: empire ? 'TEXT_STORY_TRANSMISSION_18' : 'TEXT_STORY_TRANSMISSION_17'
  };
}

function objectLists(g, local) {
  const mine = o => key(o) === key(local),
    known = p => g.autoReveal !== false || !!p.revealed;
  const lists = { myPlanets: [], otherPlanets: [], myHeroes: [], otherHeroes: [] };
  for (const p of g.planets) {
    if (p.background) continue;
    if (mine(p.owner)) lists.myPlanets.push(p);
    else if (known(p)) lists.otherPlanets.push(p);
  }
  const hero = (r, owner) => {
    if (r.dead) return;
    const t = r.carries || r.type;
    if (!t?.bool('Is_Named_Hero')) return;
    (mine(owner ?? r.owner) ? lists.myHeroes : lists.otherHeroes).push(t);
  };
  for (const p of g.planets) for (const r of p.garrison || []) hero(r);
  for (const f of g.fleets) for (const r of f.units) hero(r, f.owner);
  return lists;
}

const speaker = (s, t, chapter) =>
  s.dialog.replace('%2.2d', pad2(chapter === 0 ? t + 1 : t + 1 + s.triggers.length)).replace('%2.2d', pad2(t + 1));

function trigger(ctx, name, chapter) {
  const { s, l, g, local } = ctx;
  const enemy = g.players.find(p => relation(local, p.faction) === 1)?.faction;
  const t = rand(0, s.triggers.length - 1),
    type = key(s.triggers[t]);
  const params = [];
  const failed = () => trigger(ctx, name, chapter);
  switch (type) {
    case 'STORY_ENTER':
    case 'STORY_LAND_ON':
    case 'STORY_CONQUER':
      params[0] = pick(l.otherPlanets)?.type.name ?? '';
      break;
    case 'STORY_CONSTRUCT':
      params[0] = pick(s.construction) ?? '';
      break;
    case 'STORY_CONSTRUCT_LEVEL': {
      let done = false;
      for (let tries = 0; tries < 100 && !done; tries++) {
        const p = pick(l.myPlanets),
          ground = rand(0, 1) === 0;
        if (!p) continue;
        const cur = ground ? groundLevel(p, p.owner) : p.spaceLevel || 0,
          max = ground ? Math.min(p.type.num('Special_Structures_Land', 3), 5) : planetMaxStarbase(p);
        if (cur < max) {
          params[0] = p.type.name;
          params[1] = String(rand(cur + 1, max));
          params[2] = ground ? 'GROUND' : 'SPACE';
          done = true;
        }
      }
      if (!done) return failed();
      break;
    }
    case 'STORY_DESTROY':
      params[0] = pick(s.destroy) ?? '';
      params[1] = String(rand(1, 3));
      break;
    case 'STORY_DESTROY_BASE':
      params[0] = '';
      params[1] = rand(0, 1) === 0 ? 'GROUND' : 'SPACE';
      break;
    case 'STORY_DEPLOY':
    case 'STORY_MOVE': {
      params[0] = pick(l.myHeroes)?.name ?? '';
      let k = 0,
        pl = null;
      do {
        k++;
        pl = pick(l.otherPlanets);
      } while (k < 100 && !(type === 'STORY_MOVE' || (pl && key(pl.owner) === key(enemy))));
      if (k === 100 || !pl) return failed();
      params[1] = pl.type.name;
      break;
    }
    case 'STORY_ACCUMULATE': {
      const r = rand(10, 30),
        credits = g.players.find(p => key(p.faction) === key(local))?.credits || 0;
      params[0] = String(r * 1000 + Math.trunc(credits));
      break;
    }
    case 'STORY_DEFEAT_HERO':
      params[0] = pick(l.otherHeroes)?.name ?? '';
      break;
    case 'STORY_WIN_BATTLES':
      params[0] = String(rand(1, 3));
      params[1] = rand(0, 1) === 0 ? 'GROUND' : 'SPACE';
      break;
    default:
      ctx.host.errors?.set(name, 'Warning! Random story trigger ' + type + ' currently unsupported!');
  }
  const voice = speaker(s, t, chapter) + rand(1, 3);
  ctx.script.push('[CHAPTER ' + chapter + ']', 'TITLE ' + s.text, 'IMAGE ' + s.image, 'DIALOG ' + voice, 'TEXT ' + s.text);
  return { type, params };
}

function reward(ctx, n, noBuildable = false) {
  const { s, l } = ctx;
  let id;
  do id = key(s.rewards[rand(0, s.rewards.length - 1)]);
  while (noBuildable && id === 'BUILDABLE_UNIT');
  const rewards = [];
  if (id === 'BUILDABLE_UNIT') {
    if (!state.used || state.used.length !== s.buildable.length) state.used = s.buildable.map(() => false);
    if (state.used.every(Boolean)) return reward(ctx, n, true);
    let k;
    do k = rand(0, s.buildable.length - 1);
    while (state.used[k]);
    state.used[k] = true;
    rewards[0] = s.buildable[k];
  } else if (id === 'UNIQUE_UNIT') {
    rewards[0] = pick(s.unit) ?? '';
    rewards[1] = pick(l.myPlanets)?.type.name ?? '';
  } else if (id === 'CREDITS') rewards[0] = String(n * 10000);
  else ctx.host.errors?.set('RANDOM_TRIGGER_' + n, 'Unknown random story reward ' + id);
  ctx.script.push('[CHAPTER ' + n + ']', 'TITLE ' + s.text, 'IMAGE ' + s.image, 'TEXT ' + s.text);
  return { reward: id, rewards };
}

export function startRandomStory(host) {
  const game = host?.game,
    g = game?.galaxy;
  if (!g || !host.addEvent) return null;
  const local = game.localFaction ?? game.me;
  if (key(state.faction) !== key(local)) {
    state.faction = local;
    state.used = null;
  }
  const s = setup(local),
    l = objectLists(g, local);
  const name = 'Random_Plot_' + state.count++;
  const plot = { name, scriptName: '', owner: local, events: new Map(), instance: null, generated: true };
  host.plots.set(key(name), plot);
  const ctx = { host, s, l, g, local, script: [] };
  const n = rand(1, s.max);
  const dialog = (e, chapter) => {
    e.dialog = name;
    e.chapter = chapter;
    e.tag = name + e.name;
    e.popup = false;
  };
  let first = null;
  for (let i = 0; i < n; i++) {
    const made = trigger(ctx, 'RANDOM_TRIGGER_' + i, i);
    const ev = host.addEvent(plot, {
      name: 'RANDOM_TRIGGER_' + i,
      type: made.type,
      params: made.params,
      prereqs: i ? [['RANDOM_TRIGGER_' + (i - 1)]] : []
    });
    dialog(ev, i);
    first ||= ev;
    host.addEvent(plot, {
      name: 'RANDOM_TRIGGER_' + i + 'a',
      type: 'STORY_TRIGGER',
      reward: 'REMOVE_STORY_GOAL',
      rewards: [ev.tag],
      prereqs: [['RANDOM_TRIGGER_' + i]]
    });
    ctx.script.push('');
  }
  const made = reward(ctx, n);
  const last = host.addEvent(plot, {
    name: 'RANDOM_TRIGGER_' + n,
    type: 'STORY_TRIGGER',
    reward: made.reward,
    rewards: made.rewards,
    prereqs: [['RANDOM_TRIGGER_' + (n - 1)]]
  });
  dialog(last, n);
  plot.script = ctx.script.join('\n') + '\n';
  registerStoryScript(name, plot.script);
  if (first) {
    const request = {
      id: ++host.storyGoalId,
      name,
      chapter: 0,
      tag: first.tag,
      entries: [],
      popup: true,
      eventName: first.name,
      completed: false,
      read: false,
      removeAfterRead: false
    };
    host.storyGoals?.unshift(request);
    game.storyDialog?.show?.({ ...request, choice: true, onAccept: () => rand(1, 3), onCancel: () => cancelRandomStory(host, name) });
    game.storyDialog?.refreshSummary?.();
  }
  return plot;
}

export const generatedPlotSave = plot =>
  plot.generated
    ? {
        script: plot.script || '',
        events: [...plot.events.values()].map(e => ({
          name: e.name,
          type: e.type,
          prereqs: e.prereqs,
          chapter: e.chapter,
          tag: e.tag,
          dialog: e.dialog,
          popup: e.popup
        }))
      }
    : null;

export function restoreGeneratedPlot(host, sp) {
  const plot = { name: sp.name, scriptName: '', owner: sp.owner, events: new Map(), instance: null, generated: true, script: sp.generated.script };
  host.plots.set(key(sp.name), plot);
  for (const d of sp.generated.events) {
    const e = host.addEvent(plot, { name: d.name, type: d.type, prereqs: d.prereqs || [] });
    Object.assign(e, { chapter: d.chapter, tag: d.tag, dialog: d.dialog, popup: d.popup });
  }
  registerStoryScript(sp.name, plot.script);
  return plot;
}

export function cancelRandomStory(host, name) {
  const plot = host.plots.get(key(name));
  if (plot) {
    host.plots.delete(key(name));
    for (const e of plot.events.values()) host.dropEvent?.(e);
  }
  dropStoryScript(name);
  rand(1, 2);
}

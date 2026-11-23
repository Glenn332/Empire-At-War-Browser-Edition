import { parseXML } from '../xml.js';
import { fetchText } from '../vfs.js';
import { finishLinkedTactical, linkedMapLoaded } from './linktactical.js';
import { missionResult } from './galacticcorruption.js';

// Multiplayer has no networked linked mission. Every peer resolves it inside the lockstep step
// instead, as won by the faction whose plot asked for it, and applies the flags its tactical plot
// sets on STORY_VICTORY so the campaign plots waiting on them carry on.
const key = s => String(s || '').toUpperCase();
const xmlPath = s => (/^DATA\//i.test(key(s)) ? String(s).replace(/\\/g, '/') : 'Data/XML/' + String(s).replace(/\\/g, '/'));

async function victoryFlags(name, seen = new Set()) {
  if (!name || seen.has(key(name))) return [];
  seen.add(key(name));
  const src = await fetchText(xmlPath(name)).catch(() => null);
  if (!src) return [];
  const out = [];
  for (const root of parseXML(src).children)
    for (const node of root.children) {
      if (/^Active_Plot$/i.test(node.tag)) out.push(...(await victoryFlags(node.text.trim(), seen)));
      else if (/^Event$/i.test(node.tag) && key(node.val('Event_Type')) === 'STORY_VICTORY') {
        const reward = key(node.val('Reward_Type'));
        if (reward !== 'SET_FLAG' && reward !== 'INCREMENT_FLAG') continue;
        out.push({ faction: node.val('Event_Param1'), reward, flag: node.val('Reward_Param1'), value: node.val('Reward_Param2') });
      }
    }
  return out;
}

export async function preloadLinkedPlots(game) {
  const plots = (game.linkedPlotFlags = new Map());
  for (const plot of game.story?.plots?.values() || [])
    for (const e of plot.events.values()) {
      const name = e.reward === 'LINK_TACTICAL' && e.rewards[6];
      if (name && !plots.has(key(name))) plots.set(key(name), await victoryFlags(name));
    }
}

export function resolveNetLinked(game) {
  const request = game.pendingLinkedTactical;
  game.pendingLinkedTactical = null;
  if (!request) return;
  if (request.corruption) return missionResult(game, request, true);
  const p = game.galaxy.planets[request.planet];
  if (!p) return;
  const winner = key(request.player) === key(request.defender) ? 'defender' : 'attacker',
    faction = winner === 'attacker' ? request.attacker : request.defender;
  request.player = faction;
  linkedMapLoaded(game.story, request);
  game.story?.startTactical(p, request.mode === 'space');
  const story = game.story,
    flags = game.linkedPlotFlags?.get(key(request.plot));
  if (story && request.plot && !flags) story.errors.set('LINK_TACTICAL', 'Tactical plot not preloaded for multiplayer: ' + request.plot);
  for (const f of story ? flags || [] : [])
    if (!f.faction || key(f.faction) === key(faction)) {
      if (f.reward === 'SET_FLAG' || story.flags.get(f.flag) === undefined) story.flags.set(f.flag, f.value);
      else story.flags.increment(f.flag, f.value);
    }
  finishLinkedTactical(game, { request, participants: new Map(), context: null }, { winner, autoResolved: true });
}

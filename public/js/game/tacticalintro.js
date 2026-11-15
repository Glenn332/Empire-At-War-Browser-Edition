import { db } from '../gamedata.js';
import { fetchBinary } from '../vfs.js';
import { movieDefinitions } from './galacticmovies.js';

const key = s => String(s || '').toUpperCase();
const START_DELAY = 10;

function presentTypes(game) {
  const out = new Set(),
    w = game.world;
  for (const u of w?.units || []) {
    if (u.dead) continue;
    if (u.type) out.add(key(u.type.name));
    if (u.squad?.type) out.add(key(u.squad.type.name));
  }
  for (const list of w?.flagshipRiders?.values() || []) for (const t of list) out.add(key(t.name));
  return out;
}

function conditional(faction, base, present) {
  for (const kind of ['And', 'Or'])
    for (const row of faction.tuples(base + '_Conditional_' + kind)) {
      const speech = row[row.length - 1],
        need = row
          .slice(0, -1)
          .map(n => key(n.trim()))
          .filter(n => n && n !== 'NONE');
      if (!speech || !need.length) continue;
      if (kind === 'And' ? need.every(n => present.has(n)) : need.some(n => present.has(n))) return speech.trim();
    }
  return '';
}

function introSpeech(game, faction, land, attacker) {
  const side = attacker ? 'Attacker' : 'Defender',
    base = `SpeechEvent_Tactical_Intro_${land ? 'Land' : 'Space'}_${side}`;
  const picked = conditional(faction, base, presentTypes(game));
  if (picked) return picked;
  const g = game.tacticalCampaign?.galaxy,
    mine = key(faction.name);
  if (g && !game.setup.net && g.planets.filter(p => key(p.owner) === mine).length < 2) {
    const last = faction.str(`SpeechEvent_Tactical_Intro_Land_${side}_Last_Location`).trim();
    if (last) return last;
  }
  if (land && game.setup.campaign?.attacker?.raid) {
    const raid = faction.str(`SpeechEvent_Tactical_Intro_Land_Raid_${side}`).trim();
    if (raid) return raid;
  }
  return faction.str(base).trim();
}

export function tacticalIntro(game) {
  const cb = game.setup?.campaign;
  if (game.introPlayed || !cb?.galaxy || game.setup.linkedTactical || game.observer || game.setup.restore) return;
  const w = game.world;
  if (!game.introMovieWarm) {
    game.introMovieWarm = true;
    const name = game.landBattle ? game.factions?.[game.me] : game.human?.factionName,
      movie = name && db.faction(name)?.str('Tactical_Intro_Command_Bar_Movie_Name').trim();
    if (movie)
      movieDefinitions()
        .then(defs => {
          const file = defs.get(key(movie))?.val('Movie_File');
          return file && fetchBinary(file);
        })
        .catch(() => {});
  }
  if (!w || (w.time || 0) < START_DELAY) return;
  const speech = game.audio?.speech;
  if (!speech || speech.queue.length) return;
  game.introPlayed = true;
  const land = !!game.landBattle,
    myTeam = land ? game.myTeam : game.human?.team?.id,
    name = land ? game.factions?.[game.me] : game.human?.factionName,
    faction = name && db.faction(name);
  if (!faction || myTeam === undefined) return;
  const event = introSpeech(game, faction, land, myTeam === (cb.attacker?.team ?? 0));
  if (!event) return;
  const record = speech.enqueue(event);
  if (!record) return;
  const movie = faction.str('Tactical_Intro_Command_Bar_Movie_Name').trim();
  if (!movie || !game.movies) return;
  game.movies.play(movie, true);
  const end = r => {
    if (r !== record) return;
    offDone();
    offStory();
    game.movies?.stop();
  };
  const offDone = speech.on('done', end),
    offStory = speech.on('storydone', end);
}

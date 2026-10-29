import { db } from '../gamedata.js';
import { changeController } from './galacticpolitics.js';
import { VIS } from './galacticfog.js';
import { advisorHints } from './advisorhints.js';
import { tutorialReward } from './tutorialrewards.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();
const atoi = s => parseInt(String(s ?? '').trim(), 10) || 0;
const present = s => s !== undefined && String(s).length > 0;

export function galacticStoryReward(host, e) {
  const game = host.game,
    g = game.galaxy,
    p = e.rewards,
    owner = e.plot?.owner || game.me;
  const player = name => g.players.find(q => key(q.faction) === key(name));
  const planetsOfType = name => g.planets.filter(q => key(q.type.name) === key(name) || key(q.name) === key(name));
  const objectsOfType = name => host.objects().filter(o => !o.dead && key(o.type.name) === key(name));
  switch (e.reward) {
    case 'CREDITS': {
      const q = player(owner);
      if (q) q.credits = Math.max(0, q.credits + (parseFloat(p[0]) || 0));
      return true;
    }
    case 'REVEAL_PLANET': {
      if (!present(p[0]) || !present(p[1])) {
        host.errors.set(e.name, 'REVEAL_PLANET -- incomplete parameters');
        return true;
      }
      const on = atoi(p[1]) !== 0,
        state = g.visibility;
      for (const q of planetsOfType(p[0])) {
        q.storyRevealed = on;
        const v = state?.planets?.[q.index];
        if (v) v.discovered = on;
      }
      return true;
    }
    case 'TRIGGER_EVENT': {
      for (const plot of host.plots.values()) {
        const ev = plot.events.get(key(p[0]));
        if (ev) {
          host.fire(ev, true);
          break;
        }
      }
      return true;
    }
    case 'STORY_ELEMENT': {
      if (!present(p[0])) return true;
      host
        .readPlot(p[0] + '.xml', '', owner)
        .then(plot => host.startPlot?.(plot))
        .catch(error => host.errors.set(e.name, error.message));
      return true;
    }
    case 'REMOVE_UNIT': {
      const list = objectsOfType(p[0]);
      for (const o of present(p[1]) ? list : list.slice(0, 1)) host.despawn(o);
      game.select?.(-1);
      return true;
    }
    case 'DESTROY_OBJECT': {
      const o = objectsOfType(p[0])[0];
      if (o) host.destroyObject ? host.destroyObject(o) : host.despawn(o);
      return true;
    }
    case 'CHANGE_OWNER': {
      const faction = db.faction(p[1])?.name;
      if (!faction) return true;
      const planets = planetsOfType(p[0]);
      if (planets.length) {
        for (const q of planets) {
          const old = changeController(q, faction, g);
          if (old !== q.owner) {
            game.ai?.invalidate?.();
            host.planetCaptured?.(q, old);
          }
        }
        return true;
      }
      const list = objectsOfType(p[0]),
        n = present(p[2]) ? (atoi(p[2]) === 0 ? list.length : Math.min(atoi(p[2]), list.length)) : Math.min(1, list.length);
      for (const o of list.slice(0, n)) {
        const record = o.record || o,
          at = o.planet;
        if (at && at.garrison?.includes(record)) record.owner = faction;
        else if (at) {
          host.despawn(o);
          host.spawn(host.type(record.type), host.planet(at), host.player(faction));
        }
      }
      return true;
    }
    case 'SELECT_PLANET': {
      const q = planetsOfType(p[0])[0];
      if (q) game.select?.(q.index);
      return true;
    }
    case 'ZOOM_IN':
      if (game.selected >= 0) game.zoomIn?.(game.selected);
      return true;
    case 'ZOOM_OUT':
      game.zoomOut?.();
      return true;
    case 'SCROLL_LOCK':
      game.scrollLocked = atoi(p[0]) !== 0;
      return true;
    case 'LOCK_PLANET_SELECTION':
      game.planetSelectionLocked = atoi(p[0]) !== 0;
      return true;
    case 'ENABLE_FLEET_COMBINE':
      game.fleetCombine = !present(p[0]) || atoi(p[0]) !== 0;
      return true;
    case 'RESTRICT_AUTORESOLVE': {
      const q = planetsOfType(p[0])[0];
      if (!q) return true;
      game.pendingBattle?.disable(q.index, !present(p[1]) || atoi(p[1]) !== 0);
      return true;
    }
    case 'ENABLE_DIRECT_INVASION':
      game.directInvasion = true;
      return true;
    case 'DISABLE_DIRECT_INVASION':
      game.directInvasion = false;
      return true;
    case 'SET_ADVISOR': {
      const q = player(owner);
      if (q) advisorHints(q).Galactic = atoi(p[0]) !== 0;
      return true;
    }
    case 'DISABLE_MOVIES':
      game.moviesDisabled = atoi(p[0]) !== 0;
      return true;
    case 'START_MOVIE':
      if (!game.moviesDisabled) (host.moviesPlaying ||= []).push({ name: String(p[0] || ''), at: (host.serviceTime || 0) + 1 / 30 });
      return true;
    case 'START_CINEMATIC_MODE':
      game.controlsLocked = true;
      game.cinematicMode = true;
      document.body.classList.add('letterboxed');
      return true;
    case 'STOP_CINEMATIC_MODE':
      game.controlsLocked = false;
      game.cinematicMode = false;
      document.body.classList.remove('letterboxed');
      return true;
    case 'SET_PLANET_VISIBILITY_LEVEL': {
      const q = planetsOfType(p[0])[0],
        faction = db.faction(p[1])?.name;
      if (!q || !faction || !present(p[3])) return true;
      const list = (q.visibilityModifiers ||= []),
        source = key(p[3]),
        at = list.findIndex(m => m.source === source && key(m.owner) === key(faction));
      if (at >= 0) list.splice(at, 1);
      if (key(p[2]) !== 'NONE') {
        if (key(p[2]) !== 'MAXIMUM') {
          host.unsupported('SET_PLANET_VISIBILITY_LEVEL:' + p[2]);
          return true;
        }
        const seconds = present(p[4]) ? parseFloat(p[4]) : -1;
        list.push({ owner: faction, source, mask: VIS.ALL, min: VIS.ALL, expires: seconds >= 0 ? g.time + seconds : null });
      }
      return true;
    }
    case 'NEW_POWER_FOR_ALL':
    case 'REMOVE_POWER_FROM_ALL': {
      const q = player(owner);
      if (!q || !present(p[0]) || !present(p[1])) return true;
      const powers = (q.storyPowers ||= []),
        entry = { type: key(p[0]), ability: key(p[1]) };
      const at = powers.findIndex(x => x.type === entry.type && x.ability === entry.ability);
      if (e.reward === 'NEW_POWER_FOR_ALL') {
        if (at < 0) powers.push(entry);
      } else if (at >= 0) powers.splice(at, 1);
      return true;
    }
    case 'MOVE_FLEET': {
      const from = planetsOfType(p[0])[0],
        to = planetsOfType(p[1])[0],
        mode = key(p[2]);
      if (!from || !to || !mode) return true;
      const friendly = mode !== 'FILTER_ENEMY_ONLY';
      const fleets = g.fleets.filter(
        f => f.planet === from.index && !f.leg && f.units.length && (key(f.owner) === key(owner)) === friendly
      );
      if (!fleets.length) return true;
      for (const f of fleets.slice(1))
        if (key(f.owner) === key(fleets[0].owner)) {
          fleets[0].units.push(...f.units);
          f.units = [];
        }
      g.fleets = g.fleets.filter(f => f.units.length);
      game.moveFleet?.(fleets[0], to.index);
      return true;
    }
    case 'INVADE_PLANET': {
      const q = planetsOfType(p[0])[0];
      if (!q || key(q.owner) === key(owner)) return true;
      const fleet = g.fleets.find(
        f =>
          f.planet === q.index &&
          !f.leg &&
          key(f.owner) === key(owner) &&
          f.units.some(u => u.carries && (!present(p[1]) || key((u.carries || u.type).name) === key(p[1])))
      );
      if (fleet) game.invadeFrom?.(fleet, q.index) ?? game.land?.(fleet, q.index);
      return true;
    }
    case 'POSITION_CAMERA':
    case 'SCROLL_CAMERA': {
      const q = planetsOfType(p[0])[0] || objectsOfType(p[0])[0]?.planet;
      if (!q || !game.view) return true;
      const o =
        e.reward === 'POSITION_CAMERA'
          ? String(p[1] || '')
              .split(',')
              .map(n => parseFloat(n) || 0)
          : [0, 0];
      game.view.x = q.pos[0] + (o[0] || 0);
      game.view.y = q.pos[1] + (o[1] || 0);
      game.clampPan?.();
      return true;
    }
    case 'RESET_GALACTIC_FILTERS':
      game.filters = 0;
      g.displayFilters = 0;
      game.ui?.refresh?.();
      return true;
    case 'HIDE_CURSOR_ON_CLICK':
      game.hideCursorOnClick = atoi(p[0]) !== 0;
      return true;
    default:
      return tutorialReward(host, e);
  }
}

export function storyMoviesDone(host) {
  const list = host?.moviesPlaying;
  while (list?.length && list[0].at <= (host.serviceTime || 0) + 1e-9) host.signal('STORY_MOVIE_DONE', list.shift().name);
}

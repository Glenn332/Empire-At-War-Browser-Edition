import { db } from '../gamedata.js';
import { simRandom } from './simrandom.js';
import { fontFamily } from '../fonts.js';
import { fontPixels } from '../fontpolicy.js';

const key = s => String(s || '').toUpperCase();
const preventers = new WeakMap();
export function hasRetreatPrevention(type) {
  if (!type) return false;
  let has = preventers.get(type);
  if (has === undefined) {
    const tag = t =>
      t
        .sub('Abilities')
        .some(n =>
          n.children.some(a => /^RETREAT_PREVENTION_ABILITY$/i.test(a.tag) && !/^(no|false|0)$/i.test(a.val('Initially_Enabled', 'Yes')))
        );
    has =
      tag(type) ||
      [...type.list('Company_Units'), ...type.list('Squadron_Units')].some(n => {
        const t = db.type(n);
        return t && t !== type && tag(t);
      });
    preventers.set(type, has);
  }
  return has;
}

const disabledFactions = new Set();
export const retreatDisabledList = () => [...disabledFactions];
export function setRetreatDisabledList(list) {
  disabledFactions.clear();
  for (const f of list || []) disabledFactions.add(key(f));
}
export function setRetreatDisabled(faction, on) {
  if (on) disabledFactions.add(key(faction));
  else disabledFactions.delete(key(faction));
}
export const retreatDisabled = faction => disabledFactions.has(key(faction));

export class RetreatCoordinator {
  constructor(adapter) {
    this.a = adapter;
    this.active = null;
    this.done = false;
    this.start = adapter.time();
  }

  tag(player, name) {
    return db.faction(this.a.factionOf(player))?.str(`${this.a.prefix}_Retreat_${name}`) || '';
  }
  allowedAfter() {
    return db.constants.num(`${this.a.prefix}_Retreat_Allowed_Countdown_Seconds`, 30);
  }

  canRetreat(player) {
    const a = this.a;
    if (!a.campaign || a.skirmishRules?.() || this.done || !a.isSide(player)) return 1;
    if (a.principals && !a.principals.some(f => key(f) === key(a.factionOf(player)))) return 1;
    if (a.time() - this.start < this.allowedAfter()) return 2;
    if (this.active && this.active.player !== player) return 5;
    if (!db.faction(a.factionOf(player))?.bool('Is_Playable') || retreatDisabled(a.factionOf(player))) return 1;
    return a.blocker(player);
  }

  refusal(player, code) {
    const reason = { 3: 1, 4: 2, 6: 3 }[code];
    return (reason && this.tag(player, `Not_Allowed_Reason_${reason}_SFXEvent`).trim()) || this.tag(player, 'Not_Allowed_SFXEvent').trim();
  }

  requestByFaction(faction) {
    const a = this.a,
      player = a.players().find(p => a.isSide(p) && key(a.factionOf(p)) === key(faction));
    if (player === undefined || this.active || (a.isLocal && a.isLocal(player))) return false;
    return this.request(player) === 0;
  }

  requestByScript(faction) {
    const a = this.a,
      player = a.players().find(p => a.isSide(p) && key(a.factionOf(p)) === key(faction));
    if (player === undefined || this.active || this.canRetreat(player)) return false;
    return this.request(player) === 0;
  }

  mitigation(player) {
    const best = new Map();
    for (const e of this.a.everything?.(player) || []) {
      for (const ability of e.type?.sub?.('Abilities')?.flatMap(n => n.all('Retreat_Protection_Ability')) || []) {
        let m = ability.num('Retreat_Loss_Mitigation', 0);
        if (!(m >= 0 && m < 1)) m = 0;
        const category = ability.num('Stacking_Category', 0);
        best.set(category, Math.max(best.get(category) ?? 0, m));
      }
    }
    let sum = 0;
    for (const v of best.values()) sum += v;
    return sum;
  }

  attrition(player) {
    const a = this.a,
      c = db.constants;
    let f = c.num(`${a.prefix}_Retreat_Attrition_Factor`, 0);
    if (
      a.prefix === 'Land' &&
      a.blockaded?.(player) &&
      !a.everything?.(player)?.some(e => e.type?.bool?.('Prevents_Blockade_Run_Attrition'))
    )
      f += c.num('Blockade_Run_Attrition_Factor', 0);
    return Math.min(1, f);
  }

  requestByPlan(player) {
    const a = this.a;
    if (player === undefined || player === null || (a.isLocal && a.isLocal(player))) return 1;
    const code = this.canRetreat(player);
    if (code) return code;
    if (this.active || this.flight) return 5;
    return this.request(player);
  }

  request(player) {
    const a = this.a;
    if (this.active && this.active.player === player) {
      this.cancel();
      return 0;
    }
    const code = this.canRetreat(player);
    if (code) {
      const sfx = this.refusal(player, code);
      if (sfx) a.play(sfx, player);
      return code;
    }
    const seconds = db.faction(a.factionOf(player))?.num(`${this.a.prefix}_Retreat_Countdown_Seconds`, 10);
    this.active = { player, left: seconds, text: this.tag(player, 'Countdown_Text_ID'), color: this.tag(player, 'Countdown_Color_RGBA') };
    this.begin(player);
    if (a.isLocal?.(player)) a.generic?.('retreat_clicked');
    a.play(this.unitSound('SFXEvent_Retreat_Start') || this.tag(player, 'Begin_SFXEvent'), player);
    for (const other of a.players())
      if (other !== player && a.isSide(other) && a.teamOf(other) !== a.teamOf(player))
        a.play(this.tag(player, 'Enemy_Begin_SFXEvent'), other);
    a.show?.(this.line());
    return 0;
  }

  begin(player) {
    const a = this.a,
      list = a.units(player),
      prefix = a.prefix;
    this.list = new Set(list);
    this.state = {
      player,
      list: this.list,
      phase: 'countdown',
      pursue: p => db.faction(a.factionOf(p))?.num(`${prefix}_Retreat_Pursue_Max_Speed_Mod_Factor`, 1) ?? 1,
      damaged: p => db.faction(a.factionOf(p))?.num(`${prefix}_Retreat_Units_Damaged_Mod_Factor`, 1) ?? 1
    };
    a.begin?.(this.state);
  }

  unitSound(tag) {
    const first = this.list && [...this.list][0];
    return first?.type?.str?.(tag).trim() || '';
  }

  cancel(automatic = false) {
    if (!this.active) return;
    const { player } = this.active;
    const sfx = (!automatic && this.unitSound('SFXEvent_Retreat_Cancel')) || this.tag(player, 'Cancel_SFXEvent');
    this.active = null;
    this.a.cancelled?.(this.state);
    this.state = null;
    this.a.play(sfx, player);
    this.a.show?.(null);
  }

  line() {
    return this.active
      ? { text: (db.t(this.active.text) || '') + clockText(this.active.left), color: this.active.color }
      : null;
  }

  step(dt) {
    const r = this.active,
      a = this.a;
    if (this.flight) {
      this.stepFlight(dt);
      return;
    }
    if (!r || this.done) return;
    if (this.canRetreat(r.player)) {
      this.cancel(true);
      return;
    }
    r.left -= dt;
    if (r.left > 0) {
      a.show?.(this.line());
      return;
    }
    this.go(r.player);
  }

  flightFrame() {
    const f = this.flight,
      a = this.a,
      count = f.list.length,
      wait = db.faction(a.factionOf(f.player))?.num('Space_Retreat_Unit_Increment_Wait_Frames', 1) ?? 1;
    const fast = db.faction(a.factionOf(f.player))?.num('Space_Retreat_Flight_Move_Increment', 500) ?? 500;
    f.frame++;
    a.cameraFrame?.(f.frame);
    if (f.frame === 181) a.explode?.(f.player);
    if (f.frame < 89) {
      if (f.frame < 30) for (const e of f.list) a.move(e, 8.125);
      else {
        f.list.forEach((e, i) => a.move(e, i <= f.released ? fast : 8.125));
        if (f.list[f.released] && f.sounded !== f.released) {
          f.sounded = f.released;
          a.released?.(f.list[f.released]);
        }
        f.wait--;
        if (f.wait <= 0) {
          f.released = Math.min(f.released + 1, count - 1);
          f.wait = wait;
        }
      }
    }
    return f.frame < f.total;
  }

  stepFlight(dt) {
    const f = this.flight;
    f.acc += dt * 30;
    while (f.acc >= 1 && this.flight) {
      f.acc--;
      if (!this.flightFrame()) {
        this.finish();
        return;
      }
    }
  }

  finish() {
    const f = this.flight,
      a = this.a;
    this.flight = null;
    a.generic?.('retreat_complete');
    a.cameraEnd?.();
    const enemy = a.players().find(p => p !== f.player && a.isSide(p) && a.teamOf(p) !== a.teamOf(f.player));
    a.end(enemy, f.player);
    const going = new Set(f.list);
    for (const e of a.everything(f.player)) a.remove(e, !going.has(e));
    a.flightEnd?.(this.state);
    this.state = null;
  }

  snapshot(ref) {
    const a = this.a,
      players = a.players(),
      names = list => [...list].map(ref).filter(Boolean);
    const out = { start: this.start, done: this.done };
    if (this.active) out.active = { player: players.indexOf(this.active.player), left: this.active.left, list: names(this.list || []) };
    if (this.flight) {
      const f = this.flight;
      out.flight = {
        player: players.indexOf(f.player),
        list: names(f.list),
        frame: f.frame,
        released: f.released,
        wait: f.wait,
        acc: f.acc,
        total: f.total
      };
    }
    return out;
  }

  restore(o, get) {
    if (!o) return;
    const a = this.a,
      players = a.players(),
      units = list => list.map(get).filter(e => e && !e.dead);
    this.start = o.start ?? this.start;
    this.done = !!o.done;
    if (o.active && players[o.active.player] !== undefined) {
      const player = players[o.active.player];
      this.active = {
        player,
        left: o.active.left,
        text: this.tag(player, 'Countdown_Text_ID'),
        color: this.tag(player, 'Countdown_Color_RGBA')
      };
      this.beginWith(player, units(o.active.list));
      a.show?.(this.line());
    }
    if (o.flight && players[o.flight.player] !== undefined) {
      const player = players[o.flight.player],
        list = units(o.flight.list);
      this.beginWith(player, list);
      this.state.phase = 'flight';
      const total = a.cameraStart?.(this.state, list) ?? o.flight.total;
      this.flight = {
        player,
        list,
        frame: o.flight.frame,
        released: o.flight.released,
        wait: o.flight.wait,
        acc: o.flight.acc,
        total: Math.max(total, o.flight.total)
      };
      a.flightStart?.(this.state, list);
    }
  }

  beginWith(player, list) {
    const units = this.a.units;
    this.a.units = () => list;
    try {
      this.begin(player);
    } finally {
      this.a.units = units;
    }
  }

  go(player) {
    const a = this.a,
      attrition = this.attrition(player) - this.mitigation(player);
    this.done = true;
    this.active = null;
    a.show?.(null);
    const going = [...this.list].filter(e => {
      if (!carriesNamedHero(e) && simRandom() < attrition) {
        a.remove(e, true);
        this.list.delete(e);
        return false;
      }
      return !e.dead;
    });
    this.state.phase = 'flight';
    if (a.move) {
      const total = a.cameraStart?.(this.state, going) ?? 89;
      this.flight = { player, list: going, frame: 0, released: 0, wait: 0, acc: 0, total };
      a.flightStart?.(this.state, going);
      if (total <= 0) this.finish();
      return;
    }
    const enemy = a.players().find(p => p !== player && a.isSide(p) && a.teamOf(p) !== a.teamOf(player));
    a.end(enemy, player);
    const reached = a.retreatReachable ? a.retreatReachable(player) : true,
      keep = new Set(reached ? going : []);
    for (const e of a.everything(player)) a.remove(e, !keep.has(e) && !(a.keptAnyway?.(e) ?? false));
    a.flightEnd?.(this.state);
    this.state = null;
  }
}

function carriesNamedHero(e, seen = new Set()) {
  if (!e || seen.has(e)) return false;
  seen.add(e);
  if (e.type?.bool?.('Is_Named_Hero') || e.carries?.bool?.('Is_Named_Hero')) return true;
  return [...(e.fighters || []), ...(e.members || []), ...(e.holds || []), ...(e.cargo || [])].some(x => x !== e && carriesNamedHero(x, seen));
}

function clockText(left) {
  const t = Math.max(0, left),
    whole = Math.trunc(t);
  return ' ' + String(whole).padStart(3, '0') + '.' + String(Math.trunc((t - whole) * 1000)).padStart(3, '0');
}

export function showRetreatLine(line) {
  let el = document.getElementById('retreatline');
  if (!line) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'retreatline';
    const c = db.constants,
      point = c.num('Game_Play_UI_Countdown_Font_Size', 0),
      size = point > 0 ? fontPixels(innerHeight, point) : 16;
    el.style.cssText = `position:fixed;left:${c.num('GUI_Tactical_Countdown_Timers_Screen_X', 0.005) * 100}%;top:${
      c.num('GUI_Tactical_Countdown_Timers_Screen_Y', 0.1) * 100
    }%;white-space:pre;pointer-events:none;z-index:6;font:${size}px ${fontFamily(
      c.str('Game_Play_UI_Countdown_Font_Name', '').trim() || 'Arial'
    )};text-shadow:1px 1px 0 #000`;
    document.body.appendChild(el);
  }
  const v = String(line.color || '')
    .split(/[\s,]+/)
    .map(parseFloat)
    .filter(Number.isFinite);
  el.style.color = v.length >= 3 ? `rgb(${v[0]},${v[1]},${v[2]})` : '#fff';
  el.textContent = line.text;
}

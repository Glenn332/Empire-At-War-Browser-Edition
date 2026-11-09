import { allied as routeAllied } from './humanroute.js';
import { db } from '../gamedata.js';
import { setComponentText } from './componenttext.js';
import { snapNativeText } from '../nativefont.js';
import { fillSummary, openSummary, battleTime } from './summary.js';
import { typeIcon } from './nativepanel.js';
import { battleHostile } from './galacticbattles.js';
import { openDialog } from './dialogs.js';
import { intelligence, VIS } from './galacticfog.js';
import { fleetsVisibleAt } from './orbitpanes.js';

const key = x => String(x || '').toUpperCase();
const SHELLS = ['PENDING_BATTLE_SHELL', 'STORY_PENDING_BATTLE_SHELL'];
const color = s => {
  const v = String(s || '')
    .split(/[\s,]+/)
    .map(parseFloat)
    .filter(Number.isFinite);
  return v.length >= 3 ? [v[0], v[1], v[2], v[3] ?? 255] : [255, 255, 255, 255];
};
const pendingTimeout = () => db.constants.num('Battle_Pending_Timeout_Seconds', 10);
const nameOf = type => type && (db.t(type.str('Text_ID')) || type.name);

export class PendingBattle {
  constructor(game) {
    this.game = game;
    this.request = null;
    this.resolution = null;
    this.disabled = new Set();
    this.overlay = new Map();
    this.generation = 0;
    this.music = false;
  }

  get busy() {
    return !!(this.request || this.resolution || this.deferred);
  }

  disable(planet, on) {
    if (on) this.disabled.add(planet);
    else this.disabled.delete(planet);
  }
  restricted(p) {
    return this.disabled.has(p);
  }
  forbidden(request) {
    const campaign = this.game.galaxy?.campaign;
    if (!campaign) return false;
    if (!campaign.bool('Is_Autoresolve_Allowed', true)) return true;
    if (!campaign.bool('Is_Story_Campaign')) return false;
    const name = key(this.game.galaxy.planets[request.p]?.type?.name),
      mode = request.mode === 'land' ? 'LAND' : 'SPACE',
      list = campaign.list('Autoresolve_Exclusion_Locations');
    for (let i = 0; i + 1 < list.length; i += 2) if (key(list[i]) === name && key(list[i + 1]) === mode) return true;
    return mode === 'SPACE' && this.storyLocked(request);
  }
  storyLocked(request) {
    const g = this.game.galaxy,
      p = g?.planets[request.p];
    if (!p) return false;
    const sides = new Set([key(request.attacker), key(request.defender)]),
      flagged = t => !!t?.bool?.('Prevents_Story_Campaign_Autoresolve');
    for (const f of g.fleets || [])
      if (f.planet === p.index && !f.leg && sides.has(key(f.owner)))
        for (const u of f.units) if (!u.dead && (flagged(u.type) || flagged(u.carries))) return true;
    for (const u of p.orbitalStructures || []) if (!u.dead && sides.has(key(u.owner)) && flagged(u.type)) return true;
    return !!p.station && sides.has(key(p.owner)) && flagged(p.station);
  }
  allowed(request) {
    return !this.restricted(request.p) && !this.forbidden(request);
  }
  single(request) {
    return (
      db.constants.bool('AlwaysBypassAutoResolve') ||
      this.restricted(request.p) ||
      this.forbidden(request) ||
      this.tutorial() ||
      !!this.game.pendingLinkedTactical
    );
  }
  tutorial() {
    return !!this.game.galaxy?.players?.find(p => key(p.faction) === key(this.game.me))?.tutorial;
  }

  begin(request) {
    const game = this.game;
    if (this.busy) return false;
    if (game.net) return this.netBegin(request);
    if (game.controlsLocked || game.storyMovie) {
      this.deferred = request;
      return true;
    }
    if (!db.constants.bool('Strategic_Queue_Tactical_Battles', true)) return this.fight(request);
    if (game.autoResolveOption || game.galaxy.campaignAutoResolve === 0) return this.resolve(request);
    if (!this.restricted(request.p) && game.battles.overrun(request)) return this.resolve(request, false, true);
    return this.show(request);
  }

  netBegin(request) {
    const game = this.game,
      humans = [request.attacker, request.defender].filter(f => game.isHuman(f));
    const coop = !!game.setup.singlePlayerCampaign && humans.length >= 1;
    if ((humans.length < 2 && !coop) || (game.setup.options?.autoResolve ?? 2) === 0) return this.resolve(request);
    request.id = this.netCount = (this.netCount || 0) + 1;
    request.voters = (game.setup.players || []).map((p, i) => (p.human && !p.left ? i : -1)).filter(i => i >= 0);
    request.humans = humans;
    request.answers = new Map();
    request.deadline = (game.now?.() ?? performance.now()) + Math.max(0, pendingTimeout()) * 1000;
    this.request = request;
    if (request.voters.includes(game.localPid)) this.show(request).catch(error => console.error(error));
    return true;
  }

  tick() {
    if (this.deferred && !this.game.controlsLocked && !this.game.storyMovie) {
      const waiting = this.deferred;
      this.deferred = null;
      this.begin(waiting);
    }
    const r = this.request;
    if (!r?.voters || !r.voters.includes(this.game.localPid)) return;
    const left = this.secondsLeft(r);
    if (left !== r.shownLeft) {
      r.shownLeft = left;
      this.paint();
    }
    if (!r.sent && left <= 0) this.cast('fight');
  }

  secondsLeft(r) {
    return Math.max(0, Math.ceil((r.deadline - (this.game.now?.() ?? performance.now())) / 1000));
  }

  cast(choice) {
    const r = this.request;
    if (!r?.voters || r.sent) return;
    r.sent = choice;
    this.game.order({ c: 'battle', id: r.id, choice });
    const ui = this.game.scriptUI;
    for (const id of ['choice_button_left', 'choice_button_right', 'attack_button_single']) ui?.visibility(id, false);
    this.paint();
  }

  answer(faction, id, choice) {
    const r = this.request,
      who = this.game.actingPid;
    if (!r?.voters || r.id !== id || !r.voters.includes(who) || r.answers.has(who) || !['fight', 'resolve'].includes(choice)) return;
    r.answers.set(who, choice);
    this.tally();
  }

  tally() {
    const r = this.request;
    if (!r?.voters || !r.voters.every(v => r.answers.has(v))) return;
    const fight = [...r.answers.values()].includes('fight');
    this.close();
    if (fight) this.fight(r);
    else this.resolve(r, true);
  }

  left(pid, faction, gone) {
    const r = this.request;
    if (!r?.voters) return;
    r.voters = r.voters.filter(v => v !== pid);
    if (gone) r.humans = r.humans.filter(f => key(f) !== key(faction));
    if (r.humans.length < (this.game.setup.singlePlayerCampaign ? 1 : 2)) {
      this.close();
      this.resolve(r, true);
      return;
    }
    this.tally();
  }

  fight(request) {
    this.game.startBattle(request.p, request.attacker, request.defender, request.mode, request.options);
    return true;
  }

  async show(request) {
    const game = this.game,
      ui = game.scriptUI,
      generation = ++this.generation;
    const unasked = () => {
      if (!game.net) return this.fight(request);
      this.request = request;
      this.cast('fight');
      return true;
    };
    if (!ui) return unasked();
    this.request = request;
    this.name = this.single(request) ? SHELLS[1] : SHELLS[0];
    game.pauseGalactic(true);
    game.keys?.clear();
    game.dragFleet = game.drag = null;
    game.dragGround = undefined;
    game.dragReach = null;
    game.radar?.flash(request.p);
    game.planetFlash?.(request.p, true);
    for (const n of SHELLS) ui.visibility(n, n === this.name);
    if (this.name === SHELLS[0]) {
      ui.text('choice_button_left', 'TEXT_BUTTON_BEGIN');
      ui.text('choice_button_right', 'TEXT_BUTTON_RESOLVE_BATTLE');
      ui.visibility('choice_button_left', true);
      ui.visibility('choice_button_right', true);
    } else {
      ui.text('attack_button_single', 'TEXT_BUTTON_BEGIN');
      ui.visibility('attack_button_single', true);
    }
    this.sound(request);
    await ui.ready();
    if (generation !== this.generation || !this.request) return true;
    if (!ui.shells.get(this.name)) {
      if (!game.net) return this.fight(this.close());
      for (const n of SHELLS) ui.visibility(n, false);
      return unasked();
    }
    ui.place(this.name, [0, Math.max(768, (1024 * innerHeight) / innerWidth) / 2]);
    this.paint();
    ui.play(this.name);
    return true;
  }

  sound(request) {
    const audio = this.game.audio,
      faction = db.faction(this.game.me),
      kind = request.mode === 'land' ? 'Land' : 'Space';
    const sfx = faction?.str(`SFX_Event_Tactical_${kind}_Battle_Pending`);
    if (sfx) audio?.play(sfx);
    const event = db.music.get(key(faction?.str(`Music_Event_Tactical_${kind}_Battle_Pending`)));
    if (event && audio?.setPlaylist) {
      audio.setPlaylist(event.list('Files'), false);
      this.music = true;
    }
  }

  side(request, owner) {
    const g = this.game.galaxy,
      planet = g.planets[request.p],
      defender = key(owner) === key(request.defender);
    const units = g.fleets
      .filter(f => f.planet === request.p && !f.leg && key(f.owner) === key(owner))
      .flatMap(f => f.units.filter(u => !u.dead));
    if (request.mode !== 'land') return { units, count: units.length };
    const friendly = u =>
      key(u.owner) === key(request.defender) ||
      !!db
        .faction(request.defender)
        ?.list('Allies')
        .some(n => key(n) === key(u.owner));
    const surface = [...planet.garrison, ...(planet.groundStructures || [])].filter(u => !u.dead && friendly(u) === defender);
    const landing = defender ? [] : (request.options.records || []).filter(u => !u.dead);
    const ground = [...surface.filter(u => planet.garrison.includes(u)), ...landing];
    return { units: ground, count: surface.length + landing.length };
  }

  paint() {
    const game = this.game,
      request = this.request,
      ui = game.scriptUI,
      shell = ui?.shells.get(this.name);
    if (!request || !shell?.root) return;
    const comps = ui.comps,
      g = game.galaxy,
      planet = g.planets[request.p],
      scale = game.overlayScale();
    let layer = this.overlay.get(this.name);
    if (!layer) {
      layer = new Map();
      this.overlay.set(this.name, layer);
    }
    const element = (id, tag) => {
      const bone = shell.origins.get(id.toUpperCase());
      if (!bone) return null;
      let el = layer.get(id);
      if (!el) {
        el = document.createElement(tag);
        el.dataset.control = id.toUpperCase();
        layer.set(id, el);
        shell.root.appendChild(el);
        el.style.position = 'absolute';
        el.style.pointerEvents = 'none';
        const index = shell.model?.bones.findIndex(b => b.name.toUpperCase() === id.toUpperCase());
        if (index >= 0) el.dataset.bone = index;
      }
      return { el, bone, comp: comps.get(id.toUpperCase()) };
    };
    const textId = this.name === SHELLS[0] ? 'text_attack_choice' : 'text_attack_single',
      t = element(textId, 'div');
    if (t) {
      const off = (t.comp?.val('Text_Offset') || '').split(/[\s,]+/).map(Number);
      t.el.className = 'ht';
      t.el.style.left = t.bone.x + (off[0] || 0) + 'px';
      t.el.style.top = -t.bone.y - (off[1] || 0) + 'px';
      const kind = request.mode === 'land' ? 'LAND' : 'SPACE',
        body = request.sent
          ? db.t('TEXT_WAITING_FOR_OPPONENT')
          : (db.t(planet.type.str('Text_ID')) || planet.name) + db.t(`TEXT_${game.net ? 'MP_' : ''}TACTICAL_${kind}_BATTLE_IS_PENDING`),
        line = request.voters ? body + ' ' + this.secondsLeft(request) : body;
      t.line = line;
      t.tint = color(db.constants.str('Battle_Pending_Message_Color'));
      setComponentText(t.el, t.comp, line, { scale, tint: t.tint });
    }
    if (this.name === SHELLS[0]) {
      const me = game.me,
        mine = key(me) === key(request.defender) ? request.defender : request.attacker,
        other = mine === request.defender ? request.attacker : request.defender;
      const hostile = g.players.find(p => battleHostile(me, p.faction))?.faction || other;
      for (const [id, owner, tint] of [
        ['graph_left', mine, me],
        ['graph_right', other, hostile]
      ]) {
        const slot = element(id, 'canvas');
        if (!slot) continue;
        const { units, count } = this.side(request, owner),
          space = request.mode !== 'land';
        const station = space && key(owner) === key(request.defender) && planet.station ? [{ type: planet.station }] : [];
        const fallback =
          units.length || station.length ? null : db.faction(owner)?.str(space ? 'Fighter_Icon_Name' : 'Infantry_Icon_Name') || null;
        const picture = game.stackPicture(units.length ? units : station, tint, game.graphComp, false, count, fallback);
        slot.el.hidden = !picture;
        if (!picture) continue;
        slot.el.width = picture.width;
        slot.el.height = picture.height;
        slot.el.getContext('2d').drawImage(picture, 0, 0);
        Object.assign(slot.el.style, { left: slot.bone.x + 'px', top: -slot.bone.y + 'px', transform: 'translate(-50%,-50%)' });
        slot.el.setAttribute('role', 'img');
        slot.el.setAttribute('aria-label', db.t(db.faction(tint)?.str('Text_ID')) || tint);
      }
    }
    snapNativeText(shell.root);
  }

  resize() {
    if (this.request) this.paint();
  }
  refreshLanguage() {
    if (this.request) this.paint();
  }

  close({ keepPause = false } = {}) {
    const game = this.game,
      request = this.request;
    this.generation++;
    if (request) {
      for (const n of SHELLS) game.scriptUI?.visibility(n, false);
      game.radar?.flash(request.p, false);
      game.planetFlash?.(request.p, false);
      if (this.music) {
        game.audio?.stopMusic?.();
        this.music = false;
      }
      this.request = null;
      if (!keepPause) game.pauseGalactic(false);
    }
    return request;
  }

  click(name) {
    if (!this.request) return;
    const k = key(name),
      shell = this.name;
    if (this.game.net) {
      if (shell === SHELLS[0] && k === 'CHOICE_BUTTON_RIGHT') this.cast('resolve');
      else if ((shell === SHELLS[0] && k === 'CHOICE_BUTTON_LEFT') || (shell === SHELLS[1] && k === 'ATTACK_BUTTON_SINGLE')) this.cast('fight');
      return;
    }
    if (shell === SHELLS[0] && k === 'CHOICE_BUTTON_RIGHT') this.resolve(this.close({ keepPause: true }), true);
    else if ((shell === SHELLS[0] && k === 'CHOICE_BUTTON_LEFT') || (shell === SHELLS[1] && k === 'ATTACK_BUTTON_SINGLE'))
      this.fight(this.close());
  }

  resolve(request, held = false, silent = false) {
    const game = this.game;
    if (game.net) {
      for (const p of game.galaxy.players) p.bounty = 0;
      const outcome = game.battles.resolveFor(request);
      if (!outcome) return this.fight(request);
      this.present(request, outcome, silent).catch(error => console.error(error));
      game.ui?.refresh();
      game.overview?.refresh();
      return true;
    }
    if (!held) game.pauseGalactic(true);
    for (const p of game.galaxy.players) p.bounty = 0;
    const outcome = game.battles.resolveFor(request);
    if (!outcome) {
      game.pauseGalactic(false);
      return this.fight(request);
    }
    this.resolution = { request, outcome };
    this.present(request, outcome, silent)
      .catch(error => console.error(error))
      .finally(() => this.finish());
    return true;
  }

  finish() {
    if (!this.resolution) return;
    this.resolution = null;
    this.game.pauseGalactic(false);
    this.game.ui?.refresh();
    this.game.overview?.refresh();
  }

  losses({ sides, result }, attacker, defender, me = this.game.localFaction ?? this.game.me) {
    const
      lost = [new Map(), new Map()],
      dead = [[], []];
    for (let i = 0; i < 2; i++)
      for (const u of sides[i]) {
        if (u.groundBase) continue;
        const kept = u.station ? result.sides[i].stations.has(u) && result.sides[i].stations.get(u) : result.sides[i].alive.has(u);
        if (kept) continue;
        const owner = u.owner ?? [attacker, defender][i],
          at = key(owner) === key(me) ? 0 : !routeAllied(owner, me) ? 1 : -1;
        if (at < 0) continue;
        lost[at].set(u.original, (lost[at].get(u.original) || 0) + 1);
        dead[at].push(u.original);
      }
    return { yours: lost[0], enemy: lost[1], mine: dead[0], theirs: dead[1] };
  }

  sees(planet, viewer) {
    const g = this.game.galaxy,
      v = intelligence(g, planet);
    if (v && v.mask & VIS.FLEET_PRESENCE) return true;
    const fleets = g.fleets.filter(f => f.planet === planet.index && !f.leg);
    return fleetsVisibleAt(g, planet, viewer, fleets);
  }

  async netResult(line) {
    const dlg = await openDialog('IDD_MP_AUTO_RESOLVE_RESULT_DIALOG', { modal: false }).catch(() => null);
    if (!dlg) return;
    dlg.setText('IDC_RESULTS_TEXT', line);
    dlg.setText('IDC_CANCEL_BUTTON', db.t('TEXT_BUTTON_CLOSE'));
    dlg.show('IDC_DIALOG_CLOSE_BUTTON', false);
    this.dialog = dlg;
    await new Promise(done =>
      dlg.on('IDC_CANCEL_BUTTON', () => {
        dlg.close();
        this.dialog = null;
        done();
      })
    );
  }

  async present(request, outcome, silent) {
    const game = this.game,
      { p, attacker, defender, mode } = request,
      planet = game.galaxy.planets[p];
    const space = mode === 'space',
      planetName = db.t(planet.type.str('Text_ID')) || planet.name;
    const local = game.localFaction ?? game.me,
      fighting = [attacker, defender].some(f => key(f) === key(local));
    if (!fighting && !this.sees(planet, local)) return;
    const me = fighting ? local : attacker;
    const { yours, enemy, mine, theirs } = this.losses(outcome, attacker, defender, me);
    const winnerIndex = outcome.result.winner,
      won =
        key([attacker, defender][winnerIndex]) === key(me) ||
        !!db
          .faction(me)
          ?.list('Allies')
          ?.some(n => key(n) === key([attacker, defender][winnerIndex]));
    const log = game.galacticLog,
      red = [255, 24, 39],
      faction = nameOf(db.faction(me)) || me;
    const token = (text, ...values) => values.reduce((s, v, i) => s.replace('##' + i, v), text);
    for (const type of [...theirs, ...mine])
      if (type.bool('Is_Named_Hero') || [...type.categories()].some(c => c.includes('HERO')))
        log?.message(token(db.t('TEXT_AR_HERO_LOSS'), nameOf(type), planetName), { color: red });
    const a = mine.length,
      b = theirs.length,
      kind = space ? 'SPACE' : 'LAND';
    const verdict = won
      ? b > a * 3
        ? 'WIN_MAJOR'
        : b > a
          ? 'WIN_REGULAR'
          : 'WIN_MINOR'
      : b * 3 < a
        ? 'LOSS_MAJOR'
        : a > b
          ? 'LOSS_REGULAR'
          : 'LOSS_MINOR';
    const line = token(db.t(`TEXT_AR_${kind}_${verdict}`), faction, planetName, String(a));
    log?.message(line, { color: red });
    if (silent || !fighting) return;
    if (game.net) return this.netResult(line);
    const dlg = await openSummary();
    if (!dlg) return;
    fillSummary(dlg, {
      title: db.t(won ? 'TEXT_WIN_BATTLE' : 'TEXT_LOST_BATTLE'),
      time: battleTime(0),
      planet: planetName,
      yours,
      enemy,
      icon: typeIcon,
      bounty: game.galaxy.players.find(p => key(p.faction) === key(me))?.bounty || 0,
      collects: !!db.faction(me)?.bool('Benefits_From_Corruption')
    });
    dlg.show('IDC_DIALOG_CLOSE_BUTTON', false);
    dlg.setText('IDC_CONTINUE_BUTTON', db.t('TEXT_BUTTON_RETURN_TO_GALACTIC'));
    this.dialog = dlg;
    await new Promise(done =>
      dlg.on('IDC_CONTINUE_BUTTON', () => {
        dlg.close();
        this.dialog = null;
        done();
      })
    );
  }
}

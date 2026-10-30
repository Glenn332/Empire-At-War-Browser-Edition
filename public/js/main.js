import { TacticalMarker } from './game/tacticalobjects.js';
import { linkedParent, authoredMapOwner, ensureMissionPlayers } from './game/linktactical.js';
import { mpBattleParent } from './game/galacticmpbattle.js';
import { startGalaxyFrame, galaxyFrameSetup } from './game/mpgalaxyframe.js';
import './pointertrap.js';
import './touch.js';
import * as THREE from 'three';
import { db, loadGameData, skirmishStation, skirmishFactions, autoColors, switchLanguage } from './gamedata.js';
import { findFiles, fetchText, fromInstall } from './vfs.js';
import { gfx, storeGfx } from './gfx.js';
import { loadMap, pickEnvironment, environmentRoll, skirmishMaps, mapTitle } from './ted.js';
import { preloadModels, getModelData, buildModel, resetLighting, prebuildModel, dropPrebuilt } from './model.js';
import { loadALA, animName } from './ala.js';
import { bakeRockTextures } from './rockbake.js';
import { loadIcons, iconUrl } from './icons.js';
import { Audio } from './audio.js';
import { Renderer, loadBlobMaterials } from './game/render.js';
import { loadTacticalCamera } from './game/tacticalcameradata.js';
import { World, Player, Team, modelsForType, buildListFor, isUpgradeType, resetEntityIds } from './game/sim.js';
import { seedSim } from './game/simrandom.js';
import { Lockstep, TURN, CHAT_MAX, chatText } from './game/netgame.js';
import { ticker } from './net.js';
import { execute } from './game/commands.js';
import { SkirmishAI } from './game/ai.js';
import { loadSpaceBrain } from './game/spacebrain.js';
import { SpaceGoals } from './game/spacegoals.js';
import { ScriptHost } from './game/scripts.js';
import { aiFreeStore, difficultyAdjustment } from './game/landbrain.js';
import { UI } from './game/ui.js';
import { Pointers } from './game/pointers.js';
import { expansion } from './edition.js';
import { loadHudAssets } from './game/hud.js';
import { loadGameFonts } from './fonts.js';
import { diag } from './diag.js';
import './aidebug.js';
import { BenchOverlay } from './benchoverlay.js';
import { texturesReady, loadTexture, textureBytes, dxtSupported } from './dds.js';
import { loadParticles } from './particles.js';
import { Advisor } from './game/advisor.js';
import { FrontEnd } from './game/frontend.js';
import { showSummary } from './game/summary.js';
import { showLoadScreen, endLoadScreen, activeLoadScreen, loadProgress } from './game/loadscreen.js';
import { LandGame } from './game/landgame.js';
import { GalacticGame } from './game/galactic.js';
import { startServiceWorker, assetsAvailable } from './pack.js';
import { ensureCurrentBuild } from './update.js';
import { showSplash, hideSplash, showMessage } from './splash.js';
import { Cinematic } from './game/cinematic.js';
import { loadPrioritySets } from './game/priorities.js';
import { loadDialogs, openDialog } from './game/dialogs.js';
import { Menus } from './game/menus.js';
import { openLobby } from './game/lobby.js';
import { openMultiplayer } from './game/multiplayer.js';
import { BUILD } from './build.js';
import {
  snapshot,
  snapshotNow,
  restore,
  restoreView,
  restoreSpaceCampaign,
  validate,
  listSaves,
  putSave,
  getSave,
  deleteSave,
  downloadSave,
  importSaveFile
} from './game/savegame.js';
import { watchForResume, pendingResume, forgetResume } from './game/resume.js';
import { restoreBattleScripts } from './game/tacticalsave.js';
import { orderMove } from './game/orders.js';
import { placeSpecialWeapons, placeCampaignSpecialWeapons } from './game/superweapon.js';
import { placeCampaignBattle, sideBeaten, battleResult } from './game/campaignbattle.js';
import { storyTypes } from './game/storyart.js';
import { openRetreatDialog, resolveTactical, spaceRosters } from './game/tacticalautoresolve.js';
import { RetreatCoordinator, showRetreatLine, hasRetreatPrevention } from './game/retreat.js';
import { installTacticalBattle } from './game/tacticalbattle.js';
import { TacticalStoryHost } from './game/tacticalstory.js';
import { stepTacticalSpeech } from './game/tacticalspeech.js';
import { isSuperweaponTarget, isTacticalSuperweapon } from './game/tacticalsuperweapon.js';
import { TacticalSuperweaponHUD } from './game/tacticalsuperweaponhud.js';
import { tacticalAnnouncement } from './game/tacticalvictory.js';
import { loadBlackMarket } from './game/blackmarket.js';
import { giveFreeUpgrades } from './game/planetabilities.js';
import { stageStart, unstash, setInPlace, toMainMenu } from './game/transit.js';
import { TacticalCinematics } from './game/tacticalcinematics.js';
import { stepDualFlash } from './game/tutorialrewards.js';
import { PALETTE as SLOT_COLORS, MAX_SLOTS } from './game/slotrows.js';
import { leaveTo, guardLeaving } from './leaveguard.js';
import { beaconType } from './game/beacons.js';
const AI_STEP_MS = 4,
  AI_STEP_WORK = 80;

guardLeaving();

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const _modelTurn = new THREE.Matrix4().makeRotationZ(Math.PI / 2),
  _modelTurnQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const _tiltM = new THREE.Matrix4(),
  _tiltE = new THREE.Euler();
function tiltAsAuthored(u, o) {
  if (Math.abs(o.rot[0]) + Math.abs(o.rot[1]) <= 0.01) return;
  _tiltM.makeRotationFromEuler(_tiltE.set(o.rot[0] * DEG, o.rot[1] * DEG, o.rot[2] * DEG, 'ZYX')).multiply(_modelTurn);
  _tiltE.setFromRotationMatrix(_tiltM, 'ZXY');
  u.heading = _tiltE.z - Math.PI / 2;
  u.pitch = -_tiltE.x;
  u.roll = _tiltE.y;
}
const FACTIONS = [];
const audio = new Audio();
let spareRenderer = null;

let pristine = null;
const menuTexts = ['menuTitle', 'menuBody', 'resumeBtn'];
function notePage() {
  pristine ||= { body: new Set(document.body.children), hud: $('hud').cloneNode(true), menu: menuTexts.map(id => $(id).innerHTML) };
}
const hudButtons = () => {
  $('menuBtn').onclick = () => window.game?.toggleMenu();
};
function resetPage() {
  audio.reset();
  resetLighting();
  if (!pristine) return;
  for (const el of [...document.body.children]) if (!pristine.body.has(el) && !el.hasAttribute('data-page')) el.remove();
  const hud = $('hud'),
    fresh = pristine.hud.cloneNode(true);
  hud.replaceWith(fresh);
  pristine.body.delete(hud);
  pristine.body.add(fresh);
  hudButtons();
  menuTexts.forEach((id, i) => {
    $(id).innerHTML = pristine.menu[i];
  });
  $('view').replaceChildren();
  for (const id of ['menu', 'lobby']) $(id).classList.add('hidden');
  document.body.classList.remove('attract', 'cinematic', 'commandbar-hidden', 'hud-hidden', 'letterboxed', 'original-hud', 'track-cam');
  document.documentElement.style.removeProperty('--letterbox');
}
function endGame(next) {
  const g = window.game;
  if (g) {
    try {
      g.dispose(!['land', 'galactic', 'multiplayer'].includes(next));
    } catch (e) {
      console.warn('ending the game', e);
    }
    for (const part of [g.tacticalMovies, g.tutorialFx]) {
      try {
        part?.dispose?.();
      } catch (e) {
        console.warn('ending the game', e);
      }
    }
    for (const dlg of [g.summary, g.campaignScore, g.tutorialDialog]) {
      try {
        dlg?.close?.();
      } catch {}
    }
  }
  window.game = null;
  resetPage();
}

const STAGES = {
  'Loading map': [0, 0.05],
  'Loading models': [0.05, 0.14],
  'Loading animations': [0.14, 0.21],
  'Preparing surfaces': [0.21, 0.22],
  'Preparing effects and shaders': [0.22, 0.44],
  'Loading ships': [0.44, 0.97],
  'Preparing the battle': [0.97, 0.98]
};
let stageNow = null;

function progress(text, frac) {
  const stage = String(text).replace(/\s*\(\d+\/\d+\)$/, ''),
    log = (window.loadLog ||= []);
  if (log.at(-1)?.[1] !== stage) log.push([Math.round(performance.now()), stage]);
  $('loadText').textContent = text;
  if (frac !== undefined) $('loadBar').style.width = Math.round(frac * 100) + '%';
  const screen = activeLoadScreen();
  if (screen) {
    const st = screen.staged && Object.entries(STAGES).find(([k]) => text.startsWith(k));
    const begun = st && st[0] !== stageNow && frac === 1;
    if (st) stageNow = st[0];
    if (st) loadProgress(st[1][0] + (st[1][1] - st[1][0]) * (begun ? 0 : (frac ?? 0)));
    else if (!screen.staged && frac !== undefined) loadProgress(frac);
  }
}

function choices(el, options, initial, onPick) {
  let current = initial;
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.textContent = label;
    b.classList.toggle('on', value === current);
    b.onclick = () => {
      current = value;
      for (const c of el.children) c.classList.toggle('on', c === b);
      onPick?.(value);
    };
    el.appendChild(b);
  }
  return () => current;
}

const BENCH_FLEETS = {
  Empire: [
    'Star_Destroyer',
    'Victory_Destroyer',
    'Acclamator_Assault_Ship',
    'Tartan_Patrol_Cruiser',
    'Tartan_Patrol_Cruiser',
    'Broadside_Class_Cruiser',
    'TIE_Fighter_Squadron',
    'TIE_Fighter_Squadron',
    'TIE_Bomber_Squadron',
    'TIE_Bomber_Squadron'
  ],
  Rebel: [
    'Calamari_Cruiser',
    'Alliance_Assault_Frigate',
    'Nebulon_B_Frigate',
    'Corellian_Corvette',
    'Corellian_Corvette',
    'Corellian_Gunboat',
    'Rebel_X-Wing_Squadron',
    'Rebel_X-Wing_Squadron',
    'Y-Wing_Squadron',
    'Y-Wing_Squadron'
  ],
  Underworld: [
    'Kedalbe_Battleship',
    'Vengeance_Frigate',
    'Interceptor4_Frigate',
    'Crusader_Gunship',
    'Crusader_Gunship',
    'Crusader_Gunship',
    'StarViper_Squadron',
    'StarViper_Squadron',
    'Skipray_Squadron',
    'Skipray_Squadron'
  ]
};
const BENCH_SECONDS = 60;
const TICK = 1 / 30;
function benchFleet(faction, pads = false) {
  const can = [],
    seen = new Set(),
    builders = [];
  const builder = t => {
    if (t && !seen.has(t)) {
      seen.add(t);
      builders.push(t);
    }
  };
  for (let st = skirmishStation(faction), guard = 0; st && guard < 8; st = db.type(st.str('Next_Level_Base')), guard++) builder(st);
  if (!pads) {
    for (const st of builders)
      for (const t of buildListFor(st, faction))
        if (
          !isUpgradeType(t) &&
          !can.includes(t) &&
          (t.has('Space_Model_Name') || t.has('Squadron_Units')) &&
          t.tag.toLowerCase() !== 'starbase'
        )
          can.push(t);
  } else
    for (const t of db.types.values())
      if ((t.behaviors().has('TACTICAL_BUILD_OBJECTS') && !t.has('Tactical_Health')) || t.name.toUpperCase().endsWith('_PAD')) builder(t);
  for (let i = 0; pads && i < builders.length && i < 400; i++) {
    for (const t of buildListFor(builders[i], faction)) {
      if (isUpgradeType(t)) continue;
      if (t.has('Tactical_Buildable_Constructed')) {
        builder(db.type(t.str('Tactical_Buildable_Constructed')));
        continue;
      }
      if (
        !can.includes(t) &&
        (t.has('Space_Model_Name') || t.has('Squadron_Units')) &&
        t.tag.toLowerCase() !== 'starbase' &&
        !t.behaviors().has('TACTICAL_BUILD_OBJECTS')
      )
        can.push(t);
    }
  }
  const own = (BENCH_FLEETS[faction] || []).map(n => db.type(n));
  const kinds = [...new Set(own)];
  if (own.length && own.every(Boolean) && kinds.filter(t => can.includes(t)).length * 2 > kinds.length) return own;
  if (!can.length) return own.filter(Boolean);
  let seed = 2166136261;
  for (const ch of faction) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const draw = (from, n, out) => {
    const pool = from.slice();
    for (let k = 0; k < n; k++) {
      if (!pool.length) pool.push(...from);
      out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    }
    return out;
  };
  const ships = can.filter(t => !t.has('Squadron_Units')),
    wings = can.filter(t => t.has('Squadron_Units'));
  if (!pads || !ships.length || !wings.length) return draw(can, 10, []);
  return draw(wings, 4, draw(ships, 6, []));
}

class Game {
  constructor(setup) {
    this.setup = setup;
    this.audio = audio;
    this.paused = false;
    this.speed = 1;
    this.over = false;
    this.last = performance.now();
    this.frame = this.frame.bind(this);
  }

  async start() {
    const { mapFile, credits, popCap, teamFactions } = this.setup;
    $('lobby').classList.add('hidden');
    if (!this.setup.attract) showSplash();
    progress('Loading map', 0);
    const map = await loadMap(mapFile);
    ensureMissionPlayers(this.setup, map);
    pickEnvironment(map, this.setup.net ? environmentRoll(this.setup.seed) : Math.random());
    this.map = map;
    Game.loading = this;
    await this.showLoading(map);

    const stationType = (f, marker = null) => skirmishStation(f, marker);
    const factions = (this.artFactions = [...new Set(teamFactions)]);
    const names = (this.artNames = new Set()),
      seen = (this.artSeen = new Set()),
      later = [];
    if (!this.setup.attract && !this.setup.campaign) for (const f of factions) modelsForType(stationType(f), factions, names, seen, later);
    const cb = this.setup.campaign;
    if (cb)
      for (const n of [
        cb.defender.station,
        ...(cb.defender.orbital || []),
        ...(cb.planetWeapons || []),
        ...cb.attacker.units.map(u => u.type),
        ...cb.defender.units.map(u => u.type)
      ]) {
        const t = db.type(n);
        if (t) modelsForType(t, factions, names, seen, null);
      }
    if (cb)
      for (const t of await storyTypes(
        [...(cb.storyPlots || []).map(p => p.name), this.setup.tacticalStoryPlot, 'SANDBOX_STANDARD.XML'].filter(Boolean)
      ))
        modelsForType(t, factions, names, seen, null);
    if (!this.setup.attract && !this.setup.campaign)
      for (const f of factions)
        for (const k of ['Standalone_Space_Maps_Special_Weapon_A', 'Standalone_Space_Maps_Special_Weapon_B']) {
          const t = db.faction(f) && db.type(db.faction(f).str(k).trim());
          if (t) modelsForType(t, factions, names, seen, later);
        }
    const isPad = t => (t.behaviors().has('TACTICAL_BUILD_OBJECTS') && !t.has('Tactical_Health')) || t.name.toUpperCase().endsWith('_PAD');
    for (const o of map.objects) modelsForType(o.type, factions, names, seen, isPad(o.type) ? null : later);
    const tacticalWeapons = [...seen].filter(isTacticalSuperweapon),
      superweaponAssets = new Set();
    if (tacticalWeapons.length)
      for (const o of map.objects)
        if (isSuperweaponTarget(o.type))
          for (const tag of ['Death_Explosions', 'Death_By_TSW_Replacements'])
            for (const n of o.type.list(tag)) {
              const t = db.type(n);
              if (t) modelsForType(t, factions, superweaponAssets, new Set(), null);
            }
    for (const name of superweaponAssets) names.add(name);
    if (!this.setup.attract)
      for (const o of map.objects) {
        if (!/^TEAM_\d\d_/i.test(o.type.name) || !o.type.has('Marker_For_Specific_Object_Type')) continue;
        for (const f of factions) {
          const t = stationType(f, o.type);
          if (t) modelsForType(t, factions, names, seen, later);
        }
      }
    if (!this.setup.attract && !this.setup.campaign) {
      const sides = new Set(factions.map(f => f.toUpperCase()));
      for (const t of db.types.values()) {
        if (!t.str('Space_Model_Name') && !t.list('Squadron_Units').length) continue;
        if (!t.list('Affiliation').some(a => sides.has(a.toUpperCase()))) continue;
        if (!seen.has(t) && !later.includes(t)) later.push(t);
      }
    }
    for (const env of map.environments || []) for (const s of env.skydomes) names.add(s.str('Space_Model_Name'));
    {
      const b = db.constants.str('WaypointFlagModelName').trim();
      if (b) names.add(b);
    }
    await preloadModels(names, (d, n) => progress(`Loading models (${d}/${n})`, d / n));
    await Promise.all(
      [...superweaponAssets].filter(n => n && !getModelData(n)).map(n => Promise.resolve(loadParticles(n)).catch(() => null))
    );
    progress('Loading animations', 1);
    this.artClips = new Set(
      (await findFiles('MODELS\\\\[^\\\\]*_(IDLE|DIE|DEPLOY|UNDEPLOY|BUILD)_00\\.ALA$')).map(n => n.split('\\').pop())
    );
    await this.loadClips(names);
    await this.loadSuperweaponClips(tacticalWeapons);

    this.renderer = await Renderer.create($('view'), spareRenderer);
    spareRenderer = null;
    window.applyGraphics(this.renderer);
    if (/[?&]gfxinfo/.test(location.search)) {
      const tag = $('buildTag'),
        g = this.renderer.gpu,
        v = /Version\/([\d.]+)/.exec(navigator.userAgent);
      if (tag) tag.classList.add('always');
      if (tag)
        tag.textContent +=
          ' | ' +
          (g ? 'webgpu' + (g.bundles ? '' : ' nobundle') : 'webgl' + (navigator.gpu ? ' (webgpu here)' : '')) +
          (dxtSupported() ? ' dxt' : ' no-dxt') +
          ' | ' +
          (v ? 'v' + v[1] : 'no version');
    }
    progress('Preparing surfaces', 1);
    await bakeRockTextures(this.renderer.renderer);
    this.renderer.setEnvironment(map.environment);
    progress('Preparing effects and shaders', 1);
    const warmFrom = performance.now();
    const query = new URLSearchParams(location.search),
      warm = !query.has('nowarm');
    if (warm) await this.warmUp(names).catch(e => console.warn('warm-up', e));
    const cap = +query.get('preload');
    const budget = cap > 0 && !this.setup.net ? cap * 1048576 : this.setup.attract ? 256 * 1048576 : Infinity;
    if (this.setup.benchmark) {
      this.benchFleets = new Map(factions.map(f => [f, benchFleet(f, this.setup.benchPads)]));
      const want = new Set();
      for (const fleet of this.benchFleets.values())
        for (const t of fleet) {
          want.add(t);
          for (const k of ['Squadron_Units'])
            for (const n of t.list(k)) {
              const u = db.type(n);
              if (u) want.add(u);
            }
        }
      later.splice(0, later.length, ...later.filter(t => want.has(t)));
    }
    this.artState = new Map();
    for (const t of later) this.artState.set(t, 'later');
    const total = later.length;
    while (later.length && textureBytes() < budget) {
      const batch = later.splice(0, 6),
        done = total - later.length - batch.length;
      progress(`Loading ships (${done}/${total})`, done / total);
      await this.fetchArt(batch, false, warm).catch(e => console.warn('preload', e));
      for (const t of batch) this.artState.set(t, 'here');
    }
    diag.warmUpMs = Math.round(performance.now() - warmFrom);
    diag.preloaded = { types: total - later.length, later: later.length, textureMB: Math.round(textureBytes() / 1048576) };
    if (this.setup.net) {
      resetEntityIds();
      seedSim(this.setup.seed >>> 0);
    }
    const world = (this.world = new World({ scene: this.renderer.scene, fx: this.renderer, audio, map }));
    world.bring = type => {
      this.bring(type);
    };
    this.workerMode =
      (this.setup.spaceWorker !== undefined ? !!this.setup.spaceWorker : new URLSearchParams(location.search).has('spaceworker')) &&
      !this.setup.campaign &&
      !this.setup.linkedTactical &&
      !this.setup.attract;
    if (!this.workerMode && !new URLSearchParams(location.search).has('noscripts'))
      this.scriptsReady = ScriptHost.create(this)
        .then(h => {
          this.scripts = h;
          world.scripts = h;
          if (h && new URLSearchParams(location.search).has('noplans')) h.plansOff = true;
          if (h && !this.setup.net) h.budgetMs = 4;
        })
        .catch(e => console.warn('scripts', e));
    world.artReady = type => {
      if (this.lock) return true;
      const st = this.artState.get(type);
      return st === undefined || st === 'here';
    };
    world.autofire = !this.setup.net && !!window.autofireDefault;
    const teams = teamFactions.map((f, i) => world.addTeam(new Team(i, f)));
    let bots = 0;
    this.setup.players.forEach((cfg, i) => {
      const p = world.addPlayer(
        new Player(i, teams[cfg.team], {
          human: !!cfg.human,
          credits,
          popCap,
          color: cfg.color ? new THREE.Color(cfg.color) : null,
          difficulty: cfg.difficulty,
          name: cfg.human ? (this.setup.net ? cfg.name || 'Player' : 'You') : `Bot ${++bots}`
        })
      );
      if (cfg.human && (!this.setup.net || cfg.peer === this.setup.net.me || cfg.peers?.includes(this.setup.net.me))) this.human = p;
      else if (cfg.human && this.setup.net?.spectators?.includes(this.setup.net.me) && !this.human) {
        this.human = p;
        this.spectator = true;
      }
      if (cfg.human && this.setup.net) p.autofire = !!cfg.autofire;
    });
    await Promise.all(
      world.players
        .filter(p => !p.human)
        .map(async p => {
          p.adjust = await difficultyAdjustment(p.factionName, p.difficulty).catch(() => null);
        })
    );
    const human = this.human;
    audio.human = human;
    world.viewer = human;
    world.fog = this.setup.fog !== false;
    world.onEvent = (kind, data) => this.onEvent(kind, data);

    world.skirmish = !this.setup.attract && !this.setup.benchmark && !this.setup.campaign;
    world.campaign = !!this.setup.campaign;
    await installTacticalBattle(this);
    if (this.setup.campaign)
      for (const p of world.players)
        if (p.id >= 0 && this.setup.campaign.tech?.[p.factionName] !== undefined) p.campaignTech = this.setup.campaign.tech[p.factionName];
    this.placeArgs = [map, teams, stationType];
    this.placeMap(map, teams, stationType);
    if (this.setup.campaign) {
      const cbk = this.setup.campaign;
      await loadBlackMarket();
      cbk.attacker.units = cbk.attacker.units.map(u => ({ ...u, type: db.type(u.type) })).filter(u => u.type);
      cbk.defender.units = cbk.defender.units.map(u => ({ ...u, type: db.type(u.type) })).filter(u => u.type);
      this.campaignBook = placeCampaignBattle(world, map, teams, cbk);
      world.overrunSides = [teams[cbk.attacker.team], teams[cbk.defender.team]];
      this.retreat = this.spaceRetreat(cbk);
      placeCampaignSpecialWeapons(world, map.objects, cbk);
      for (const p of world.players)
        if (p.id >= 0)
          giveFreeUpgrades(
            cbk.upgrades?.[p.factionName]?.space,
            p.factionName,
            t => p.upgrades.has(t.name.toUpperCase()),
            t => world.applyUpgrade(p, t)
          );
      this.campaignBook.called = new Map();
      world.market = cbk.blackMarket || {};
      if (cbk.treasury) {
        world.tacticalSessions = [];
        for (const p of world.players) {
          const t = p.id >= 0 && cbk.treasury[String(p.factionName).toUpperCase()];
          if (!t) continue;
          if (!t.ai) {
            p.credits = t.credits;
            world.tacticalSessions[p.id] = { ai: false };
            continue;
          }
          p.credits = t.share;
          world.tacticalSessions[p.id] = {
            ai: true,
            reserve: Math.max(0, t.credits - t.share),
            released: 0,
            adjust: t.adjust ?? 1,
            parts: t.parts || []
          };
        }
      }
    }
    const loaded = this.setup.restore ? restore(this, this.setup.restore) : null;
    if (loaded && this.campaignBook) restoreSpaceCampaign(this, this.setup.restore, loaded.refs);
    this.savedThing =
      loaded &&
      (r => {
        const [e, n] = String(r).split('.'),
          x = loaded.refs.get(e) || null;
        return n === undefined ? x : x?.fighters?.[+n] || null;
      });
    if (loaded && this.retreat && this.setup.restore.battle.retreat)
      this.retreat.restore(this.setup.restore.battle.retreat, this.savedThing);
    if (loaded) this.loadedSave = { save: this.setup.restore, refs: loaded.refs };
    this.ais =
      this.setup.benchmark || this.setup.attract || this.workerMode
        ? []
        : world.players.filter(p => !p.human && !p.team.mapSide).map(p => new SkirmishAI(world, p, p.difficulty));
    world.goals = this.workerMode || new URLSearchParams(location.search).has('oldai') ? null : new SpaceGoals(world, () => this.ais);
    this.freeStores = [];
    if (!new URLSearchParams(location.search).has('nofreestore'))
      for (const ai of this.ais) {
        this.freeStores.push(
          aiFreeStore(ai.player.factionName)
            .then(async fs => {
              for (let n = 0; n < 200 && !this.scripts; n++) await new Promise(r => setTimeout(r, 100));
              if (this.scripts && fs.space) this.scripts.freeStore(ai.player, fs.space, () => ai.mine().filter(e => !e.aiPlan), ai);
            })
            .catch(() => {})
        );
      }
    this.ai = this.ais[0];
    await loadBlobMaterials().catch(() => null);
    await loadPrioritySets().catch(e => console.warn('targeting priorities not loaded', e));
    await loadGameFonts();
    await loadDialogs().catch(() => null);
    this.losses = new Map();
    this.renderer.setSelectionArt(human.faction);
    this.hudAssets = await loadHudAssets().catch(e => {
      console.warn('command bar', e);
      return null;
    });
    this.cine = new Cinematic(this);
    this.menus = new Menus(this);
    this.advisor = new Advisor(this);
    this.ui = new UI(this);
    if (this.hudAssets) this.superweaponHUD = new TacticalSuperweaponHUD(this, this.hudAssets);

    const rig = this.renderer.rig;
    rig.bounds = { minX: world.min.x, minY: world.min.y, maxX: world.max.x, maxY: world.max.y };
    rig.setSpec(
      await loadTacticalCamera('Space_Mode', {
        pitchDefault: 50,
        pitchMin: -10,
        pitchMax: 85,
        pitchZoomedIn: 50,
        pitchZoomBegin: -1,
        yawDefault: 0,
        fovDefault: 55,
        fovMin: 55,
        fovMax: 55,
        fovPerUnit: 0,
        distDefault: 1000,
        distMin: 200,
        distMax: 1900,
        distPerUnit: 500
      })
    );
    if (human.station) {
      rig.x = human.station.x;
      rig.y = human.station.y;
    }
    if (this.campaignBook) {
      const a = this.campaignBook.anchors[human.team.id];
      if (a) {
        rig.x = a.x;
        rig.y = a.y;
      }
    }
    if (loaded) restoreView(this, this.setup.restore, loaded.refs);
    const tracks = tag => {
      const t = human.faction.tuples(tag).find(t => t[0].toUpperCase() === 'SPACE');
      const ev = t && db.music.get(t[1].toUpperCase());
      return ev ? ev.list('Files') : [];
    };
    this.music = { ambient: tracks('Music_Event_List_Ambient'), battle: tracks('Music_Event_List_Battle'), mode: '', check: 0 };
    if (this.setup.attract) {
      const menu = db.music.get('MAIN_MENU_MUSIC_EVENT'),
        files = menu ? menu.list('Files') : [];
      this.music = { ambient: files, battle: files, mode: '', check: 0 };
    }
    this.setMusic(this.music.ambient.length ? 'ambient' : 'battle');
    const audioXml = await fetchText('Data/XML/Audio.xml').catch(() => null);
    const peace = audioXml && /<Music_Space_Battle_To_Ambient_Peace_Seconds>\s*([\d.]+)/i.exec(audioXml);
    this.music.peace = peace ? parseFloat(peace[1]) : 15;

    const icon = iconUrl(human.faction.str('Icon_Name'));
    $('factionIcon').innerHTML = icon ? `<img src="${icon}">` : '';
    if (this.setup.benchmark) this.startBenchmark(this.setup.benchmark);
    if (new URLSearchParams(location.search).has('spaceprobe'))
      import('./game/spaceprobe.js').then(P => {
        this.probeStart = P.battleSnapshot(this);
        window.spaceProbe = steps => P.spaceProbe(this, steps);
      });
    if (warm) await this.warmFrames().catch(e => console.warn('warm frames', e));
    await this.scriptsReady;
    const savedScripts = this.scripts && this.setup.restore?.battle?.scripts;
    if (this.scripts && !savedScripts)
      await this.scripts
        .prime()
        .then(() => this.scripts.compileAll(3000))
        .catch(e => console.warn('scripts', e));
    if (savedScripts) await this.scripts.compileAll(3000).catch(e => console.warn('scripts', e));
    await TacticalStoryHost.create(this, this.scripts, { restoring: !!savedScripts });
    if (savedScripts) {
      try {
        restoreBattleScripts(this, savedScripts, null, this.savedThing);
      } catch (error) {
        console.warn('the saved scripts could not be put back, they start over:', error);
        await this.scripts.prime().catch(e => console.warn('scripts', e));
      }
    }
    if (this.workerMode) {
      const { SpaceMirror } = await import('./game/spacemirror.js');
      this.mirror = new SpaceMirror(this, this.loadedSave);
      progress('Preparing the battle', 1);
      await this.mirror.whenReady;
    }
    if (this.setup.net) await this.prepareLockstep();
    if (!this.setup.attract) hideSplash();
    $('loading').classList.add('hidden');
    $('hud').classList.remove('hidden');
    if (this.setup.benchmark) this.bench.restart();
    else if (loaded) {
      this.message(`Loaded: ${this.setup.restore.name}`, 'good');
      if (loaded.missing.length)
        this.message(`${loaded.missing.length} saved item(s) no longer exist in the game data and were left out`, 'bad');
    } else if (this.setup.attract) this.startAttract();
    else this.message(`${db.t(map.textId) || map.planet} — destroy the enemy space station`);
    this.last = performance.now();
    requestAnimationFrame(this.frame);
    window.game = this;
    this.diag = diag;
    diag.attach(this.renderer.renderer, () => ({
      units: this.world.units.length,
      shots: this.world.projectiles.length,
      particles: this.renderer.particles.length,
      time: +this.world.time.toFixed(0)
    }));
    Game.loading = null;
    await this.endLoading();
  }

  restartAttract() {
    const w = this.world;
    for (const u of w.units) if (!u.dead && (u.player.id >= 0 || u.mapIndex !== undefined)) w.removeUnit(u);
    for (const q of w.squads) q.dead = true;
    w.units = w.units.filter(u => !u.dead);
    w.unitGridN = Infinity;
    w.squads = [];
    w.projectiles = [];
    for (const t of w.teams) t.station = null;
    this.placeMap(...this.placeArgs, true);
    this.startAttract();
  }

  dispose(keep = false) {
    this.modeSuspended = true;
    this.over = true;
    clearInterval(this.attractCycle);
    this.missTicker?.stop();
    this.front?.dispose();
    this.cine?.stop();
    if (this.menus) while (this.menus.stack.length) this.menus.stack.pop().close();
    this.ui?.destroy();
    this.bench?.dispose();
    this.bench = null;
    if (this.renderer) spareRenderer = this.renderer.dispose(keep);
    if (window.game === this) window.game = null;
  }

  startAttract() {
    const w = this.world;
    document.body.classList.add('attract');
    w.fog = false;
    for (const p of w.players) {
      const mine = w.units
        .filter(u => !u.dead && !u.squad && u.player === p && u.isMobile)
        .concat(w.squads.filter(q => !q.dead && q.player === p));
      const foes = w.units.filter(u => !u.dead && !u.squad && u.player.id >= 0 && u.player.team !== p.team);
      if (!mine.length || !foes.length) continue;
      const x = foes.reduce((a, u) => a + u.x, 0) / foes.length,
        y = foes.reduce((a, u) => a + u.y, 0) / foes.length;
      orderMove(mine, x, y, true);
    }
    this.cine.start();
  }

  async warmUp(names) {
    const R = this.renderer,
      gl = R.renderer;
    const files = await findFiles('MODELS\\\\P[A-Z]{0,2}_[^\\\\]*\\.ALO$').catch(() => []);
    const defs = await Promise.all(files.map(f => Promise.resolve(loadParticles(f.split('\\').pop())).catch(() => null)));
    for (const d of defs) if (d && d.emitters) for (const e of d.emitters) if (e.texture) loadTexture(e.texture, { repeat: false });
    progress('Preparing effects and shaders', 0.3);
    const park = new THREE.Group();
    for (const n of names) {
      const data = getModelData(n);
      if (!data) continue;
      try {
        park.add(buildModel(data, { teamColor: this.warmColor() }).root);
      } catch {}
    }
    progress('Preparing effects and shaders', 0.45);
    const all = await texturesReady();
    progress('Preparing effects and shaders', 0.7);
    this.artOnCard ||= new WeakSet();
    for (const t of all)
      if (t.image || t.mipmaps?.length) {
        this.artOnCard.add(t);
        try {
          gl.initTexture(t);
        } catch {}
      }
    progress('Preparing effects and shaders', 0.8);
    R.scene.add(park);
    try {
      gl.compile(R.scene, R.camera);
    } finally {
      R.scene.remove(park);
    }
  }

  async warmFrames() {
    const R = this.renderer,
      rig = R.rig,
      cam = R.camera,
      w = this.world;
    const keep = { x: rig.x, y: rig.y, dist: rig.dist, maxDist: rig.maxDist, far: cam.far, viewer: w.viewer };
    const span = Math.max(1000, w.max.x - w.min.x, w.max.y - w.min.y);
    rig.x = (w.min.x + w.max.x) / 2;
    rig.y = (w.min.y + w.max.y) / 2;
    rig.maxDist = Infinity;
    rig.dist = span * 1.1;
    cam.far = Math.max(cam.far, span * 4);
    cam.updateProjectionMatrix();
    w.viewer = null;
    try {
      dropPrebuilt();
      const need = new Map();
      for (const u of w.units) {
        if (u.dead || !u.garrison || !u.garrison.length || !u.player) continue;
        const color = u.player.id >= 0 ? u.player.color : null;
        for (const g of u.garrison) {
          const n = Math.max(0, (g.remaining >= 0 ? Math.min(g.want, g.remaining) : g.want) - g.live.length);
          if (!n || !g.type) continue;
          for (const name of g.type.has('Squadron_Units') ? g.type.list('Squadron_Units') : [g.type.name]) {
            const data = getModelData(db.type(name)?.str('Space_Model_Name'));
            if (!data) continue;
            let byColor = need.get(data);
            if (!byColor) need.set(data, (byColor = new Map()));
            byColor.set(color, (byColor.get(color) || 0) + n);
          }
        }
      }
      for (const [data, byColor] of need) for (const [color, n] of byColor) prebuildModel(data, color, n);
      R.fxParticles.prepare(R.renderer, cam);
      const next = async () => {
        await new Promise(r => {
          requestAnimationFrame(() => r());
          setTimeout(r, 100);
        });
        if (R.gpu) await R.gpu.settle();
      };
      for (let i = 0; i < 2; i++) {
        R.render(w, 0, null);
        await next();
      }
      R.instances?.prepare(R.renderer, cam);
      if (R.gpu) {
        await R.gpu.settle();
        R.render(w, 0, null);
        await next();
      }
    } finally {
      rig.x = keep.x;
      rig.y = keep.y;
      rig.dist = keep.dist;
      rig.maxDist = keep.maxDist;
      cam.far = keep.far;
      cam.updateProjectionMatrix();
      w.viewer = keep.viewer;
    }
  }

  loadClips(names) {
    const wanted = [];
    for (const m of names)
      for (const kind of ['IDLE', 'DIE', 'DEPLOY', 'UNDEPLOY', 'BUILD']) {
        const a = animName(m, kind);
        if (this.artClips.has(a)) wanted.push(a);
      }
    return Promise.all(wanted.map(loadALA));
  }

  async loadSuperweaponClips(types) {
    if (!types.length) return;
    this.superweaponClips ??= new Set((await findFiles('MODELS\\\\[^\\\\]*_ATTACK_00\\.ALA$')).map(n => n.split('\\').pop()));
    await Promise.all(
      types
        .map(t => animName(t.str('Space_Model_Name'), 'ATTACK'))
        .filter(n => this.superweaponClips.has(n))
        .map(loadALA)
    );
  }

  warmColor() {
    if (this.human) return this.human.color;
    const c = (this.setup.players || []).find(p => p.color)?.color;
    return new THREE.Color(c || '#3686f2');
  }

  async fetchArt(types, gentle, gpu = true) {
    const R = this.renderer,
      gl = R.renderer,
      add = new Set();
    for (const t of types) modelsForType(t, this.artFactions, add, this.artSeen);
    const tactical = [...this.artSeen].filter(t => isTacticalSuperweapon(t) && add.has(t.str('Space_Model_Name')));
    if (tactical.length)
      for (const o of this.map.objects)
        if (isSuperweaponTarget(o.type))
          for (const tag of ['Death_Explosions', 'Death_By_TSW_Replacements'])
            for (const n of o.type.list(tag)) {
              const t = db.type(n);
              if (t) modelsForType(t, this.artFactions, add, this.artSeen);
            }
    const fresh = [...add].filter(n => n && !this.artNames.has(n));
    for (const n of fresh) this.artNames.add(n);
    if (!fresh.length) return;
    const breath = () => new Promise(r => requestAnimationFrame(() => r()));
    if (gentle)
      for (const n of fresh) {
        await preloadModels([n]);
        await breath();
      }
    else await preloadModels(fresh);
    await this.loadClips(fresh);
    await this.loadSuperweaponClips(tactical);
    if (tactical.length)
      await Promise.all(fresh.filter(n => !getModelData(n)).map(n => Promise.resolve(loadParticles(n)).catch(() => null)));
    if (!gpu) return;
    const park = new THREE.Group();
    for (const n of fresh) {
      const data = getModelData(n);
      if (!data) continue;
      try {
        park.add(buildModel(data, { teamColor: this.warmColor() }).root);
      } catch {}
      if (gentle) await breath();
    }
    park.traverse(o => {
      o.visible = true;
    });
    this.artOnCard ||= new WeakSet();
    for (const t of await texturesReady()) {
      if (this.artOnCard.has(t) || !(t.image || t.mipmaps?.length)) continue;
      this.artOnCard.add(t);
      try {
        gl.initTexture(t);
      } catch {}
      if (gentle) await breath();
    }
    if (gentle && gl.compileAsync) await gl.compileAsync(park, R.camera, R.scene).catch(() => {});
    else {
      R.scene.add(park);
      try {
        gl.compile(R.scene, R.camera);
        const rt = (this.warmTarget ||= new THREE.WebGLRenderTarget(4, 4)),
          was = gl.getRenderTarget(),
          only = [];
        park.traverse(o => {
          if (o.isMesh) {
            only.push([o, o.frustumCulled]);
            o.frustumCulled = false;
          }
        });
        const shown = R.scene.children.filter(o => o !== park && o.visible);
        for (const o of shown) o.visible = false;
        try {
          gl.setRenderTarget(rt);
          gl.render(R.scene, R.camera);
        } finally {
          gl.setRenderTarget(was);
          for (const o of shown) o.visible = true;
          for (const [o, f] of only) o.frustumCulled = f;
        }
      } finally {
        R.scene.remove(park);
      }
    }
  }

  artFor(type) {
    if (!this.artState) return null;
    const st = this.artState.get(type);
    if (st === 'here') return null;
    if (st && st !== 'later') return st;
    if (st === undefined) {
      const names = modelsForType(type, this.artFactions, new Set(), new Set());
      if ([...names].every(n => !n || this.artNames.has(n))) {
        this.artState.set(type, 'here');
        return null;
      }
      this.artState.set(type, 'later');
    }
    this.bring(type, true);
    if (this.lock) (this.artHolds ||= new Set()).add(type);
    return this.artState.get(type);
  }

  artHeld() {
    if (!this.artHolds?.size) return false;
    for (const t of this.artHolds) if (this.artState.get(t) === 'here') this.artHolds.delete(t);
    return this.artHolds.size > 0;
  }

  bring(type, held = false) {
    if ((this.lock && !held) || !this.artState || this.artState.get(type) !== 'later') return;
    const job = (this.artQueue || Promise.resolve())
      .then(() => this.fetchArt([type], true))
      .catch(e => console.warn('art', type.name, e))
      .then(() => {
        this.artState.set(type, 'here');
      });
    this.artState.set(type, job);
    this.artQueue = job;
  }

  placeMap(map, teams, stationType, again = false) {
    const w = this.world;
    if (!again) w.mapObjects = new Map();
    const byOwner = !expansion() && !this.setup.attract && !this.setup.campaign && !this.setup.linkedTactical,
      factionOrder = [...db.factions.values()];
    const mapSides = new Map();
    const mapSide = o => {
      if (!w.skirmish || this.setup.linkedTactical || o.owner < 0) return null;
      const f = factionOrder[o.owner];
      if (!f || /^(yes|true)$/i.test(f.str('Is_Playable')) || f.bool('Is_Neutral') || !f.bool('Create_Player_In_Multiplayer_Games'))
        return null;
      if (teams.some(t => t.factionName.toUpperCase() === f.name.toUpperCase())) return null;
      let p = mapSides.get(f) || w.players.find(q => q.team.mapSide && q.factionName === f.name);
      if (!p) {
        const t = w.addTeam(new Team(w.teams.length, f.name));
        t.mapSide = true;
        p = w.addPlayer(new Player(w.players.length, t, { credits: 0, name: f.name }));
      }
      mapSides.set(f, p);
      return p;
    };
    for (const [mapIndex, o] of map.objects.entries()) {
      const n = o.type.name.toUpperCase();
      const heading = o.rot[2] * DEG;
      if (!again && (o.type.behaviors().has('MARKER') || o.type.bool('Is_Marker')))
        w.mapObjects.set(mapIndex, [new TacticalMarker(o, () => w.neutral)]);
      const team = /^TEAM_(\d\d)_/.exec(n);
      if (team) {
        const t = teams[+team[1]];
        if (!t || !t.players.length) continue;
        if (n.endsWith('SPACE_STATION')) {
          const owner = t.players.find(p => p.human) || t.players[0];
          const st = stationType(t.factionName, o.type) || stationType(t.factionName);
          if (st) t.station = t.firstStation = w.spawn(st, owner, o.pos[0], o.pos[1], heading);
        } else if (n.endsWith('SPAWN_POINT_MARKER')) {
          if (!again) t.spawnPoints.push({ x: o.pos[0], y: o.pos[1], heading });
        } else if (o.type.has('Marker_For_Specific_Object_Type')) {
          const owner = t.players.find(p => p.human) || t.players[0];
          const st = stationType(t.factionName, o.type);
          if (st) w.spawn(st, owner, o.pos[0], o.pos[1], heading);
        }
        continue;
      }
      if (byOwner && o.owner >= 0) {
        const f = factionOrder[o.owner],
          of = f ? w.players.filter(p => p.id >= 0 && p.factionName && p.factionName.toUpperCase() === f.name.toUpperCase()) : [];
        const spawn = /^PLAYER_(\d+)_SPAWN_POINT_MARKER$/.exec(n);
        if (spawn) {
          const p = of[+spawn[1]];
          if (p && p.team) {
            p.spawn = { x: o.pos[0], y: o.pos[1], heading };
            p.team.spawnPoints.push(p.spawn);
          }
          continue;
        }
        if (f && !of.length && /^(yes|true)$/i.test(f.str('Is_Playable'))) continue;
        if (of.length && !(o.type.behaviors().has('MARKER') || o.type.bool('Is_Marker'))) {
          const u = w.spawn(o.type, of[0], o.pos[0], o.pos[1], heading);
          if (u) {
            w.mapObjects.set(mapIndex, [u]);
            if (!u.isSquad) {
              u.z = o.pos[2] + o.type.num('Layer_Z_Adjust', 0);
              u.syncObj();
              u.mapIndex = mapIndex;
            }
          }
          if (u && o.type.tag.toLowerCase() === 'starbase' && of[0].team && !of[0].team.station)
            of[0].team.station = of[0].team.firstStation = u;
          continue;
        }
      }
      if (o.type.behaviors().has('MARKER') || o.type.bool('Is_Marker')) continue;
      if (isSuperweaponTarget(o.type)) {
        if (!again) w.tacticalSuperweapons.addTarget(this.placeScenery(o));
        continue;
      }
      if (!again) w.addField(o.type, o.pos[0], o.pos[1], o.type.num('Scale_Factor', 1) * (o.scale || 1));
      if (!getModelData(o.type.str('Space_Model_Name'))) continue;
      const scenery = o.type.bool('In_Background') || o.type.bool('Is_Decoration') || !o.type.behaviors().size;
      if (scenery) {
        if (!again) this.placeScenery(o);
        continue;
      }
      const authored = authoredMapOwner(this.setup, o);
      const side = authored
        ? teams.find(t => t.factionName === authored)
        : this.setup.attract
          ? teams.find(t => t.players.length && new RegExp('\\b' + t.factionName + '\\b', 'i').test(o.type.str('Affiliation')))
          : null;
      const u = w.spawn(o.type, side ? side.players[0] : mapSide(o) || w.neutral, o.pos[0], o.pos[1], heading);
      if (u) w.mapObjects.set(mapIndex, [u]);
      if (u && !u.isSquad) {
        u.z = o.pos[2] + o.type.num('Layer_Z_Adjust', 0);
        tiltAsAuthored(u, o);
        u.syncObj();
        u.mapIndex = mapIndex;
      }
    }
    for (const p of teams) {
      if (!p.station) continue;
      if (!p.spawnPoints.length) p.spawnPoints.push({ x: p.station.x + 500, y: p.station.y, heading: 0 });
      for (const sp of p.spawnPoints) sp.heading = Math.atan2(-sp.y, -sp.x);
    }
    if (w.skirmish) placeSpecialWeapons(w, map.objects);
    if (w.skirmish)
      w.players.forEach((pl, k) => {
        const t = pl.team,
          list = pl.id >= 0 && pl.faction ? pl.faction.list('Space_Skirmish_AI_Default_Forces') : [];
        if (!t || !t.spawnPoints.length) return;
        const nth = t.players.indexOf(pl);
        list.forEach((name, i) => {
          const ty = db.type(name),
            sp = pl.spawn || t.spawnPoints[(i + nth) % t.spawnPoints.length];
          if (ty)
            w.spawn(
              ty,
              pl,
              sp.x + Math.cos(sp.heading) * (150 + 120 * i) - Math.sin(sp.heading) * 160 * nth,
              sp.y + Math.sin(sp.heading) * (150 + 120 * i) + Math.cos(sp.heading) * 160 * nth,
              sp.heading
            );
        });
      });
    w.recountPop();
  }

  startBenchmark(n) {
    const w = this.world,
      players = w.players;
    const sides = [players.find(p => p.team === w.teams[0]), players.find(p => p.team === w.teams[1])];
    const cols = Math.ceil(Math.sqrt(n * 1.6)),
      gap = this.setup.benchSpacing || 230;
    const mx = (w.max.x - w.min.x) * 0.025,
      my = (w.max.y - w.min.y) * 0.025;
    const inX = x => Math.max(w.min.x + mx, Math.min(w.max.x - mx, x)),
      inY = y => Math.max(w.min.y + my, Math.min(w.max.y - my, y));
    sides.forEach((p, side) => {
      const fleet = (this.benchFleets && this.benchFleets.get(p.factionName)) || benchFleet(p.factionName, this.setup.benchPads);
      if (!fleet.length) return;
      const dir = side ? -1 : 1,
        spawned = [];
      for (let i = 0; i < n; i++) {
        const type = fleet[i % fleet.length];
        if (!type) continue;
        const row = Math.floor(i / cols),
          col = i % cols;
        const e = w.spawn(type, p, inX(-dir * (1100 + row * gap)), inY((col - (cols - 1) / 2) * gap), dir > 0 ? 0 : Math.PI);
        if (e) spawned.push(e);
      }
      for (const e of spawned) orderMove([e], dir > 0 ? w.max.x - mx : w.min.x + mx, e.y, true);
    });
    w.recountPop();
    const rig = this.renderer.rig;
    rig.x = 0;
    rig.y = 0;
    rig.yaw = 0;
    rig.dist = 4200;
    rig.clamp();
    this.bench = this.benchOverlay(`${n} v ${n} ships`, { ships: `${n} vs ${n}` });
  }

  benchOverlay(label, result, seconds = BENCH_SECONDS) {
    return new BenchOverlay({
      label,
      result,
      seconds,
      renderer: this.renderer.renderer,
      parent: $('hud'),
      net: this.lock ? () => this.lock.netStats(TICK) : null,
      count: () => ({ units: this.world.units.filter(u => !u.dead && u.player.id >= 0).length, shots: this.world.projectiles.length })
    });
  }

  toggleBenchmark() {
    if (this.setup.benchmark) return;
    if (this.bench) {
      this.bench.dispose();
      this.bench = null;
      return;
    }
    this.bench = this.benchOverlay('live battle', { battle: 'live' }, Infinity);
  }

  placeScenery(o, effects = false) {
    const data = getModelData(o.type.str('Space_Model_Name')),
      inst = data ? buildModel(data) : null;
    const g = new THREE.Group();
    if (inst) g.add(inst.root);
    g.position.set(o.pos[0], o.pos[1], o.pos[2] + o.type.num('Layer_Z_Adjust', 0));
    g.quaternion.setFromEuler(new THREE.Euler(o.rot[0] * DEG, o.rot[1] * DEG, o.rot[2] * DEG, 'ZYX')).multiply(_modelTurnQ);
    g.scale.setScalar(o.type.num('Scale_Factor', 1) * (o.scale || 1));
    this.renderer.scene.add(g);
    if (inst) {
      this.renderer.addIdle(inst, o.type.str('Space_Model_Name'));
      if (inst.billboards.length) this.renderer.sceneryBillboards.push(inst);
    }
    const particles = [];
    if (inst && effects)
      for (const px of inst.proxies || []) {
        if (px.hidden) continue;
        const pos = new THREE.Vector3(),
          handle = this.renderer.fxParticles.spawn(px.name, f => {
            px.bone.getWorldPosition(pos);
            f.x = pos.x;
            f.y = pos.y;
            f.z = pos.z;
            f.rot = 0;
            f.scale = g.scale.x;
            f.vx = f.vy = 0;
          });
        if (handle) particles.push(handle);
      }
    return {
      type: o.type,
      owner: 'Neutral',
      x: o.pos[0],
      y: o.pos[1],
      z: o.pos[2],
      rotation: o.rot.slice(),
      scale: o.scale || 1,
      dead: false,
      remove: () => {
        this.renderer.scene.remove(g);
        for (const handle of particles) handle.stop();
        this.renderer.idlers = this.renderer.idlers.filter(a => a.inst !== inst);
        this.renderer.sceneryBillboards = this.renderer.sceneryBillboards.filter(a => a !== inst);
      }
    };
  }

  tacticalReplacement(type, transform) {
    const file = type.str('Space_Model_Name');
    if (getModelData(file))
      this.placeScenery({ type, pos: [transform.x, transform.y, transform.z], rot: transform.rotation, scale: 1 }, true);
    else
      this.renderer.fxParticles.spawn(
        file,
        f => {
          f.x = transform.x;
          f.y = transform.y;
          f.z = transform.z;
          f.rot = transform.rotation[2] * DEG;
          f.scale = 1;
          f.vx = f.vy = 0;
        },
        { scale: type.num('Scale_Factor', 1) }
      );
  }

  onEvent(kind, d) {
    const me = this.human;
    if (kind === 'killed' && this.ui && this.ui.radar && d.unit && (!this.world.fog || (me && d.unit.seenBy & me.bit)))
      this.ui.radar.event('Default_Unit_Die', d.unit.x, d.unit.y);
    if (kind === 'beacon' && me && d.beacon.owner.team === me.team) {
      const b = d.beacon;
      this.audio.play(b.type.str('SFXEvent_Beacon_Placed'));
      this.ui?.radar?.event(b.type.str('Beacon_Radar_Map_Event_Name').trim(), b.x, b.y);
    }
    if (kind === 'interdict' && this.ui?.radar) {
      if (d.on) this.ui.radar.event('Interdict_Activated', d.unit.x, d.unit.y, d.unit);
      else this.ui.radar.remove(d.unit);
    }
    if (kind === 'reinforcementReady' && d.player === me)
      this.message(`${db.t(d.type.str('Text_ID')) || d.type.name} ready — drag it from Reinforcements onto the map`, 'good');
    else if (kind === 'built' && d.player === me && !d.replaced && d.entity?.isStructure) this.message(`${d.entity.name} ready`, 'good');
    else if (kind === 'upgrade' && d.player === me) this.message(`${db.t(d.type.str('Text_ID'))} complete`, 'good');
    else if (kind === 'overrun' && me && d.team === me.team) this.audio.play(me.faction?.str('SFXEvent_HUD_Tactical_Victory_Near'));
    else if (kind === 'stationLevelLost' && me) {
      const friendly = d.unit.player.team === me.team,
        hostile = !friendly && d.unit.player.id >= 0;
      if (friendly || hostile)
        this.message(
          db.t(friendly ? 'TEXT_FRIENDLY_SPACE_STATION_LEVEL_LOST' : 'TEXT_ENEMY_SPACE_STATION_LEVEL_LOST'),
          'bad',
          'rgb(255, 24, 39)'
        );
    } else if (kind === 'stationUpgraded') {
      if (d.player.team === me.team) {
        if (this.ui.selection.includes(d.old)) this.ui.select([d.station]);
        this.message('Space station upgraded', 'good');
        audio.play(me.faction.str(d.player === me ? 'SFXEvent_Starbase_Upgraded' : 'SFXEvent_Starbase_Ally_Upgraded'));
      } else {
        this.message('The enemy has upgraded their space station', 'bad');
        audio.play(me.faction.str('SFXEvent_Starbase_Enemy_Upgraded'));
      }
    } else if (kind === 'captured') {
      if (d.player === me) this.message(`${d.pad.name} under your control`, 'good');
    } else if (kind === 'died') {
      const e = d.entity;
      this.cine.onDeath(e);
      if (e.player.id >= 0 && (e.isSquad || !e.squad) && !e.isPad) {
        const m = this.losses.get(e.player.team) || this.losses.set(e.player.team, new Map()).get(e.player.team);
        m.set(e.type, (m.get(e.type) || 0) + 1);
      }
      if (e.player === me && !e.isSquad && e.visualRadius > 60) this.message(`${e.name} lost`, 'bad');
    } else if (kind === 'baseAttacked' && me && d.unit.player.team === me.team) this.message('Our space station is under attack!', 'bad');
    else if (kind === 'gameover') this.gameOver(d.winner, !!d.ready);
    if (kind === 'built' && this.campaignBook && d.entity) {
      const m = this.campaignBook.called,
        t = d.player.team.id;
      if (!m.has(t)) m.set(t, []);
      m.get(t).push(d.entity);
    }
  }

  canRetreat() {
    return !!this.setup.campaign && !this.setup.linkedTactical && !this.spectator && !this.over && !this.tacticalVictory.winner;
  }
  retreatClicked() {
    if (!this.canRetreat()) return;
    if (this.lock) {
      this.command({ c: 'retreat' });
      return;
    }
    if (this.retreat.active?.player === this.human) {
      this.retreat.cancel();
      return;
    }
    const retreat = () => this.retreat.request(this.human);
    if (this.setup.campaign.autoResolve?.allowed) openRetreatDialog({ retreat, autoResolve: () => this.autoResolveNow() });
    else retreat();
  }
  spaceRetreat(cb) {
    const w = this.world,
      game = this,
      sides = [cb.attacker.team, cb.defender.team];
    const going = p =>
      [...w.units, ...w.squads].filter(
        e =>
          e.player === p &&
          !e.dead &&
          !e.isStructure &&
          !e.isPad &&
          !e.isStation &&
          !e.underConstruction &&
          !(
            e.hardpoints &&
            e.hardpoints.some(h => h.kind === 'HARD_POINT_ENGINE') &&
            e.hardpoints.filter(h => h.kind === 'HARD_POINT_ENGINE').every(h => !h.alive)
          )
      );
    w.defenderTeam = cb.defender.team;
    return (w.retreat = new RetreatCoordinator({
      prefix: 'Space',
      campaign: !!cb && !this.setup.linkedTactical,
      time: () => w.time,
      generic: name => this.tacticalStory?.generic(name),
      players: () => w.players.filter(p => p.id >= 0),
      factionOf: p => p.factionName,
      teamOf: p => p.team,
      isLocal: p => (this.setup.net ? !!p.human : p === this.human),
      isSide: p => p.id >= 0 && sides.includes(w.teams.indexOf(p.team)),
      units: going,
      everything: p => [...w.units, ...w.squads].filter(e => e.player === p && !e.dead),
      blocker: p =>
        w.interdictors.some(i => i.team !== p.team)
          ? 3
          : w.units.some(u => !u.dead && u.player === p && hasRetreatPrevention(u.type))
            ? 4
            : w.units.some(u => !u.dead && u.player === p && isTacticalSuperweapon(u.type))
              ? 6
              : 0,
      begin: state => {
        w.retreatState = state;
        for (const e of state.list)
          for (const u of e.fighters || [e]) {
            if (u.retreatTarget === undefined) u.retreatTarget = u.targetableUnit;
            u.holdFire = true;
            u.targetableUnit = false;
            u.setOrder?.({ kind: 'idle' });
          }
      },
      cancelled: state => {
        for (const e of state.list)
          for (const u of e.fighters || [e]) {
            u.holdFire = undefined;
            u.targetableUnit = u.retreatTarget ?? u.targetableUnit;
            u.retreatTarget = undefined;
          }
        w.retreatState = null;
      },
      flightStart: (state, list) => {
        const d = w.retreatDir || { x: -1, y: 0 };
        for (const e of list)
          for (const u of e.fighters || [e]) {
            u.retreatFlight = true;
            u.heading = Math.atan2(d.y, d.x);
          }
      },
      move: (e, distance) => {
        if (e.isSquad || e.fighters) return;
        const d = w.retreatDir || { x: -1, y: 0 };
        e.x += d.x * distance;
        e.y += d.y * distance;
        e.syncObj?.();
      },
      cameraStart: (state, list) => {
        const station = state.player.station && !state.player.station.dead ? state.player.station : null,
          flyers = list.length > 0;
        if (!station && !flyers) return 0;
        const cine = (this.retreatCamera = new TacticalCinematics(this, { at: () => null, of: () => null }));
        cine.start(false);
        if (!cine.on) {
          this.retreatCamera = null;
          return flyers ? (station ? 450 : 150) : 300;
        }
        const d = w.retreatDir || { x: -1, y: 0, z: 0 },
          M = w.retreatMarker || { x: station?.x ?? 0, y: station?.y ?? 0, z: 0 };
        const q = 175.034,
          xy = Math.hypot(d.x, d.y) || 1,
          perp = d.x > 0 ? { x: d.y / xy, y: -d.x / xy } : { x: -d.y / xy, y: d.x / xy };
        const stationKey = offset => ({
          position: { x: station.x, y: station.y, z: station.z || 0 },
          offset,
          entity: station,
          rotate: false,
          last: null
        });
        cine.shots = {
          first: flyers
            ? {
                from: { x: M.x - q * d.x + 150 * perp.x, y: M.y - q * d.y + 150 * perp.y, z: M.z - q * d.z + 70 },
                target: { x: M.x + q * d.x, y: M.y + q * d.y, z: M.z + q * d.z }
              }
            : null,
          station: station ? { from: stationKey({ x: 0, y: -2000, z: 2000 }), target: stationKey({ x: 0, y: 0, z: 0 }) } : null
        };
        cine.shotNow = null;
        return flyers ? (station ? 450 : 150) : 300;
      },
      cameraFrame: frame => {
        const cine = this.retreatCamera;
        if (!cine?.on) return;
        const shot = frame >= (cine.shots.first ? 150 : 0) && cine.shots.station ? 'station' : cine.shots.first ? 'first' : 'station';
        if (cine.shotNow !== shot) {
          cine.shotNow = shot;
          const s = cine.shots[shot];
          cine.position = { from: s.from, to: null, start: 0, end: 0 };
          cine.target = { from: s.target, to: null, start: 0, end: 0 };
        }
        cine.tick = frame;
        cine.paint();
      },
      cameraEnd: () => {
        this.retreatCamera?.stop();
        this.retreatCamera = null;
      },
      released: e => {
        const u = e.fighters?.[0] || e,
          sfx = e.player?.faction?.str('SFXEvent_Exit_Into_Hyperspace').trim();
        if (sfx) game.audio.play(sfx, u.x, u.y);
      },
      explode: p => {
        const st = p.station;
        if (!st || st.dead) return;
        const blast = db.type(st.type.str('Retreat_Self_Destruct_Explosion').trim());
        if (blast) w.detonate(blast, p, st.x, st.y, (st.z || 0) + st.type.num('Ranged_Target_Z_Adjust', 0), 1, true);
        w.kill(st, null);
      },
      flightEnd: () => {
        w.retreatState = null;
      },
      remove: (e, lost) => {
        if (e.isSquad || e.fighters) {
          e.dead = true;
          if (!lost) e.retreated = true;
          return;
        }
        if (!lost) e.retreated = true;
        w.removeUnit(e);
      },
      end: enemy => this.tacticalVictory.request(enemy.team, 12, 210),
      play: (sfx, p) => {
        if (p === game.human && sfx) game.audio.play(sfx);
      },
      show: showRetreatLine
    }));
  }
  startCinematicRetreat(id, seconds) {
    const w = this.world,
      p = w.players.find(q => q.id === id);
    if (!p || !(seconds >= 0)) return;
    const wait = db.faction(p.factionName)?.num('Space_Retreat_Unit_Increment_Wait_Frames', 1) ?? 1;
    const list = [...w.units, ...w.squads].filter(
      e => e.player === p && !e.dead && !e.isStructure && !e.isPad && !e.isStation && !e.underConstruction
    );
    (this.cinematicJumps ||= []).push(...list.map((e, i) => ({ e, at: w.time + (seconds * 30 + i * wait) / 30, left: 90 })));
  }
  stepCinematicJumps(dt) {
    const jumps = this.cinematicJumps,
      w = this.world;
    if (!jumps?.length) return;
    const fast = 500;
    for (const j of jumps) {
      if (w.time < j.at || j.done) continue;
      const e = j.e;
      if (e.dead) {
        j.done = true;
        continue;
      }
      if (!j.started) {
        j.started = true;
        for (const u of e.fighters || [e]) u.retreatFlight = true;
        const sfx = e.player?.faction?.str('SFXEvent_Exit_Into_Hyperspace').trim(),
          u0 = e.fighters?.[0] || e;
        if (sfx) this.audio.play(sfx, u0.x, u0.y);
      }
      if (!e.isSquad && !e.fighters) {
        const h = e.heading || 0;
        e.x += Math.cos(h) * fast * dt * 30;
        e.y += Math.sin(h) * fast * dt * 30;
        e.syncObj?.();
      }
      j.left -= dt * 30;
      if (j.left <= 0) {
        j.done = true;
        if (e.isSquad || e.fighters) e.dead = true;
        else w.removeUnit(e);
      }
    }
    this.cinematicJumps = jumps.filter(j => !j.done);
  }

  autoResolveNow() {
    const w = this.world,
      cb = this.setup.campaign;
    if (!this.canRetreat()) return;
    const code = this.retreat.canRetreat(this.human);
    if (code) {
      const sfx = this.retreat.refusal(this.human, code);
      if (sfx) this.audio.play(sfx);
      return;
    }
    const { winner, doomed } = resolveTactical(spaceRosters(w, cb), cb, { space: true });
    for (const e of doomed) if (!e.dead) w.kill(e, null);
    const [won, lost] = winner === 0 ? [cb.attacker.team, cb.defender.team] : [cb.defender.team, cb.attacker.team];
    if (!sideBeaten(w, w.teams[lost])) this.tacticalVictory.request(w.teams[won], 12, 210);
  }

  campaignCheck() {
    const w = this.world,
      cb = this.setup.campaign;
    if (!cb || this.over || this.tacticalVictory.winner) return;
    for (const s of [cb.attacker, cb.defender]) {
      const team = w.teams[s.team];
      if (!sideBeaten(w, team)) continue;
      const other = w.teams[s === cb.attacker ? cb.defender.team : cb.attacker.team];
      this.tacticalVictory.request(other, 11, 210);
      return;
    }
  }

  campaignVictoryStep() {
    if (!this.campaignBook || this.over) return;
    const result = this.tacticalVictory.update(this.world.tacticalSuperweapons.disableDepth, () => this.campaignCheck());
    if (!result) return;
    this.world.winner = result.team;
    this.campaignOutcome = {
      ...battleResult(this.world, this.campaignBook, this.setup.campaign, result.team.id),
      ...this.tacticalCampaign?.result(this.campaignBook),
      sides: this.setup.teamFactions.slice(),
      victoryType: result.type
    };
    this.world.onEvent('gameover', { winner: result.team, ready: true });
  }

  returnToGalaxy() {
    const cb = this.setup.campaign;
    if (linkedParent(this)) {
      const result = { ...this.campaignOutcome, storyFlags: this.tacticalStory?.flags.snapshot() };
      linkedParent(this).returnLinkedTactical(result);
      return;
    }
    if (mpBattleParent()) {
      mpBattleParent().mpBattles.returned(this.campaignOutcome);
      return;
    }
    if (this.campaignOutcome && this.world.tacticalSessions) this.campaignOutcome.credits = this.tacticalCredits();
    const { galaxy, ...result } = this.campaignOutcome || {};
    stageStart({ mode: 'galactic', players: [], teamFactions: [], campaign: cb.campaignName, restore: galaxy || cb.galaxy, result });
  }

  tacticalCredits() {
    const out = {};
    for (const p of this.world.players) {
      const s = p.id >= 0 && this.world.tacticalSessions?.[p.id];
      if (!s) continue;
      const id = String(p.factionName).toUpperCase(),
        left = p.credits || 0;
      if (!s.ai) {
        out[id] = { credits: Math.max(0, left), ai: false };
        continue;
      }
      const delta = left - s.released;
      out[id] = { credits: Math.max(0, s.reserve + (delta > 0 ? delta * s.adjust : delta)), ai: true, delta, parts: s.parts };
    }
    return out;
  }

  gameOver(winner, ready = false) {
    this.over = true;
    const won = winner === this.human.team;
    const s = this.human.stats,
      t = this.world.time;
    $('menuTitle').textContent = won ? 'Victory' : 'Defeat';
    $('menuBody').innerHTML = `<p class="hint">Time ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} ·
      Built ${s.built} · Destroyed ${s.killed} · Lost ${s.lost}</p>`;
    $('resumeBtn').textContent = 'Keep watching';
    if (!this.victoryNotified) this.tacticalVictoryNotice(winner);
    setTimeout(
      () =>
        this.showSummary(won).then(shown => {
          if (!shown) this.toggleMenu();
        }),
      ready ? 0 : 2500
    );
  }

  tacticalVictoryNotice(winner, suppress = false) {
    if (this.victoryNotified) return;
    this.victoryNotified = true;
    const human = this.human,
      notice = tacticalAnnouncement(this.world, human, winner);
    if (!suppress && notice.sound) audio.play(human.faction.str(notice.sound));
    const ev = db.music.get(human.faction.str(notice.music).toUpperCase());
    if (ev) audio.setPlaylist(ev.list('Files'), true, true);
    if (!suppress && notice.text) this.superweaponHUD?.victory(notice.text, notice.ally);
  }

  showSummary(won) {
    return showSummary(this, won, this.human.team);
  }

  message(text, cls = '', color = '', life = 6000) {
    const d = document.createElement('div');
    d.textContent = text;
    d.className = cls;
    if (color) d.style.color = color;
    const box = $('messages');
    if (box.lastChild && box.lastChild.textContent === text) return;
    const wrap = document.createElement('p');
    wrap.style.margin = '0';
    wrap.appendChild(d);
    box.appendChild(wrap);
    while (box.childElementCount > 5) box.firstChild.remove();
    setTimeout(() => wrap.remove(), life);
  }

  setMusic(mode, fade = false) {
    const m = this.music,
      list = m[mode] && m[mode].length ? m[mode] : m.battle.length ? m.battle : m.ambient;
    if (m.mode === mode || !list.length) return;
    m.mode = mode;
    audio.setPlaylist(list, fade);
  }

  updateMusic() {
    const m = this.music,
      w = this.world;
    if (!m || this.over || this.victoryNotified || this.setup.attract || w.tacticalSuperweapons?.disableDepth) return;
    const fought = w.lastViewerCombat ?? -1e9;
    if (m.mode !== 'battle' && fought > (m.seen ?? -1e9)) this.setMusic('battle', true);
    else if (m.mode === 'battle' && w.time - fought >= m.peace) this.setMusic('ambient', true);
    m.seen = fought;
  }

  updateSpotted() {
    const w = this.world,
      me = this.human;
    if (this.over || this.setup.attract || this.setup.benchmark || w.time < (this.spotCheck ?? 0)) return;
    this.spotCheck = w.time + 0.5;
    if (!this.spotLines) {
      this.spotLines = new Map();
      for (const [name, ev] of me.faction.tuples('SFXEvent_Unit_Type_Spotted')) {
        const t = db.type(name);
        if (!t || !ev) continue;
        this.spotLines.set(t.name.toUpperCase(), ev);
        const ship = db.type(t.str('Unique_Space_Unit'));
        if (ship) this.spotLines.set(ship.name.toUpperCase(), ev);
      }
    }
    for (const u of w.units) {
      if (u.dead || u.hyper || u.spotted || u.player.id < 0 || u.player.team === me.team) continue;
      const ev = this.spotLines.get(u.type.name.toUpperCase());
      if (!ev || (w.fog && !w.canSee(me, u))) continue;
      u.spotted = true;
      audio.playFor(me, ev);
    }
  }

  togglePause() {
    if (this.lock) this.lock.togglePause();
    else this.paused = !this.paused;
  }
  setEnvironmentIndex(n) {
    const envs = this.map?.environments || [];
    if (!envs.length) return;
    const i = Math.max(0, Math.min(envs.length - 1, n | 0));
    this.map.environment = envs[i];
    this.map.activeEnvironment = i;
    this.renderer.setEnvironment(envs[i]);
  }
  setSpeed(s) {
    if (this.lock) {
      if (s !== this.speed) this.lock.setSpeed(s);
    } else this.speed = s;
  }

  command(cmd) {
    if (this.spectator) {
      this.message('You are watching this battle.', 'bad');
      return null;
    }
    if (this.lock) {
      this.lock.command(cmd);
      return null;
    }
    if (this.mirror) {
      this.mirror.command(cmd);
      return null;
    }
    const r = execute(this.world, this.human, cmd);
    this.commandResult(cmd, r);
    return r;
  }

  stepAIs() {
    const ais = this.ais,
      n = ais.length,
      G = this.world.goals;
    if (!n) return;
    const first = (this.aiTurn = ((this.aiTurn || 0) + 1) % n);
    if (G) {
      if (this.lock) G.budget = AI_STEP_WORK;
      else G.deadline = performance.now() + AI_STEP_MS;
    }
    try {
      for (let i = 0; i < n; i++) ais[(first + i) % n].update(TICK);
    } finally {
      if (G) {
        G.deadline = undefined;
        G.budget = undefined;
      }
    }
  }

  commandResult(cmd, r) {
    if (r.why) {
      if (cmd.c === 'build' || cmd.c === 'ability' || cmd.c === 'reinforce' || cmd.c === 'special') {
        this.message(r.why, 'bad');
        this.audio.play('GUI_Bad_Sound');
      }
      if (cmd.c === 'build' && /population cap/i.test(r.why)) this.audio.play(this.human.faction.str('SFXEvent_Tactical_Pop_Cap_Reached'));
    }
  }

  beaconReady() {
    const me = this.human,
      w = this.world;
    return !!this.lock && !!me && !!beaconType(me.faction) && (!w.beacons || w.beacons.ready(me, w.time));
  }

  async openChat() {
    if (this.chatDlg) {
      this.chatDlg.edit('IDC_IME_EDITBOX')?.focus();
      return;
    }
    if (this.chatOpening) return;
    this.chatOpening = true;
    const dlg = await openDialog('IDD_INGAME_CHAT_DIALOG', { modal: false }).catch(() => null);
    this.chatOpening = false;
    if (!dlg) return;
    this.chatDlg = dlg;
    let team = !!this.chatTeam;
    dlg.check('IDC_TEAM_MEMBERS_ONLY', team, v => {
      team = this.chatTeam = v;
      box?.focus();
    });
    const box = dlg.edit('IDC_IME_EDITBOX');
    const close = () => {
      dlg.close();
      this.chatDlg = null;
    };
    if (!box) {
      close();
      return;
    }
    box.maxLength = CHAT_MAX;
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (box.value.trim()) this.audio.play('GUI_Common_Chat_Send');
        this.lock?.say(box.value, team);
        close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    box.focus();
  }

  chatLine(from, text, team, mine) {
    if (!from) return;
    this.message(chatText(from, text, team), 'chat', '#' + from.color.getHexString());
    if (!mine) this.audio.play('GUI_Common_Chat_Receive');
  }

  takeOver(p) {
    const pre = this.takeovers?.get(p);
    if (!pre?.brain || p.defeated) return false;
    p.human = false;
    p.difficulty = 'medium';
    const ai = new SkirmishAI(this.world, p, 'medium', pre.brain);
    this.ais.push(ai);
    if (this.scripts && pre.fs?.space) this.scripts.freeStore(p, pre.fs.space, () => ai.mine().filter(e => !e.aiPlan), ai);
    return true;
  }

  async prepareLockstep() {
    progress('Preparing the battle', 1);
    const humans = this.world.players.filter(p => p.human);
    this.takeovers = new Map(
      await Promise.all(
        humans.map(async p => [
          p,
          {
            brain: await loadSpaceBrain(p.factionName).catch(() => null),
            fs: await aiFreeStore(p.factionName).catch(() => null)
          }
        ])
      )
    );
    await Promise.all([
      this.world.paths.deterministic(),
      this.scripts ? this.scripts.preloadAll() : null,
      ...this.ais.map(ai => ai.brainReady),
      ...(this.freeStores || [])
    ]);
    this.speed = 1;
    this.lock = new Lockstep(this, this.setup.net);
    progress('Waiting for the other players', 1);
    await this.lock.ready();
    if (window.autofireDefault) this.command({ c: 'autofire', on: true });
    this.missTicker = ticker(TICK * 1000, () => this.missedFrame());
  }
  setLanguage(language) {
    return switchLanguage(language);
  }
  async showLoading(map) {
    if (this.setup.attract) return;
    const dlg = await showLoadScreen({ setup: this.setup, map, land: false, staged: true });
    if (dlg) hideSplash();
  }

  async endLoading() {
    window.loadLog?.push([Math.round(performance.now()), 'Loaded', diag.preloaded]);
    const direct = this.setup.benchmark || this.setup.restore || this.setup.direct || this.setup.net;
    await endLoadScreen({
      direct,
      hold: on => {
        this.paused = on;
      },
      unlock: () => audio.unlock()
    });
  }

  touchView(dx, dy, turn) {
    this.ui?.touchView(dx, dy, turn);
  }

  toggleMenu() {
    this.menus.toggle().then(ok => {
      if (!ok) this.plainMenu();
    });
  }

  plainMenu() {
    const m = $('menu');
    const open = m.classList.toggle('hidden') === false;
    if (!this.over) {
      this.paused = open;
      $('menuTitle').textContent = 'Paused';
      $('menuBody').innerHTML = '';
      $('resumeBtn').textContent = 'Resume';
    }
  }

  remember() {
    const w = this.world;
    for (const u of w.units) {
      if (u.dead) continue;
      const roll = u.roll || 0;
      if (u.cx === undefined) {
        u.px = u.x;
        u.py = u.y;
        u.pz = u.z;
        u.ph = u.heading;
        u.pr = roll;
      } else {
        u.px = u.cx;
        u.py = u.cy;
        u.pz = u.cz;
        u.ph = u.ch;
        u.pr = u.cr;
      }
      u.cx = u.x;
      u.cy = u.y;
      u.cz = u.z;
      u.ch = u.heading;
      u.cr = roll;
      if (u.isFighter) {
        const pitch = u.pitch || 0;
        u.pp = u.cp ?? pitch;
        u.cp = pitch;
        if (u.flip) {
          u.flip = false;
          u.ph += u.ph > 0 ? -Math.PI : Math.PI;
          u.pp = (u.pp < 0 ? -Math.PI : Math.PI) - u.pp;
          u.pr += u.pr > 0 ? -Math.PI : Math.PI;
        }
      }
    }
    for (const q of w.squads) {
      if (q.dead) continue;
      if (q.cx === undefined) {
        q.px = q.x;
        q.py = q.y;
      } else {
        q.px = q.cx;
        q.py = q.cy;
      }
      q.cx = q.x;
      q.cy = q.y;
    }
    for (const p of w.projectiles) {
      if (p.cx === undefined) {
        p.px = p.x;
        p.py = p.y;
        p.pz = p.z;
        p.pa = p.age;
      } else {
        p.px = p.cx;
        p.py = p.cy;
        p.pz = p.cz;
        p.pa = p.ca;
      }
      p.cx = p.x;
      p.cy = p.y;
      p.cz = p.z;
      p.ca = p.age;
    }
  }

  present(k) {
    const w = this.world;
    const su = this.shownUnits || (this.shownUnits = []),
      sq = this.shownSquads || (this.shownSquads = []),
      sp = this.shownShots || (this.shownShots = []);
    su.length = 0;
    sq.length = 0;
    sp.length = 0;
    const units = w.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead || u.cx === undefined) continue;
      const cx = u.cx,
        cy = u.cy,
        cz = u.cz,
        ch = u.ch,
        cr = u.cr,
        px = u.px,
        py = u.py,
        pz = u.pz,
        ph = u.ph,
        pr = u.pr;
      if (
        px === cx &&
        py === cy &&
        pz === cz &&
        ph === ch &&
        pr === cr &&
        cx === u.x &&
        cy === u.y &&
        cz === u.z &&
        ch === u.heading &&
        cr === (u.roll || 0)
      ) {
        if (u.wasShown) {
          u.wasShown = false;
          u.syncObj();
        }
        continue;
      }
      u.tx = u.x;
      u.ty = u.y;
      u.tz = u.z;
      u.th = u.heading;
      u.tr = u.roll;
      let dh = ch - ph;
      if (dh > Math.PI) dh -= 2 * Math.PI;
      else if (dh < -Math.PI) dh += 2 * Math.PI;
      const x = (u.x = u.ix = px + (cx - px) * k),
        y = (u.y = u.iy = py + (cy - py) * k),
        z = (u.z = u.iz = pz + (cz - pz) * k);
      const h = (u.heading = u.ih = ph + dh * k),
        roll = (u.roll = u.ir = pr + (cr - pr) * k);
      const o = u.obj,
        e = o.matrix.elements,
        s = o.scale.x,
        a = h + Math.PI / 2,
        ca = Math.cos(a) * s,
        sa = Math.sin(a) * s;
      o.position.set(x, y, z);
      if (roll) {
        const cro = Math.cos(roll),
          sro = Math.sin(roll);
        e[0] = ca * cro;
        e[1] = sa * cro;
        e[2] = -sro * s;
        e[8] = ca * sro;
        e[9] = sa * sro;
        e[10] = cro * s;
      } else {
        e[0] = ca;
        e[1] = sa;
        e[2] = 0;
        e[8] = 0;
        e[9] = 0;
        e[10] = s;
      }
      e[4] = -sa;
      e[5] = ca;
      e[6] = 0;
      e[12] = x;
      e[13] = y;
      e[14] = z;
      if (u.cp || u.pp) {
        u.tp = u.pitch;
        u.pitch = u.pp + (u.cp - u.pp) * k;
        u.syncObj();
        u.pitched = true;
      }
      u.wasShown = true;
      su.push(u);
    }
    for (const q of w.squads) {
      if (q.dead || q.cx === undefined || (q.px === q.cx && q.py === q.cy && q.cx === q.x && q.cy === q.y)) continue;
      q.tx = q.x;
      q.ty = q.y;
      q.x = q.ix = q.px + (q.cx - q.px) * k;
      q.y = q.iy = q.py + (q.cy - q.py) * k;
      sq.push(q);
    }
    const shots = w.projectiles;
    for (let i = 0; i < shots.length; i++) {
      const p = shots[i];
      if (p.dead || p.cx === undefined) continue;
      p.tx = p.x;
      p.ty = p.y;
      p.tz = p.z;
      p.ta = p.age;
      p.x = p.px + (p.cx - p.px) * k;
      p.y = p.py + (p.cy - p.py) * k;
      p.z = p.pz + (p.cz - p.pz) * k;
      if (p.ca !== undefined && p.pa !== undefined) p.age = p.pa + (p.ca - p.pa) * k;
      sp.push(p);
    }
  }

  settle() {
    const su = this.shownUnits,
      sq = this.shownSquads,
      sp = this.shownShots;
    if (!su) return;
    for (let i = 0; i < su.length; i++) {
      const u = su[i];
      if (u.x === u.ix) u.x = u.tx;
      if (u.y === u.iy) u.y = u.ty;
      if (u.z === u.iz) u.z = u.tz;
      if (u.heading === u.ih) u.heading = u.th;
      if (u.roll === u.ir) u.roll = u.tr;
      if (u.pitched) {
        u.pitch = u.tp;
        u.pitched = false;
      }
    }
    for (const q of sq) {
      if (q.x === q.ix) q.x = q.tx;
      if (q.y === q.iy) q.y = q.ty;
    }
    for (let i = 0; i < sp.length; i++) {
      const p = sp[i];
      p.x = p.tx;
      p.y = p.ty;
      p.z = p.tz;
      p.age = p.ta;
    }
    su.length = 0;
    sq.length = 0;
    sp.length = 0;
  }

  missedFrame() {
    if (this.over) {
      this.missTicker.stop();
      return;
    }
    const now = performance.now();
    if (!document.hidden && now - this.last < 3 * TICK * 1000) return;
    const real = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.lockFrame(real);
  }

  lockFrame(real) {
    const w = this.world,
      lock = this.lock;
    this.settle();
    const behind = lock.behind();
    if (this.paused) this.owed = 0;
    this.owed = Math.min((this.owed || 0) + (this.paused ? 0 : real * this.speed), (4 + behind * TURN) * TICK);
    if (behind > 1) this.owed = Math.max(this.owed, Math.min(behind, 3) * TICK);
    const t0 = performance.now();
    for (;;) {
      if (!this.midStep) {
        if (!w.paths.ready() || this.artHeld() || !lock.step()) break;
        if (this.paused) {
          this.owed = 0;
          break;
        }
        w.updateBegin(TICK);
        this.midStep = true;
      }
      if (this.owed < TICK) {
        if (!this.paused) w.updateSome(Math.ceil(w.units.length * Math.min(1, (this.owed + real * this.speed) / TICK)));
        break;
      }
      w.updateSome(Infinity);
      w.updateEnd();
      this.midStep = false;
      diag.lap('logic');
      if (!w.aiSuspended) this.stepAIs();
      if (this.scripts) this.scripts.update(TICK);
      if (this.advisor) this.advisor.update(TICK);
      this.campaignVictoryStep();
      this.retreat?.step(TICK);
      this.stepCinematicJumps(TICK);
      diag.lap('ai');
      this.remember();
      lock.stepped();
      this.owed -= TICK;
    }
    lock.frame(
      this.owed / TICK,
      1,
      !w.paths.ready() ? 'route planning' : this.artHolds?.size ? 'loading art' : null,
      performance.now() - t0
    );
    if (lock.started && !this.paused && this.owed >= TICK) {
      if ((this.stalled = (this.stalled || 0) + real) > 2 && !this.stallSaid) {
        this.stallSaid = true;
        const who = w.paths.ready() ? lock.waitingFor() : [];
        this.message(who.length ? `Waiting for ${who.join(', ')}…` : 'Waiting…', 'bad');
      }
    } else {
      this.stalled = 0;
      this.stallSaid = false;
    }
    this.present(lock.started ? Math.min(1, this.owed / TICK) : 0);
    diag.lap('logic');
  }

  frame(now) {
    if (this.modeSuspended) return;
    requestAnimationFrame(this.frame);
    diag.begin(now);
    const real = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    if (this.bench) this.bench.tick(now - this.last, now);
    this.last = now;
    if (this.mirror) {
      this.mirror.frame(real);
      diag.lap('logic');
    } else if (this.lock) this.lockFrame(real);
    else if (!this.paused && !this.tacticalMovies?.pausesMode) {
      const w = this.world;
      this.settle();
      this.owed = Math.min((this.owed || 0) + real * this.speed, 4 * TICK);
      for (;;) {
        if (!this.midStep) {
          w.updateBegin(TICK);
          this.midStep = true;
        }
        if (this.owed >= TICK) {
          w.updateSome(Infinity);
          w.updateEnd();
          diag.lap('logic');
          if (!w.aiSuspended) this.stepAIs();
          if (this.scripts) this.scripts.update(TICK);
          if (this.advisor) this.advisor.update(TICK);
          this.campaignVictoryStep();
          this.retreat?.step(TICK);
          this.stepCinematicJumps(TICK);
          diag.lap('ai');
          this.remember();
          this.midStep = false;
          this.owed -= TICK;
          continue;
        }
        w.updateSome(Math.ceil(w.units.length * Math.min(1, (this.owed + real * this.speed) / TICK)));
        break;
      }
      this.present(this.owed / TICK);
      diag.lap('logic');
    }
    const storyDelta = this.paused || this.tacticalMovies?.pausesMode ? 0 : real * this.speed;
    this.scripts?.updateStory(storyDelta);
    this.tacticalCinematics?.update(storyDelta);
    this.tacticalMovies?.update(real, !!this.paused || !!this.menus?.open);
    this.tacticalStory?.update();
    stepTacticalSpeech(this, real);
    if (this.tutorialFx || this.dualFlash) {
      stepDualFlash(this, real);
      this.tutorialFx?.update(real);
    }
    this.linkedPresentation?.update(real, !!this.menus?.open);
    this.linkedPresentation?.paint();
    this.ui.update(real);
    this.superweaponHUD?.update(real);
    diag.lap('hud');
    const rig = this.renderer.rig;
    const cine = this.cine;
    this.updateMusic();
    this.updateSpotted();
    if (cine.on && cine.lookX !== undefined) {
      audio.listener.x = cine.lookX;
      audio.listener.y = cine.lookY;
      audio.listener.dist = Math.max(300, cine.camDist);
    } else {
      audio.listener.x = rig.x;
      audio.listener.y = rig.y;
      audio.listener.dist = rig.dist;
    }
    {
      const c = this.renderer.camera.position;
      audio.listener.cx = c.x;
      audio.listener.cy = c.y;
      audio.listener.cz = c.z;
    }
    if ((this.loopTimer = (this.loopTimer || 0) - real) <= 0) {
      this.loopTimer = 0.2;
      const em = this.paused ? [] : this.world.loopEmitters(this.emitters || (this.emitters = []));
      const star = cine.on && cine.subject && !cine.subject.dead ? cine.subject : null;
      const focus = star && star.type.str('SFXEvent_Engine_Cinematic_Focus_Loop');
      if (focus && !this.paused) em.push({ id: 'cine', event: focus, x: audio.listener.x, y: audio.listener.y });
      audio.setLoops(em);
    }
    diag.lap('sound');
    this.renderer.render(this.world, this.paused ? 0 : real * this.speed, g => this.ui.drawOverlay(g));
    diag.end();
  }
}

async function boot() {
  await startServiceWorker();
  const build = await ensureCurrentBuild();
  try {
    sessionStorage.removeItem('swr-relinked');
  } catch {}
  const tag = document.createElement('div');
  tag.id = 'buildTag';
  tag.textContent = 'build ' + build;
  document.body.appendChild(tag);
  if (!(await fromInstall()) && !(await assetsAvailable())) {
    hideSplash();
    progress('No game data found in this browser.');
    $('needData').classList.remove('hidden');
    return;
  }
  try {
    await loadGameData(progress);
    new Pointers(document.documentElement).set('POINTER_NORMAL');
    progress('Loading interface', 1);
    await loadIcons();
  } catch (e) {
    hideSplash();
    progress('Failed to load game data: ' + e.message);
    console.error(e);
    return;
  }
  FACTIONS.push(...skirmishFactions());
  if (!FACTIONS.length) {
    hideSplash();
    progress('This game data has no faction that can be played in a skirmish.');
    return;
  }
  const { space: maps, land: landMaps, custom: customMaps } = await skirmishMaps();
  const anyMap = m => [maps, landMaps, customMaps.space, customMaps.land].some(l => l.includes(m));
  const launch = setup =>
    setup.mode === 'galactic' && setup.net && !galaxyFrameSetup()
      ? (startGalaxyFrame(setup), Promise.resolve())
      : (autoColors(setup.players, setup.teamFactions, SLOT_COLORS),
        setup.mode === 'land'
          ? new LandGame(setup, { audio, progress })
          : setup.mode === 'galactic'
            ? new GalacticGame(setup, { audio, progress })
            : new Game({ benchmark: 0, ...setup }))
          .start()
          .catch(e => {
            console.error(e);
            if (setup.linkedTactical && window.parent !== window) window.parent.game?.abortLinkedTactical(e.message);
            else showMessage('Failed to start: ' + e.message);
          });
  const leaveFor = mode => {
    if (window.game) endGame(mode || 'space');
  };
  const sel = $('pickMap');
  for (const m of maps) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = mapTitle(m);
    sel.appendChild(o);
  }
  const params = new URLSearchParams(location.search);
  const pref = maps.find(m => m.toUpperCase().includes((params.get('map') || 'KUAT').toUpperCase()));
  if (pref) sel.value = pref;
  const label = f => db.t(db.faction(f).str('Text_ID')) || f;
  const other = f => FACTIONS.find(x => x !== f);
  const named = n => FACTIONS.find(f => f.toUpperCase() === (n || '').toUpperCase());
  const myFaction = named(params.get('faction')) || named('Empire') || FACTIONS[0];
  const foeFaction =
    named(params.get('enemy')) || (myFaction !== named('Rebel') && named('Rebel')) || FACTIONS.find(f => f !== myFaction) || myFaction;
  const getTeam1 = choices(
    $('pickTeam1'),
    FACTIONS.map(f => [f, label(f)]),
    myFaction
  );
  const getTeam2 = choices(
    $('pickTeam2'),
    FACTIONS.map(f => [f, label(f)]),
    foeFaction
  );
  const getCredits = choices(
    $('pickCredits'),
    [
      [2000, '2,000'],
      [4000, '4,000'],
      [6000, '6,000'],
      [8000, '8,000'],
      [15000, '15,000']
    ],
    +(params.get('credits') || 6000)
  );
  const getPop = choices(
    $('pickPop'),
    [
      [0, 'Default'],
      [20, '20'],
      [30, '30'],
      [50, '50'],
      [100, '100'],
      [200, '200'],
      [300, '300'],
      [500, '500'],
      [1000, '1000'],
      [2000, '2000'],
      [5000, '5000'],
      [9999, '9999']
    ],
    +(params.get('popcap') || 0)
  );
  const getFog = choices(
    $('pickFog'),
    [
      [true, 'On'],
      [false, 'Off']
    ],
    params.get('fog') !== '0'
  );

  const PALETTE = SLOT_COLORS;
  const MAX_PLAYERS = MAX_SLOTS;
  const players = [{ human: true, team: 0, color: PALETTE[0], auto: true }];
  const addBot = (team, difficulty = params.get('difficulty') || 'medium') => {
    if (players.length >= MAX_PLAYERS) return;
    const color = PALETTE.find(c => !players.some(p => p.color === c)) || PALETTE[players.length % PALETTE.length];
    players.push({ human: false, team, difficulty, color, auto: true });
  };
  addBot(1);
  for (let i = 0; i < +(params.get('allies') || 0); i++) addBot(0);
  for (let i = 1; i < +(params.get('enemies') || 1); i++) addBot(1);
  const list = $('players');
  const select = (options, value, onChange) => {
    const s = document.createElement('select');
    for (const [v, text] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = text;
      s.appendChild(o);
    }
    s.value = value;
    s.onchange = () => onChange(s.value);
    return s;
  };
  const renderPlayers = () => {
    list.replaceChildren();
    let bot = 0;
    for (const p of players) {
      const row = document.createElement('div');
      row.className = 'player';
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p.human ? 'You' : `Bot ${++bot}`;
      const team = select(
        [
          [0, 'Team 1'],
          [1, 'Team 2']
        ],
        p.team,
        v => {
          p.team = +v;
        }
      );
      const diff = p.human
        ? document.createElement('span')
        : select(
            [
              ['easy', 'Easy'],
              ['medium', 'Medium'],
              ['hard', 'Hard']
            ],
            p.difficulty,
            v => {
              p.difficulty = v;
            }
          );
      if (p.human) {
        diff.className = 'pdiff';
        diff.textContent = 'Player';
      }
      const color = document.createElement('input');
      color.type = 'color';
      color.value = p.color;
      color.oninput = () => {
        p.color = color.value;
      };
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'Remove';
      del.className = 'del';
      if (p.human) del.style.visibility = 'hidden';
      del.onclick = () => {
        players.splice(players.indexOf(p), 1);
        renderPlayers();
      };
      row.append(name, team, diff, color, del);
      list.appendChild(row);
    }
    $('addBot').disabled = players.length >= MAX_PLAYERS;
    $('lobbyError').textContent = '';
  };
  $('addBot').onclick = () => {
    const n0 = players.filter(p => p.team === 0).length;
    addBot(n0 <= players.length - n0 ? 0 : 1);
    renderPlayers();
  };
  renderPlayers();

  const startFromSave = snap => {
    const why = validate(snap);
    if (why) {
      alert(why);
      return;
    }
    if (!snap.campaign && snap.mode !== 'galactic' && !anyMap(snap.setup.mapFile)) {
      alert('This save is on a map that is not in your game data.');
      return;
    }
    audio.unlock();
    leaveFor(snap.mode === 'galactic' ? 'galactic' : snap.campaign ? snap.campaign.setup.mode : snap.mode);
    if (snap.mode === 'galactic') {
      new GalacticGame({ ...snap.setup, restore: snap.galaxy }, { audio, progress }).start().catch(e => {
        console.error(e);
        showMessage('Failed to load the save: ' + e.message);
      });
      return;
    }
    if (snap.campaign) {
      launch({ ...snap.campaign.setup, restore: snap }).catch?.(e => {
        console.error(e);
        showMessage('Failed to load the save: ' + e.message);
      });
      return;
    }
    if (snap.mode === 'land') {
      launch({ ...snap.setup, mode: 'land', players: snap.setup.players.map(p => ({ ...p })), restore: snap });
      return;
    }
    new Game({ ...snap.setup, players: snap.setup.players.map(p => ({ ...p })), restore: snap }).start().catch(e => {
      console.error(e);
      showMessage('Failed to load the save: ' + e.message);
    });
  };
  const loadSave = async id => {
    if (window.game?.setup?.net) {
      try {
        sessionStorage.setItem('swr-load', id);
      } catch {}
      leaveTo(location.pathname);
      return;
    }
    const snap = await getSave(id);
    if (snap) startFromSave(snap);
    else alert('That save could not be read.');
  };
  const fmtWhen = iso => {
    try {
      return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return '';
    }
  };
  const renderSaves = async () => {
    const saves = (await listSaves()).filter(s => !s.mp);
    for (const box of document.querySelectorAll('.savelist')) {
      box.replaceChildren();
      if (!saves.length) {
        const e = document.createElement('p');
        e.className = 'hint';
        e.textContent = 'No saved games yet.';
        box.appendChild(e);
        continue;
      }
      for (const sv of saves) {
        const row = document.createElement('div');
        row.className = 'saverow';
        const info = document.createElement('div');
        info.className = 'saveinfo';
        const t = document.createElement('b');
        t.textContent = sv.name;
        const d = document.createElement('span');
        d.textContent = `${(sv.summary.factions || []).join(' vs ')} · ${fmtWhen(sv.saved)}`;
        info.append(t, d);
        const btn = (label, title, fn) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.title = title;
          b.onclick = fn;
          return b;
        };
        row.append(
          info,
          btn('Load', 'Load this game', () => loadSave(sv.id)),
          btn('Download', 'Save it as a file on this computer', async () => {
            const snap = await getSave(sv.id);
            if (snap) downloadSave(snap);
          }),
          btn('✕', 'Delete this save', async () => {
            if (confirm(`Delete "${sv.name}"?`)) {
              await deleteSave(sv.id);
              renderSaves();
            }
          })
        );
        box.appendChild(row);
      }
    }
  };
  const saveStatus = (text, cls = '') => {
    for (const e of document.querySelectorAll('.savestatus')) {
      e.textContent = text;
      e.className = 'savestatus hint ' + cls;
    }
  };
  $('saveNow').onclick = async () => {
    const g = window.game;
    if (!g || g.over) {
      saveStatus('There is no battle in progress to save.', 'bad');
      return;
    }
    try {
      await putSave(await snapshotNow(g));
      saveStatus('Game saved.', 'good');
      renderSaves();
    } catch (e) {
      console.error(e);
      saveStatus('Could not save: ' + e.message, 'bad');
    }
  };
  for (const input of document.querySelectorAll('.saveimport')) {
    input.onchange = async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      try {
        const { snap } = await importSaveFile(file);
        saveStatus(`Imported "${snap.name}".`, 'good');
        renderSaves();
      } catch (e) {
        saveStatus(e.message, 'bad');
      }
    };
  }
  renderSaves();

  const go = () => {
    if (![0, 1].every(t => players.some(p => p.team === t))) {
      $('lobbyError').textContent = 'Each team needs at least one player.';
      return;
    }
    audio.unlock();
    if (params.get('mode') === 'galactic') {
      new GalacticGame(
        { campaign: params.get('campaign') || 'Sandbox_Equal_Footing_Empire', faction: params.get('faction') },
        { audio, progress }
      )
        .start()
        .catch(e => {
          console.error(e);
          showMessage('Failed to start: ' + e.message);
        });
      return;
    }
    if (params.get('mode') === 'land' && landMaps.length) {
      const want = (params.get('map') || 'TATOOINE').toUpperCase();
      const all = players.map(p => ({ ...p }));
      for (let i = 0, n = Math.min(6, +params.get('bots') || 0); i < n; i++)
        all.push({
          human: false,
          team: i % 2,
          difficulty: 'normal',
          color: ['#3aa0ff', '#ff8a2a', '#b46cff', '#35d0c0', '#d0d050', '#c0c0c0'][i]
        });
      const lbench = params.has('benchmark') ? Math.max(1, Math.min(200, +params.get('benchmark') || 30)) : 0;
      const lmp = params.has('mptest')
        ? { net: { session: { on: () => () => {}, send() {}, broadcast() {} }, me: 0 }, seed: +params.get('mptest') || 1 }
        : {};
      if (lmp.net)
        all.forEach(p => {
          if (p.human) Object.assign(p, { peer: 0, name: 'Test' });
        });
      launch({
        ...lmp,
        mode: 'land',
        benchmark: lbench,
        direct: true,
        preBuilt: params.get('prebuilt') !== '0',
        mapFile: landMaps.find(m => m.toUpperCase().includes(want)) || landMaps[0],
        credits: getCredits(),
        popCap: lbench ? 9999 : getPop(),
        fog: lbench ? false : getFog(),
        teamFactions: [getTeam1(), getTeam2()],
        players: all
      });
      return;
    }
    const bench = params.has('benchmark') ? Math.max(1, Math.min(400, +params.get('benchmark') || 100)) : 0;
    const benchSpacing = params.has('spacing') ? Math.max(20, +params.get('spacing') || 230) : 0;
    const mptest = params.has('mptest') ? { session: { on: () => () => {}, send() {}, broadcast() {} }, me: 0 } : null;
    new Game({
      ...(mptest ? { net: mptest, seed: +params.get('mptest') || 1 } : {}),
      benchmark: bench,
      benchSpacing,
      benchPads: params.has('padfleet'),
      direct: true,
      mapFile: sel.value,
      credits: getCredits(),
      popCap: bench ? 9999 : getPop(),
      fog: bench ? false : getFog(),
      teamFactions: [getTeam1(), getTeam2()],
      players: players.map(p => ({ ...p, ...(mptest && p.human ? { peer: 0, name: 'Test' } : {}) }))
    })
      .start()
      .catch(e => {
        console.error(e);
        showMessage('Failed to start: ' + e.message);
      });
  };
  $('startBtn').onclick = go;
  hudButtons();
  $('resumeBtn').onclick = () => window.game?.plainMenu();
  $('quitBtn').onclick = () => toMainMenu();
  $('musicVol').value = audio.musicVolume;
  $('sfxVol').value = audio.sfxVolume;
  $('musicVol').oninput = e => audio.setMusicVolume(+e.target.value);
  $('sfxVol').oninput = e => {
    audio.sfxVolume = +e.target.value;
  };
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem('swr-volume') || '{}');
    } catch {
      return {};
    }
  })();
  if (saved.music !== undefined) {
    audio.setMusicVolume(saved.music);
    $('musicVol').value = saved.music;
  }
  if (saved.sfx !== undefined) {
    audio.sfxVolume = saved.sfx;
    $('sfxVol').value = saved.sfx;
  }
  if (saved.voice !== undefined) audio.voiceVolume = saved.voice;
  try {
    const m = parseFloat(localStorage.getItem('swr-master'));
    if (Number.isFinite(m)) audio.setMasterVolume(m);
  } catch {}
  $('voiceVol').value = audio.voiceVolume;
  $('voiceVol').oninput = e => {
    audio.voiceVolume = +e.target.value;
  };
  const store = () => {
    try {
      localStorage.setItem('swr-volume', JSON.stringify({ music: audio.musicVolume, sfx: audio.sfxVolume, voice: audio.voiceVolume }));
    } catch {}
  };
  for (const id of ['musicVol', 'sfxVol', 'voiceVol']) $(id).addEventListener('change', store);
  const GFX = { Shadows: 'shadows', Bloom: 'bloom', Heat: 'heat', Flare: 'flare' };
  {
    const box = $('optCaptureBars');
    let on = false;
    try {
      on = localStorage.getItem('swr-capturebars') === '1';
    } catch {}
    box.checked = on;
    window.showCaptureBars = on;
    box.parentElement.title = 'A bar over a structure being captured shows how far along the capture is.';
    box.onchange = () => {
      window.showCaptureBars = box.checked;
      try {
        localStorage.setItem('swr-capturebars', box.checked ? '1' : '0');
      } catch {}
    };
  }
  {
    const box = $('optAllUnitIcons');
    let on = false;
    try {
      on = localStorage.getItem('swr-alluniticons') === '1';
    } catch {}
    box.checked = on;
    window.showAllUnitIcons = on;
    box.parentElement.title = 'Every unit carries its icon over it, not only squadrons and heroes.';
    box.onchange = () => {
      window.showAllUnitIcons = box.checked;
      try {
        localStorage.setItem('swr-alluniticons', box.checked ? '1' : '0');
      } catch {}
    };
  }
  {
    const box = $('optMultiPlace');
    let on = true;
    try {
      on = localStorage.getItem('swr-multiplace') !== '0';
    } catch {}
    box.checked = on;
    window.multiPlace = on;
    box.parentElement.title =
      'A click on the reinforcement window adds the unit to a hand at the cursor, to call several in together. Off: one at a time.';
    box.onchange = () => {
      window.multiPlace = box.checked;
      try {
        localStorage.setItem('swr-multiplace', box.checked ? '1' : '0');
      } catch {}
    };
  }
  {
    const box = $('optReinforceTurn');
    let on = true;
    try {
      on = localStorage.getItem('swr-reinforce-turn') !== '0';
    } catch {}
    box.checked = on;
    window.reinforceTurn = on;
    box.parentElement.title =
      'While placing reinforcements, the mouse wheel turns them and dragging a line sets the way they face. Off: they face the default way.';
    box.onchange = () => {
      window.reinforceTurn = box.checked;
      try {
        localStorage.setItem('swr-reinforce-turn', box.checked ? '1' : '0');
      } catch {}
    };
  }
  {
    const box = $('optLineMove');
    let on = true;
    try {
      on = localStorage.getItem('swr-line-move') !== '0';
    } catch {}
    box.checked = on;
    window.lineMove = on;
    box.parentElement.title =
      'With several units selected, hold the right mouse button and drag to lay them out along a line, facing across it; the wheel changes which kinds go in front.';
    box.onchange = () => {
      window.lineMove = box.checked;
      try {
        localStorage.setItem('swr-line-move', box.checked ? '1' : '0');
      } catch {}
    };
  }
  {
    const box = $('optDirectControl');
    let on = false;
    try {
      on = localStorage.getItem('swr-direct') === '1';
    } catch {}
    box.checked = on;
    window.directControl = on;
    box.parentElement.title =
      'Select one of your units and press V (Direct Control in the keyboard options) to steer it with W A S D and fire with the left mouse button at what is under the cursor; V or Escape gives it back. Not in multiplayer.';
    box.onchange = () => {
      window.directControl = box.checked;
      try {
        localStorage.setItem('swr-direct', box.checked ? '1' : '0');
      } catch {}
      if (!box.checked) {
        window.game?.releaseDirect?.();
        window.game?.ui?.releaseDirect?.();
      }
    };
  }
  {
    const box = $('optAutofire');
    let on = true;
    try {
      const saved = localStorage.getItem('swr-autofire');
      if (saved !== null) on = saved === '1';
    } catch {}
    box.checked = on;
    window.autofireDefault = on;
    box.parentElement.title = 'The abilities of units will be activated automatically.';
    box.onchange = () => {
      window.autofireDefault = box.checked;
      try {
        localStorage.setItem('swr-autofire', box.checked ? '1' : '0');
      } catch {}
      if (window.game?.lock) {
        window.game.command({ c: 'autofire', on: box.checked });
        return;
      }
      const w = window.game && window.game.world;
      if (!w) return;
      if (w.autofireSides) {
        window.game.command({ c: 'autofire', on: box.checked });
        return;
      }
      w.autofire = box.checked;
      for (const u of w.units) if (u.player?.human) for (const a of u.abilities || []) if (a.def.autofire) a.auto = box.checked;
    };
  }
  window.applyGraphics = renderer => {
    for (const [id, key] of Object.entries(GFX)) $('gfx' + id).checked = !!gfx[key];
    if (!renderer || !renderer.post) return;
    renderer.shadowsOn = !!gfx.shadows;
    renderer.post.bloom = !!gfx.bloom;
    renderer.post.heat = !!gfx.heat;
    renderer.post.flare = !!gfx.flare;
    renderer.fxParticles.heatOn = !!gfx.heat;
    if (renderer.ratioWas !== gfx.scale) {
      renderer.ratioWas = gfx.scale;
      if (renderer.ctx) renderer.resize();
    }
  };
  for (const [id, key] of Object.entries(GFX)) {
    const box = $('gfx' + id);
    box.checked = !!gfx[key];
    box.onchange = () => {
      gfx[key] = box.checked;
      storeGfx();
      window.applyGraphics(window.game?.renderer);
    };
  }
  $('loading').classList.add('hidden');
  const lobby = cancel =>
    openLobby({
      maps,
      landMaps,
      customMaps,
      factions: FACTIONS,
      audio,
      cancel,
      init: { mapFile: sel.value, teamFactions: [getTeam1(), getTeam2()], players, credits: getCredits(), popCap: getPop(), fog: getFog() },
      start: setup => {
        audio.unlock();
        leaveFor(setup.mode);
        launch(setup);
      }
    });
  const multiplayer = async kind => {
    leaveFor('multiplayer');
    hideSplash();
    history.replaceState(null, '', location.pathname + '?multiplayer' + (kind === 'lan' ? '=lan' : ''));
    const ok = await openMultiplayer({
      maps,
      landMaps,
      customMaps,
      factions: FACTIONS,
      audio,
      version: BUILD,
      launch,
      kind,
      back: () => leaveTo(location.pathname)
    }).catch(e => {
      console.warn('multiplayer', e);
      return false;
    });
    if (!ok) leaveTo(location.pathname);
  };
  const exits = {
    lobby,
    multiplayer,
    load: loadSave,
    start: setup => {
      leaveFor(setup.mode);
      launch(setup);
    }
  };
  const mainMenu = async () => {
    if (!params.has('nomenu')) {
      const demo = db.constants.list('Demo_Attract_Maps')[0]?.replace(/\.rec$/i, '.ted');
      const front =
        demo && db.constants.bool('Main_Menu_Demo_Attract_Mode')
          ? await startFrontEnd(demo, exits).catch(e => {
              console.warn('main menu', e);
              return false;
            })
          : false;
      if (front) return;
      if (window.game) {
        leaveTo(location.pathname + '?nomenu');
        return;
      }
    }
    hideSplash();
    const staged = await openLobby({
      maps,
      landMaps,
      customMaps,
      factions: FACTIONS,
      audio,
      init: { mapFile: sel.value, teamFactions: [getTeam1(), getTeam2()], players, credits: getCredits(), popCap: getPop(), fog: getFog() },
      start: setup => {
        audio.unlock();
        leaveFor(setup.mode);
        launch(setup);
      }
    }).catch(e => {
      console.warn('setup screen', e);
      return false;
    });
    if (!staged) $('lobby').classList.remove('hidden');
  };
  setInPlace({
    start: setup =>
      setTimeout(() => {
        leaveFor(setup.mode);
        launch(setup);
      }),
    menu: () =>
      setTimeout(() => {
        endGame('menu');
        history.replaceState(null, '', location.pathname);
        showSplash();
        mainMenu();
      }),
    load: id => setTimeout(() => loadSave(id))
  });
  notePage();
  const linked = window.parent !== window && window.parent.game?.linkedMission;
  if (params.has('linked-tactical') && linked?.frame.contentWindow === window) {
    await launch(linked.setup);
    return;
  }
  const mpGalaxy = params.has('mp-galaxy') && galaxyFrameSetup();
  if (mpGalaxy) {
    hideSplash();
    await launch(mpGalaxy);
    return;
  }
  const mpParent = params.has('mp-battle') && mpBattleParent();
  if (mpParent) {
    await launch(mpParent.mpBattles.current.setup);
    return;
  }
  if (window.parent === window) watchForResume(() => window.game);
  let pending = null;
  try {
    pending = sessionStorage.getItem('swr-load');
    sessionStorage.removeItem('swr-load');
  } catch {}
  if (pending) {
    const snap = await getSave(pending);
    if (pending === 'resume') forgetResume();
    if (snap) {
      startFromSave(snap);
      return;
    }
  }
  if (params.has('autostart') || params.has('benchmark')) {
    go();
    return;
  }
  if (params.has('multiplayer')) {
    hideSplash();
    const ok = await openMultiplayer({
      maps,
      landMaps,
      customMaps,
      factions: FACTIONS,
      audio,
      version: BUILD,
      launch,
      join: params.get('join'),
      kind: params.get('multiplayer') === 'lan' ? 'lan' : 'internet',
      back: () => leaveTo(location.pathname)
    }).catch(e => {
      console.warn('multiplayer', e);
      return false;
    });
    if (ok) return;
  }
  let staged0 = null;
  try {
    staged0 = JSON.parse(sessionStorage.getItem('swr-start') || 'null');
    sessionStorage.removeItem('swr-start');
  } catch {}
  if (staged0) staged0 = await unstash(staged0);
  if (staged0) {
    launch(staged0);
    return;
  }
  await mainMenu();
}

async function startFrontEnd(mapFile, { lobby, multiplayer, load, start }) {
  if (!(await loadMap(mapFile).catch(() => null))) return false;
  const game = new Game({
    attract: true,
    direct: true,
    benchmark: 0,
    mapFile,
    credits: 0,
    popCap: 0,
    fog: false,
    teamFactions:
      FACTIONS.includes('Rebel') && FACTIONS.includes('Underworld') ? ['Rebel', 'Underworld'] : [FACTIONS[0], FACTIONS[1] || FACTIONS[0]],
    players: [
      { human: true, team: 0, color: '#e0352b' },
      { human: false, team: 1, color: '#f7c90d', difficulty: 'easy' }
    ]
  });
  audio.menuOnly = true;
  await game.start();
  const unlock = () => {
    audio.unlock();
    removeEventListener('pointerdown', unlock, true);
  };
  addEventListener('pointerdown', unlock, true);
  const front = (game.front = new FrontEnd(game, {
    skirmish: cancel => lobby(cancel),
    multiplayer,
    start,
    leave: () => leaveTo('index.html')
  }));
  if (!(await front.open())) return false;
  hideSplash();
  const cycle = db.constants.num('Demo_Attract_Map_Cycle_Delay_Seconds', 1200);
  let from = 0;
  game.attractCycle = setInterval(() => {
    if (game.world.time - from > cycle && game.menus.stack.length === 1) {
      game.restartAttract();
      from = game.world.time;
    }
  }, 5000);
  const put = await pendingResume();
  if (put)
    game.menus.ask(
      'Continue your game?',
      [put.name, 'The browser closed this page while it was in the background.'],
      () => load(put.id).then(() => forgetResume()),
      () => forgetResume()
    );
  return true;
}

boot();

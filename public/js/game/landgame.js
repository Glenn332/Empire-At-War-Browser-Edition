import { TacticalMarker } from './tacticalobjects.js';
import { linkedParent, reportLinkedVictory, authoredMapOwner, ensureMissionPlayers, missionMapActor } from './linktactical.js';
import { mpBattleParent } from './galacticmpbattle.js';

import * as THREE from 'three';
import { db } from '../gamedata.js';
import { loadMap, pickEnvironment, environmentRoll } from '../ted.js';
import { loadModel, lighting, setPlanetEnvironment, depthMaterial, programSources, planetClock } from '../model.js';
import { env as gpuEnv, wantGPU } from '../gpu/env.js';
import { loadALO } from '../alo.js';
import { iconUrl, iconCanvasRect, iconAtlas } from '../icons.js';
import { buildTerrain, buildWater, skyMaterial, heightAt, paintFog, fogTexture, CELL } from './terrain.js';
import { LandWorld, costOf, timeOf, isUpgrade, buildsFor, FACING, placeRotation, landPop } from './land.js';
import { showHand, formation, slotAt, stretched, laidOut, WHEEL_TURN } from './placehand.js';
import { ArcView } from './directview.js';
import { ChaseView } from './chaseview.js';
import { TrackCam, TRACK_LOOK } from './trackcam.js';
import { Menus } from './menus.js';
import { loadHudAssets } from './hud.js';
import { LandUI } from './landhud.js';
import { SelectionRings, loadBlobMaterials } from './render.js';
import { shownAbility, abilityIconName } from './ui.js';
import { Pointers, tacticalPointer } from './pointers.js';
import { showSummary } from './summary.js';
import { openRetryDialog } from './retrydialog.js';
import { openRetreatDialog, resolveTactical, landRosters } from './tacticalautoresolve.js';
import { RetreatCoordinator, showRetreatLine, hasRetreatPrevention } from './retreat.js';
import { aiAbilities } from './landabilities.js';
import { commandArmy } from './landai.js';
import { LandGoals } from './landgoals.js';
import { Decals, scorch } from './landdecals.js';
import { addHouse, addWall, addCapturable, putInside, tickCapturables } from './landbase.js';
import { loadLandTables } from './landtables.js';
import { loadClashes } from './landclash.js';
import { LandCinematic } from './landcine.js';
import { Wildlife, isAmbient } from './landlife.js';
import { Bolts } from './landbolts.js';
import { Shots } from './landshots.js';
import { BenchOverlay } from '../benchoverlay.js';
import { loadBrain, Mind, target, buildGoal, aiFreeStore } from './landbrain.js';
import { loadPrioritySets } from './priorities.js';
import { fireSound } from './weaponswap.js';
import { LandScripts } from './landscripts.js';
import { TacticalStoryHost } from './tacticalstory.js';
import { stepTacticalSpeech } from './tacticalspeech.js';
import { fetchText } from '../vfs.js';
import { gfx, pixelRatio, shadowSize, gammaOn } from '../gfx.js';
import { tickGarrisons, adoptGarrisons } from './landgarrison.js';
import { placeLandInvasion, invasionWinner, landInvasionResult, invasionStructureDeath } from './campaignland.js';
import { campaignSetup } from './savegame.js';
import { saveBattleScripts, restoreBattleScripts } from './tacticalsave.js';

async function landCamera() {
  const own = {
    steps: [
      [170, 27],
      [271.5, 45],
      [460, 55],
      [1000, 65],
      [1600, 80]
    ],
    start: 460
  };
  const xml = await fetchText('Data/XML/TacticalCameras.xml').catch(() => null);
  const m = xml && /<TacticalCamera\s+Name="Land_Mode">([^]*?)<\/TacticalCamera>/i.exec(xml.replace(/<!--[^]*?-->/g, ''));
  if (!m) return own;
  const get = k => {
    const x = new RegExp('<' + k + '>\\s*([^<]*?)\\s*</' + k + '>', 'i').exec(m[1]);
    return x ? x[1] : '';
  };
  const num = (k, d) => {
    const v = parseFloat(get(k));
    return Number.isFinite(v) ? v : d;
  };
  const pairs = k => {
    const v = get(k)
        .split(/[\s,]+/)
        .map(parseFloat)
        .filter(Number.isFinite),
      out = [];
    for (let i = 0; i + 1 < v.length; i += 2) out.push([v[i], v[i + 1]]);
    return out;
  };
  const steps = [];
  const ps = pairs('Pitch_Spline'),
    ds = pairs('Distance_Spline');
  if (/^(yes|true|1)$/i.test(get('Use_Splines')) && ps.length > 1 && ds.length > 1) {
    const near = ds[0][1],
      far = ds[ds.length - 1][1];
    for (const [f, pitch] of ps) if (f <= 1) steps.push([near + f * (far - near), pitch]);
  } else {
    const pitch = num('Pitch_Default', 50);
    steps.push([num('Distance_Min', 170), pitch], [num('Distance_Max', 460), pitch]);
  }
  for (const n of ['', '2']) {
    const d = num('Tactical_Overview_Distance' + n, 0),
      p = num('Tactical_Overview_Pitch' + n, 0);
    if (d > steps[steps.length - 1][0] && p > 0) steps.push([d, Math.min(89, p)]);
  }
  if (steps.length < 2 || !(steps[steps.length - 1][0] > steps[0][0])) return own;
  return { steps, start: Math.min(steps[steps.length - 1][0], Math.max(steps[0][0], num('Distance_Default', 460))) };
}
import { ParticleManager, loadParticles } from '../particles.js';
import { LandInstances, viewTest, shaderScene } from './landinstances.js';
import { MirrorRenderer, mirrorSupported } from '../mirror.js';
import { loadBlackMarket } from './blackmarket.js';
import { giveFreeUpgrades } from './planetabilities.js';
import { stageStart } from './transit.js';
import { stepDualFlash } from './tutorialrewards.js';
import { loadALA, animName, AnimState } from '../ala.js';
import { simRandom, seedSim, simRandomState } from './simrandom.js';
import { resetLandIds, preloadLand } from './land.js';
import { resetBrainIds } from './landbrain.js';
import { executeLand } from './landcommands.js';
import { Lockstep, TURN } from './netgame.js';
import { ticker } from '../net.js';
import { openDialog } from './dialogs.js';

import { showLoadScreen, endLoadScreen } from './loadscreen.js';
import { showSplash, hideSplash } from '../splash.js';
import { pressed, held, bothButtonsRotate, keysOf, keyName } from './keybinds.js';

const LAND_TICK = 1 / 30;
const nextTask = () =>
  new Promise(r => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

const DEG = Math.PI / 180;
const beh = t => (t._landBeh ||= new Set([...t.list('Behavior'), ...t.list('LandBehavior')].map(x => x.toUpperCase())));
const $ = id => document.getElementById(id);
const nameOf = t => db.t(t.str('Text_ID')) || t.name.replace(/^UC_/, '').replace(/_/g, ' ');
const iconOf = t => {
  let n = t.str('Icon_Name');
  if (!n) {
    const c = db.type(t.list('Company_Units')[0]) || db.type(t.str('Tactical_Buildable_Constructed'));
    n = c ? c.str('Icon_Name') : '';
  }
  return n ? iconUrl(n) : '';
};

const CSS = `
#landend { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 30; pointer-events: none; font: 700 54px "EmpireAtWar-Bold", "Segoe UI", sans-serif; color: #ffd421; text-shadow: 0 0 14px #000, 0 0 4px #000; }
`;

async function spawnMapLoadTables(game, world, map) {
  const rows = [];
  for (const o of map.objects) {
    const text = o.type.str('Map_Load_Spawn_Table');
    if (!text) continue;
    const parts = text
        .split(',')
        .map(x => x.trim())
        .filter(Boolean),
      table = [];
    let total = 0;
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const t = db.type(parts[i]),
        w = parseFloat(parts[i + 1]);
      if (t && w > 0) table.push({ t, at: (total += w) });
    }
    if (!table.length || simRandom() < 1 - total) continue;
    const r = simRandom() * total,
      pick = (table.find(e => r <= e.at) || table[table.length - 1]).t;
    rows.push({ o, t: pick });
  }
  for (const { o, t } of rows) {
    const affil = t
      .list('Affiliation')
      .map(f => f.trim().toUpperCase())
      .filter(Boolean);
    let side = -1,
      neutral = false;
    const first = affil.find(f => db.faction(f));
    if (first) {
      side = world.factions.findIndex(f => String(f).toUpperCase() === first);
      if (side < 0) {
        neutral = !!db.faction(first).bool('Is_Neutral') || first === 'NEUTRAL';
        side = neutral ? -1 : world.wild;
      }
    } else {
      const owner = o.owner >= 0 ? [...db.factions.values()][o.owner]?.name : null;
      side = owner ? world.factions.findIndex(f => String(f).toUpperCase() === owner.toUpperCase()) : -1;
    }
    const at = { type: t, pos: o.pos, rot: o.rot, scale: 1 };
    let made = null;
    try {
      if (beh(t).has('CAPTURE_POINT')) {
        const pt = await world.addPoint(at, side >= 0 && side < world.factions.length ? side : -1);
        if (beh(t).has('TACTICAL_BUILD_OBJECTS')) world.addPadSite(pt, at);
        else if (!pt.reinforce) made = await addCapturable(world, pt, at);
        made ||= { type: t, point: pt };
      } else if (t.has('Company_Units') || beh(t).has('WALK_LOCOMOTOR')) {
        const q = await world.spawn(t.name, o.pos[0], o.pos[1], o.rot[2] * DEG, side < 0 ? world.wild : side);
        if (q && (side < 0 || side === world.wild)) {
          q.native = true;
          for (const m of q.members) m.captures = false;
        }
        made = q?.members?.[0] || null;
      } else if (t.str('Land_Model_Name')) {
        const site = {
          base: false,
          side: side < 0 ? world.wild : side,
          point: { side: -1, type: t },
          x: o.pos[0],
          y: o.pos[1],
          z: o.pos[2],
          rot: o.rot,
          scale: 1,
          options: [],
          structure: null,
          building: null
        };
        made = await world.finishSite(site, t, site.side);
      }
    } catch (e) {
      console.warn('map load spawn', t.name, e);
    }
    game.sandboxStructure = made || { type: t };
  }
}

function readyDrawsOnly(R) {
  if (!R.extensions.get('KHR_parallel_shader_compile')) return;
  const props = R.properties,
    direct = R.renderBufferDirect.bind(R),
    building = new WeakSet();
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const prog = props.get(material).currentProgram;
    if (prog) {
      if (prog.isReady()) return direct(camera, scene, geometry, material, object, group);
      return;
    }
    if (!scene || building.has(material)) return;
    building.add(material);
    queueMicrotask(() =>
      Promise.resolve(R.compileAsync(object, camera, shaderScene(scene)))
        .catch(() => {})
        .then(() => building.delete(material))
    );
  };
}

export class LandGame {
  constructor(setup, { audio, progress }) {
    this.setup = setup;
    this.audio = audio;
    this.progress = progress;
    this.environmentFogEnabled = true;
    this.noSave = !!(setup.campaign && setup.net);
    this.paused = false;
    this.over = false;
    this.landBattle = true;
    this.speed = 1;
    this.tacticalWinner = undefined;
    if (setup.net) {
      resetLandIds();
      resetBrainIds();
      seedSim(setup.seed >>> 0);
    }
    const human =
      (setup.net && setup.players.find(p => p.human && (p.peer === setup.net.me || p.peers?.includes(setup.net.me)))) ||
      setup.players.find(p => p.human) ||
      setup.players[0];
    this.spectator = !!setup.net?.spectators?.includes(setup.net.me);
    this.players = setup.players;
    this.me = setup.players.indexOf(human);
    this.teams = setup.players.map(p => p.team);
    this.myTeam = human.team;
    this.factions = setup.players.map(p => setup.teamFactions[p.team] || setup.teamFactions[0]);
    this.ai = setup.players.map(() => ({ timer: 4 + simRandom() * 3, wait: null, sleep: 0 }));
    this.view = { x: 0, y: 0, dist: 460, yaw: -90 * DEG, pitch: 55 * DEG };
    this.keys = new Set();
    this.bolts = [];
    this.zones = [];
    this.aiTimer = 5;
    this.hudTimer = 0;
    this.frame = this.frame.bind(this);
    this.life = new AbortController();
  }

  listen(ev, fn, opts) {
    addEventListener(ev, fn, { ...(typeof opts === 'boolean' ? { capture: opts } : opts), signal: this.life.signal });
  }

  dispose() {
    this.modeSuspended = true;
    this.over = true;
    this.life.abort();
    this.missTicker?.stop();
    this.cine?.stop?.();
    if (this.menus) while (this.menus.stack.length) this.menus.stack.pop().close();
    this.ui?.destroy?.();
    this.bench?.dispose?.();
    const R = this.renderer;
    if (R?.isMirror) R.dispose?.();
    else if (R) {
      R.dispose();
      R.forceContextLoss();
    }
    this.gpu?.dispose();
    this.flash?.remove();
    this.endTrack();
    this.track?.destroy();
    this.chase?.destroy();
    if (window.game === this) window.game = null;
  }

  message(text, cls, color, life) {
    this.say(text, cls, color, life);
  }
  togglePause() {
    if (this.lock) this.lock.togglePause();
    else this.paused = !this.paused;
  }
  setSpeed(s) {
    if (this.lock) {
      if (s !== this.speed) this.lock.setSpeed(s);
    } else this.speed = s;
  }

  command(cmd) {
    if (this.spectator) {
      this.message?.('You are watching this battle.', 'bad');
      return null;
    }
    if (this.lock) {
      this.lock.command(cmd);
      return null;
    }
    const r = executeLand(this, this.me, cmd);
    this.commandResult(cmd, r);
    return r;
  }
  execute(pid, cmd) {
    return executeLand(this, pid, cmd);
  }
  commandResult(cmd, r) {
    if (!r || !r.why) return;
    if (r.soft) {
      this.say(r.why);
      return;
    }
    this.say(r.why, 'bad');
    this.audio.play('GUI_Bad_Sound');
    if (cmd.c === 'build' && /population cap|unit max/i.test(r.why))
      this.audio.play(db.faction(this.factions[this.me])?.str('SFXEvent_Tactical_Pop_Cap_Reached'));
  }
  netPlayer(i) {
    const p = this.players[i];
    if (!p) return null;
    return ((this.netPlayers ||= [])[i] ||= {
      id: i,
      get name() {
        return p.name || 'Player';
      },
      get team() {
        return p.team;
      },
      get human() {
        return !!p.human;
      },
      left: false,
      color: p.color
    });
  }
  hashState() {
    const w = this.world;
    let h = 0x811c9dc5 | 0;
    const f64 = new Float64Array(1),
      u32 = new Uint32Array(f64.buffer);
    const mixInt = v => {
      h = Math.imul(h ^ (v | 0), 0x01000193);
    };
    const mix = v => {
      f64[0] = v || 0;
      mixInt(u32[0]);
      mixInt(u32[1]);
    };
    mix(w.time);
    for (const x of simRandomState()) mixInt(x);
    for (const c of w.credits) mix(c);
    mixInt(w.units.length);
    mixInt(w.squads.length);
    mixInt(w.shots.length);
    for (const u of w.units) {
      mixInt(u.squad?.id || 0);
      mix(u.x);
      mix(u.y);
      mix(u.heading);
      mix(u.health);
      mix(u.shield);
      mixInt(u.dead ? 1 : 0);
    }
    return h >>> 0;
  }
  takeOver(p, pid) {
    const cfg = this.players[pid];
    if (!cfg || !cfg.human || this.world.beaten.has(this.teams[pid])) return false;
    cfg.human = false;
    cfg.difficulty = cfg.difficulty || 'medium';
    if (this.netPlayers?.[pid]) this.netPlayers[pid].left = true;
    const fs = this.freeStores?.get(pid);
    if (fs) fs();
    return true;
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
    const box = dlg.edit('IDC_IME_EDITBOX');
    dlg.check('IDC_TEAM_MEMBERS_ONLY', team, v => {
      team = this.chatTeam = v;
      box?.focus();
    });
    const close = () => {
      dlg.close();
      this.chatDlg = null;
    };
    if (!box) {
      close();
      return;
    }
    box.maxLength = 200;
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.lock?.say(box.value, team);
        close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    box.focus();
  }
  chatLine(from, text, team) {
    if (!from) return;
    this.say(`${from.name}${team ? ' (' + (db.t('TEXT_TEAM') || 'Team') + ')' : ''}: ${text}`, 'chat', from.color || '');
    this.audio.play('GUI_Chat_Message_SFX');
  }

  async prepareLockstep() {
    this.progress('Preparing the battle', 1);
    if (this.scripts) await this.scripts.host.preloadAll();
    await Promise.all(this.freeStoreJobs || []);
    this.speed = 1;
    this.lock = new Lockstep(this, this.setup.net);
    this.progress('Waiting for the other players', 1);
    await this.lock.ready();
    if (globalThis.autofireDefault) this.command({ c: 'autofire', on: true });
    this.missTicker = ticker(1000 / 30, () => {
      if (this.over) {
        this.missTicker.stop();
        return;
      }
      const now = performance.now();
      if (!document.hidden && now - this.last < 100) return;
      const real = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.lockFrame(real);
    });
  }

  lockFrame(real) {
    const lock = this.lock;
    const behind = lock.behind();
    if (this.paused) this.owed = 0;
    this.owed = Math.min((this.owed || 0) + (this.paused ? 0 : real * this.speed), (4 + behind * TURN) * LAND_TICK);
    if (behind > 1) this.owed = Math.max(this.owed, Math.min(behind, 3) * LAND_TICK);
    if (!this.pumping) this.pump();
    lock.frame(this.owed / LAND_TICK, 3, null);
    if (lock.started && !this.paused && this.owed >= LAND_TICK) {
      if ((this.stalled = (this.stalled || 0) + real) > 2 && !this.stallSaid) {
        this.stallSaid = true;
        const who = lock.waitingFor();
        this.say(who.length ? `Waiting for ${who.join(', ')}…` : 'Waiting…', 'bad');
      }
    } else {
      this.stalled = 0;
      this.stallSaid = false;
    }
  }
  async pump() {
    this.pumping = true;
    const w = this.world,
      lock = this.lock;
    try {
      while (!this.over && this.owed >= LAND_TICK && lock.step()) {
        if (this.paused) {
          this.owed = 0;
          break;
        }
        w.update(LAND_TICK);
        this.cinematicTransports?.update();
        if (this.scripts) this.scripts.update(LAND_TICK);
        this.landRetreat?.step(LAND_TICK);
        this.stepCommanders(LAND_TICK);
        this.stepEnd(LAND_TICK);
        lock.stepped();
        this.owed -= LAND_TICK;
        await nextTask();
      }
    } catch (e) {
      console.error('[land lockstep]', e);
    } finally {
      this.pumping = false;
    }
  }

  toggleMenu() {
    this.menus.toggle();
  }

  async start() {
    const P = this.progress,
      setup = this.setup;
    $('lobby').classList.add('hidden');
    if (!setup.attract) showSplash();
    P('Loading map', 0);
    const map = (this.map = await loadMap(setup.mapFile));
    ensureMissionPlayers(setup, map);
    pickEnvironment(map, setup.net ? environmentRoll(setup.seed) : Math.random());
    if (!setup.attract && (await showLoadScreen({ setup, map, land: true }))) hideSplash();
    this.teams = this.players.map(p => p.team);
    this.factions = this.players.map(p => setup.teamFactions[p.team]);
    while (this.ai.length < this.players.length) this.ai.push({ timer: 4, wait: null, sleep: 0 });
    const t = (this.terrain = map.terrain);
    if (!t) throw new Error('not a land map: ' + setup.mapFile);

    const glOpts = { antialias: gfx.aa !== false, powerPreference: 'high-performance', stencil: true };
    const onThread = /[?&]worker(&|$)/.test(location.search) && mirrorSupported();
    const renderer = (this.renderer = onThread ? new MirrorRenderer({ ...glOpts, webgpu: wantGPU() }) : new THREE.WebGLRenderer(glOpts));
    if (renderer.isMirror && renderer.webgpu) renderer.gpuEnv(lighting, programSources);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.debug.checkShaderErrors = /[?&]shadercheck/.test(location.search);
    readyDrawsOnly(renderer);
    renderer.setPixelRatio(pixelRatio());
    $('view').appendChild(renderer.domElement);
    gammaOn(renderer.domElement);
    if (wantGPU() && !renderer.isMirror) await this.startGPU();
    this.camera = new THREE.PerspectiveCamera(55, 1, 5, 40000);
    this.camera.up.set(0, 0, 1);
    const scene = (this.scene = new THREE.Scene());
    this.sky = new THREE.Scene();
    this.skyTick = [];
    this.flash = document.createElement('div');
    this.flash.style.cssText = 'position:fixed;inset:0;background:#dfe8ff;opacity:0;pointer-events:none;mix-blend-mode:screen;z-index:1';
    document.body.appendChild(this.flash);

    const env = map.environment;
    P('Building the ground', 0.2);
    t.extraLayers = [
      ...new Set(
        [...db.types.values()]
          .filter(x => x.has('Terrain_Texture_Modifier_Material'))
          .map(x => x.num('Terrain_Texture_Modifier_Material', -1))
          .filter(i => i >= 0)
      )
    ];
    this.ground = await buildTerrain(t);
    lighting.fowMap.value = fogTexture(t);
    lighting.fowSide.value = (t.size - 1) * CELL;
    scene.add(this.ground);
    this.water = buildWater(t);
    if (this.water) scene.add(this.water);
    await this.applyEnvironment(env);

    const world = (this.world = new LandWorld(map, scene, {
      factions: this.factions,
      teams: this.teams,
      credits: setup.credits,
      popCap: setup.popCap
    }));
    world.campaign = !!setup.campaign;
    world.autofireSides = new Set(!setup.net && this.me >= 0 && globalThis.autofireDefault ? [this.me] : []);
    world.isHumanSide = s => !!this.players?.[s]?.human;
    const treasury = setup.campaign?.treasury;
    if (treasury)
      world.tacticalSessions = this.factions.map((f, side) => {
        const t = treasury[String(f).toUpperCase()];
        if (!t) return null;
        if (!t.ai) {
          world.credits[side] = t.credits;
          return { ai: false };
        }
        world.credits[side] = t.share;
        return { ai: true, reserve: Math.max(0, t.credits - t.share), released: 0, adjust: t.adjust ?? 1, parts: t.parts || [] };
      });
    world.viewer = this.me;
    world.colors = this.players.map(p => (p.color ? new THREE.Color(p.color) : null));
    world.tables = await loadLandTables().catch(() => null);
    await loadBlobMaterials().catch(() => null);
    await loadPrioritySets().catch(e => console.warn('targeting priorities not loaded', e));
    await loadClashes().catch(() => null);
    this.brains = await Promise.all(this.factions.map(f => loadBrain(f).catch(() => null)));
    this.goals = new URLSearchParams(location.search).has('oldai') ? null : new LandGoals(this);
    world.setWeather(env && env.weather);
    this.players.forEach((p, i) => {
      const d =
        !p.human &&
        world.tables &&
        world.tables.difficulty.get(
          { medium: 'normal' }[String(p.difficulty || 'normal').toLowerCase()] || String(p.difficulty || 'normal').toLowerCase()
        );
      if (d) {
        world.mods[i] = { build: d.build, credit: d.credit, damage: d.damage, health: d.health };
        this.ai[i].sleep = d.sleep;
      }
    });
    const captain = team => this.teams.indexOf(team);
    const preBuilt = setup.preBuilt !== false;
    this.life = new Wildlife(world, scene, setup.fog !== false);
    this.lightning = new Bolts(scene);
    world.onWeather = name => {
      if (name !== 'clear')
        this.say(db.text.get('TEXT_WEATHER_NAME_' + name.toUpperCase()) || name.charAt(0).toUpperCase() + name.slice(1));
    };
    if (setup.net) {
      const roots = [];
      for (const f of this.factions)
        for (const n of db.faction(f)?.list('Land_Skirmish_AI_Default_Forces') || []) {
          const t = db.type(n);
          if (t) roots.push(t);
        }
      this.preloaded = await preloadLand(roots, this.factions, (d, n) => P(`Loading units (${d}/${n})`, 0.3 + (0.1 * d) / Math.max(1, n)), [
        ...new Set(map.objects.map(o => o.type))
      ]);
      world.fixed = true;
    }
    P('Placing the map', 0.4);
    let done = 0;
    await Promise.all(
      map.objects.map(async (o, mapIndex) => {
        const name = o.type.name,
          team = /^TEAM_(\d\d)_(.+)$/i.exec(name),
          side = team ? captain(+team[1]) : -1;
        try {
          if (beh(o.type).has('MARKER') || o.type.bool('Is_Marker'))
            world.mapObjects.set(mapIndex, [new TacticalMarker(o, () => world.sidePlayers[side >= 0 ? side : world.wild])]);
          if (beh(o.type).has('CAPTURE_POINT')) {
            const pt = await world.addPoint(o);
            world.mapObjects.set(mapIndex, [{ point: pt }]);
            if (beh(o.type).has('TACTICAL_BUILD_OBJECTS')) world.addPadSite(pt, o);
            else if (!pt.reinforce) await addCapturable(world, pt, o);
          } else if (team && /^REINFORCEMENT_POINT/i.test(team[2]) && db.type(team[2])) {
            if (side >= 0) await world.addPoint(o, side, db.type(team[2]));
          } else if (team && o.type.has('Marker_For_Specific_Object_Type')) {
            if (side >= 0 && !/SPACE_STATION/i.test(team[2])) await world.addBaseSite(o, side, preBuilt && !/BUILDPADS/i.test(team[2]));
          } else if (isAmbient(o.type)) {
            await this.life.add(o.type, o.pos[0], o.pos[1], o.rot[2] * DEG, o.scale || 1);
          } else if (
            o.type.has('Spawned_Indigenous_Units_Type') &&
            o.type.list('Spawned_Indigenous_Units_Type').every(n => db.type(n) && isAmbient(db.type(n)))
          ) {
            const kinds = o.type.list('Spawned_Indigenous_Units_Type'),
              n = Math.min(12, o.type.num('Spawned_Indigenous_Units_Quantity', 6)),
              r = o.type.num('Spawn_Indigenous_Units_Radius', 80);
            for (let i = 0; i < n; i++)
              await this.life.add(
                db.type(kinds[i % kinds.length]),
                o.pos[0] + (Math.random() - 0.5) * r,
                o.pos[1] + (Math.random() - 0.5) * r,
                Math.random() * 6.28
              );
          } else if (
            authoredMapOwner(setup, o) &&
            missionMapActor(setup, o) &&
            /structure$/i.test(o.type.tag) &&
            !beh(o.type).has('WALK_LOCOMOTOR')
          ) {
            const owner = this.factions.indexOf(authoredMapOwner(setup, o)),
              side = owner < 0 ? world.wild : owner;
            const site = {
              base: false,
              side,
              point: { side: -1, type: o.type },
              x: o.pos[0],
              y: o.pos[1],
              z: o.pos[2],
              rot: o.rot,
              scale: o.scale || 1,
              options: [],
              structure: null,
              building: null
            };
            const u = await world.finishSite(site, o.type, side);
            if (u) {
              world.mapObjects.set(mapIndex, [u]);
              u.mapIndex = mapIndex;
            }
          } else if (authoredMapOwner(setup, o) && missionMapActor(setup, o)) {
            const owner = this.factions.indexOf(authoredMapOwner(setup, o)),
              q = await world.spawn(o.type.name, o.pos[0], o.pos[1], o.rot[2] * DEG, owner < 0 ? world.wild : owner);
            if (q) {
              world.mapObjects.set(mapIndex, q.mates || [q]);
              for (const member of q.mates || [q]) member.mapIndex = mapIndex;
            }
          } else if (!team && beh(o.type).has('WEAPON') && beh(o.type).has('WALK_LOCOMOTOR') && !o.type.has('Company_Units')) {
            const q = await world.spawn(o.type.name, o.pos[0], o.pos[1], o.rot[2] * DEG, world.wild);
            if (q) {
              q.native = true;
              for (const m of q.members) m.captures = false;
            }
          } else if (beh(o.type).has('WALL') && (await addWall(world, o))) {
          } else if (o.type.has('Spawned_Indigenous_Units_Type') && (await addHouse(world, o))) {
          } else {
            const file = o.type.str('Land_Model_Name');
            if (file && !beh(o.type).has('MARKER') && !o.type.bool('Is_Marker')) {
              const inst = await loadModel(file).catch(() => null);
              if (inst) {
                const grp = new THREE.Group();
                grp.add(inst.root);
                grp.position.set(o.pos[0], o.pos[1], o.pos[2]);
                placeRotation(grp, o.rot);
                grp.scale.setScalar(o.type.num('Scale_Factor', 1) * (o.scale || 1));
                scene.add(grp);
                grp.userData.casts = true;
                {
                  const ghost = inst.meshByName.get('STEALTH');
                  if (ghost) ghost.visible = false;
                }
                const idle = beh(o.type).has('IDLE') ? await Promise.resolve(loadALA(animName(file, 'IDLE'))).catch(() => null) : null;
                if (idle) (this.propAnims ||= []).push(this.propEntry(grp, inst, new AnimState(inst, idle, { loop: true })));
                grp.updateMatrixWorld(true);
                if (!idle) {
                  grp.traverse(x => {
                    x.matrixAutoUpdate = false;
                  });
                  grp.matrixWorldAutoUpdate = false;
                }
                const entry = { grp, holder: grp, inst, x: o.pos[0], y: o.pos[1], scriptHidden: false };
                (this.props ||= []).push(entry);
                if (o.hint) {
                  const prop = new TacticalMarker(o, () => world.sidePlayers[world.wild]);
                  prop.members = [entry];
                  prop.prop = { grp, inst, file, entry: (this.propAnims || []).find(p => p.grp === grp) || null };
                  world.mapObjects.set(mapIndex, [prop]);
                }
                if (beh(o.type).has('LAND_OBSTACLE') || beh(o.type).has('WALL')) {
                  const cells = [],
                    c = world.blockObstacle(o, await loadALO(file).catch(() => null), cells);
                  const prop = world.mapObjects.get(mapIndex)?.[0]?.prop;
                  if (prop) prop.cells = cells;
                  if (c) (this.propBlocks ||= new Map()).set(o.type.name, (this.propBlocks.get(o.type.name) || 0) + c);
                }
              }
            }
          }
        } catch (e) {
          console.warn('map object', name, e);
        }
        if (++done % 100 === 0) P(`Placing the map (${done}/${map.objects.length})`, 0.4 + (0.5 * done) / map.objects.length);
      })
    );

    if (!(setup.restore && setup.restore.battle)) await spawnMapLoadTables(this, world, map);
    const save = setup.restore && setup.restore.battle;
    const marks = team =>
      map.objects
        .filter(o => new RegExp('^TEAM_0' + team + '_SPAWN_POINT_MARKER$', 'i').test(o.type.name))
        .map(o => world.nearestOpen(o.pos[0], o.pos[1]))
        .filter(Boolean);
    const homeOf = side => world.points.find(p => p.reinforce && p.side >= 0 && world.ally(p.side, side));
    const sides = this.players.map((_, i) => i);
    const spots = sides.map(side => {
      const m = marks(this.teams[side]);
      if (m.length) return m;
      const h = homeOf(side);
      return [world.nearestOpen(h ? h.x + 40 : 400, h ? h.y : 400)];
    });
    if (setup.campaign?.tech) world.campaignTech = this.factions.map(f => setup.campaign.tech[f]);
    if (setup.campaign) world.planetCorruption = setup.campaign.corruption ?? -1;
    if (setup.campaign)
      this.factions.forEach((f, i) =>
        giveFreeUpgrades(
          setup.campaign.upgrades?.[f]?.land,
          f,
          t => world.owned[i].has(t.name),
          t => world.grant(i, t)
        )
      );
    if (setup.campaign) await loadBlackMarket();
    if (setup.campaign) world.market = this.factions.map(f => setup.campaign.blackMarket?.[f] || []);
    if (setup.campaign) world.defenderSide = setup.campaign.defender.side;
    if (setup.campaign) {
      const had = new Set(world.squads);
      this.invasionBook = await placeLandInvasion(world, map, setup.campaign);
      if (save && setup.restore.campaign) {
        for (const q of world.squads)
          if (!had.has(q) && !q.structure) {
            for (const u of q.members) {
              u.dead = true;
              u.died = -1e9;
            }
            q.members = [];
          }
        this.restoreLandCampaign(setup.restore.campaign, (this.loadedLand = await this.landRestore(save)));
      }
    }
    if (this.invasionBook) {
      world.retreat = this.landRetreat = this.makeRetreat();
      if (this.loadedLand && save.retreat)
        this.landRetreat.restore(save.retreat, r => {
          const [q, m] = String(r).slice(1).split('.').map(Number);
          return this.loadedLand.squads[q]?.members[m] || null;
        });
    } else if (save) this.loadedLand = await this.landRestore(save);
    else
      await Promise.all(
        sides.flatMap(side => {
          const enemy = sides.find(o => !world.ally(o, side)) ?? side,
            other = spots[enemy][0],
            list = db.faction(this.factions[side]).list('Land_Skirmish_AI_Default_Forces');
          const nth = world.teamSides(side).indexOf(side);
          return list.map((n, i) => {
            const sp = spots[side],
              at = sp[(i + nth) % sp.length],
              o = world.nearestOpen(at.x + (i >= sp.length ? 40 : 0) + nth * 70, at.y + nth * 50) || at;
            return world.spawn(n, o.x, o.y, Math.atan2(other.y - o.y, other.x - o.x), side);
          });
        })
      );
    world.onReady = (side, type) => {
      if (side !== this.me) return;
      this.say(isUpgrade(type) ? `${nameOf(type)} complete` : `${nameOf(type)} ready - call it in from Reinforcements`, 'good');
      if (!this.audio.play(type.str('SFXEvent_Build_Complete')))
        this.audio.play(db.faction(this.factions[side]).str('Reinforcements_Ready_SFXEvent'));
    };
    const fx = (this.fx = new ParticleManager(scene));
    this.shotLooks = new Shots(scene, fx);
    const decals = (this.decals = new Decals(world, scene));
    const particle = name => {
      const t = db.type(name);
      return t ? t.str('Land_Model_Name') || t.str('Space_Model_Name') : '';
    };
    const burst = (file, x, y, z) => {
      if (file && fx.systems.length < 300 && fx.state(file) === 'ready') fx.burst(file, x, y, z);
    };
    let lastFire = 0;
    world.onShot = s => {
      const made = (s.w.proj._landMade ??= particle(s.w.proj.str('Projectile_Object_Creation_Particle')));
      if (made) burst(made, s.x, s.y, s.z);
      if (world.time - lastFire < 0.07) return;
      lastFire = world.time;
      this.audio.play(fireSound(s.from.type, s.w.proj) || s.w.proj.str('Projectile_SFXEvent_Fire'), s.x, s.y);
    };
    world.onSound = (name, x, y) => this.audio.play(name, x, y);
    world.onOverrun = side => {
      if (side === this.me) this.audio.play(db.faction(world.factions[side])?.str('SFXEvent_HUD_Tactical_Victory_Near'));
    };
    world.onImpact = s => {
      const p = s.w.proj;
      const first = s.ground ? 'Projectile_Ground_Detonation_Particle' : 'Projectile_Object_Detonation_Particle',
        second = s.ground ? 'Projectile_Object_Detonation_Particle' : 'Projectile_Ground_Detonation_Particle';
      if (s.expired) burst(particle(p.str('Projectile_Lifetime_Detonation_Particle')), s.ax, s.ay, s.z);
      else burst(particle(p.str(first)) || particle(p.str(second)), s.ax, s.ay, s.z);
      if (!s.expired)
        scorch(decals, p.str('Projectile_Ground_Detonation_Particle') || p.str('Projectile_Object_Detonation_Particle'), s.ax, s.ay);
      if (Math.random() < 0.3)
        this.audio.play(p.str('Projectile_SFXEvent_Detonate') || p.str('Projectile_SFXEvent_Detonate_Reduced_By_Armor'), s.ax, s.ay);
    };
    this.losses = new Map();
    world.onDeath = u => {
      if (this.invasionBook) invasionStructureDeath(world, this.invasionBook, u);
      if (world.companyLost(u)) {
        const lk = this.teams[u.side] ?? 'w' + u.side,
          ty = u.squad?.type || u.type;
        if (!this.losses.has(lk)) this.losses.set(lk, new Map());
        const lost = this.losses.get(lk);
        lost.set(ty, (lost.get(ty) || 0) + 1);
      }
      const ex = u.type.list('Death_Explosions');
      if (!u.spin && ex.length) burst(particle(ex[Math.floor(Math.random() * ex.length)]), u.x, u.y, u.z + u.aimZ * 0.5);
      for (const n of u.type.list('Death_Explosions')) scorch(decals, n, u.x, u.y);
      this.audio.play(u.type.str('Death_SFXEvent_Start_Die') || u.type.str('SFXEvent_Die'), u.x, u.y);
      const f = db.faction(this.factions[this.me]);
      if (u.structure && world.ally(u.side, this.me)) this.audio.play(u.type.str('SFXEvent_Unit_Lost'));
    };
    world.onFx = (name, x, y, z) => {
      scorch(decals, name, x, y);
      const t = db.type(name);
      burst(t ? t.str('Land_Model_Name') || t.str('Space_Model_Name') : name, x, y, z);
    };
    world.onSound = (name, x, y) => this.audio.play(name, x, y);
    world.onCapture = pt => {
      if (pt.side >= 0 && this.factions[pt.side]) this.tacticalStory?.signalCapture(pt.type.name, this.factions[pt.side]);
      const f = db.faction(this.factions[this.me]);
      if (pt.reinforce)
        this.audio.play(f.str(world.ally(pt.side, this.me) ? 'SFXEvent_HUD_Landing_Zone_Captured' : 'SFXEvent_HUD_Landing_Zone_Lost'));
      else if (world.ally(pt.side, this.me)) this.audio.play(f.str('SFXEvent_HUD_Build_Pad_Captured'));
    };

    const own = world.units.find(u => !u.dead && u.side === this.me);
    const home = this.invasionBook?.anchors[this.me] ||
      homeOf(this.me) ||
      spots[this.me]?.[0] ||
      own || { x: (world.n * CELL) / 2, y: (world.n * CELL) / 2 };
    this.view.x = home.x;
    this.view.y = home.y;
    if (save && save.view && (!setup.net || setup.restoreSlot === this.me)) Object.assign(this.view, save.view);
    this.menus = new Menus(this);
    this.buildHud();
    P('Command bar', 0.95);
    const assets = await loadHudAssets().catch(e => {
      console.warn('command bar', e);
      return null;
    });
    if (!assets) throw new Error('the command bar art is missing');
    this.ui = new LandUI(this, assets);
    this.cine = new LandCinematic(this);
    this.cam = await landCamera();
    this.view.dist = this.cam.start;
    this.bindInput();
    const me = db.faction(this.factions[this.me]);
    const tracks = tag => {
      const tu = me.tuples(tag).find(x => x[0].toUpperCase() === 'LAND');
      const ev = tu && db.music.get(tu[1].toUpperCase());
      return ev ? ev.list('Files') : [];
    };
    const music = tracks('Music_Event_List_Ambient').concat(tracks('Music_Event_List_Battle'));
    if (music.length && this.audio.setPlaylist) this.audio.setPlaylist(music, false);

    const q = new URLSearchParams(location.search);
    this.noBatch = q.has('nobatch');
    this.noCull = q.has('nocull');
    this.noLoose = q.has('noloose');
    this.noDepthTwin = q.has('nodepthtwin');
    this.world.interp = !setup.net && (q.has('fixedstep') || ((!!this.gpuOn || !!this.renderer.webgpu) && !q.has('nofixedstep')));
    if (!this.noBatch)
      this.world.prepare = holder => {
        holder.userData.ready = false;
        const job = Promise.resolve(this.renderer.compileAsync(holder, this.camera, shaderScene(this.scene)))
          .catch(() => {})
          .then(() => {
            const props = this.renderer.properties,
              texs = new Set();
            holder.traverse(o => {
              for (const m of [].concat(o.material || [])) {
                if (m.map) texs.add(m.map);
                if (m.uniforms)
                  for (const k in m.uniforms) {
                    const v = m.uniforms[k].value;
                    if (v && v.isTexture) texs.add(v);
                  }
              }
            });
            const todo = [...texs].filter(t => t.version > 0 && props.get(t).__version !== t.version);
            if (!todo.length) {
              holder.userData.ready = true;
              return;
            }
            holder.userData.uploads = todo;
            (this.uploading ||= []).push(holder);
          });
        (this.preparing ||= new Set()).add(job);
        job.then(() => this.preparing.delete(job));
      };
    this.world.poseCache = !this.noBatch && !q.has('nocache');
    if (!q.has('noscripts')) {
      this.scripts = await LandScripts.create(this).catch(() => null);
      if (this.scripts && !setup.net) this.scripts.host.budgetMs = 4;
      this.savedScripts = this.scripts && this.loadedLand && setup.restore?.battle?.scripts;
      if (this.scripts) {
        if (q.has('noplans')) this.scripts.off = true;
        if (this.savedScripts) await this.scripts.host.compileAll();
        else await this.scripts.host.warm();
      }
      this.freeStores = new Map();
      this.freeStoreJobs = [];
      if (this.scripts && !q.has('nofreestore') && !setup.benchmark)
        this.factions.forEach((f, side) => {
          if (!this.ai || !this.ai[side]) return;
          const human = !!this.players[side]?.human;
          if (human && !setup.net) return;
          this.freeStoreJobs.push(
            aiFreeStore(f)
              .then(fs => {
                if (!fs.land) return;
                const w = this.world,
                  held = () => new Set((this.ai[side].plans || []).flatMap(p => p.force));
                const attach = () =>
                  this.scripts.host.freeStore(
                    w.sidePlayers[side],
                    fs.land,
                    () => {
                      const h = held();
                      return w.squads.filter(
                        s =>
                          s.side === side &&
                          s.members.length &&
                          !s.structure &&
                          !s.arriving &&
                          !s.native &&
                          !s.members[0].inside &&
                          !s.members[0].flies &&
                          !s.aiPlan &&
                          !s.noAI &&
                          !s.mine &&
                          !s.busy &&
                          !s.pending &&
                          !s.entering &&
                          !h.has(s)
                      );
                    },
                    this.scripts.commanders[side]
                  );
                if (human) this.freeStores.set(side, attach);
                else attach();
              })
              .catch(() => {})
          );
        });
    }
    await this.audio.useAudioMode?.('Land');
    await TacticalStoryHost.create(this, this.scripts?.host, { restoring: !!this.savedScripts });
    if (this.savedScripts) {
      try {
        restoreBattleScripts(this, this.savedScripts, null, this.savedThing(this.loadedLand));
      } catch (error) {
        console.warn('the saved scripts could not be put back, they start over:', error);
        this.savedScripts = null;
      }
    }
    if (setup.net) await this.prepareLockstep();
    this.fit();
    this.listen('resize', () => this.fit());
    window.game = this;
    if (this.setup.benchmark) await this.startBenchmark(this.setup.benchmark);
    if (this.scripts && !setup.net && !q.has('nowarm') && !this.savedScripts)
      await this.scripts.host.settle().catch(e => console.warn('scripts settle', e));
    if (!q.has('nowarm')) await this.warmFrames().catch(e => console.warn('warm frames', e));
    if (!setup.attract) hideSplash();
    $('loading').classList.add('hidden');
    await endLoadScreen({ direct: setup.benchmark || setup.restore || setup.direct || setup.net, unlock: () => this.audio.unlock?.() });
    this.bench?.restart();
    this.last = performance.now();
    requestAnimationFrame(this.frame);
    if (!setup.campaign)
      this.say('Take reinforcement points with infantry, build from your command centre, destroy the enemy command centre');
  }

  landSnapshot(name, { version, build }) {
    const w = this.world,
      s = this.setup,
      r1 = v => Math.round(v * 10) / 10;
    const live = w.squads.filter(q => !q.structure && !q.arriving && q.members.length);
    let scripts = null;
    try {
      scripts = saveBattleScripts(this, this.thingRef(live));
    } catch (error) {
      console.warn('the battle is saved without its scripts (they start over when it is loaded):', error.message || error);
    }
    return {
      format: 'sw-revival-save',
      version,
      build,
      saved: new Date().toISOString(),
      name:
        name ||
        `${db.t(this.map.textId) || this.map.planet || 'Land skirmish'} — ${Math.floor(w.time / 60)}:${String(Math.floor(w.time % 60)).padStart(2, '0')}`,
      setup: {
        mode: 'land',
        preBuilt: s.preBuilt !== false,
        mapFile: s.mapFile,
        credits: s.credits,
        popCap: s.popCap,
        fog: s.fog,
        teamFactions: s.teamFactions.slice(),
        players: s.players.map(p => ({ human: !!p.human, team: p.team, color: p.color, difficulty: p.difficulty }))
      },
      mode: 'land',
      summary: {
        mode: 'land',
        planet: this.map.planet || '',
        factions: s.teamFactions.slice(),
        time: Math.round(w.time),
        units: live.filter(q => q.side === this.me).length
      },
      battle: {
        kind: 'land',
        time: r1(w.time),
        speed: this.speed,
        view: {
          x: r1(this.view.x),
          y: r1(this.view.y),
          dist: r1(this.view.dist),
          yaw: +this.view.yaw.toFixed(3),
          pitch: +this.view.pitch.toFixed(3)
        },
        weather: { i: w.weather.i, left: r1(w.weather.left) },
        captured: w.units
          .filter(u => u.capturable && !u.dead)
          .map(u => ({ pt: w.points.indexOf(u.capturable), hp: r1(u.health), sh: r1(u.shield) })),
        houses: w.units
          .filter(u => u.house && !u.dead)
          .map(u => ({ x: Math.round(u.x), y: Math.round(u.y), hp: r1(u.health), timer: r1(u.house.timer) })),
        queues: w.queues.map(q => ({
          units: q.units.map(x => [x.type.name, r1(x.left)]),
          upgrades: q.upgrades.map(x => [x.type.name, r1(x.left)])
        })),
        owned: w.owned.map(s => [...s]),
        credits: w.credits.map(Math.round),
        ready: w.ready.map(l => l.map(t => t.name)),
        points: w.points.map(p => ({ side: p.side, taker: p.taker, progress: +p.progress.toFixed(3) })),
        sites: w.sites.map(st => ({
          structure:
            st.structure && !st.structure.dead
              ? {
                  uc: st.builtFrom || '',
                  type: st.structure.type.name,
                  side: st.structure.side,
                  hp: r1(st.structure.health),
                  sh: r1(st.structure.shield)
                }
              : null,
          building: st.building ? { uc: st.building.uc.name, side: st.building.side, left: r1(st.building.left) } : null
        })),
        squads: live.map(q => ({
          type: q.type.name,
          side: q.side,
          co: q.company,
          in: q.members[0].inside && q.members[0].inside.site ? w.sites.indexOf(q.members[0].inside.site) : -1,
          home: q.native
            ? (h => (h ? [Math.round(h.x), Math.round(h.y)] : null))(w.units.find(u => u.house && u.house.out.includes(q)))
            : undefined,
          ab: q.abilities.map(a => [
            a.def.kind,
            a.active && a.def.toggle ? 1 : 0,
            Math.round(a.active && !a.def.toggle ? a.def.recharge : Math.max(0, a.cooldown))
          ]),
          members: q.members.map(u => ({
            type: u.type.name,
            x: r1(u.x),
            y: r1(u.y),
            h: +u.heading.toFixed(3),
            hp: r1(u.health),
            sh: r1(u.shield),
            o: [u.off.x, u.off.y]
          }))
        })),
        landing: w.transports
          .filter(t => t.stage === 'land')
          .map(t => ({
            type: t.typeName,
            side: t.side,
            x: r1(t.x),
            y: r1(t.y),
            ...(this.invasionBook?.transports.has(t) ? { gid: this.invasionBook.transports.get(t) } : {})
          })),
        ...(this.landRetreat
          ? {
              retreat: this.landRetreat.snapshot(u => {
                const i = live.indexOf(u.squad);
                return i >= 0 && !u.dead ? 'q' + i + '.' + live[i].members.indexOf(u) : null;
              })
            }
          : {}),
        ...(scripts ? { scripts } : {})
      },
      ...(s.campaign && this.invasionBook ? { campaign: this.landCampaign(live) } : {})
    };
  }

  landCampaign(live) {
    const w = this.world,
      book = this.invasionBook;
    const sq = q => {
        const i = live.indexOf(q);
        return i >= 0 ? 'q' + i : null;
      },
      st = u => {
        const i = u && !u.dead && u.site ? w.sites.indexOf(u.site) : -1;
        return i >= 0 ? 's' + i : null;
      };
    return {
      setup: campaignSetup(this),
      book: {
        companies: [...book.companies].map(([gid, list]) => [gid, list.map(sq).filter(Boolean)]),
        structures: [...book.structures].map(([gid, list]) => [gid, list.map(st).filter(Boolean)]),
        replacements: [...book.replacements].map(([u, gid]) => [st(u), gid]).filter(([r]) => r),
        proxyStructures: [...book.proxyStructures],
        lostStructures: [...book.lostStructures],
        waiting: book.waiting.map(u => ({ ...u, type: u.type.name })),
        absent: book.absent.slice(),
        persistent: [...book.persistent].map(([key, e]) => [
          key,
          { type: e.type, owner: e.owner, position: e.position, baseLevel: e.baseLevel, unit: st(e.unit) }
        ])
      }
    };
  }

  restoreLandCampaign(c, made) {
    const w = this.world,
      book = this.invasionBook;
    const sq = r => made.squads[+String(r).slice(1)] || null,
      st = r => (r ? w.sites[+String(r).slice(1)]?.structure || null : null);
    book.companies = new Map(c.book.companies.map(([gid, refs]) => [gid, refs.map(sq).filter(Boolean)]));
    (made.landing || []).forEach((q, i) => {
      const gid = made.landingGids[i];
      if (q && gid !== undefined) book.companies.set(gid, q.mates || [q]);
    });
    book.structures = new Map(c.book.structures.map(([gid, refs]) => [gid, refs.map(st).filter(Boolean)]));
    book.replacements = new Map(c.book.replacements.map(([r, gid]) => [st(r), gid]).filter(([u]) => u));
    book.proxyStructures = new Set(c.book.proxyStructures);
    book.lostStructures = new Set(c.book.lostStructures);
    book.waiting = c.book.waiting.map(u => ({ ...u, type: db.type(u.type) })).filter(u => u.type);
    book.absent = c.book.absent.slice();
    book.transports = new Map();
    book.pending = 0;
    book.persistent = new Map(
      c.book.persistent.map(([key, e]) => {
        const unit = st(e.unit);
        return [key, { ...e, position: e.position.slice(), unit, site: unit?.site || null }];
      })
    );
  }

  thingRef(live) {
    const w = this.world,
      sites = x => w.sites.indexOf(x),
      points = x => w.points.indexOf(x);
    return x => {
      if (!x) return null;
      if (x.isPoint && x.point) {
        const i = points(x.point);
        return i >= 0 ? 'pt' + i : null;
      }
      if (x.isSite && x.site) {
        const i = sites(x.site);
        return i >= 0 ? 'st' + i : null;
      }
      if (x.dead) return null;
      const placed = () => {
        const list = w.mapObjects?.get(x.mapIndex) || [],
          k = list.indexOf(x);
        return k >= 0 ? 'm' + x.mapIndex + (k ? '.' + k : '') : null;
      };
      if (x.members) {
        const i = live.indexOf(x);
        if (i >= 0) return 'q' + i;
        const u = x.members[0],
          si = u && u.site ? sites(u.site) : -1;
        if (si >= 0) return 'sq' + si;
        if (x.mapIndex !== undefined) return placed();
        return x.structure && u ? 'at:' + x.type.name + ':' + Math.round(u.x) + ':' + Math.round(u.y) : null;
      }
      if (x.site) {
        const i = sites(x.site);
        if (i >= 0) return 's' + i;
      }
      if (x.capturable) {
        const i = points(x.capturable);
        if (i >= 0) return 'c' + i;
      }
      if (x.squad) {
        const i = live.indexOf(x.squad);
        if (i >= 0) return 'q' + i + '.' + x.squad.members.indexOf(x);
      }
      if (x.mapIndex !== undefined) return placed();
      return x.structure && x.type ? 'at:' + x.type.name + ':' + Math.round(x.x) + ':' + Math.round(x.y) : null;
    };
  }

  savedThing(made) {
    const w = this.world,
      view = this.scripts?.view;
    return r => {
      const at = /^at:(.+):(-?\d+):(-?\d+)$/.exec(String(r || ''));
      if (at) {
        const near = u => u && !u.dead && Math.abs(u.x - +at[2]) < 2 && Math.abs(u.y - +at[3]) < 2;
        return (
          w.squads.find(q => q.structure && q.type.name === at[1] && near(q.members[0])) ||
          w.units.find(u => u.structure && u.type.name === at[1] && near(u)) ||
          null
        );
      }
      const m = /^(q|sq|s|c|pt|st|m)(\d+)(?:\.(\d+))?$/.exec(String(r || ''));
      if (!m) return null;
      const i = +m[2];
      switch (m[1]) {
        case 'q': {
          const q = made.squads[i];
          return m[3] === undefined ? q || null : q?.members[+m[3]] || null;
        }
        case 'sq':
          return w.sites[i]?.structure?.squad || null;
        case 's':
          return w.sites[i]?.structure || null;
        case 'c':
          return w.units.find(u => !u.dead && u.capturable === w.points[i]) || null;
        case 'pt':
          return w.points[i] && view ? view.point(w.points[i]) : null;
        case 'st':
          return w.sites[i] && view ? view.site(w.sites[i]) : null;
        case 'm': {
          const x = (w.mapObjects?.get(i) || [])[m[3] === undefined ? 0 : +m[3]];
          return x && !x.dead ? x : null;
        }
      }
      return null;
    };
  }

  async landRestore(b) {
    const w = this.world;
    w.time = b.time || 0;
    if (!this.setup.net) this.speed = b.speed || 1;
    if (b.credits) w.credits = b.credits.slice();
    (b.owned || []).forEach((l, i) => {
      if (w.owned[i]) for (const n of l) w.owned[i].add(n);
    });
    w.ready = (b.ready || []).map(l => l.map(n => db.type(n)).filter(Boolean));
    while (w.ready.length < this.factions.length) w.ready.push([]);
    const reorder = (side, name, left) => {
      const t = db.type(name);
      if (!t || !w.queues[side]) return;
      const from = w.units.find(u => u.structure && !u.dead && w.ally(u.side, side) && u.builds && u.builds.includes(t));
      w.queueOf(side, t).push({ type: t, left, total: Math.max(left, timeOf(t) * w.mods[side].build), from, side });
    };
    this.reorder = reorder;
    (b.points || []).forEach((p, i) => {
      const pt = w.points[i];
      if (!pt) return;
      pt.side = p.side;
      pt.taker = p.taker;
      pt.progress = p.progress || 0;
      w.showOwner(pt);
    });
    this.later = [];
    await Promise.all(
      (b.sites || []).map(async (sv, i) => {
        const st = w.sites[i];
        if (!st) return;
        if (st.structure && !sv.structure) {
          const u = st.structure;
          w.unstamp(u);
          u.dead = true;
          u.died = -1e9;
          st.structure = null;
          u.squad.members = [];
        }
        if (sv.structure) {
          if (!st.structure) {
            const t = db.type(sv.structure.uc) || db.type(sv.structure.type);
            if (t) await w.finishSite(st, t, sv.structure.side);
          }
          const u = st.structure;
          if (u) {
            u.health = Math.min(u.maxHealth, sv.structure.hp);
            u.shield = Math.min(u.maxShield, sv.structure.sh || 0);
            for (const q of sv.structure.queue || []) this.later.push([sv.structure.side, q.type, q.left]);
          }
        }
        if (sv.building) {
          const uc = db.type(sv.building.uc);
          if (uc) st.building = { uc, type: uc, side: sv.building.side, left: sv.building.left, total: timeOf(uc) };
        }
      })
    );
    const raze = u => {
      w.unstamp(u);
      u.dead = true;
      u.died = -1e9;
      if (u.site) u.site.structure = null;
      u.squad.members = [];
    };
    const houseAt = at => at && w.units.find(u => u.house && !u.dead && Math.abs(u.x - at[0]) < 2 && Math.abs(u.y - at[1]) < 2);
    if (b.captured) {
      tickCapturables(w);
      for (const u of w.units.filter(x => x.capturable)) {
        const sv = b.captured.find(c => c.pt === w.points.indexOf(u.capturable));
        if (!sv) {
          raze(u);
          continue;
        }
        u.health = Math.min(u.maxHealth, sv.hp);
        u.shield = Math.min(u.maxShield, sv.sh || 0);
        for (const q of sv.queue || []) this.later.push([u.side, q.type, q.left]);
      }
    }
    if (b.houses)
      for (const u of w.units.filter(x => x.house)) {
        const sv = b.houses.find(h => Math.abs(h.x - u.x) < 2 && Math.abs(h.y - u.y) < 2);
        if (!sv) raze(u);
        else {
          u.health = Math.min(u.maxHealth, sv.hp);
          u.house.timer = sv.timer ?? u.house.timer;
        }
      }
    if (b.weather && w.weather.phases.length) {
      const wx = w.weather,
        ph = wx.phases[b.weather.i % wx.phases.length];
      wx.i = b.weather.i % wx.phases.length;
      wx.left = b.weather.left;
      wx.name = ph.name;
      wx.strength = ph.strength;
    }
    const squads = await Promise.all(
      (b.squads || []).map(q => {
        const m = q.members[0];
        return m
          ? w.spawn(q.type, m.x, m.y, m.h, q.side, q.members).then(sq => {
              if (sq && q.co !== undefined) sq.company = 's' + q.co;
              if (sq && q.in >= 0 && w.sites[q.in] && w.sites[q.in].structure) putInside(w, sq, w.sites[q.in].structure);
              if (sq && q.home) {
                sq.native = true;
                for (const u of sq.members) u.captures = false;
                const h = houseAt(q.home);
                if (h) h.house.out.push(sq);
              }
              for (const [kind, on, cd] of (sq && q.ab) || []) {
                const st = sq.abilityState(kind);
                if (!st) continue;
                st.cooldown = cd;
                if (on) w.useAbility(sq, kind);
              }
              return sq;
            })
          : null;
      })
    );
    const landing = await Promise.all((b.landing || []).map(l => w.spawn(l.type, l.x, l.y, 0, l.side)));
    (b.queues || []).forEach((q, side) => {
      for (const [n, left] of q.units || []) reorder(side, n, left);
      for (const [n, left] of q.upgrades || []) reorder(side, n, left);
    });
    for (const [side, n, left] of this.later) reorder(side, n, left);
    adoptGarrisons(w);
    this.say(`Loaded: ${this.setup.restore.name}`);
    return { squads, landing, landingGids: (b.landing || []).map(l => l.gid) };
  }

  async applyEnvironment(env) {
    this.map.environment = env;
    if (env) {
      setPlanetEnvironment(env);
      const [sun, f1, f2] = env.lights,
        n = v => new THREE.Vector3(...v).normalize();
      lighting.sunDir.value.copy(n(sun.dir));
      lighting.sunColor.value.setRGB(...sun.color.map(c => c * 1.6));
      lighting.fillDir.value.copy(n(f1.dir).add(n(f2.dir)).normalize());
      lighting.fillColor.value.setRGB(...f1.color.map((c, i) => (c + f2.color[i]) * 0.8));
      lighting.ambient.value.setRGB(...env.ambient.map(c => Math.max(c, 0.25)));
    }

    const generation = (this.environmentGeneration = (this.environmentGeneration || 0) + 1);
    this.environmentSkies ||= new Map();
    let entry = this.environmentSkies.get(env);
    if (!entry) {
      entry = { sky: new THREE.Scene(), ticks: [] };
      this.environmentSkies.set(env, entry);
      entry.loading = (async () => {
        for (const type of (env && env.landSkies) || []) {
          const file = type.str('Land_Model_Name'),
            inst = await loadModel(file).catch(() => null);
          if (!inst) continue;
          inst.root.scale.setScalar(type.num('Scale_Factor', 1));
          const [ax, az] = env.skyAngles?.[type.name.toUpperCase()] || [0, 0];
          inst.root.quaternion
            .setFromEuler(new THREE.Euler((ax * Math.PI) / 180, 0, (az * Math.PI) / 180, 'ZYX'))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
          const data = await loadALO(file).catch(() => null);
          const domes = new Map(
            (data ? data.meshes : [])
              .filter(m => /skydome/i.test(m.subs[0]?.material.shader || ''))
              .map(m => [m.name.toUpperCase(), m.subs[0].material.params])
          );
          for (const [name, node] of inst.meshByName)
            node.traverse(o => {
              if (!o.isMesh) return;
              const params = domes.get(name);
              if (params) {
                o.material = skyMaterial(params);
                entry.ticks.push(o.material.userData.tick);
              } else {
                const src = o.material;
                o.material = src.clone();
                if (src.uniforms?.map) o.material.uniforms.map.value = src.uniforms.map.value;
                o.material.depthTest = false;
                o.material.depthWrite = false;
              }
              o.frustumCulled = false;
            });
          entry.sky.add(inst.root);
          break;
        }
      })();
    }
    await entry.loading;
    if (generation !== this.environmentGeneration) return;
    this.sky = entry.sky;
    this.skyTick = entry.ticks;
  }
  setEnvironmentIndex(n) {
    const envs = this.map?.environments || [];
    if (!envs.length) return;
    const i = Math.max(0, Math.min(envs.length - 1, n | 0));
    this.map.activeEnvironment = i;
    this.applyEnvironment(envs[i]).catch(error => console.warn('environment', error));
  }
  setCinematicEnvironment(on) {
    const map = this.map,
      cinematic = map.environments?.findIndex(e => e.name === 'Cinematic');
    if (on) {
      if (cinematic === undefined || cinematic < 0 || this.savedEnvironment) return;
      this.savedEnvironment = { environment: map.environment, index: map.activeEnvironment };
      map.activeEnvironment = cinematic;
      this.applyEnvironment(map.environments[cinematic]).catch(error => console.warn('cinematic environment', error));
    } else if (this.savedEnvironment) {
      const saved = this.savedEnvironment;
      this.savedEnvironment = null;
      map.activeEnvironment = saved.index;
      this.applyEnvironment(saved.environment).catch(error => console.warn('cinematic environment', error));
    }
  }

  fit() {
    this.renderer.setPixelRatio((this.ratioWas = pixelRatio()));
    this.renderer.setSize(innerWidth, innerHeight);
    if (this.gpu) {
      this.gpu.setPixelRatio(this.ratioWas);
      this.gpu.setSize(innerWidth, innerHeight);
    }
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  buildHud() {
    if (!document.getElementById('landHudCss')) {
      const st = document.createElement('style');
      st.id = 'landHudCss';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const bars = (this.bars = document.createElement('canvas'));
    bars.className = 'overlay';
    $('view').appendChild(bars);
  }

  say(text, cls = '', color = '', life = 6000) {
    if (!text) return;
    const box = $('messages');
    if (box.lastChild && box.lastChild.textContent === text) return;
    const d = document.createElement('div');
    d.textContent = text;
    d.className = cls;
    if (color) d.style.color = color;
    const wrap = document.createElement('p');
    wrap.style.margin = '0';
    wrap.appendChild(d);
    box.appendChild(wrap);
    while (box.childElementCount > 5) box.firstChild.remove();
    setTimeout(() => wrap.remove(), life);
  }

  tacticalCredits() {
    const w = this.world,
      out = {};
    (w.tacticalSessions || []).forEach((s, side) => {
      if (!s) return;
      const left = w.credits[side] || 0,
        id = String(this.factions[side]).toUpperCase();
      if (!s.ai) {
        out[id] = { credits: Math.max(0, left), ai: false };
        return;
      }
      const delta = left - s.released;
      out[id] = { credits: Math.max(0, s.reserve + (delta > 0 ? delta * s.adjust : delta)), ai: true, delta, parts: s.parts };
    });
    return out;
  }

  lookAt(p) {
    this.following = null;
    this.view.x = p.x;
    this.view.y = p.y;
  }

  touchView(dx, dy, turn) {
    if (this.controlsLocked || this.cine.on || this.menus.open) return;
    const v = this.view,
      k = (v.dist * 1.1) / innerHeight,
      fx = -Math.cos(v.yaw),
      fy = -Math.sin(v.yaw),
      f = dy * k,
      r = -dx * k;
    v.x += fx * f + fy * r;
    v.y += fy * f - fx * r;
    v.yaw += turn;
  }

  startTrack(q, whole) {
    this.following = q;
    (this.track ||= new TrackCam(this.renderer.domElement, () => this.endTrack())).start(whole);
  }

  endTrack() {
    if (!this.direct) this.following = null;
    if (!this.track?.on) return;
    this.track.stop();
    if (this.viewDist) this.view.dist = this.viewDist(this.view.dist);
    if (this.viewTilt) this.view.pitch = this.viewTilt(this.view.dist);
  }

  toggleDirect() {
    if (this.direct) return this.releaseDirect();
    if (!globalThis.directControl) return;
    if (this.lock) {
      this.say('Direct control is not available in multiplayer', 'bad');
      return;
    }
    const q = this.ui.selection.find(
      s => !s.dead && s.side === this.me && !s.structure && s.members?.length && s.members[0].x !== undefined && !s.members[0].inside
    );
    if (!q) {
      this.say('Select one of your units to take control of it', 'bad');
      return;
    }
    this.ui.placing = this.ui.armed = this.ui.aiming = null;
    q.foe = null;
    for (const m of q.members) {
      m.path = [];
      m.target = null;
    }
    const D = {
      turn: 0,
      throttle: 0,
      firing: false,
      target: null,
      lead: q.members[0],
      spot: { x: 0, y: 0, z: 0, aimZ: 0, hitRadius: 0, kind: 'INFANTRY', dead: false, side: -1, mvx: 0, mvy: 0, mvz: 0, path: [] }
    };
    D.slots = new Map();
    q.direct = D;
    for (const m of q.members) m.direct = D;
    this.endTrack();
    this.direct = q;
    this.following = q;
    this.ui.select([q]);
    this.directNote(true);
  }

  releaseDirect() {
    const q = this.direct;
    if (!q) return;
    for (const m of q.members) m.direct = null;
    if (q.direct && q.direct.lead) q.direct.lead.direct = null;
    q.direct = null;
    this.direct = null;
    this.following = null;
    this.fireHeld = false;
    this.chase?.exit();
    this.directNote(false);
  }

  toggleChase() {
    const C = (this.chase ||= new ChaseView(this.renderer.domElement));
    C.onLost = () => C.exit();
    if (C.on) {
      C.exit();
      return;
    }
    const q = this.direct,
      u = q.direct?.lead;
    let spread = 0;
    if (u) for (const m of q.members) spread = Math.max(spread, Math.hypot(m.x - u.x, m.y - u.y));
    if (u) C.enter(u.x, u.y, u.z, Math.max(u.hitRadius || 0, u.aimZ || 0, 8), u.heading, 40 + spread * 1.6, u.holder);
  }

  steerDirect() {
    const q = this.direct,
      D = q && q.direct,
      k = this.keys,
      m = this.ui.mouse;
    if (!D) return false;
    if (q.dead || !q.members.length || !globalThis.directControl) {
      this.releaseDirect();
      return false;
    }
    if (q.members[0] !== D.lead) {
      D.lead = q.members[0];
      D.slots.clear();
    }
    for (const m of q.members) m.direct = D;
    D.turn = (held(k, 'SCROLL_RIGHT') ? 1 : 0) - (held(k, 'SCROLL_LEFT') ? 1 : 0);
    D.throttle = (held(k, 'SCROLL_UP') ? 1 : 0) - (held(k, 'SCROLL_DOWN') ? 1 : 0);
    let t = null;
    const C = this.chase;
    if (C && C.on) {
      const L = D.lead,
        W = innerWidth / 2,
        H = innerHeight / 2;
      C.setPivot(L.x, L.y, L.z);
      const u = this.unitAt(W, H);
      if (u && !u.dead && u.side >= 0 && this.world.enemy(L, u)) t = u;
      else {
        const g = this.groundAt(W, H);
        if (g) {
          const s = D.spot;
          s.x = g.x;
          s.y = g.y;
          s.z = heightAt(this.terrain, g.x, g.y);
          t = s;
        }
      }
      D.target = t;
      D.firing = !!this.fireHeld && !!t;
      C.aim(q.members.some(u => this.world.directBears(u, t)) ? 'in' : 'out');
      return true;
    }
    if (m.inside) {
      const u = this.unitAt(m.x, m.y);
      if (u && !u.dead && u.side >= 0 && this.world.enemy(D.lead, u)) t = u;
      else {
        const g = this.groundAt(m.x, m.y);
        if (g) {
          const s = D.spot;
          s.x = g.x;
          s.y = g.y;
          s.z = heightAt(this.terrain, g.x, g.y);
          t = s;
        }
      }
    }
    D.target = t;
    D.firing = !!this.fireHeld && !!t;
    return true;
  }

  directNote(on) {
    if (!this.directEl) {
      const d = (this.directEl = document.createElement('div'));
      d.style.cssText =
        'position:fixed;left:50%;top:56px;transform:translateX(-50%);z-index:50;pointer-events:none;font:13px "Segoe UI",sans-serif;color:#ffd76a;text-shadow:0 0 3px #000,0 0 3px #000';
      document.body.appendChild(d);
    }
    this.directEl.textContent = `Direct control: W A S D to steer, hold the left button to fire, ${keyName(keysOf('DIRECT_VIEW')[0] || null)} for the view behind it, V or Esc to let go`;
    this.directEl.style.display = on ? 'block' : 'none';
  }

  moveLayout(scene) {
    const ui = this.ui,
      dn = this.down,
      m = ui.mouse,
      marks = (this.moveMarks ||= []);
    let A = null;
    const squads =
      dn && dn[2] === 2 && !ui.placing && !ui.armed && globalThis.lineMove !== false ? ui.movers().filter(q => q.members.length) : [];
    const on = squads.length > 1 && Math.hypot(m.x - dn[0], m.y - dn[1]) > 5;
    if (on) {
      const a = this.groundAt(dn[0], dn[1]),
        b = this.groundAt(m.x, m.y);
      if (a && b) {
        const radii = squads.map(q => {
          const c = q.members.reduce((s, u) => [s[0] + u.x / q.members.length, s[1] + u.y / q.members.length], [0, 0]);
          return Math.max(15, ...q.members.map(u => Math.hypot(u.x - c[0], u.y - c[1]) + (u.hitRadius || 5)));
        });
        const L = laidOut(
          squads.map(q => q.type),
          radii,
          this.movePerm || 0,
          r => stretched(r, 12, a, b)
        );
        A = { squads, pts: L.pts, facing: L.facing, radii };
        showHand(
          L.seq.map(i => squads[i].type),
          m.x,
          m.y
        );
      }
    } else this.movePerm = 0;
    if (this.moveDragOn && !on) showHand(null);
    this.moveDragOn = on;
    this.moveAt = A;
    this.moveMat ||= new THREE.MeshBasicMaterial({
      color: 0x6be675,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.moveRing ||= new THREE.RingGeometry(0.88, 1, 40);
    this.moveTip ||= (() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([1.05, 0.22, 0, 1.05, -0.22, 0, 1.45, 0, 0], 3));
      return g;
    })();
    this.moveGhostsFor(scene, A);
    const n = A ? A.squads.length : 0;
    while (marks.length < n) {
      const g = new THREE.Group(),
        ring = new THREE.Mesh(this.moveRing, this.moveMat),
        tip = new THREE.Mesh(this.moveTip, this.moveMat);
      ring.renderOrder = tip.renderOrder = 9;
      g.add(ring, tip);
      scene.add(g);
      marks.push(g);
    }
    marks.forEach((g, i) => {
      g.visible = i < n;
      if (i >= n) return;
      const p = A.pts[i],
        r = A.radii[i];
      g.position.set(p.x, p.y, heightAt(this.terrain, p.x, p.y) + 2);
      g.scale.setScalar(r);
      g.rotation.z = A.facing;
    });
  }

  moveGhostsFor(scene, A) {
    const G = this.moveGhosts;
    if (!A) {
      if (G) {
        for (const o of G.list) scene.remove(o.holder);
        this.moveGhosts = null;
      }
      return;
    }
    if (!G || G.squads !== A.squads.map(q => q.id).join()) {
      if (G) for (const o of G.list) scene.remove(o.holder);
      this.ghostMat ||= new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { tint: { value: new THREE.Color(0x55ff77) } },
        vertexShader:
          'varying vec3 vN, vP; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = mat3(modelMatrix) * normal; gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader:
          'uniform vec3 tint; varying vec3 vN, vP; void main() { float f = abs(dot(normalize(vN), normalize(cameraPosition - vP))); gl_FragColor = vec4(tint * (0.55 + 0.75 * (1.0 - f)), 0.3 + 0.4 * (1.0 - f)); }'
      });
      const mat = this.ghostMat,
        list = [];
      for (const q of A.squads) {
        const m = q.members.filter(u => !u.dead && u.x !== undefined),
          cx = m.reduce((s, u) => s + u.x, 0) / m.length,
          cy = m.reduce((s, u) => s + u.y, 0) / m.length;
        const h = m[0].heading,
          ch = Math.cos(h),
          sh = Math.sin(h);
        for (const u of m) {
          const file = u.type.str('Land_Model_Name');
          if (!file) continue;
          const holder = new THREE.Group();
          holder.visible = false;
          holder.scale.setScalar(u.holder ? u.holder.scale.x : 1);
          scene.add(holder);
          const dx = u.x - cx,
            dy = u.y - cy;
          const entry = {
            q,
            u,
            holder,
            inst: null,
            a: dx * ch + dy * sh,
            c: -dx * sh + dy * ch,
            turn: u.heading - h,
            up: (u.z || 0) - heightAt(this.terrain, u.x, u.y)
          };
          list.push(entry);
          loadModel(file)
            .then(inst => {
              if (!inst || !this.moveGhosts || !this.moveGhosts.list.includes(entry)) return;
              inst.root.traverse(o => {
                if (!o.isMesh) return;
                if (o.material.transparent || o.material.userData?.additive) {
                  o.visible = false;
                  return;
                }
                const gm = this.ghostMaterialOf(o.material);
                o.material = gm;
                o.renderOrder = 7;
                const si = inst.skins ? inst.skins.findIndex(s => s.mesh === o) : -1,
                  src = si >= 0 && u.inst && u.inst.skins ? u.inst.skins[si] : null;
                o.onBeforeRender = src
                  ? () => {
                      if (src.mats) {
                        gm.uniforms.boneMatrices.value = src.mats;
                        gm.uniformsNeedUpdate = true;
                      }
                    }
                  : () => {};
              });
              entry.inst = inst;
              holder.add(inst.root);
            })
            .catch(() => {});
        }
      }
      this.moveGhosts = { squads: A.squads.map(q => q.id).join(), list };
    }
    const ch = Math.cos(A.facing),
      sh = Math.sin(A.facing);
    for (const o of this.moveGhosts.list) {
      const gb = o.inst && o.inst.bones,
        sb = o.u.inst && o.u.inst.bones;
      if (gb && sb && gb.length === sb.length)
        for (let k = 0; k < gb.length; k++) {
          if (gb[k] && sb[k]) {
            gb[k].position.copy(sb[k].position);
            gb[k].quaternion.copy(sb[k].quaternion);
            gb[k].scale.copy(sb[k].scale);
          }
        }
      const i = A.squads.indexOf(o.q),
        p = A.pts[i];
      if (!p) {
        o.holder.visible = false;
        continue;
      }
      const x = p.x + ch * o.a - sh * o.c,
        y = p.y + sh * o.a + ch * o.c;
      o.holder.position.set(x, y, heightAt(this.terrain, x, y) + o.up);
      o.holder.rotation.z = A.facing + o.turn + Math.PI / 2;
      o.holder.visible = true;
    }
  }

  ghostMaterialOf(m) {
    const memo = (this.ghostMats ||= new Map());
    let g = memo.get(m);
    if (g) return g;
    if (!m.isShaderMaterial || !m.uniforms || !('ghost' in m.uniforms)) g = this.ghostMat;
    else {
      g = m.clone();
      g.uniforms = { ...m.uniforms, ghost: { value: 1 }, tint: { value: new THREE.Vector4(0.33, 1, 0.47, 0.7) } };
      if (m.uniforms.boneMatrices) g.uniforms.boneMatrices = { value: m.uniforms.boneMatrices.value };
    }
    memo.set(m, g);
    return g;
  }

  landGhost(type, scene) {
    this.ghostMat ||= new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { tint: { value: new THREE.Color(0x55ff77) } },
      vertexShader:
        'varying vec3 vN, vP; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vN = mat3(modelMatrix) * normal; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader:
        'uniform vec3 tint; varying vec3 vN, vP; void main() { float f = abs(dot(normalize(vN), normalize(cameraPosition - vP))); gl_FragColor = vec4(tint * (0.55 + 0.75 * (1.0 - f)), 0.3 + 0.4 * (1.0 - f)); }'
    });
    const mat = this.ghostMat.clone(),
      c = this.world.craftOf(type.name),
      holder = new THREE.Group();
    const gh = { type, holder, mat, r: 0 };
    holder.visible = false;
    scene.add(holder);
    if (c) {
      holder.scale.setScalar(c.scale);
      loadModel(c.file)
        .then(inst => {
          inst.root.traverse(o => {
            if (!o.isMesh) return;
            if (o.material.transparent) {
              o.visible = false;
              return;
            }
            o.material = mat;
            o.onBeforeRender = () => {};
            o.renderOrder = 7;
          });
          const b = new THREE.Box3(),
            s = new THREE.Vector3();
          inst.root.updateMatrixWorld(true);
          inst.root.traverse(o => {
            if (o.isMesh && o.visible && o.geometry) {
              o.geometry.computeBoundingBox();
              b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
            }
          });
          if (!b.isEmpty()) {
            b.getSize(s);
            gh.r = (Math.max(s.x, s.y) / 2) * c.scale;
          }
          holder.add(inst.root);
        })
        .catch(() => {});
    }
    return gh;
  }

  placeSlots(list, x, y, from = null) {
    const w = this.world,
      G = this.ghosts || [],
      h = this.ui.placeTurn || 0,
      radii = list.map((t, i) => Math.max(40, G[i]?.r || 0));
    let L;
    if (from) {
      L = laidOut(list, radii, this.ui.placePerm || 0, r => stretched(r, 20, from, { x, y }));
      this.placeFace = globalThis.reinforceTurn !== false ? L.facing : h;
    } else {
      L = laidOut(list, radii, this.ui.placePerm || 0, r => formation(r, 20).map(o => slotAt(o, x, y, h)));
      this.placeFace = h;
    }
    const pts = L.pts;
    this.placeSeq = L.seq;
    let extra = 0;
    return list.map((t, i) => {
      const p = pts[i];
      p.why = w.cantReinforce(this.me, t.name, p.x, p.y, extra);
      extra += landPop(t);
      return p;
    });
  }

  bindInput() {
    const el = this.renderer.domElement,
      v = this.view,
      ui = this.ui,
      w = this.world,
      me = this.me;
    const addEventListener = (ev, fn, opts) => this.listen(ev, fn, opts);
    addEventListener('keydown', e => {
      if (
        e.code === 'Escape' &&
        (this.controlsLocked || this.tacticalCinematics?.on || this.tacticalMovies?.active) &&
        this.scripts?.host.storyEscape()
      ) {
        e.preventDefault();
        return;
      }
      if (this.controlsLocked) return;
      if (e.code === 'F2' && !this.setup.attract) {
        e.preventDefault();
        this.toggleBenchmark();
        return;
      }
      if (pressed(e, 'DIRECT_CONTROL') && !this.menus.open) {
        this.toggleDirect();
        return;
      }
      if (pressed(e, 'DIRECT_VIEW') && this.direct && !this.menus.open) {
        this.toggleChase();
        return;
      }
      if (pressed(e, 'TOGGLE_HUD') && !this.menus.open) {
        document.body.classList.toggle('hud-hidden');
        return;
      }
      if (e.code === 'Escape' && this.track?.on) {
        this.endTrack();
        return;
      }
      if (e.code === 'Escape' && this.direct) {
        this.releaseDirect();
        return;
      }
      const squadCam = pressed(e, 'SQUAD_CAM');
      if ((squadCam || pressed(e, 'BATTLE_CAM')) && !this.menus.open) {
        e.preventDefault();
        const pick = ui.selection.find(s => !s.dead && s.members?.length);
        if (this.track?.on && this.track.whole !== squadCam) this.track.start(squadCam);
        else if (!this.cine.on && (this.following || pick)) {
          if (this.following) this.endTrack();
          else this.startTrack(pick, squadCam);
        } else if (!squadCam) this.cine.toggle();
        return;
      }
      if (this.cine.on) {
        if (e.code === 'Escape') this.cine.stop();
        else if (pressed(e, 'PAUSE')) this.togglePause();
        return;
      }
      if (e.code === 'Escape') {
        if (ui.placing || ui.armed) {
          ui.placing = ui.armed = ui.aiming = null;
        } else this.toggleMenu();
        return;
      }
      if (this.menus.open) return;
      if (this.lock && pressed(e, 'INITIATE_CHAT')) {
        e.preventDefault();
        this.openChat();
        return;
      }
      if (pressed(e, 'PAUSE')) this.togglePause();
      const order = [
        ['ATTACK', 'attack'],
        ['ATTACK_MOVE', 'attackmove'],
        ['MOVE', 'move'],
        ['GUARD', 'guard']
      ].find(([id]) => pressed(e, id))?.[1];
      if (order && ui.movers().length) ui.arm(order);
      if (pressed(e, 'STOP')) ui.stop();
      for (let n = 1; n <= 5; n++)
        if (pressed(e, 'ABILITY_' + n)) {
          const a = ui.bar?.abilityAt(n);
          if (a) ui.useAbility(a.kind, a.units);
        }
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    const k = this.cam.steps,
      far = k[k.length - 1];
    const tilt = d => {
      for (let i = 1; i < k.length; i++)
        if (d <= k[i][0]) return (k[i - 1][1] + ((k[i][1] - k[i - 1][1]) * Math.max(0, d - k[i - 1][0])) / (k[i][0] - k[i - 1][0])) * DEG;
      return far[1] * DEG;
    };
    v.dist = Math.min(far[0], Math.max(k[0][0], v.dist));
    v.pitch = tilt(v.dist);
    this.viewTilt = tilt;
    this.viewDist = d => Math.min(far[0], Math.max(k[0][0], d));
    el.addEventListener(
      'wheel',
      e => {
        if (this.controlsLocked) return;
        const dn = this.down,
          dragged = dn && Math.hypot(ui.mouse.x - dn[0], ui.mouse.y - dn[1]) > 5;
        if (this.moveDragOn) {
          this.movePerm = (this.movePerm || 0) + Math.sign(e.deltaY);
          return;
        }
        if (ui.placing && (e.shiftKey || (dragged && dn[2] === 0 && (ui.placeList || []).length > 1))) {
          ui.placePerm = (ui.placePerm || 0) + Math.sign(e.deltaY);
          return;
        }
        if (this.chase?.on) {
          this.chase.wheel(e.deltaY / 100);
          return;
        }
        if (this.track?.on) {
          v.dist = Math.min(far[0], Math.max(k[0][0] * 0.25, v.dist * Math.exp(e.deltaY * 0.0011)));
          return;
        }
        if (ui.placing && globalThis.reinforceTurn !== false) {
          ui.placeTurn = (ui.placeTurn || 0) + Math.sign(e.deltaY) * WHEEL_TURN;
          return;
        }
        v.dist = Math.min(far[0], Math.max(k[0][0], v.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
        v.pitch = tilt(v.dist);
      },
      { passive: true }
    );
    el.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      ui.mouse.x = e.clientX;
      ui.mouse.y = e.clientY;
      ui.mouse.inside = e.target === el;
      if (ui.bribeTip && !ui.bribeTip.hidden) {
        ui.bribeTip.style.left = e.clientX + 'px';
        ui.bribeTip.style.top = e.clientY + 'px';
      }
      if (this.chase?.on) {
        if (!this.controlsLocked) this.chase.look(e.movementX || 0, e.movementY || 0);
        return;
      }
      if (this.track?.on) {
        if (this.controlsLocked) return;
        v.yaw -= (e.movementX || 0) * TRACK_LOOK;
        v.pitch = Math.min(1.5, Math.max(0.02, v.pitch + (e.movementY || 0) * TRACK_LOOK));
        return;
      }
      if (
        this.ctrlTurn &&
        !this.turnDrag &&
        e.buttons & 2 &&
        Math.abs(e.clientX - this.ctrlTurn[0]) + Math.abs(e.clientY - this.ctrlTurn[1]) > 5
      ) {
        this.turnDrag = 'tilt';
        this.down = null;
      }
      if (!this.controlsLocked && (e.buttons & 4 || (this.turnDrag && e.buttons & 3))) v.yaw -= e.movementX * 0.005;
      if (!this.controlsLocked && this.turnDrag === 'tilt' && e.buttons & 2)
        v.pitch = Math.min(far[1] * DEG, Math.max(k[0][1] * DEG, v.pitch + e.movementY * 0.005));
    });
    const send = (x, y, mode = '') => {
      if (this.controlsLocked) return;
      const foe = this.unitAt(x, y),
        g = this.groundAt(x, y),
        attack = foe && !w.ally(foe.side, me) && !foe.dead;
      let spoke = false;
      const sel = ui.movers();
      if (!sel.length || (!attack && !g)) return;
      const r = this.command({ c: 'move', u: sel.map(q => q.id), mode, t: attack ? foe.squad.id : 0, ...(g ? { x: g.x, y: g.y } : {}) });
      const at = r?.at || new Map();
      for (const q of sel) {
        if (!attack && g && mode === 'attack' && q.members.some(u => u.needsDeploy && u.weapon)) {
          (this.pings ||= []).push({ x: g.x, y: g.y, t: 0, color: '#ff5544' });
          continue;
        }
        if (g || attack)
          (this.pings ||= []).push({
            x: attack ? foe.x : (at.get(q) || g).x,
            y: attack ? foe.y : (at.get(q) || g).y,
            t: 0,
            color: attack
              ? '#ff5544'
              : mode === 'attackmove'
                ? '#ffb347'
                : mode === 'waypoint'
                  ? '#7fd4ff'
                  : mode === 'guard'
                    ? '#4fb3ff'
                    : '#6be675'
          });
        if (!spoke) spoke = !!this.audio.play(q.members[0].type.str(attack ? 'SFXEvent_Attack' : 'SFXEvent_Move'));
      }
    };
    const place = (sx, sy, ex, ey) => {
      const list = ui.placeList || [ui.placing],
        from = ex !== undefined ? this.groundAt(sx, sy) : null;
      const g = ex !== undefined ? this.groundAt(ex, ey) : this.groundAt(sx, sy),
        at = g && (ex === undefined || from) && this.placeSlots(list, g.x, g.y, from);
      const why = !g ? 'Not on the map' : at.find(p => p.why)?.why;
      if (why) {
        this.say(why, 'bad');
        this.audio.play('GUI_Bad_Sound');
        ui.placing = null;
        this.hudTimer = 0;
        return;
      }
      list.forEach((t, i) => this.command({ c: 'reinforce', type: t.name, x: at[i].x, y: at[i].y, h: this.placeFace || 0 }));
      ui.placing = null;
      this.hudTimer = 0;
    };
    el.addEventListener('mousedown', e => {
      this.audio.unlock && this.audio.unlock();
      if (this.controlsLocked) {
        this.down = null;
        return;
      }
      if (this.cine.on) {
        this.cine.stop();
        this.down = null;
        return;
      }
      if (this.direct) {
        if (e.button === 0) this.fireHeld = true;
        this.down = null;
        return;
      }
      if (this.track?.on) {
        this.track.relock();
        this.down = null;
        return;
      }
      this.ctrlTurn = e.button === 2 && e.ctrlKey && !e.shiftKey && !e.altKey && !ui.placing ? [e.clientX, e.clientY] : null;
      if (bothButtonsRotate() && (e.buttons & 3) === 3 && !ui.placing) {
        this.turnDrag = true;
        this.down = null;
        return;
      }
      this.down = [e.clientX, e.clientY, e.button];
    });
    addEventListener('mouseup', e => {
      if (this.controlsLocked) {
        this.down = null;
        return;
      }
      if (e.button === 0 && this.fireHeld) {
        this.fireHeld = false;
        return;
      }
      if (e.button === 2) this.ctrlTurn = null;
      if ((e.button === 0 || e.button === 2) && this.turnDrag) {
        this.turnDrag = false;
        return;
      }
      const down = this.down;
      this.down = null;
      if (e.button === 0 && ui.placing && ui.dragPlace) {
        ui.dragPlace = false;
        if (e.target === el) place(e.clientX, e.clientY);
        return;
      }
      if (this.over || !down || e.button !== down[2]) return;
      const dragged = Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5;
      if (e.button === 0 && dragged && !ui.placing && !ui.armed) {
        const x0 = Math.min(down[0], e.clientX),
          x1 = Math.max(down[0], e.clientX),
          y0 = Math.min(down[1], e.clientY),
          y1 = Math.max(down[1], e.clientY);
        const p = this.proj || (this.proj = new THREE.Vector3()),
          hit = new Set();
        for (const u of w.units) {
          if (u.dead || u.side !== me || u.structure || u.inside || u.squad.native || u.squad.selectable === false) continue;
          p.set(u.x, u.y, u.z + 4).project(this.camera);
          const sx = ((p.x + 1) / 2) * innerWidth,
            sy = ((1 - p.y) / 2) * innerHeight;
          if (p.z < 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) hit.add(u.squad);
        }
        ui.select([...hit], e.shiftKey);
        if (hit.size) this.audio.play([...hit][0].members[0].type.str('SFXEvent_Select'));
        return;
      }
      if (e.target !== el && !dragged) return;
      if (e.target !== el && document.elementFromPoint(down[0], down[1]) !== el) return;
      const cx = down[0],
        cy = down[1];
      if (e.button === 0 && ui.placing) {
        if (dragged && (ui.placeList || []).length > 1) place(cx, cy, e.clientX, e.clientY);
        else place(cx, cy);
      } else if (e.button === 0 && ui.armed === 'bombing') {
        ui.bombAt(this.groundAt(cx, cy));
      } else if (e.button === 0 && ui.aiming) {
        ui.aimAt(this.unitAt(cx, cy), this.groundAt(cx, cy));
      } else if (e.button === 0 && ui.armed) {
        send(cx, cy, ui.armed);
        if (ui.armed !== 'waypoint') ui.armed = null;
        this.hudTimer = 0;
      } else if (e.button === 0) {
        const u = this.unitAt(cx, cy),
          g = this.groundAt(cx, cy);
        const pad = !u && g ? ui.padAt(g.x, g.y) : null;
        if (u && !u.dead && !u.squad.craft) {
          const now = performance.now(),
            twice = this.lastPick && now - this.lastPick.t < 400 && this.lastPick.type === u.squad.type && u.side === me && !u.structure;
          this.lastPick = { t: now, type: u.squad.type };
          if (twice) {
            const pr = this.proj || (this.proj = new THREE.Vector3());
            const same = w.squads.filter(
              q =>
                q.side === me &&
                q.type === u.squad.type &&
                q.members.length &&
                !q.structure &&
                !q.native &&
                !q.members[0].inside &&
                q.members.some(m => {
                  pr.set(m.x, m.y, m.z + 4).project(this.camera);
                  return pr.z < 1 && Math.abs(pr.x) <= 1 && Math.abs(pr.y) <= 1;
                })
            );
            ui.select(same, e.shiftKey);
            this.audio.play(u.type.str('SFXEvent_Select'));
          } else if (u.side === me || (u.structure && w.ally(u.side, me))) {
            ui.select([u.squad], e.shiftKey && ui.mine().length === ui.selection.length);
            this.audio.play(u.type.str('SFXEvent_Select'));
          } else if (u.side < 0 || w.ally(u.side, me)) ui.select([u.squad]);
        } else if (pad) ui.select([pad]);
        else if (!e.shiftKey) ui.select([]);
      } else if (e.button === 2) {
        if (ui.placing || ui.armed) {
          ui.placing = ui.armed = ui.aiming = null;
          this.hudTimer = 0;
        } else if (dragged && this.moveDragOn && this.moveAt) {
          const A = this.moveAt;
          this.command({
            c: 'formmove',
            p: A.squads.map((q, i) => [q.id, A.pts[i].x, A.pts[i].y]),
            h: A.facing,
            mode: e.ctrlKey ? 'attackmove' : ''
          });
          for (const p of A.pts) (this.pings ||= []).push({ x: p.x, y: p.y, t: 0, color: e.ctrlKey ? '#ffb347' : '#6be675' });
          this.audio.play(A.squads[0].members[0]?.type.str('SFXEvent_Move'));
        } else {
          const on = this.unitAt(cx, cy),
            g = this.groundAt(cx, cy);
          if (on && w.ally(on.side, me) && on.slots && ui.movers().length) ui.enter(on);
          else {
            if (g && !(on && !w.ally(on.side, me))) ui.leave(g);
            send(cx, cy);
          }
        }
      }
    });
  }

  groundAt(sx, sy) {
    const ray = this.ray || (this.ray = new THREE.Raycaster());
    ray.setFromCamera(new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), this.camera);
    const o = ray.ray.origin,
      d = ray.ray.direction;
    let prev = 0;
    for (let t = 10; t < 12000; t += 8) {
      const x = o.x + d.x * t,
        y = o.y + d.y * t,
        z = o.z + d.z * t;
      if (z <= heightAt(this.terrain, x, y)) {
        const m = (prev + t) / 2;
        return { x: o.x + d.x * m, y: o.y + d.y * m };
      }
      prev = t;
    }
    return null;
  }

  unitAt(sx, sy) {
    for (const h of this.iconHits || []) if (Math.abs(sx - h.x) <= h.r && Math.abs(sy - h.y) <= h.r) return h.u;
    const p = this.proj || (this.proj = new THREE.Vector3()),
      W = innerWidth,
      H = innerHeight;
    let best = null,
      bd = 1;
    const boxedBuilding = u => u.structure && u.inst && u.inst.box && !u.inst.box.isEmpty() && u.holder;
    for (const u of this.world.units) {
      if (u.seen === false || u.inside || u.dead) continue;
      if (boxedBuilding(u)) continue;
      p.set(u.x, u.y, u.z).project(this.camera);
      if (p.z >= 1) continue;
      const x0 = ((p.x + 1) / 2) * W,
        y0 = ((1 - p.y) / 2) * H;
      const tall = Math.max(8, (u.aimZ || 6) * 2.1);
      p.set(u.x, u.y, u.z + tall).project(this.camera);
      if (p.z >= 1) continue;
      const x1 = ((p.x + 1) / 2) * W,
        y1 = ((1 - p.y) / 2) * H;
      if (
        (x0 < -W / 4 && x1 < -W / 4) ||
        (x0 > W * 1.25 && x1 > W * 1.25) ||
        (y0 < -H / 4 && y1 < -H / 4) ||
        (y0 > H * 1.25 && y1 > H * 1.25)
      )
        continue;
      const len = Math.hypot(x1 - x0, y1 - y0) || 1,
        ppu = len / tall;
      const t = Math.max(0, Math.min(1, ((sx - x0) * (x1 - x0) + (sy - y0) * (y1 - y0)) / (len * len)));
      const d = Math.hypot(sx - (x0 + (x1 - x0) * t), sy - (y0 + (y1 - y0) * t));
      const half = Math.max(u.structure ? 30 : 12, (u.structure ? u.hitRadius : u.body || u.hitRadius || 6) * ppu * 1.15);
      if (d / half < bd) {
        bd = d / half;
        best = u;
      }
    }
    let boxed = null,
      area = Infinity;
    for (const u of this.world.units) {
      if (u.seen === false || u.inside || u.dead || u.structure || !u.inView || !u.inst || !u.inst.box || u.inst.box.isEmpty()) continue;
      const b = u.inst.box,
        m = u.holder.matrixWorld;
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity,
        behind = false;
      for (let i = 0; i < 8; i++) {
        p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
          .applyMatrix4(m)
          .project(this.camera);
        if (p.z >= 1) {
          behind = true;
          break;
        }
        const x = ((p.x + 1) / 2) * W,
          y = ((1 - p.y) / 2) * H;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      if (behind) continue;
      const gx = (x1 - x0) * 0.08,
        gy = (y1 - y0) * 0.08;
      if (sx < x0 + gx || sx > x1 - gx || sy < y0 + gy || sy > y1 - gy) continue;
      const ar = (x1 - x0) * (y1 - y0);
      if (ar < area) {
        area = ar;
        boxed = u;
      }
    }
    if (boxed && (!best || best.structure || bd > 0.6 || boxed === best)) return boxed;
    if (best) return best;
    const ray = (this.pickRay ||= new THREE.Raycaster()),
      inv = (this.pickInv ||= new THREE.Matrix4()),
      hit = (this.pickHit ||= new THREE.Vector3());
    ray.setFromCamera({ x: (sx / W) * 2 - 1, y: 1 - (sy / H) * 2 }, this.camera);
    const r0 = ray.ray.clone();
    let near = null,
      nd = Infinity;
    for (const u of this.world.units) {
      if (u.seen === false || u.inside || u.dead || !boxedBuilding(u)) continue;
      inv.copy(u.holder.matrixWorld).invert();
      const r = ray.ray.copy(r0).applyMatrix4(inv);
      if (!r.intersectBox(u.inst.box, hit)) continue;
      const d = hit.applyMatrix4(u.holder.matrixWorld).distanceTo(r0.origin);
      if (d < nd) {
        nd = d;
        near = u;
      }
    }
    ray.ray.copy(r0);
    if (near) return near;
    const g = this.groundAt(sx, sy);
    if (g)
      for (const u of this.world.units)
        if (u.structure && !u.dead && u.seen !== false && !boxedBuilding(u) && Math.hypot(u.x - g.x, u.y - g.y) < u.hitRadius * 2.2)
          return u;
    return best;
  }

  think(side, army = true) {
    const w = this.world,
      ai = this.ai[side],
      faction = this.factions[side];
    const mine = w.units.filter(u => u.structure && w.ally(u.side, side) && !u.dead);
    const going = w.sites.some(s => s.building && s.building.side === side);
    const brain = this.brains[side] || null;
    const mind = brain ? new Mind(brain, w, side, { difficulty: this.players[side].difficulty || 'Normal' }) : null;
    if (!going && mind && !ai.led) {
      let best = null;
      for (const s of w.sites)
        for (const uc of w.siteOptions(s, side)) {
          const d = mind.desire(buildGoal(uc), target.site(s, s.base ? s.pad : s.point && s.point.type));
          if (d > 0 && (!best || d > best.d)) best = { d, s, uc };
        }
      const cs = best && this.scripts && !this.scripts.off ? this.scripts.commanders[side] : null;
      if (cs && !cs.mind) cs.look(mind, []);
      if (cs && cs.plan(buildGoal(best.uc), this.scripts.view.site(best.s))) {
      } else if (best && w.credits[side] >= costOf(best.uc)) w.startSite(best.s, best.uc, side);
      ai.building = best ? [best.uc.name, +best.d.toFixed(1)] : null;
    }
    const wants = mind
      ? {
          units: Math.max(
            mind.desire('Tactical_Multiplayer_Build_Land_Units_Generic'),
            mind.desire('Tactical_Multiplayer_Build_Infantry_Emergency'),
            mind.desire('Burn_Units_Land')
          ),
          tech: mind.desire('Tech_Upgrade_Emergency'),
          upgrades: Math.max(mind.desire('Purchase_Land_Upgrades_Generic'), mind.desire('Purchase_Early_Land_Upgrades'))
        }
      : { units: 1, tech: 1, upgrades: 1 };
    if (mind && !w.points.some(p => /MINERAL|MINING/i.test(p.type.name))) wants.units = Math.max(wants.units, 1);
    ai.wantsTo = wants;
    let scripted = false;
    const cmdr = mind && this.scripts && !this.scripts.off ? this.scripts.commanders[side] : null;
    if (ai.led) scripted = true;
    else if (cmdr && this.scripts.host.plans.ready) {
      const P = this.scripts.host.plans,
        goals = [
          'Tech_Upgrade_Emergency',
          'Tactical_Multiplayer_Build_Land_Units_Generic',
          'Tactical_Multiplayer_Build_Infantry_Emergency',
          'Purchase_Land_Upgrades_Generic',
          'Purchase_Early_Land_Upgrades'
        ];
      const order = goals
        .map(g => [
          g,
          g === 'Tactical_Multiplayer_Build_Land_Units_Generic'
            ? Math.max(
                mind.desire(g),
                wants.units > 0 && mind.desire(g) <= 0 && mind.desire('Tactical_Multiplayer_Build_Infantry_Emergency') <= 0
                  ? wants.units
                  : 0
              )
            : mind.desire(g)
        ])
        .filter(x => x[1] > 0)
        .sort((a, b) => b[1] - a[1]);
      if (order.length && order.every(([g]) => P.can(g))) {
        if (!cmdr.mind) cmdr.look(mind, []);
        for (const [g] of order) if (!P.count(cmdr, g) && P.canBegin(cmdr, g)) cmdr.plan(g);
        scripted = order.some(([g]) => P.count(cmdr, g) > 0);
      }
    }
    const tech = [...w.owned[side]].filter(n => /TECH/i.test(n) && /LEVEL/i.test(n)).length;
    if (ai.wait && (w.credits[side] >= ai.wait.credits || w.time >= ai.wait.until)) {
      ai.next = w.time + ai.sleep;
      ai.wait = null;
    }
    if (!scripted && !ai.wait && w.time >= (ai.next || 0) && !w.queues[side].units.length) {
      const sold = [];
      for (const u of mine)
        for (const t of buildsFor(u.type, faction, w.campaign)) if (t.has('Company_Units') || isUpgrade(t)) sold.push([u, t]);
      const pick = (test, most) => {
        let n = Math.floor(simRandom() * (most + 1));
        const can = () => sold.filter(([u, t]) => test(t) && !w.cantBuy(u, t, side));
        for (let list = can(); n > 0 && list.length; n--, list = can()) {
          const [u, t] = list[Math.floor(simRandom() * list.length)];
          w.buy(u, t, side);
        }
      };
      const hero = t => /HERO/i.test(t.tag) || t.list('Company_Units').some(n => /HERO/i.test(db.type(n)?.str('CategoryMask') || ''));
      if (wants.tech > 0) pick(t => isUpgrade(t) && /TECH/i.test(t.name) && /LEVEL/i.test(t.name), 1);
      if (wants.upgrades > 0) pick(t => isUpgrade(t) && !(/TECH/i.test(t.name) && /LEVEL/i.test(t.name)), 1);
      if (wants.units > 0) {
        pick(t => !isUpgrade(t) && hero(t), 1);
        pick(t => !isUpgrade(t) && !hero(t), 3);
      }
      ai.wait = { credits: [2000, 3000, 4000][Math.min(2, tech)], until: w.time + [30, 45, 60][Math.min(2, tech)] };
    }
    const home = w.points.find(p => p.reinforce && p.side >= 0 && w.ally(p.side, side));
    const view = this.scripts && this.scripts.view,
      E = ai.led && view && view.landPool ? view.landPool(w.sidePlayers[side]) || [] : null;
    const idle = E ? E.find(x => (!x.owner || x.owner.state === 'over') && w.time - (x.since ?? 0) > 20) : null;
    if (
      home &&
      w.ready[side].length &&
      (!ai.led || idle) &&
      this.reinforcementsEnabled?.[String(this.factions[side] || '').toUpperCase()] !== false
    ) {
      const t = idle ? idle.type : w.ready[side][0],
        o = w.nearestOpen(home.x + 40 + simRandom() * 80, home.y - 60 + simRandom() * 120);
      if (o && !w.cantReinforce(side, t.name, o.x, o.y)) {
        w.ready[side].splice(w.ready[side].indexOf(t), 1);
        w.reinforce(side, t.name, o.x, o.y, 0);
      }
    }
    for (const q of w.squads)
      if (q.side === side && q.members.length && !q.structure && !q.arriving && !q.native && q.abilities.length)
        aiAbilities(w, q, mind && mind.b.eq.has('BRIBE_TARGET_SCORE') ? u => mind.fn('BRIBE_TARGET_SCORE', target.unit(u)) : null);
    if (army && !ai.led) commandArmy(this, side);
  }

  stepCommanders(dt) {
    const w = this.world;
    if (this.setup.benchmark) this.benchOrders(dt);
    this.players.forEach((p, i) => {
      if (p.human || w.aiSuspended || w.beaten.has(this.teams[i]) || this.setup.benchmark) return;
      const ai = this.ai[i];
      const led = this.goals ? this.goals.tick(i, dt) : false;
      ai.led = led;
      if (ai.armyDue) {
        ai.armyDue = false;
        if (!led) commandArmy(this, i);
      } else if ((ai.timer -= dt) <= 0) {
        ai.timer = 3;
        this.think(i, false);
        ai.armyDue = true;
      }
    });
  }

  stepEnd(dt) {
    const w = this.world;
    tickGarrisons(w).catch(e => console.error('garrison', e));
    if (this.invasionVictory && !this.over) {
      this.invasionVictory.left -= dt;
      if (this.invasionVictory.left <= 0 && !this.invasionBook.pending && !w.garrisonBusy && !this.tacticalStory?.disableDepth) {
        this.over = true;
        this.invasionVictory.finish();
        this.invasionVictory = null;
      }
    } else if (this.invasionBook && !this.over) {
      const winner = invasionWinner(w, this.invasionBook, this.setup.campaign);
      if (winner !== null) {
        w.winner = this.teams[winner];
        this.end(w.winner === this.myTeam);
      }
    } else if (!this.over && (w.beaten.has(this.myTeam) || w.winner !== undefined)) this.end(w.winner === this.myTeam);
  }

  frame(now) {
    if (this.modeSuspended) return;
    if (!this.warming) requestAnimationFrame(this.frame);
    const raw = this.last === undefined ? 0 : now - this.last,
      real = Math.max(0, Math.min(0.1, raw / 1000));
    this.last = now;
    const w = this.world,
      v = this.view,
      k = this.keys,
      dt = this.warming || this.paused || this.over || this.tacticalMovies?.pausesMode ? 0 : real * this.speed;
    if (!this.menus.open && !this.controlsLocked) {
      const sp = v.dist * 1.1 * real * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2.6 : 1),
        fx = -Math.cos(v.yaw),
        fy = -Math.sin(v.yaw);
      const steer = !!this.direct && this.steerDirect();
      const f = steer ? 0 : (held(k, 'SCROLL_UP') ? 1 : 0) - (held(k, 'SCROLL_DOWN') ? 1 : 0);
      const r = steer ? 0 : (held(k, 'SCROLL_RIGHT') ? 1 : 0) - (held(k, 'SCROLL_LEFT') ? 1 : 0);
      v.x += (fx * f + fy * r) * sp;
      v.y += (fy * f - fx * r) * sp;
      if (held(k, 'ROTATE_LEFT')) v.yaw -= real * 1.2;
      if (held(k, 'ROTATE_RIGHT')) v.yaw += real * 1.2;
      const fq = this.following;
      if (fq && (fq.dead || !fq.members?.length || f || r)) this.following = null;
      else if (fq) {
        v.x = fq.x;
        v.y = fq.y;
      }
    }
    {
      const lo = this.map.playMin || [0, 0],
        hi = this.map.playMax || [(this.terrain.size - 1) * 20, (this.terrain.size - 1) * 20];
      v.x = Math.min(hi[0], Math.max(lo[0], v.x));
      v.y = Math.min(hi[1], Math.max(lo[1], v.y));
    }
    w.look =
      this.warming || this.tacticalCinematics?.on || this.cine?.on
        ? null
        : { x: v.x, y: v.y, r: v.dist * 2.5 + 300 + (this.chase?.active ? 3000 : 0) };
    if (w.look && !this.noCull) w.look.see = viewTest(this.camera);
    w.lerpOut();
    if (this.lock) this.lockFrame(real);
    else if (dt > 0 && w.interp) {
      this.acc = Math.min((this.acc || 0) + dt, 0.1 * (this.speed || 1) + LAND_TICK);
      while (this.acc >= LAND_TICK && !this.over) {
        w.update(LAND_TICK);
        this.cinematicTransports?.update();
        if (this.scripts) this.scripts.update(LAND_TICK);
        this.landRetreat?.step(LAND_TICK);
        this.stepCommanders(LAND_TICK);
        this.stepEnd(LAND_TICK);
        this.acc -= LAND_TICK;
      }
    } else if (dt > 0) {
      for (let left = dt; left > 1e-5; left -= 1 / 30) {
        w.update(Math.min(left, 1 / 30));
        this.cinematicTransports?.update();
        if (this.scripts) this.scripts.update(Math.min(left, 1 / 30));
        this.landRetreat?.step(Math.min(left, 1 / 30));
      }
      this.stepCommanders(dt);
      this.stepEnd(dt);
    }
    if (!w.interp) w.poseQueued();
    this.scripts?.host.updateStory(dt);
    this.tacticalMovies?.update(real, !!this.paused || !!this.menus?.open);
    this.tacticalStory?.update();
    stepTacticalSpeech(this, real);
    if (this.tutorialFx || this.dualFlash) {
      stepDualFlash(this, real);
      this.tutorialFx?.update(real);
    }
    for (const p of this.propAnims || []) {
      if (p.grp.visible && p.anim) p.anim.step(this.paused ? 0 : real * (this.speed || 1));
      if (p.proxies?.length) this.stepPropProxies(p);
    }
    this.linkedPresentation?.update(real, !!this.menus?.open);
    this.linkedPresentation?.paint();
    if ((this.hudTimer -= real) <= 0) {
      this.hudTimer = 0.25;
      this.ui.refresh();
      if (this.setup.fog !== false && !this.reveal && !this.tacticalCinematics?.on) {
        w.updateSight(this.me);
        for (const u of w.units) u.holder.visible = u.seen && !u.inside && !u.scriptHidden;
        paintFog(this.terrain, w.eyes, true, this.paused ? 0 : 0.25 * (this.speed || 1), db.constants.num('LandFOWRegrowTime', 6));
        for (const p of this.props || []) p.grp.visible = !p.scriptHidden;
      } else {
        for (const u of w.units) u.holder.visible = !u.inside && !u.scriptHidden;
        for (const prop of this.props || []) prop.grp.visible = !prop.scriptHidden;
        paintFog(this.terrain, null, false);
      }
    }
    if (w.interp) {
      w.lerpIn((this.acc || 0) / LAND_TICK);
      w.poseQueued(dt);
    }
    {
      const fq = this.following,
        lo = this.map.playMin || [0, 0],
        hi = this.map.playMax || [(this.terrain.size - 1) * 20, (this.terrain.size - 1) * 20];
      if (this.track?.on && (!fq || fq.dead || !fq.members?.length)) this.endTrack();
      if (fq && !fq.dead && fq.members?.length) {
        const c = this.track?.on ? this.track.focus(fq) : fq;
        v.x = Math.min(hi[0], Math.max(lo[0], c.x));
        v.y = Math.min(hi[1], Math.max(lo[1], c.y));
      }
      const lead = this.direct?.direct?.lead;
      if (lead && this.chase?.on) this.chase.setPivot(lead.x, lead.y, lead.z);
    }
    const z = this.track?.on && this.following ? Math.max(heightAt(this.terrain, v.x, v.y), this.track.focus(this.following).z) : heightAt(this.terrain, v.x, v.y),
      cp = Math.cos(v.pitch),
      cam = this.camera;
    if (this.cine && this.cine.on) this.cine.frame(real);
    else {
      const cx = v.x + Math.cos(v.yaw) * cp * v.dist,
        cy = v.y + Math.sin(v.yaw) * cp * v.dist;
      cam.position.set(cx, cy, Math.max(z + Math.sin(v.pitch) * v.dist, heightAt(this.terrain, cx, cy) + 8));
      cam.lookAt(v.x, v.y, z);
      if (this.chase && this.chase.active) this.chase.frame(cam, v.x, v.y, z, (x, y) => heightAt(this.terrain, x, y) + 3);
    }
    this.tacticalCinematics?.update(dt);
    this.tacticalCinematics?.paint();
    this.drawMarks();
    planetClock.value += dt;
    if (dt > 0 && (this.trailTimer = (this.trailTimer || 0) - real) <= 0) {
      this.trailTimer = 0.1;
      this.decals.trail(w.units, w.look, this.audio, (name, x, y) => w.onFx && w.onFx(name, x, y, heightAt(this.terrain, x, y) + 1));
      this.decals.update();
    }
    {
      const F = this.map.environment && this.map.environment.fog,
        a = w.weather.fog || 0;
      if (this.environmentFogEnabled !== false && F && F.on && F.end > 0) {
        lighting.fogTint.value.setRGB(...F.color);
        lighting.fogRange.value.set((1 - a) * F.start + a * (F.end - 0.0001), F.end);
      } else lighting.fogRange.value.set(0, 0);
    }
    if (dt > 0) this.life.update(dt, w.look);
    this.lightning.update(dt, w, w.tables && w.tables.lightning, cam);
    const wx = w.weather;
    if (wx.emitter && wx.level > 0.01 && !this.wxFx)
      this.wxFx = this.fx.spawn(wx.emitter, f => {
        f.x = this.view.x;
        f.y = this.view.y;
        f.z = heightAt(this.terrain, this.view.x, this.view.y);
        f.rot = 0;
        f.scale = 1;
        f.vx = f.vy = 0;
      });
    else if (this.wxFx && (wx.level <= 0.01 || this.wxFx.dead)) {
      this.wxFx.stop();
      this.wxFx = null;
    }
    if (this.wxFx) this.wxFx.density = Math.min(1, wx.level);
    const WA = w.tables && w.tables.weatherAudio;
    if (WA && dt > 0 && !this.weatherAudioPaused) {
      const at = list => list.filter(e => e.weather === wx.name && wx.level >= e.from).sort((a, b) => b.from - a.from)[0];
      const loop = at(WA.loops),
        now = at(WA.now);
      this.wxLoop = loop ? loop.event : '';
      if (now && (this.wxNext = (this.wxNext ?? now.lo + Math.random() * (now.hi - now.lo)) - real) <= 0) {
        this.audio.play(now.event);
        this.wxNext = now.lo + Math.random() * (now.hi - now.lo);
      }
      if (wx.lightning > 0 && (this.boltNext = (this.boltNext ?? 4) - real) <= 0) {
        this.boltNext = ((3 + Math.random() * 9) / Math.max(0.1, wx.lightning)) * 0.5;
        this.bolt = 0.45;
      }
    }
    if (this.bolt > 0) {
      this.bolt -= real;
      const k = this.bolt > 0.3 || (this.bolt > 0.12 && this.bolt < 0.2) ? 0.55 : 0;
      this.flash.style.opacity = k;
    } else if (this.flash && this.flash.style.opacity !== '0') this.flash.style.opacity = '0';
    this.fx.update(dt);
    const L = this.audio.listener;
    const cineLook = this.tacticalCinematics?.on ? this.tacticalCinematics.evaluate('target') : null;
    if (L && cineLook) {
      L.x = cineLook.x;
      L.y = cineLook.y;
      L.dist = Math.max(100, Math.hypot(cam.position.x - cineLook.x, cam.position.y - cineLook.y, cam.position.z - (cineLook.z || 0)));
      L.cx = cam.position.x;
      L.cy = cam.position.y;
      L.cz = cam.position.z;
    } else if (L) {
      L.x = v.x;
      L.y = v.y;
      L.dist = v.dist;
      L.cx = cam.position.x;
      L.cy = cam.position.y;
      L.cz = cam.position.z;
    }
    if (this.audio.setLoops && (this.loopTimer = (this.loopTimer || 0) - real) <= 0) {
      this.loopTimer = 0.25;
      const ear = cineLook && L ? L : v,
        em = [],
        reach2 = (ear.dist * 1.6 + 200) ** 2;
      if (!this.paused && !this.over)
        for (const u of w.units) {
          if (u.dead || u.inside || u.scriptHidden || u.seen === false || (u.x - ear.x) ** 2 + (u.y - ear.y) ** 2 > reach2) continue;
          if (u.loops === undefined)
            u.loops = [
              u.type.str('SFXEvent_Engine_Idle_Loop') || u.type.str('SFXEvent_Ambient_Loop') || u.type.str('SFXEvent_Powered_Active_Loop'),
              u.type.str('SFXEvent_Engine_Moving_Loop')
            ];
          if (u.holstered) continue;
          const ev = (u.path && u.path.length && u.loops[1]) || u.loops[0];
          if (ev) em.push({ id: u, event: ev, x: u.x, y: u.y });
        }
      if (this.wxLoop && !this.paused && !this.weatherAudioPaused) em.push({ id: 'weather', event: this.wxLoop, x: ear.x, y: ear.y });
      this.audio.setLoops(em);
    }
    if (this.water) this.water.userData.tick(dt);
    this.ground.userData.tick(dt);
    for (const f of this.skyTick) f(dt);
    const R = this.gpuOn ? this.gpu : this.renderer;
    const skip = R.isMirror && R.behind();
    R.autoClear = false;
    const draw = eye => {
      for (const d of this.sky.children) d.position.setFromMatrixPosition(eye.matrixWorld);
      R.render(this.sky, eye);
      R.clearDepth();
      R.render(this.scene, eye);
    };
    cam.updateMatrixWorld();
    this.sendTextures();
    const B = this.noBatch ? null : (this.batches ||= new LandInstances(this.scene, this.renderer, this.camera));
    if (B) {
      B.poseNow ||= u => w.pose(u, 0);
      B.noGL = R === this.gpu;
    }
    if (w.look && w.look.see) {
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      w.look.see = viewTest(cam);
    }
    if (B) {
      const loose = (this.looseList ||= []);
      loose.length = 0;
      if (!this.noLoose) {
        for (const p of this.props || []) loose.push(p.grp);
        for (const it of this.shotLooks.live.values()) if (it.holder) loose.push(it.holder);
      }
      B.collect(w.units, w.look, [this.life ? this.life.list : [], w.points, this.props || []], cam.position, loose);
      this.scene.matrixWorldAutoUpdate = false;
    }
    if (!skip) {
      this.castShadows();
      if (this.water) this.water.userData.mirror(R, cam, draw);
      R.clear();
      draw(cam);
      if (R === this.gpu) R.endFrame();
      if (this.sameFrame) this.sameFrame(cam);
    }
    if (B) {
      this.scene.matrixWorldAutoUpdate = true;
      B.restore();
    }
    if (!skip) this.drawBars();
    w.lerpOut();
    if (R.isMirror) {
      this.skipped = (this.skipped || 0) + raw;
      if (skip) {
        R.skip();
        return;
      }
      R.flush();
      if (this.bench) this.bench.tick(this.skipped, performance.now());
      this.skipped = 0;
      return;
    }
    if (this.bench) this.bench.tick(raw, performance.now());
  }

  benchOrders(dt) {
    const w = this.world,
      sides = [this.teams.indexOf(0), this.teams.indexOf(1)],
      all = w.squads,
      n = all.length;
    if (!n) return;
    this.benchOwed = Math.min(n, (this.benchOwed || 0) + n * dt);
    let k = Math.floor(this.benchOwed),
      at = this.benchAt || 0;
    this.benchOwed -= k;
    const batch = [];
    while (k-- > 0) {
      if (at >= n) at = 0;
      batch.push(all[at++]);
    }
    this.benchAt = at;
    const live = q => q.members.length && !q.structure && !q.native && !q.members[0].inside && q.members.some(u => u.speed > 0);
    for (const q of batch) {
      if (!sides.includes(q.side) || !live(q) || q.foe || q.busy || q.entering || q.arriving || q.box?.path?.length) continue;
      if (q.march && q.members.some(u => u.path.length || u.v > 0.5)) continue;
      if (q.members.some(u => u.path.length || u.v > 0.5 || u.target)) continue;
      let best = null,
        bd = Infinity;
      for (const e of w.squads) {
        if (!e.members.length || !sides.includes(e.side) || this.teams[e.side] === this.teams[q.side] || e.members[0].inside) continue;
        const d = Math.hypot(e.x - q.x, e.y - q.y) + (e.structure ? 1e5 : 0);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (!best) continue;
      const need = Math.max(1, ...q.members.map(u => u.need || 1)),
        o = w.nearestOpen(best.x, best.y, need) || w.nearestOpen(best.x, best.y);
      if (!o || Math.hypot(o.x - q.x, o.y - q.y) < 40) continue;
      w.order(q, o.x, o.y);
      q.march = { x: o.x, y: o.y };
    }
  }

  async startBenchmark(n) {
    const w = this.world,
      m = this.map,
      lo = m.playMin || [0, 0],
      hi = m.playMax || [(this.terrain.size - 1) * 20, (this.terrain.size - 1) * 20];
    const cx = (lo[0] + hi[0]) / 2,
      cy = (lo[1] + hi[1]) / 2;
    const sides = [this.teams.indexOf(0), this.teams.indexOf(1)];
    const kinds = side => {
      const out = new Set();
      for (const q of w.squads)
        if (q.side >= 0 && this.teams[q.side] === this.teams[side] && q.structure && q.members[0])
          for (const t of buildsFor(q.members[0].type, this.factions[side])) if (t.has('Company_Units') && !/HERO/i.test(t.tag)) out.add(t);
      return [...out].sort((a, b) => (a.name < b.name ? -1 : 1));
    };
    const cols = Math.ceil(Math.sqrt(n)),
      gap = 90,
      all = [];
    await Promise.all(
      sides.map((side, k) => {
        const list = kinds(side),
          dir = k ? 1 : -1;
        if (!list.length || side < 0) return null;
        const jobs = [];
        for (let i = 0; i < n; i++) {
          const row = Math.floor(i / cols),
            col = i % cols;
          const o = w.nearestOpen(cx + dir * (350 + row * gap), cy + (col - (cols - 1) / 2) * gap) || { x: cx + dir * 350, y: cy };
          jobs.push(
            w
              .spawn(list[i % list.length].name, o.x, o.y, dir > 0 ? Math.PI : 0, side)
              .then(q => {
                if (q) all.push([q, -dir]);
              })
              .catch(() => {})
          );
        }
        return Promise.all(jobs);
      })
    );
    for (const [q, dir] of all) {
      const o = w.nearestOpen(cx + dir * 300, q.members[0] ? q.members[0].y : cy) || { x: cx, y: cy };
      w.order(q, o.x, o.y);
      q.march = { x: o.x, y: o.y };
    }
    const v = this.view;
    v.x = cx;
    v.y = cy;
    v.dist = 900;
    this.bench = this.benchOverlay(`${n} v ${n} companies`, { companies: `${n} vs ${n}` });
  }

  async warmFrames() {
    if (this.preparing) await Promise.all([...this.preparing]);
    this.sendTextures(Infinity);
    const v = this.view,
      keep = { x: v.x, y: v.y, dist: v.dist },
      reveal = this.reveal,
      m = this.map;
    const lo = m.playMin || [0, 0],
      hi = m.playMax || [(this.terrain.size - 1) * 20, (this.terrain.size - 1) * 20];
    const next = async () => {
      await new Promise(r => {
        requestAnimationFrame(() => r());
        setTimeout(r, 100);
      });
      if (this.gpuOn) await this.gpu.settle();
    };
    const drawn = this.renderer.isMirror ? () => this.renderer.idle() : () => null;
    this.warming = true;
    if (!this.noBatch) (this.batches ||= new LandInstances(this.scene, this.renderer, this.camera)).warm = true;
    this.warmGround();
    const putAway = await this.warmEffects((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2).catch(e => {
      console.warn('warm effects', e);
      return () => {};
    });
    try {
      v.x = (lo[0] + hi[0]) / 2;
      v.y = (lo[1] + hi[1]) / 2;
      v.dist = Math.max(hi[0] - lo[0], hi[1] - lo[1]) * 0.9;
      this.reveal = true;
      this.hudTimer = 0;
      this.frame(performance.now());
      await drawn();
      await next();
      if (this.batches) {
        this.batches.readyAll();
        this.frame(performance.now());
        await drawn();
        await next();
      }
      Object.assign(v, keep);
      this.reveal = reveal;
      this.hudTimer = 0;
      for (let i = 0; i < 2; i++) {
        this.frame(performance.now());
        await drawn();
        await next();
      }
      if (this.gpuOn || this.renderer.webgpu)
        for (let i = 0; i < 2; i++) {
          this.frame(performance.now());
          await drawn();
          await next();
        }
    } finally {
      this.warming = false;
      Object.assign(v, keep);
      this.reveal = reveal;
      this.hudTimer = 0;
      if (this.batches) this.batches.warm = false;
      putAway();
    }
  }

  warmGround() {
    const w = this.world,
      done = new Set();
    for (const u of w.units) {
      if (u.dead) continue;
      const need = u.need || 1;
      for (const nd of [need, (need & ~3) | 1, u.need || 2]) {
        if (done.has(nd)) continue;
        done.add(nd);
        w.openness(w.rooms(nd), nd & 3);
      }
    }
    const B = this.batches;
    if (B)
      for (const list of [this.props || [], this.life ? this.life.list : [], w.points])
        for (const e of list) {
          const h = e.holder || e.grp;
          if (h) B.reachOf(h);
        }
  }

  async warmEffects(x, y) {
    const w = this.world,
      fx = this.fx,
      L = this.shotLooks;
    if (!fx || !L) return () => {};
    const z = heightAt(this.terrain, x, y) + 30;
    const particle = name => {
      const t = db.type(name);
      return (t ? t.str('Land_Model_Name') || t.str('Space_Model_Name') : name) || '';
    };
    const projs = new Set(),
      effects = new Set(),
      models = new Set(),
      undo = [];
    for (const u of w.units) {
      for (const W of [u.weapon, ...(u.weapons || []), ...(u.guns || [])]) if (W && W.proj) projs.add(W.proj);
      for (const n of u.type.list('Death_Explosions')) effects.add(particle(n));
      if (u.inst)
        for (const [k, g] of u.inst.meshByName)
          if (/_FLASH/.test(k) && !g.visible) {
            g.visible = true;
            undo.push(() => {
              g.visible = false;
            });
          }
    }
    for (const P of projs) {
      for (const k of [
        'Projectile_Object_Creation_Particle',
        'Projectile_Ground_Detonation_Particle',
        'Projectile_Object_Detonation_Particle',
        'Projectile_Lifetime_Detonation_Particle'
      ])
        if (P.str(k)) effects.add(particle(P.str(k)));
      const look = L.lookOf(P);
      if (look.kind === 'fx') effects.add(look.file);
      else if (look.kind === 'model') models.add(look.file);
    }
    effects.delete('');
    await Promise.all([...effects].map(n => Promise.resolve(loadParticles(n)).catch(() => null)));
    const bursts = [...effects].map(n => fx.burst(n, x, y, z)).filter(Boolean);
    fx.update(LAND_TICK);
    const holders = (await Promise.all([...models].map(f => loadModel(f).catch(() => null)))).filter(Boolean).map(inst => {
      const h = new THREE.Group();
      h.add(inst.root);
      h.position.set(x, y, z);
      this.scene.add(h);
      return h;
    });
    const D = this.decals;
    if (D) D.put(x, y, 8, 8, 0, { uv: [0, 0, 0.01, 0.01], strength: 0 }, { born: w.time, seconds: 1, keeps: false });
    this.warmDomes = true;
    return () => {
      for (const h of bursts) h.dead = true;
      for (const h of holders) this.scene.remove(h);
      for (const f of undo) f();
      if (D) {
        D.mesh.count = 0;
        D.next = 0;
        D.marks.length = 0;
      }
      this.warmDomes = false;
    };
  }

  sendTextures(budget = 2) {
    const list = this.uploading;
    if (!list || !list.length) return;
    const R = this.renderer,
      props = R.properties;
    while (list.length && budget > 0) {
      const h = list[0],
        todo = h.userData.uploads;
      const t = todo.pop();
      if (this.gpuOn) {
        if (t && t.version > 0 && this.gpu.sent(t)) budget--;
      } else if (t && t.version > 0 && props.get(t).__version !== t.version) {
        R.initTexture(t);
        budget--;
      }
      if (!todo.length) {
        list.shift();
        h.userData.uploads = null;
        h.userData.ready = true;
      }
    }
  }

  benchOverlay(label, result, seconds = 60) {
    return new BenchOverlay({
      label,
      result,
      seconds,
      renderer: this.gpuOn ? this.gpu : this.renderer,
      parent: document.getElementById('hud') || document.body,
      net: this.lock ? () => this.lock.netStats(LAND_TICK) : null,
      count: () => ({ units: this.world.units.filter(u => !u.dead && u.side >= 0 && !u.structure).length, shots: this.world.shots.length })
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

  async startGPU() {
    gpuEnv.programSources = programSources;
    gpuEnv.lighting = lighting;
    const { GPURenderer } = await import('../gpu/renderer.js');
    const gpu = await GPURenderer.create().catch(e => {
      console.warn('webgpu', e);
      return null;
    });
    if (!gpu) {
      console.warn('webgpu: not available here, drawn with WebGL');
      return;
    }
    this.gpu = gpu;
    this.gpuOn = true;
    gpu.domElement.style.pointerEvents = 'none';
    this.renderer.domElement.after(gpu.domElement);
    gammaOn(gpu.domElement);
    gpu.setPixelRatio(this.renderer.getPixelRatio());
    gpu.setSize(innerWidth, innerHeight);
  }

  async gpuCompare() {
    if (!this.gpu) return null;
    const was = { paused: this.paused, on: this.gpuOn, raf: window.requestAnimationFrame },
      gl = this.renderer.getContext();
    this.paused = true;
    const W = gl.drawingBufferWidth,
      H = gl.drawingBufferHeight;
    const readGL = () => {
      const px = new Uint8Array(W * H * 4),
        out = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let y = 0; y < H; y++) out.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      return { width: W, height: H, data: out };
    };
    const draw = on => {
      this.gpuOn = on;
      if (this.cast) this.cast.frame = 0;
      window.requestAnimationFrame = () => 0;
      try {
        this.frame(this.last);
      } finally {
        window.requestAnimationFrame = was.raf;
      }
    };
    const both = () => {
      let gl = null,
        shot = null;
      this.sameFrame = cam => {
        this.sameFrame = null;
        gl = readGL();
        const G = this.gpu;
        this.gpuOn = true;
        try {
          if (this.cast) this.cast.frame = 0;
          this.castShadows();
          G.autoClear = false;
          const drawG = eye => {
            for (const d of this.sky.children) d.position.setFromMatrixPosition(eye.matrixWorld);
            G.render(this.sky, eye);
            G.clearDepth();
            G.render(this.scene, eye);
          };
          if (this.water) this.water.userData.mirror(G, cam, drawG);
          G.clear();
          drawG(cam);
          shot = G.readNext();
          G.endFrame();
        } finally {
          this.gpuOn = false;
        }
      };
      draw(false);
      return shot.then(gpu => [gl, gpu]);
    };
    let a, b, c;
    try {
      draw(false);
      draw(false);
      [a, b] = await both();
      draw(false);
      [c] = await both();
    } finally {
      this.paused = was.paused;
      this.gpuOn = was.on;
      this.sameFrame = null;
    }
    const diff = (p, q) => {
      if (p.width !== q.width || p.height !== q.height) return { size: [p.width, p.height, q.width, q.height] };
      let n = 0,
        max = 0,
        sum = 0;
      const hist = new Array(9).fill(0),
        img = new Uint8ClampedArray(p.data.length);
      for (let i = 0; i < p.data.length; i += 4) {
        const d = Math.max(
          Math.abs(p.data[i] - q.data[i]),
          Math.abs(p.data[i + 1] - q.data[i + 1]),
          Math.abs(p.data[i + 2] - q.data[i + 2])
        );
        img[i + 3] = 255;
        if (!d) continue;
        n++;
        sum += d;
        if (d > max) max = d;
        hist[Math.min(8, Math.ceil(Math.log2(d + 1)))]++;
        img[i] = Math.min(255, 64 + d * 8);
        img[i + 1] = d > 8 ? 0 : 255;
      }
      return { pixels: p.data.length / 4, differ: n, share: n / (p.data.length / 4), max, mean: n ? sum / n : 0, hist, img };
    };
    const ab = diff(a, b),
      ac = diff(a, c);
    window.GPU_COMPARE = { webgl: a, webgpu: b, webglAgain: c, diff: ab, control: ac };
    const brief = d =>
      d.img ? { differ: d.differ, share: +d.share.toFixed(5), max: d.max, mean: +d.mean.toFixed(2), hist: d.hist.join(' ') } : d;
    return { size: [W, H], webglVsWebgpu: brief(ab), webglVsWebgl: brief(ac), unsupported: Object.fromEntries(this.gpu.unsupported) };
  }

  castShadows() {
    this.castOn = !!gfx.shadows;
    if (this.ratioWas !== pixelRatio()) this.fit();
    if (this.cast && this.cast.size !== shadowSize()) {
      this.cast.target.depthTexture.dispose();
      this.cast.target.dispose();
      this.cast = null;
    }
    this.noShadow ||= lighting.shadowMap.value;
    if (!this.castOn) {
      lighting.shadowOn.value = 0;
      lighting.shadowMap.value = this.noShadow;
      return;
    }
    let S = this.cast;
    if (!S) {
      const size = shadowSize(),
        target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
      target.depthTexture = new THREE.DepthTexture(size, size);
      target.depthTexture.type = THREE.UnsignedIntType;
      target.depthTexture.compareFunction = THREE.LessEqualCompare;
      target.depthTexture.magFilter = target.depthTexture.minFilter = THREE.LinearFilter;
      S = this.cast = {
        target,
        camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2),
        frame: 0,
        size,
        bias: new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      };
    }
    if (S.frame++ % 2 === 0) {
      const look = this.tacticalCinematics?.on ? this.tacticalCinematics.evaluate('target') : null,
        eye = this.camera.position;
      const v = look ? { x: look.x, y: look.y, dist: Math.hypot(eye.x - look.x, eye.y - look.y, eye.z - (look.z || 0)) } : this.view;
      const R = this.gpuOn ? this.gpu : this.renderer,
        cam = S.camera,
        half = Math.max(350, v.dist * 1.25),
        far = half * 3,
        dir = lighting.sunDir.value,
        z0 = heightAt(this.terrain, v.x, v.y);
      const dz = Math.max(0.3, dir.z),
        k = 1 / Math.hypot(dir.x, dir.y, dz);
      cam.left = cam.bottom = -half;
      cam.right = cam.top = half;
      cam.near = 1;
      cam.far = far * 2;
      cam.position.set(v.x + dir.x * k * far, v.y + dir.y * k * far, z0 + dz * k * far);
      cam.up.set(0, 0, 1);
      cam.lookAt(v.x, v.y, z0);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      const hidden = [],
        L = cam.layers,
        swapped = (this.depthSwaps ||= []);
      const twin = o => {
        const m = o.material,
          d = this.noDepthTwin || Array.isArray(m) ? null : depthMaterial(m);
        if (!d) return;
        const st = d.userData,
          kind = o.isInstancedMesh ? 'inst' : 'one';
        if (st[kind] === true) {
          o.material = d;
          swapped.push(o, m);
          return;
        }
        if (st[kind]) return;
        st[kind] = 'making';
        o.material = d;
        const job = this.renderer.compileAsync(o, cam, shaderScene(this.scene));
        o.material = m;
        Promise.resolve(job).then(
          () => {
            st[kind] = true;
          },
          () => {
            st[kind] = 'failed';
          }
        );
      };
      const writes = o => {
        if (!o.visible) return 0;
        let n = 0;
        if (
          o.isMesh &&
          o.layers.test(L) &&
          (Array.isArray(o.material) ? o.material.some(m => m.depthWrite !== false) : o.material.depthWrite !== false)
        ) {
          n++;
          twin(o);
        }
        for (const c of o.children) n += writes(c);
        return n;
      };
      for (const c of this.scene.children)
        if (c.visible && (!c.userData.casts || !writes(c))) {
          c.visible = false;
          hidden.push(c);
        }
      lighting.shadowOn.value = 0;
      lighting.shadowMap.value = this.noShadow;
      const was = R.getRenderTarget();
      try {
        R.setRenderTarget(S.target);
        R.clear();
        R.render(this.scene, cam);
        R.setRenderTarget(was);
      } finally {
        for (let i = 0; i < swapped.length; i += 2) swapped[i].material = swapped[i + 1];
        swapped.length = 0;
      }
      for (const c of hidden) c.visible = true;
      lighting.shadowMatrix.value.copy(S.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    }
    lighting.shadowMap.value = S.target.depthTexture;
    lighting.shadowTexel.value = 1 / S.size;
    lighting.shadowOn.value = 1;
  }

  canRetreat() {
    return !!this.invasionBook && !this.setup.linkedTactical && !this.spectator && !this.over && this.tacticalWinner === undefined;
  }
  retreatClicked() {
    if (!this.canRetreat()) return;
    if (this.lock) {
      this.command({ c: 'retreat' });
      return;
    }
    const retreat = (this.landRetreat ||= this.makeRetreat());
    if (retreat.active?.player === this.me) {
      retreat.cancel();
      return;
    }
    const go = () => retreat.request(this.me);
    if (this.setup.campaign.autoResolve?.allowed) openRetreatDialog({ retreat: go, autoResolve: () => this.autoResolveNow() });
    else go();
  }
  makeRetreat() {
    const w = this.world,
      cb = this.setup.campaign,
      sides = [cb.attacker.side, cb.defender.side],
      game = this;
    const mine = side => w.units.filter(u => !u.dead && u.side === side);
    return new RetreatCoordinator({
      prefix: 'Land',
      campaign: !!this.invasionBook && !this.setup.linkedTactical,
      time: () => w.time,
      generic: name => this.tacticalStory?.generic(name),
      players: () => this.players.map((_, i) => i),
      factionOf: s => this.factions[s],
      teamOf: s => this.teams[s],
      isSide: s => sides.includes(s),
      units: s => mine(s).filter(u => !u.structure),
      everything: mine,
      blocker: s => (mine(s).some(u => hasRetreatPrevention(u.type)) ? 4 : 0),
      blockaded: s => (cb.orbitOwners || []).some(o => String(o).toUpperCase() !== String(this.factions[s]).toUpperCase()),
      isLocal: s => (this.setup.net ? !!this.players[s]?.human : s === this.me),
      begin: state => {
        w.retreatState = state;
        for (const u of state.list) {
          u.retreating = true;
          u.path = [];
          u.target = null;
          if (u.squad) w.stop(u.squad);
        }
      },
      cancelled: state => {
        for (const u of state.list) u.retreating = false;
        w.retreatState = null;
      },
      flightStart: state => {
        for (const u of state.list) u.retreating = true;
      },
      flightEnd: () => {
        w.retreatState = null;
      },
      remove: (u, lost) => {
        if (lost && !u.structure) {
          w.hurt(u, 1e9, null);
          return;
        }
        u.dead = true;
        u.path = [];
        u.target = null;
        u.died = -1e9;
        if (!lost) u.retreated = true;
      },
      end: enemy => {
        w.winner = this.teams[enemy];
        this.end(w.winner === this.myTeam);
      },
      play: (sfx, s) => {
        if (s === this.me && sfx) game.audio.play(sfx);
      },
      show: showRetreatLine
    });
  }
  autoResolveNow() {
    const w = this.world,
      cb = this.setup.campaign;
    if (!this.canRetreat()) return;
    const retreat = (this.landRetreat ||= this.makeRetreat()),
      code = retreat.canRetreat(this.me);
    if (code) {
      const sfx = retreat.refusal(this.me, code);
      if (sfx) this.audio.play(sfx);
      return;
    }
    const sides = [cb.attacker.side, cb.defender.side],
      { winner, doomed } = resolveTactical(landRosters(w, this.factions, sides), cb, { space: false });
    for (const e of doomed) if (!e.dead) w.hurt(e, 1e9, null);
    const side = sides[winner];
    w.winner = this.teams[side];
    this.end(w.winner === this.myTeam);
  }

  storyTacticalVictory(owner, suppress) {
    const side = this.factions.findIndex(f => f.toUpperCase() === String(owner).toUpperCase());
    if (side < 0) return false;
    this.tacticalStory.disableDepth = 0;
    if (this.tacticalWinner !== undefined) return true;
    this.world.winner = this.teams[side];
    this.end(this.world.winner === this.myTeam, { frames: suppress ? 30 : 210, suppress });
    return true;
  }

  async playPropAnimation(prop, kind, loop, index = 0) {
    const P = prop.prop;
    if (!P) return;
    const ask = (P.asked = (P.asked || 0) + 1);
    const load = n =>
      Promise.resolve()
        .then(() => loadALA(n))
        .catch(() => null);
    const a = (await load(animName(P.file, kind, index))) || (index ? await load(animName(P.file, kind, 0)) : null);
    if (!a || ask !== P.asked) return;
    if (!P.entry) {
      P.entry = this.propEntry(P.grp, P.inst, null);
      (this.propAnims ||= []).push(P.entry);
      P.grp.traverse(x => {
        if (x !== P.grp) x.matrixAutoUpdate = true;
      });
      P.grp.matrixWorldAutoUpdate = true;
    }
    P.entry.anim = new AnimState(P.inst, a, { loop: !!loop });
  }

  propEntry(grp, inst, anim) {
    const proxies = (inst.proxies || [])
      .filter(p => !/engine/i.test(p.name))
      .map(p => ({ name: p.name, bone: p.bone, on: false, sys: null }));
    for (const p of proxies) this.fx?.state(p.name);
    return { grp, inst, anim, proxies };
  }
  stepPropProxies(e) {
    for (const p of e.proxies) {
      let on = e.grp.visible;
      for (let b = p.bone; on && b && b !== e.inst.root; b = b.parent) if (!b.visible) on = false;
      if (on && !p.on) {
        const bone = p.bone,
          at = new THREE.Vector3();
        p.sys = this.fx.spawn(
          p.name,
          f => {
            bone.getWorldPosition(at);
            f.x = at.x;
            f.y = at.y;
            f.z = at.z;
            f.rot = 0;
            f.scale = 1;
            f.vx = f.vy = 0;
          },
          { scale: e.grp.scale.x }
        );
        if (!p.sys && this.fx.state(p.name) === 'loading') continue;
      } else if (!on && p.on && p.sys) {
        p.sys.stop();
        p.sys = null;
      }
      p.on = on;
    }
  }

  end(won, { frames = 210, suppress = false } = {}) {
    if (this.tacticalWinner !== undefined || this.tacticalStory?.disableDepth) return;
    if (!won && this.useRetry) {
      if (this.retryPending) return;
      this.retryPending = true;
      const d = document.createElement('div');
      d.id = 'landend';
      d.textContent = db.t('TEXT_LOSE_TACTICAL') || db.t('TEXT_DEFEAT') || 'Defeat';
      if (!suppress) document.body.appendChild(d);
      const f = db.faction(this.factions[this.me]);
      if (!suppress) this.audio.play(f.str('SFXEvent_HUD_Lost_Land_Battle'));
      setTimeout(
        () => {
          d.remove();
          openRetryDialog(this);
        },
        (frames / 30) * 1000
      );
      return;
    }
    this.tacticalWinner = this.teams.includes(this.world.winner)
      ? this.world.winner
      : won
        ? this.myTeam
        : this.teams.find(t => t !== this.myTeam);
    const winner = this.players.find(p => p.team === this.tacticalWinner);
    if (winner) {
      const faction = this.factions[this.players.indexOf(winner)];
      this.tacticalStory?.signal('STORY_VICTORY', faction);
      reportLinkedVictory(this, faction);
    }
    this.over = !this.invasionBook;
    const d = document.createElement('div');
    d.id = 'landend';
    d.textContent = won
      ? db.t('TEXT_WIN_TACTICAL') || db.t('TEXT_VICTORY') || 'Victory'
      : db.t('TEXT_LOSE_TACTICAL') || db.t('TEXT_DEFEAT') || 'Defeat';
    if (!suppress) document.body.appendChild(d);
    const f = db.faction(this.factions[this.me]);
    if (!suppress) this.audio.play(f.str(won ? 'SFXEvent_HUD_Won_Land_Battle' : 'SFXEvent_HUD_Lost_Land_Battle'));
    const ev = db.music.get(f.str(won ? 'Music_Event_Tactical_Win' : 'Music_Event_Tactical_Lose').toUpperCase());
    if (ev && this.audio.setPlaylist) this.audio.setPlaylist(ev.list('Files'), true, true);
    if (this.scripts) this.scripts.view.onEvent('gameover', {});
    const finish = () => {
      if (this.invasionBook)
        this.campaignOutcome = landInvasionResult(
          this.world,
          this.invasionBook,
          this.setup.campaign,
          won ? this.me : this.players.findIndex(p => p.team !== this.myTeam)
        );
      if (this.campaignOutcome && this.world.tacticalSessions) this.campaignOutcome.credits = this.tacticalCredits();
      showSummary(this, won, this.myTeam).then(shown => {
        if (shown) d.remove();
      });
    };
    if (this.invasionBook) this.invasionVictory = { left: frames / 30, finish };
    else setTimeout(finish, 2500);
  }

  returnToGalaxy() {
    const cb = this.setup.campaign;
    if (linkedParent(this)) {
      linkedParent(this).returnLinkedTactical({ ...this.campaignOutcome, storyFlags: this.tacticalStory?.flags.snapshot() });
      return;
    }
    if (mpBattleParent()) {
      mpBattleParent().mpBattles.returned(this.campaignOutcome);
      return;
    }
    if (this.tacticalStory) cb.galaxy.storyFlags = this.tacticalStory.flags.snapshot();
    stageStart({
      mode: 'galactic',
      players: [],
      teamFactions: [],
      campaign: cb.campaignName,
      restore: cb.galaxy,
      result: this.campaignOutcome
    });
  }

  teamMark(q) {
    if (!q || q.structure) return null;
    const T =
      q._teamType !== undefined
        ? q._teamType
        : (q._teamType = (() => {
            const t = db.type(q.type.str('Create_Team_Type'));
            return t && t.behaviors && [...t.list('Behavior'), ...t.list('LandBehavior')].some(b => b.toUpperCase() === 'SELECTABLE')
              ? t
              : null;
          })());
    if (!T) return null;
    let x = 0,
      y = 0,
      z = 0,
      n = 0,
      top = 0;
    for (const m of q.members)
      if (!m.dead && !m.inside) {
        x += m.x;
        y += m.y;
        z += m.z;
        n++;
        top = Math.max(top, m.aimZ || 0);
      }
    if (!n) return null;
    return { x: x / n, y: y / n, z: z / n, top, size: T.num('Select_Box_Scale', 50) || 50, type: T };
  }

  drawMarks() {
    const w = this.world,
      scene = this.scene,
      me = this.me;
    const R = (this.selRings ||= (() => {
      const f = db.faction(this.factions[me]);
      return f ? new SelectionRings(scene, f, true, (x, y) => heightAt(this.terrain, x, y)) : null;
    })());
    if (R) {
      R.begin();
      const teams = new Set();
      for (const u of this.endScreen || this.track?.on ? [] : w.units) {
        if (!u.squad.selected || u.dead || u.inside) continue;
        const own = u.side === me;
        const tm = this.teamMark(u.squad);
        if (tm) {
          if (!teams.has(u.squad)) {
            teams.add(u.squad);
            R.add(tm.x, tm.y, tm.z + 0.6 + (tm.type.num('Select_Box_Z_Adjust', 0) || 0), tm.size, 0, own, tm.type);
          }
          continue;
        }
        const t = u.type,
          size =
            t.num('Select_Box_Scale', 0) ||
            (u.inst && u.inst.radius ? u.inst.radius * (u.holder ? u.holder.scale.x : 1) * 2.2 : u.foot ? 12 : 44);
        R.add(u.x, u.y, u.z + 0.6 + (t.num('Select_Box_Z_Adjust', 0) || 0), size, u.heading || 0, own, t);
      }
      R.end();
    }
    this.boltGeo ||= new THREE.BoxGeometry(1, 1, 1);
    const mat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.boltMats ||= { red: mat(0xff3a2a), green: mat(0x4dff5a), other: mat(0xffd070) };
    this.shotLooks.update(w.shots, this.camera, w.look);
    if (!this.shadows) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c2 = cv.getContext('2d'),
        gr = c2.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(0,0,0,0.42)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      c2.fillStyle = gr;
      c2.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(cv);
      this.shadows = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3
        }),
        600
      );
      this.shadows.frustumCulled = false;
      this.shadows.renderOrder = 1;
      scene.add(this.shadows);
      this.shadowM = new THREE.Matrix4();
      this.shadowQ = new THREE.Quaternion();
      this.shadowS = new THREE.Vector3();
      this.shadowP = new THREE.Vector3();
    }
    {
      const L = w.look,
        r2 = L ? Math.min(L.r, 1600) ** 2 : 1e12,
        Z = new THREE.Vector3(0, 0, 1);
      let n = 0;
      for (const u of w.units) {
        if (n >= 600) break;
        if (u.dead || u.structure || u.inside || u.seen === false || (L && (u.x - L.x) ** 2 + (u.y - L.y) ** 2 > r2)) continue;
        if (u.shadow === undefined) {
          const sc = u.type
            .str('Blob_Shadow_Scale')
            .split(/[\s,]+/)
            .map(Number)
            .filter(Number.isFinite);
          u.shadow = sc.length
            ? [sc[0] * (u.foot ? 2 : 1), (sc[1] ?? sc[0]) * (u.foot ? 2 : 1)]
            : [u.foot ? 9 : u.body * 2, u.foot ? 9 : u.body * 2];
        }
        this.shadowS.set(u.shadow[0], u.shadow[1], 1);
        this.shadowP.set(u.x, u.y, heightAt(this.terrain, u.x, u.y) + 0.5);
        this.shadows.setMatrixAt(n++, this.shadowM.compose(this.shadowP, this.shadowQ.setFromAxisAngle(Z, u.heading), this.shadowS));
      }
      this.shadows.count = lighting.shadowOn.value > 0.5 ? 0 : n;
      this.shadows.instanceMatrix.needsUpdate = true;
    }
    this.beams ||= [];
    this.beamMats ||= new Map();
    let k = 0;
    for (const bm of w.beams) {
      const a = bm.a,
        b2 = bm.b;
      if (a.dead || b2.dead) continue;
      const m = this.beams[k] || (this.beams[k] = new THREE.Mesh(this.boltGeo, this.boltMats.other));
      if (m.parent !== scene) scene.add(m);
      if (!this.beamMats.has(bm.color)) this.beamMats.set(bm.color, mat(bm.color));
      m.material = this.beamMats.get(bm.color);
      const az = a.aimZ !== undefined ? a.z + a.aimZ * 0.8 : a.z,
        bz = b2.aimZ !== undefined ? b2.z + b2.aimZ * 0.6 : b2.z;
      const dx = b2.x - a.x,
        dy = b2.y - a.y,
        dz = bz - az,
        len = Math.hypot(dx, dy, dz) || 1,
        j = () => (Math.random() - 0.5) * 2.5;
      m.position.set((a.x + b2.x) / 2 + j(), (a.y + b2.y) / 2 + j(), (az + bz) / 2 + j());
      m.scale.set(len, 0.35 + Math.random() * 0.5, 0.35 + Math.random() * 0.5);
      m.rotation.set(0, -Math.asin(Math.max(-1, Math.min(1, dz / len))), Math.atan2(dy, dx), 'ZYX');
      m.visible = true;
      k++;
    }
    for (; k < this.beams.length; k++) this.beams[k].visible = false;
    {
      const ui = this.ui,
        m = ui.mouse,
        dn = this.down,
        h = ui.hover,
        k = this.keys,
        sel = ui.selection.filter(s => !s.dead && !s.isPad && s.side === this.me);
      (this.pointers ||= new Pointers(this.renderer.domElement)).set(
        tacticalPointer({
          land: true,
          turning: !!this.turnDrag,
          direct: this.direct ? (this.direct.members.some(m => w.directBears(m, this.direct.direct?.target)) ? 'in' : 'out') : null,
          box: dn && dn[2] === 0 && !ui.placing && !ui.armed && Math.hypot(m.x - dn[0], m.y - dn[1]) > 5,
          armed: ui.armed,
          placing: ui.placing,
          hover: !h ? null : h.side === this.me ? 'own' : h.side >= 0 && !w.ally(h.side, this.me) ? 'enemy' : 'other',
          act: sel.length > 0,
          attack: sel.length > 0,
          force: !!(k && (k.has('ControlLeft') || k.has('ControlRight')))
        })
      );
    }
    {
      const q = this.direct,
        D = q && q.direct,
        out = (this.arcs ||= []);
      out.length = 0;
      if (D) for (const m of q.members) out.push(...w.directArcs(m, (this.arcOne ||= [])));
      (this.arcView ||= new ArcView(scene)).update(out, (x, y) => heightAt(this.terrain, x, y) + 2);
    }
    this.moveLayout(scene);
    {
      const ui = this.ui,
        list = ui.placing ? ui.placeList || [ui.placing] : [],
        G = (this.ghosts ||= []);
      while (G.length > list.length) scene.remove(G.pop().holder);
      for (let i = 0; i < list.length; i++)
        if (!G[i] || G[i].type !== list[i]) {
          if (G[i]) scene.remove(G[i].holder);
          G[i] = this.landGhost(list[i], scene);
        }
      const m = ui.mouse,
        g2 = list.length && (m.inside || ui.dragPlace) ? this.groundAt(m.x, m.y) : null;
      const dn = this.down,
        from = g2 && dn && dn[2] === 0 && list.length > 1 && Math.hypot(m.x - dn[0], m.y - dn[1]) > 5 ? this.groundAt(dn[0], dn[1]) : null;
      const at = g2 ? this.placeSlots(list, g2.x, g2.y, from) : null;
      if (!this.moveDragOn)
        showHand(list.length && !ui.dragPlace ? (at && this.placeSeq ? this.placeSeq.map(i => list[i]) : list) : null, m.x, m.y);
      G.forEach((gh, i) => {
        gh.holder.visible = !!at;
        if (!at) return;
        const p = at[i];
        gh.holder.position.set(p.x, p.y, heightAt(this.terrain, p.x, p.y));
        gh.holder.rotation.z = (this.placeFace ?? ui.placeTurn ?? 0) + Math.PI / 2;
        gh.mat.uniforms.tint.value.setHex(p.why ? 0xff5544 : 0x55ff77);
      });
    }
    this.domes ||= new Map();
    for (const u of w.units) {
      if (!u.dome) continue;
      if (u.holder && u.holder.children.length && u.dome.meshes === undefined) {
        const own = [];
        u.holder.updateMatrixWorld(true);
        u.holder.traverse(o => {
          const m = o.isMesh && o.material;
          if (!m || Array.isArray(m) || !m.userData.shield) return;
          const c = m.clone();
          for (const k of ['time', 'map', 'waveMap', 'distortMap']) c.uniforms[k] = m.uniforms[k];
          c.uniforms.steady.value = 1;
          c.userData = { ...m.userData };
          const d = new THREE.Mesh(o.geometry, c);
          d.matrixAutoUpdate = false;
          d.matrix.copy(o.matrixWorld);
          d.matrixWorld.copy(o.matrixWorld);
          d.renderOrder = 5;
          d.frustumCulled = false;
          d.visible = false;
          d.userData.src = o;
          scene.add(d);
          own.push(d);
        });
        u.dome.meshes = own.length ? own : null;
      }
      if (u.dome.meshes) {
        const on = !u.dead && !!u.dome.on;
        const c = u.dome.color.split(/[\s,]+/).map(Number);
        for (const o of u.dome.meshes) {
          o.visible = (on || !!this.warmDomes) && u.seen !== false;
          o.material.uniforms.tint.value.setRGB(c[0] || 0.2, c[1] || 0.2, c[2] ?? 0.8);
          if (o.visible) {
            const s = o.userData.src;
            s.updateWorldMatrix(true, false);
            o.matrix.copy(s.matrixWorld);
            o.matrixWorld.copy(s.matrixWorld);
          }
        }
        continue;
      }
      let d = this.domes.get(u);
      if (!d) {
        const c = u.dome.color.split(/[\s,]+/).map(Number);
        d = new THREE.Mesh(
          new THREE.SphereGeometry(u.dome.r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(c[0] || 0.2, c[1] || 0.2, c[2] ?? 0.8),
            transparent: true,
            opacity: 0.09,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
          })
        );
        d.rotation.x = Math.PI / 2;
        d.position.set(u.x, u.y, u.z - 20);
        d.renderOrder = 5;
        scene.add(d);
        this.domes.set(u, d);
      }
      d.visible = !u.dead && (!!u.dome.on || !!this.warmDomes) && u.seen !== false;
      if (d.userData.color !== u.dome.color) {
        d.userData.color = u.dome.color;
        const c = u.dome.color.split(/[\s,]+/).map(Number);
        d.material.color.setRGB(c[0] || 0.2, c[1] || 0.2, c[2] ?? 0.8);
      }
    }
    this.zoneGeo ||= new THREE.RingGeometry(0.985, 1, 64);
    this.zoneMat ||= new THREE.MeshBasicMaterial({ color: 0xffd421, transparent: true, opacity: 0.8, depthTest: false });
    k = 0;
    if (this.ui.placing)
      for (const p of w.points) {
        if (!(p.side >= 0 && w.ally(p.side, me)) || !p.reinforce) continue;
        const z = this.zones[k] || (this.zones[k] = new THREE.Mesh(this.zoneGeo, this.zoneMat));
        if (z.parent !== scene) scene.add(z);
        z.scale.setScalar(p.enable);
        z.position.set(p.x, p.y, p.z + 2);
        z.visible = true;
        z.renderOrder = 6;
        k++;
      }
    for (; k < this.zones.length; k++) this.zones[k].visible = false;
  }

  drawBars() {
    const c = this.bars,
      w = this.world,
      me = this.me,
      cam = this.camera,
      p = this.proj || (this.proj = new THREE.Vector3());
    if (c.width !== innerWidth || c.height !== innerHeight) {
      c.width = innerWidth;
      c.height = innerHeight;
    }
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (this.endScreen) return;
    const at = (x, y, z) => {
      p.set(x, y, z).project(cam);
      return p.z < 1 ? [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight] : null;
    };
    const atlas = iconAtlas(),
      iz = Math.max(18, Math.round(24 * Math.min(innerHeight / 768, innerWidth / 1024)));
    const abilityMark = (q, x, y) => {
      if (!atlas || !q || q.side < 0 || !w.ally(q.side, me)) return;
      const a = shownAbility(q.abilities),
        name = a && abilityIconName(a.def.kind, a.def.icon),
        rect = name && iconCanvasRect(name);
      if (rect) g.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, Math.round(x - iz / 2), Math.round(y - iz - 4), iz, iz);
    };
    const teamBars = new Set();
    for (const u of w.units) {
      if (u.dead || u.seen === false || u.inside) continue;
      const tm = this.teamMark(u.squad);
      if (tm) {
        if (teamBars.has(u.squad)) continue;
        teamBars.add(u.squad);
        const f = u.squad.healthFrac;
        if (!u.squad.selected && f >= 1) continue;
        const s = at(tm.x, tm.y, tm.z + tm.top * 2.2 + 8);
        if (!s) continue;
        const wd = 44;
        g.fillStyle = 'rgba(0,0,0,.7)';
        g.fillRect(s[0] - wd / 2 - 1, s[1] - 1, wd + 2, 5);
        g.fillStyle = w.ally(u.side, me) ? (f > 0.5 ? '#35e04a' : f > 0.25 ? '#e0c435' : '#e04535') : '#e04535';
        g.fillRect(s[0] - wd / 2, s[1], wd * f, 3);
        abilityMark(u.squad, s[0], s[1]);
        continue;
      }
      if (!u.squad.selected && u.health >= u.maxHealth && u.shield >= u.maxShield) continue;
      const s = at(u.x, u.y, u.z + u.aimZ * 2.2 + 4);
      if (!s) continue;
      const wd = u.structure ? 70 : u.maxHealth > 150 ? 44 : 22,
        f = Math.max(0, u.health / u.maxHealth);
      g.fillStyle = 'rgba(0,0,0,.7)';
      g.fillRect(s[0] - wd / 2 - 1, s[1] - 1, wd + 2, u.maxShield ? 8 : 5);
      g.fillStyle = w.ally(u.side, me) ? (f > 0.5 ? '#35e04a' : f > 0.25 ? '#e0c435' : '#e04535') : '#e04535';
      g.fillRect(s[0] - wd / 2, s[1], wd * f, 3);
      if (u.maxShield) {
        g.fillStyle = '#4aa8ff';
        g.fillRect(s[0] - wd / 2, s[1] + 4, wd * Math.max(0, u.shield / u.maxShield), 2);
      }
      if (u.squad.members.find(m => !m.dead && !m.inside) === u) abilityMark(u.squad, s[0], s[1]);
    }
    this.drawHeroIcons(g, at);
    const hv = this.ui.hover,
      lead = hv && hv.members && hv.members.find(m => !m.dead);
    if (this.lock && lead && hv.side >= 0 && hv.side !== me && lead.seen !== false) {
      const s = at(lead.x, lead.y, lead.z + (lead.aimZ || 6) * 2.2 + 16),
        pl = this.netPlayer(hv.side);
      if (s && pl && pl.name) {
        g.font = 'bold 12px "Segoe UI", sans-serif';
        g.textAlign = 'center';
        const tw = g.measureText(pl.name).width,
          col = w.ally(hv.side, me) ? '#35e04a' : '#e04535';
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(s[0] - tw / 2 - 4, s[1] - 12, tw + 8, 16);
        g.fillStyle = col;
        g.fillText(pl.name, s[0], s[1]);
      }
    }
    const bar = (x, y, z, f, col) => {
      const s = at(x, y, z);
      if (!s) return;
      g.fillStyle = 'rgba(0,0,0,.75)';
      g.fillRect(s[0] - 41, s[1] - 1, 82, 8);
      g.fillStyle = col;
      g.fillRect(s[0] - 40, s[1], 80 * f, 6);
    };
    if (globalThis.showCaptureBars)
      for (const pt of w.points) if (pt.taker >= 0) bar(pt.x, pt.y, pt.z + 60, pt.progress, w.ally(pt.taker, me) ? '#35e04a' : '#e04535');
    for (const s of w.sites)
      if (s.building) bar(s.x, s.y, s.z + 40, 1 - s.building.left / s.building.total, w.ally(s.building.side, me) ? '#ffd421' : '#e08a35');
    if (this.pings && this.pings.length) {
      let n = 0;
      for (const pg of this.pings) {
        pg.t += 0.016;
        if (pg.t > 0.6) continue;
        const s2 = at(pg.x, pg.y, heightAt(this.terrain, pg.x, pg.y) + 1);
        if (s2) {
          g.strokeStyle = pg.color;
          g.globalAlpha = 1 - pg.t / 0.6;
          g.lineWidth = 2;
          g.beginPath();
          g.ellipse(s2[0], s2[1], 8 + pg.t * 40, (8 + pg.t * 40) * 0.6, 0, 0, 6.283);
          g.stroke();
        }
        this.pings[n++] = pg;
      }
      this.pings.length = n;
      g.globalAlpha = 1;
    }
    const dn = this.down,
      m = this.ui.mouse;
    if (dn && dn[2] === 0 && !this.ui.placing && !this.ui.armed && Math.hypot(m.x - dn[0], m.y - dn[1]) > 5) {
      g.strokeStyle = '#35ff5a';
      g.lineWidth = 1;
      g.fillStyle = 'rgba(53,255,90,.08)';
      g.fillRect(dn[0], dn[1], m.x - dn[0], m.y - dn[1]);
      g.strokeRect(dn[0] + 0.5, dn[1] + 0.5, m.x - dn[0], m.y - dn[1]);
    }
  }

  drawHeroIcons(g, at) {
    const w = this.world,
      me = this.me,
      hits = (this.iconHits ||= []),
      atlas = iconAtlas();
    hits.length = 0;
    if (!atlas) return;
    const size = Math.max(22, Math.round(28 * Math.min(innerHeight / 768, innerWidth / 1024))),
      step = size + 2;
    const heroes = (this.heroTypes ||= new Map());
    const heroOf = u => {
      let r = heroes.get(u.type);
      if (r === undefined) {
        const t = u.type,
          name = t && (t.bool('Is_Named_Hero') || t.bool('Is_Generic_Hero')) && t.str('Icon_Name');
        heroes.set(t, (r = (name && iconCanvasRect(name)) || null));
      }
      return r;
    };
    const groups = (this.iconGroups ||= new Map());
    groups.clear();
    const all = !!globalThis.showAllUnitIcons,
      icons = (this.unitIconRects ||= new Map()),
      done = (this.iconSquads ||= new Set());
    const iconOf = t => {
      let r = icons.get(t);
      if (r === undefined) {
        const name = t && t.str('Icon_Name');
        icons.set(t, (r = (name && iconCanvasRect(name)) || null));
      }
      return r;
    };
    done.clear();
    const add = (host, e) => {
      let list = groups.get(host);
      if (!list) groups.set(host, (list = []));
      list.push(e);
    };
    for (const u of w.units) {
      if (u.dead || u.seen === false) continue;
      const rect = heroOf(u);
      if (rect) {
        add(u.inside && !u.inside.away ? u.inside : u.squad && u.squad.members.length > 1 ? u.squad : u, { u, rect });
        continue;
      }
      const q = u.squad;
      if (!all || u.structure || u.inside || !q || done.has(q)) continue;
      done.add(q);
      if (q.spot || q.members.some(heroOf)) continue;
      const own = iconOf(q.type) || iconOf(u.type);
      if (!own) continue;
      let hp = 0,
        max = 0;
      for (const m of q.members)
        if (!m.dead) {
          hp += m.health;
          max += m.maxHealth;
        }
      add(q.members.length > 1 ? q : u, { u, rect: own, f: max ? hp / max : 0 });
    }
    for (const [host, list] of groups) {
      let x = 0,
        y = 0,
        z = 0,
        n = 0,
        top = 0;
      if (host.members) {
        for (const m of host.members)
          if (!m.dead && !m.inside) {
            x += m.x;
            y += m.y;
            z += m.z;
            n++;
            top = Math.max(top, m.aimZ || 0);
          }
        if (!n) continue;
        x /= n;
        y /= n;
        z /= n;
      } else {
        x = host.x;
        y = host.y;
        z = host.z;
        top = host.aimZ || 0;
      }
      const s = at(x, y, z + top * 2.2 + 4);
      if (!s) continue;
      list.forEach(({ u, rect, f: hp }, i) => {
        const cx = s[0] - ((list.length - 1) * step) / 2 + i * step,
          cy = s[1] - size / 2 - 8;
        const selected = !!u.squad?.selected && u.side === me,
          enemy = !w.ally(u.side, me);
        const col = selected ? '#ffd421' : enemy ? '#ff4d3d' : '#35e04a',
          ix = Math.round(cx - size / 2),
          iy = Math.round(cy - size / 2);
        g.fillStyle = 'rgba(4,10,20,0.55)';
        g.fillRect(ix, iy, size, size);
        g.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, ix, iy, size, size);
        g.strokeStyle = col;
        g.lineWidth = selected ? 2.5 : 1.75;
        g.beginPath();
        g.roundRect(ix - 0.5, iy - 0.5, size + 1, size + 1, 3.5);
        g.stroke();
        const f = Math.max(0, Math.min(1, hp ?? u.health / u.maxHealth));
        g.fillStyle = 'rgba(0,0,0,.7)';
        g.fillRect(ix - 1, iy + size + 2, size + 2, 5);
        g.fillStyle = enemy ? '#e04535' : f > 0.5 ? '#35e04a' : f > 0.25 ? '#e0c435' : '#e04535';
        g.fillRect(ix, iy + size + 3, size * f, 3);
        hits.push({ x: cx, y: cy, r: size / 2 + 2, u: u.inside && !u.inside.away ? u.inside : u });
      });
    }
  }
}

import { readLinkedTactical } from './linktactical.js';
import { loadBlackMarket } from './blackmarket.js';
import { launchLinkedMission, returnLinkedMission, linkedMissionVictory, abortLinkedMission } from './linkedmission.js';
import { galacticLight } from './galacticlighting.js';
import { pauseGalactic, userPauseGalactic } from './galacticpause.js';
import {
  prepareComponentFonts,
  componentFont,
  loadComponentFont,
  nativeTextMask,
  nativeTextPixels,
  settleNativeFonts
} from '../nativefont.js';
import { onLanguageChange } from '../language.js';
import { dialogFontPixels, uiTextHeight } from './dialogtext.js';
import { showSplash, hideSplash } from '../splash.js';

import * as THREE from 'three';
import { BenchOverlay } from '../benchoverlay.js';
import { db, switchLanguage } from '../gamedata.js';
import { loadModel, planetLighting, lighting, updateBillboards, planetClock, programSources } from '../model.js';
import { env as gpuEnv, wantGPU } from '../gpu/env.js';
import { loadTexture } from '../dds.js';
import { RouteBatches } from './routebatch.js';
import { loadALA, animName, AnimState } from '../ala.js';
import { fontFamily, loadGameFonts } from '../fonts.js';
import { gfx, pixelRatio, gammaOn } from '../gfx.js';
import { loadCampaignData, startingGalaxy, snapshotGalaxy, applyGalaxy, PLANET_RADIUS, isHumanFaction } from './galaxy.js';
import { GalacticNet, orders, runCommand, galaxyHash } from './galacticnet.js';
import { MpBattles } from './galacticmpbattle.js';
import { seedSim } from './simrandom.js';
import { openDialog } from './dialogs.js';
import { STRATEGIC_FRAMES } from './galacticspeed.js';
import { embarkGround, canLand, landFriendly, invasionForces, applyInvasionResult, tacticalTransportType } from './invasion.js';
import { orderMove, stepFleets, LOGIC_FPS, baseSpeed, blocks, bribeQuote, pullIn } from './fleets.js';
import { canBribe } from './galacticbribe.js';
import { reachableFleetPlanets, transferFleetUnits, dropOverviewUnits } from './fleetmanagement.js';
import { humanReach } from './humanroute.js';
import { iconCanvasRect, iconAtlas } from '../icons.js';
import { loadHudAssets } from './hud.js';
import { GalacticBar, loadGalacticHudAssets } from './galactichud.js';
import { PlanetOverview, loadOverviewAssets } from './planetoverview.js';
import { BaseLayout, loadBaseLayoutAssets } from './baselayout.js';
import { MarketPanel, loadMarketAssets } from './blackmarketpanel.js';
import { stepCorruption, executeCorruption, choicesOf } from './galacticcorruption.js';
import { CorruptionVisuals } from './corruptionvisuals.js';
import { slotFor, activateSlot, isHero, SLOTS } from './abilityslots.js';
import { isRaidForce, raidCapable, RAID_SLOT } from './raid.js';
import { relation, hidden } from './galacticrelation.js';
import { TooltipGate } from './tooltipgate.js';
import { executeSlice } from './galacticslicer.js';
import { galaxyWideUpgrades } from './planetabilities.js';
import { CorruptionPanel, loadCorruptionAssets } from './corruptionpanel.js';
import { SlicePanel, loadSliceAssets } from './slicepanel.js';
import { HackPanel, loadHackAssets } from './hackpanel.js';
import { snapshot, putSave } from './savegame.js';
import { galacticBenchmark, aiActivity, activityText, commandCount, unitCount } from './galacticbenchmark.js';
import { executeHack } from './galactichack.js';
import { SabotagePanel, loadSabotageAssets } from './sabotagepanel.js';
import { sabotageStructure } from './galacticsabotage.js';
import { GalacticRadar, loadGalacticRadarAssets } from './galacticradar.js';
import { CHAT_MAX, chatText } from './netgame.js';
import { PlanetInfo } from './planetinfo.js';
import { ScriptUI } from './scriptui.js';
import { GalacticStoryHost } from './galacticstory.js';
import { storyMoviesDone } from './storyrewards.js';
import { constructStory } from './galacticbattleevents.js';
import { GalacticScreenText } from './galacticscreentext.js';
import { GalacticStoryDialog } from './galacticstorydialog.js';
import { GalacticMovies } from './galacticmovies.js';
import { GalacticLog } from './galacticlog.js';
import { Menus } from './menus.js';
import { stepIncome, orbitFleets, cycleNumber } from './galacticeconomy.js';
import { GalacticAI } from './galacticai.js';
import { GalacticBattles } from './galacticbattles.js';
import { packContrast } from './galacticautoresolve.js';
import { PendingBattle } from './galacticpending.js';
import { GalacticVictory } from './galacticvictory.js';
import { destroyedPlanetModel, destroyPlanet, hasPlanetDestruction } from './planetdestruction.js';
import { campaignScore } from './campaignscore.js';
import { ParticleManager, loadParticles } from '../particles.js';
import { stepProduction, populationUsed, populationCap, queueUnit, cancelProduction } from './galacticproduction.js';
import {
  stepVisibility,
  intelligence,
  displayOwner,
  displayIncome,
  connectionOwner,
  visibleTransit,
  strategicStealth,
  VIS
} from './galacticfog.js';
import { routeStyle, routeSettings, routeAxes } from './galacticroutes.js';
import { placeGalacticModel, renderGalacticScenes } from './galacticscenes.js';
import { GalacticModelFade } from './galacticfade.js';
import { strategicIndex, strategicMultiplier } from './galacticspeed.js';
import { FleetLines } from './fleetlines.js';
import { stepPolitics, onControllerChange } from './galacticpolitics.js';
import { setComponentText } from './componenttext.js';
import { snapNativeText } from '../nativefont.js';
import { stageStart } from './transit.js';
import { startStrategicMusic } from './galacticmusic.js';
import { stepDualFlash } from './tutorialrewards.js';
import { pressed, held } from './keybinds.js';

const $ = id => document.getElementById(id);
const SILENT = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : SILENT),
  apply: () => undefined
});
const DEG = Math.PI / 180;
const smooth = t => t * t * (3 - 2 * t);

const rgb = s => {
  const v = String(s || '')
    .split(/[\s,]+/)
    .map(parseFloat)
    .filter(Number.isFinite);
  return v.length >= 3 ? [v[0] / 255, v[1] / 255, v[2] / 255] : [0.5, 0.5, 0.5];
};

export class GalacticGame {
  constructor(setup, { audio, progress }) {
    this.setup = setup;
    this.audio = audio;
    this.progress = progress;
    this.paused = false;
    this.galacticPauseCount = 0;
    this.userPaused = false;
    this.over = false;
    this.galactic = true;
    this.speed = strategicMultiplier(strategicIndex());
    this.uiPauseReasons = new Set();
    this.controlsLocked = false;
    this.pendingLinkedTactical = null;
    this.linkedMission = null;
    this.modeSuspended = false;
    try {
      this.simplifiedFactionColors = localStorage.getItem('swr-simplified-faction-colors') === '1';
    } catch {
      this.simplifiedFactionColors = false;
    }
    try {
      this.autoResolveOption = localStorage.getItem('swr-auto-resolve') === '1';
    } catch {
      this.autoResolveOption = false;
    }
    this.idlers = [];
    this.planetViews = [];
    this.fleetLoading = new WeakSet();
    this.selected = -1;
    this.hover = -1;
    this.planetInfo = new PlanetInfo(this);
    this.hudTimer = 0;
    this.keys = new Set();
    this.dragFleet = null;
    this.dragGround = undefined;
    this.dragReach = null;
    this.stackDown = null;
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
    this.overview?.cancelDrag();
    this.unsubscribeLanguage?.();
    this.speechStoryDone?.();
    for (const part of [this.story, this.ai, this.storyDialog, this.galacticLog, this.movies, this.scriptUI, this.screenText]) {
      try {
        part?.dispose?.();
      } catch (e) {
        console.warn('galaxy dispose', e);
      }
    }
    this.ui?.destroy?.();
    if (this.menus) while (this.menus.stack.length) this.menus.stack.pop().close();
    const R = this.renderer;
    if (R?.isWebGLRenderer) {
      R.dispose();
      R.forceContextLoss();
    } else R?.dispose?.();
    if (window.game === this) window.game = null;
  }

  async start() {
    const P = this.progress,
      C = db.constants;
    $('lobby').classList.add('hidden');
    showSplash();
    P('Reading the campaigns', 0);
    const data = (this.data = await loadCampaignData());
    await loadBlackMarket();
    if (this.setup.net) seedSim(this.setup.seed >>> 0);
    const want = String(this.setup.campaign || '').toUpperCase();
    let camp =
      data.campaigns.get(want) ||
      [...data.campaigns.values()].find(c => c.name.toUpperCase().includes(want)) ||
      [...data.campaigns.values()][0];
    const side = db.faction(this.setup.faction);
    if (camp && side && !this.setup.net) {
      const set = camp.str('Campaign_Set').toUpperCase();
      camp =
        [...data.campaigns.values()].find(
          c => c.str('Campaign_Set').toUpperCase() === set && c.str('Starting_Active_Player').toUpperCase() === side.name.toUpperCase()
        ) || camp;
    }
    if (!camp) throw new Error('this game data has no campaign');
    const g = (this.galaxy = startingGalaxy(data, camp));
    if (this.setup.restore) applyGalaxy(g, this.setup.restore);
    if (this.setup.net) this.multiplayerGalaxy(g);
    this.victory = new GalacticVictory(this);
    this.me = this.setup.net ? this.localFaction : db.faction(g.active)?.name || g.players[0]?.faction;
    stepVisibility(g, this.me);
    this.filters = g.displayFilters || 0;

    const num = (k, d) => C.num(k, d),
      vec = (k, d) => {
        const v = C.vec(k, d);
        return [v[0] ?? d[0], v[1] ?? d[1], v[2] ?? d[2]];
      };
    this.cam = {
      pitch: num('GMC_InitialPitchAngleDegrees', -30),
      zoomPitch: num('GMC_ZoomedPitchAngleDegrees', -35),
      pull: num('GMC_InitialPullbackDistance', 700),
      zoomPull: num('GMC_ZoomedPullbackPlanetRadiusFraction', 3),
      zoomOffset: vec('GMC_ZoomedPositionOffsetPlanetRadiusFractions', [0, 0, 1.05]),
      zoomTime: num('GMC_ZoomTime', 0.65),
      plane: num('Galactic_Scroll_Plane', 10),
      dragFactor: num('Galactic_Right_Button_Scroll_Speed_Factor', 0.25),
      light: num('Galactic_Zoom_Light_Level', 0.5),
      lightOut: C.vec('Galactic_Zoom_Out_Light_Angle', [0, 160, 58]),
      lightIn: C.vec('Galactic_Zoom_In_Light_Angle', [0, 235, 18])
    };
    const home = g.players.find(p => p.faction === this.me)?.home ?? -1,
      hp = g.planets[home];
    this.view = {
      x: hp ? hp.pos[0] : 0,
      y: hp ? hp.pos[1] : 0,
      z: this.cam.plane,
      zoom: 0,
      dir: 0,
      planet: -1,
      yaw: 0,
      pull: this.cam.pull,
      pullTo: this.cam.pull
    };
    const mySlot = this.setup.net
      ? (this.setup.players || []).findIndex(p => p.human && (p.peer === this.setup.net.me || p.peers?.includes(this.setup.net.me)))
      : -1;
    if (this.setup.restore && this.setup.restore.view && (!this.setup.net || this.setup.restoreSlot === mySlot))
      Object.assign(this.view, this.setup.restore.view, { zoom: 0, dir: 0, planet: -1 });
    this.view.pullTo = this.view.pull;
    this.bounds = this.planetBounds();

    let renderer = null;
    if (wantGPU()) {
      gpuEnv.programSources = programSources;
      gpuEnv.lighting = lighting;
      const { GPURenderer } = await import('../gpu/renderer.js');
      renderer = await GPURenderer.create().catch(e => {
        console.warn('webgpu', e);
        return null;
      });
    }
    renderer ||= new THREE.WebGLRenderer({ antialias: gfx.aa !== false, powerPreference: 'high-performance' });
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setPixelRatio(pixelRatio());
    $('view').appendChild(renderer.domElement);
    gammaOn(renderer.domElement);
    this.scene = new THREE.Scene();
    this.backgroundScene = new THREE.Scene();
    this.midgroundScene = new THREE.Scene();
    this.midforegroundScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
    this.camera.up.set(0, 0, 1);
    lighting.sunColor.value.setRGB(0.5, 0.5, 0.5);
    lighting.sunSpecular.value.setRGB(1, 1, 1);
    lighting.ambient.value.setRGB(0.05, 0.05, 0.05);
    lighting.fillColor.value.setRGB(0, 0, 0);
    lighting.fillColor2.value.setRGB(0, 0, 0);
    for (const key of Object.keys(planetLighting)) planetLighting[key].value.copy(lighting[key].value);

    P('Placing the planets', 0.1);
    await loadGameFonts().catch(() => null);
    let done = 0;
    await Promise.all(
      g.planets.map(async (p, i) => {
        const file = destroyedPlanetModel(p);
        const inst = file && (await loadModel(file, { alts: p.background ? false : [0, 2] }).catch(() => null));
        if (inst) {
          placeGalacticModel(inst.root, p);
          new GalacticModelFade(inst, p.type, p.background);
          const scene = p.background
            ? this.backgroundScene
            : p.type.bool('In_Midground')
              ? this.midgroundScene
              : p.type.bool('In_Midforeground')
                ? this.midforegroundScene
                : this.scene;
          scene.add(inst.root);
          if (p.type.bool('Loop_Idle_Anim_00')) {
            const a = await Promise.resolve(loadALA(animName(file, 'IDLE'))).catch(() => null);
            if (a) this.idlers.push(new AnimState(inst, a, { loop: true }));
          }
        }
        this.planetViews[i] = { inst, name: db.t(p.type.str('Text_ID')) || p.name, show: p.type.bool('Show_Name') && !p.background };
        P(`Placing the planets (${++done}/${g.planets.length})`, 0.1 + (0.8 * done) / g.planets.length);
      })
    );
    this.marker = await loadModel('w_planet_select_neutral.alo').catch(() => null);
    if (this.marker) {
      this.marker.root.visible = false;
      this.scene.add(this.marker.root);
      this.marker.root.traverse(o => {
        if (o.isMesh) {
          const own = o.material.clone();
          for (const k in o.material.uniforms)
            if (!['diffuse', 'emissive', 'specular'].includes(k)) own.uniforms[k] = o.material.uniforms[k];
          o.material = own;
          o.userData.baseColors = ['diffuse', 'emissive', 'specular'].map(k => o.material.uniforms?.[k]?.value.clone());
        }
      });
      const idle = await Promise.resolve(loadALA(animName('w_planet_select_neutral.alo', 'IDLE'))).catch(() => null);
      if (idle) {
        this.markerIdle = new AnimState(this.marker, idle, { loop: true });
        this.idlers.push(this.markerIdle);
      }
    }
    this.buildRoutes();
    await this.buildNames();
    P('Fleets', 0.95);
    this.fleetViews = new Map();
    this.mergeFleets();
    await Promise.all(g.fleets.map(f => this.fleetView(f)));

    P('Galactic command bar', 0.98);
    const hud = await loadGalacticHudAssets();
    if (hud) {
      this.human = { factionName: this.me };
      $('hud').classList.remove('hidden');
      document.body.classList.add('original-hud');
      await prepareComponentFonts(hud.comps, uiTextHeight());
      this.ui = new GalacticBar(this, hud);
      this.scriptUI = new ScriptUI(this, hud);
      g.scriptUISnapshot = () => this.scriptUI.snapshot();
      this.screenText = new GalacticScreenText(this, hud.comps);
      this.movies = new GalacticMovies(this, hud);
      this.radar = new GalacticRadar(this, await loadGalacticRadarAssets(hud));
      $('minimap').hidden = true;
    }
    const overview = await loadOverviewAssets();
    if (overview) this.overview = new PlanetOverview(this, overview);

    P('Campaign story', 0.99);
    this.menus = new Menus(this);
    await this.audio?.speech?.load();
    this.speechStoryDone = this.audio?.speech?.on('storydone', record => {
      this.screenText?.show({ id: 'TEXT_SPEECH_' + record.name, remove: true });
      if (!this.setup.net) this.story?.signal('STORY_SPEECH_DONE', record.name);
    });
    this.storyDialog = new GalacticStoryDialog(this);
    this.galacticLog = new GalacticLog(this, hud);
    onControllerChange((planet, old, now, bonus) => {
      if (!this.over) this.planetChangedHands(planet, old, now, bonus);
    });
    g.hostSnapshot = () => ({ controlsLocked: !!this.controlsLocked, suspendAI: !!this.suspendAI, tutorialPlayer: !!this.tutorialPlayer });
    if (g.hostSaved) {
      this.controlsLocked = g.hostSaved.controlsLocked;
      this.suspendAI = g.hostSaved.suspendAI;
      this.tutorialPlayer = g.hostSaved.tutorialPlayer;
    }
    this.story = await GalacticStoryHost.create(this, { warm: false });
    if (g.scriptUISaved && this.scriptUI) this.scriptUI.restore(g.scriptUISaved);
    this.ai = await GalacticAI.create(this);
    if (this.story?.unwarmed) {
      this.story.unwarmed = false;
      await this.story.warm();
    }
    this.battles = new GalacticBattles(this);
    this.pendingBattle = new PendingBattle(this);
    if (this.setup.result) {
      this.applyResult(this.setup.result);
      this.galacticBattleChanged();
      this.ai?.invalidate();
    }
    await this.scriptUI?.ready();

    hideSplash();
    if (this.setup.restore && !this.setup.result && !this.setup.net) this.setUserPaused?.(true);
    this.bindInput();
    this.fit();
    this.unsubscribeLanguage = onLanguageChange(() => this.refreshLanguage(), 2);
    this.listen('resize', () => this.fit());
    window.game = this;
    startStrategicMusic(this);
    if (this.setup.net) await this.startNet();
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  get noSave() {
    return (
      this.over ||
      !this.story ||
      !!this.battle ||
      !!(this.net && this.pendingBattle?.busy) ||
      !!this.pendingLinkedTactical ||
      this.modeSuspended ||
      !!this.linkedMission ||
      !!this.ai?.goals?.selecting
    );
  }

  saveName() {
    const g = this.galaxy;
    return `${g.campaign.name} - ${db.t('TEXT_CYCLES') || 'Cycle'} ${cycleNumber(g)}`;
  }

  galacticSnapshot(name, { version, build }) {
    const g = this.galaxy,
      snap = snapshotGalaxy(g);
    snap.view = this.viewSnap(this.view.x, this.view.y);
    if (this.story && !snap.storyLua)
      throw new Error(
        'The story scripts cannot be saved just now' +
          (this.story.saveError ? ' (' + this.story.saveError + ')' : '') +
          '. Try again in a moment.'
      );
    const { restore, result, ...setup } = this.setup;
    return {
      format: 'sw-revival-save',
      version,
      build,
      saved: new Date().toISOString(),
      name: name || this.saveName(),
      mode: 'galactic',
      setup: { ...setup, campaign: g.campaign.name, faction: g.active },
      summary: {
        mode: 'galactic',
        campaign: g.campaign.name,
        factions: [this.me],
        cycle: cycleNumber(g),
        time: Math.round(g.time || 0)
      },
      galaxy: snap
    };
  }

  onLoadCampaign(setup) {
    if (this.setup.net) {
      this.mpLoad(setup);
      return;
    }
    this.overview?.cancelDrag();
    this.unsubscribeLanguage?.();
    this.speechStoryDone?.();
    this.story?.dispose();
    this.ai?.dispose();
    this.storyDialog?.dispose();
    this.galacticLog?.dispose();
    this.audio?.speech?.clear(false);
    this.movies?.dispose();
    stageStart({ ...setup, players: [], teamFactions: [] });
  }

  mpLoad(request) {
    const key = x => String(x || '').toUpperCase(),
      data = this.data,
      want = key(request.campaign);
    const camp = data.campaigns.get(want) || [...data.campaigns.values()].find(c => key(c.name).includes(want));
    if (!camp) {
      this.message(`The campaign ${request.campaign} is not in the game data.`);
      return;
    }
    const set = key(camp.str('Campaign_Set')),
      variants = [...data.campaigns.values()].filter(c => key(c.str('Campaign_Set')) === set);
    const variant = f => variants.find(c => key(c.str('Starting_Active_Player')) === key(f));
    const sides = db.faction(request.faction)?.name;
    const hostWas = key((this.setup.players || []).find(p => p.peer === 0)?.faction);
    const players = (this.setup.players || []).map((p, i) =>
      !p.human || p.left
        ? p
        : { ...p, faction: (p.peer !== 0 && (this.menuFactions?.[i] || (key(p.faction) !== hostWas && p.faction))) || sides || p.faction }
    );
    const humanTypes = Object.fromEntries(
      players
        .filter(p => p.human)
        .map(p => [
          key(p.faction),
          variant(p.faction)
            ?.tuples('AI_Player_Control')
            .find(t => key(t[0]) === key(p.faction))?.[1] || 'Human'
        ])
    );
    const { net, restore, result, ...rest } = this.setup;
    const next = {
      ...rest,
      campaign: camp.name,
      players,
      humanTypes,
      singlePlayerCampaign: true,
      difficulty: request.difficulty || rest.difficulty,
      ...(request.startingTechLevel !== undefined ? { startingTechLevel: request.startingTechLevel } : {}),
      seed: (Math.imul((rest.seed >>> 0) ^ 0x27d4eb2d, 33) + 0x165667b1) >>> 0
    };
    this.over = true;
    this.net?.stop();
    window.parent?.mpGalaxy?.next(next);
  }

  queueLinkedTactical(params) {
    if (this.pendingLinkedTactical) return false;
    const request = readLinkedTactical(this, params);
    if (!request) return false;
    this.pendingLinkedTactical = request;
    return true;
  }
  linkedMissionVictory(winner, flags) {
    return linkedMissionVictory(this, winner, flags);
  }
  returnLinkedTactical(result) {
    return returnLinkedMission(this, result);
  }
  abortLinkedTactical(error) {
    abortLinkedMission(this, error);
  }

  setSpeed(speed) {
    if (this.net) {
      if (speed !== this.speed) this.net.lock.setSpeed(speed);
      return;
    }
    this.speed = speed;
  }
  async endCampaign(result) {
    this.over = true;
    this.controlsLocked = true;
    this.planetInfo?.close?.();
    this.storyDialog?.close();
    this.galacticLog?.close();
    this.baseLayout?.close?.();
    this.marketPanel?.close();
    this.corruptionPanel?.close();
    this.slicePanel?.close();
    this.hackPanel?.close();
    this.sabotagePanel?.close();
    this.overview?.hide?.();
    this.scriptUI?.dispose();
    this.audio?.speech?.clear(false);
    this.movies?.stop();
    this.screenText?.dispose();
    this.keys.clear();
    this.mouse.in = false;
    this.drag = this.dragFleet = null;
    this.dragGround = undefined;
    this.dragReach = null;
    this.abilityParticles?.worker.terminate();
    if (this.attachedParticles) for (const m of this.attachedParticles.values()) m.worker.terminate();
    this.corruptionVisuals?.dispose();
    $('hud')?.classList.add('hidden');
    this.renderer.domElement.hidden = true;
    this.names.hidden = true;
    this.paused = true;
    await campaignScore(this, result);
  }
  async planetDestroyed(p) {
    const pv = this.planetViews[p.index];
    if (!pv) return;
    const old = pv.inst;
    old?.root.removeFromParent();
    this.idlers = this.idlers.filter(a => a.inst !== old);
    pv.inst = null;
    pv.alt = undefined;
    const file = destroyedPlanetModel(p);
    pv.destroyedLoad = file ? loadModel(file, { alts: [0, 2] }).catch(() => null) : Promise.resolve(null);
    const inst = await pv.destroyedLoad;
    if (inst) {
      placeGalacticModel(inst.root, p);
      new GalacticModelFade(inst, p.type, p.background);
      this.scene.add(inst.root);
      pv.inst = inst;
      if (p.type.bool('Loop_Idle_Anim_00')) {
        const anim = await Promise.resolve(loadALA(animName(file, 'IDLE'))).catch(() => null);
        if (anim && pv.inst === inst) this.idlers.push(new AnimState(inst, anim, { loop: true }));
      }
    }
    this.overview?.refresh();
    this.ui?.refresh();
  }
  async planetAbilityEffect(p, name, bone) {
    const type = db.type(name),
      file = type?.str('Space_Model_Name') || type?.str('Land_Model_Name') || name;
    if (!file) return;
    const [, definition] = await Promise.all([this.planetViews[p.index]?.destroyedLoad, loadParticles(file)]);
    if (!definition || this.over) return;
    this.abilityParticles ||= new ParticleManager(this.scene);
    const root = this.planetViews[p.index]?.inst,
      b = root?.boneByName.get(String(bone || '').toUpperCase());
    const at = b?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3(...p.pos);
    this.abilityParticles.burst(file, at.x, at.y, at.z, type?.num('Scale_Factor', 1) || 1, Infinity);
  }
  async attachParticle(p, name, bone) {
    const type = db.type(String(name || '')),
      file = type?.str('Galactic_Model_Name');
    if (!file || this.over || !(await loadParticles(file))) return;
    const scene = type.bool('In_Background')
      ? this.backgroundScene
      : type.bool('In_Midground')
        ? this.midgroundScene
        : type.bool('In_Midforeground')
          ? this.midforegroundScene
          : this.scene;
    const managers = (this.attachedParticles ||= new Map());
    let manager = managers.get(scene);
    if (!manager) {
      manager = new ParticleManager(scene);
      managers.set(scene, manager);
    }
    const end = (this.galaxy.time || 0) + type.num('Particle_Lifetime_Frames', 0) / LOGIC_FPS,
      at = new THREE.Vector3();
    let handle = null;
    handle = manager.spawn(file, f => {
      if ((this.galaxy.time || 0) >= end && handle?.emitting) handle.stop();
      const root = this.planetViews[p.index]?.inst?.root,
        b = bone && this.planetViews[p.index]?.inst?.boneByName.get(String(bone).toUpperCase());
      if (b) b.getWorldPosition(at);
      else at.set(...p.pos);
      const e = root?.matrixWorld.elements;
      f.x = at.x;
      f.y = at.y;
      f.z = at.z;
      f.rot = e ? Math.atan2(e[1], e[0]) : 0;
      f.scale = 1;
      f.vx = f.vy = 0;
    });
  }

  setLanguage(language) {
    return switchLanguage(language);
  }
  async refreshLanguage() {
    if (this.scriptUI) await prepareComponentFonts(this.scriptUI.comps, uiTextHeight());
    for (const p of this.galaxy.planets)
      if (this.planetViews[p.index]) this.planetViews[p.index].name = db.t(p.type.str('Text_ID')) || p.name;
    await this.warmNameFonts();
    this.ui?.refreshLanguage();
    for (const panel of [
      this.overview,
      this.baseLayout,
      this.marketPanel,
      this.corruptionPanel,
      this.slicePanel,
      this.hackPanel,
      this.sabotagePanel
    ]) {
      panel?.reflowText();
      panel?.refresh();
    }
    if (this.baseLayout?.paletteArea) this.baseLayout.paletteArea.setAttribute('aria-label', db.t('TEXT_GROUND_FORCES'));
    this.scriptUI?.refreshLanguage();
    this.pendingBattle?.refreshLanguage();
    this.radar?.refreshLanguage();
    await this.screenText?.refreshLanguage();
    await this.galacticLog?.encyclopedia?.refreshLanguage();
    await settleNativeFonts();
  }
  setUIPause(reason, on) {
    if (this.uiPauseReasons.has(reason) === on) return;
    if (on) {
      this.uiPauseReasons.add(reason);
      this.audio?.speech?.suspend();
    } else {
      this.uiPauseReasons.delete(reason);
      this.audio?.speech?.resume();
    }
    this.movies?.setPaused(this.uiPauseReasons.size > 0);
  }
  pauseGalactic(on) {
    if (this.setup.net) return;
    pauseGalactic(this, on);
  }
  setUserPaused(on) {
    if (this.net) {
      this.net.lock.togglePause();
      return;
    }
    userPauseGalactic(this, on);
  }
  toggleMenu() {
    this.menus?.toggle();
  }
  benchmark(options) {
    return galacticBenchmark(this, options);
  }

  toggleBenchmark() {
    if (this.bench) {
      this.bench.dispose();
      this.bench = null;
      return;
    }
    const since = aiActivity(this);
    this.bench = new BenchOverlay({
      label: 'galaxy',
      result: { galaxy: 'live' },
      renderer: this.renderer,
      parent: $('hud') || document.body,
      shotsLabel: 'dec/cmd',
      count: () => ({ units: unitCount(this.galaxy), shots: activityText(since()) }),
      more: () => {
        const d = since();
        return { aiDecisions: d.plans, aiCommands: commandCount(d) };
      }
    });
  }
  message(text) {
    if (this.galacticLog) this.galacticLog.message(text);
    else console.info('[galaxy]', text);
  }
  showScreenText(request) {
    this.screenText?.show(request);
  }
  removeScreenText() {
    this.screenText?.removeAll();
  }
  showStoryDialog(request) {
    this.storyDialog?.show(request);
  }
  notifyStoryGoal(request, sound = true) {
    if (sound) this.audio?.play(db.faction(this.me)?.str('SFXEvent_Mission_Added'));
    this.galacticLog?.message(db.t(db.faction(this.me)?.str('Default_Transmission_Message')));
  }

  planetBounds() {
    const ps = this.galaxy.planets.filter(p => !p.background);
    if (!ps.length) return { x0: 0, x1: 0, y0: 0, y1: 0 };
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const p of ps) {
      x0 = Math.min(x0, p.pos[0]);
      x1 = Math.max(x1, p.pos[0]);
      y0 = Math.min(y0, p.pos[1]);
      y1 = Math.max(y1, p.pos[1]);
    }
    const mx = ((x1 - x0) / 2) * 0.15,
      my = ((y1 - y0) / 2) * 0.15;
    return { x0: x0 - mx, x1: x1 + mx, y0: y0 - my, y1: y1 + my };
  }

  routeLook(r) {
    const g = this.galaxy,
      a = connectionOwner(g, g.planets[r.a]),
      b = connectionOwner(g, g.planets[r.b]),
      f = a && db.faction(a);
    const line = this.data.lines.get(String(r.type.str('Visible_Line_Name') || 'Default').toUpperCase()) || this.data.lines.get('DEFAULT');
    const allied = (owner, viewer) =>
      owner?.toUpperCase() === viewer?.toUpperCase() ||
      db
        .faction(owner)
        ?.list('Allies')
        .some(n => n.toUpperCase() === viewer?.toUpperCase());
    return routeSettings(
      line,
      routeStyle(a, b, f, db.constants, this.me, this.simplifiedFactionColors ?? this.setup.simplifiedFactionColors ?? false, allied)
    );
  }

  buildRoutes() {
    const g = this.galaxy,
      blendOf = L =>
        /ADDITIVE$/.test(L.mode)
          ? THREE.AdditiveBlending
          : /MODULATE$/.test(L.mode)
            ? THREE.MultiplyBlending
            : L.mode === 'OPAQUE'
              ? THREE.NoBlending
              : THREE.NormalBlending;
    this.routes = [];
    for (const r of g.routes) {
      const look = this.routeLook(r),
        A = g.planets[r.a].pos,
        B = g.planets[r.b].pos;
      this.routes.push({ r, look, A, B, axes: routeAxes(A, B), ticks: 0, clock: 0, lastZoom: -1, owners: null, ownerChanged: false });
    }
    this.routeBatches = new RouteBatches(this.scene, name => loadTexture(name, { repeat: false }), blendOf);
    this.routeBatches.build(this.routes);
  }

  updateRoutes(real, zoom) {
    const simplified = this.simplifiedFactionColors ?? this.setup.simplifiedFactionColors ?? false,
      B = this.routeBatches,
      g = this.galaxy;
    let rebuild = false;
    for (const rt of this.routes) {
      const a = g.planets[rt.r.a],
        b = g.planets[rt.r.b],
        owners = `${connectionOwner(g, a)}|${connectionOwner(g, b)}|${simplified}`;
      if (owners === rt.owners) continue;
      const was = B.key(rt.look);
      rt.owners = owners;
      rt.look = this.routeLook(rt.r);
      rt.ownerChanged = true;
      if (B.key(rt.look) !== was) rebuild = true;
    }
    if (rebuild) B.build(this.routes);
    for (const rt of this.routes) {
      const a = g.planets[rt.r.a],
        b = g.planets[rt.r.b];
      const visible = !!(intelligence(g, a)?.discovered && intelligence(g, b)?.discovered);
      const changed = rt.ownerChanged || zoom !== rt.lastZoom;
      rt.ownerChanged = false;
      const L = rt.look,
        map = rt.quad.group.mesh.material.uniforms.map.value;
      const width = L.width > 0 ? L.width : map.image?.height || 1;
      const r = L.out[0] + (L.in[0] - L.out[0]) * zoom,
        gr = L.out[1] + (L.in[1] - L.out[1]) * zoom,
        bl = L.out[2] + (L.in[2] - L.out[2]) * zoom,
        opacity = L.out[3] + (L.in[3] - L.out[3]) * zoom;
      B.setQuad(rt, visible ? width : 0, r, gr, bl, opacity);
      const sparks = visible && !L.neutral && zoom < 1;
      rt.lastZoom = zoom;
      if (changed) {
        rt.ticks = 0;
        rt.clock = 0;
      }
      if (!sparks) {
        B.setSparkColor(rt, 0, 0, 0, 0);
        continue;
      }
      B.setSparkColor(
        rt,
        Math.floor(r * 0.7 * 255) / 255,
        Math.floor(gr * 0.7 * 255) / 255,
        Math.floor(bl * 0.7 * 255) / 255,
        Math.floor(opacity * 0.7 * 255) / 255
      );
      if (!this.paused) {
        rt.clock += real * this.speed * LOGIC_FPS;
        const n = Math.floor(rt.clock);
        rt.clock -= n;
        rt.ticks = (rt.ticks + n) % 50;
      }
      B.moveSparks(rt, rt.ticks);
    }
    B.flush();
  }

  async buildNames() {
    const cv = (this.names = document.createElement('canvas'));
    cv.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2';
    document.body.appendChild(cv);
    const assets = await loadHudAssets(),
      comps = assets?.comps;
    const pair = (c, key, fallback) => {
      const v = c
        ?.val(key)
        .split(/[\s,]+/)
        .map(parseFloat);
      return v?.length >= 2 && v.every(Number.isFinite) ? v : fallback;
    };
    const component = name => {
      const c = comps?.get(name),
        textures = c?.val('Blank_Texture_Name').trim().split(/\s+/).filter(Boolean) || [];
      return {
        textures,
        over: c?.val('Mouse_Over_Texture_Name').trim().split(/\s+/).filter(Boolean)[0] || '',
        offset: pair(c, 'Offset', [3, 5]),
        size: pair(c, 'Size', [0.75, 0]),
        scale: c?.num('Scale', 1) ?? 1
      };
    };
    const fleet = comps?.get('G_PLANET_FLEET'),
      name = comps?.get('G_PLANET_NAME'),
      ring = comps?.get('G_PLANET_RING');
    this.nameStyle = {
      font: name?.val('Font_Name') || 'EmpireAtWar-Bold',
      fonts:
        name
          ?.val('Alternate_Font_Name')
          .split(/[,\s]+/)
          .filter(Boolean) || [],
      pt: name?.num('Font_Point_Size', 7) ?? 7,
      offset: pair(name, 'Offset', [30, 0]),
      scale: name?.num('Scale', 1) ?? 1,
      outline: !/^(false|no|0)$/i.test(name?.val('Text_Outline') || '')
    };
    this.fleetComp = {
      ...component('G_PLANET_FLEET'),
      side: pair(fleet, 'Default_Offset', [36, 42]),
      wide: pair(fleet, 'Default_Offset_Widescreen', null)
    };
    this.groundComp = component('G_PLANET_LAND_FORCES');
    this.specialComp = {
      ...component('G_SPECIAL_ABILITY'),
      offset: pair(comps?.get('G_SPECIAL_ABILITY'), 'Offset', [-48, -20]),
      text: pair(comps?.get('G_SPECIAL_ABILITY'), 'Text_Offset', [-18, 0]),
      color: (comps?.get('G_SPECIAL_ABILITY')?.val('Text_Color') || '247 170 70 255').split(/[\s,]+/).map(Number)
    };
    this.graphComp = component('GRAPH_LEFT');
    this.ringComp = {
      texture: ring?.val('Icon_Texture_Name') || 'planet_ring.tga',
      scale: ring?.num('Scale', 1) ?? 1,
      alpha:
        (ring
          ?.val('Color')
          .split(/[\s,]+/)
          .map(Number)[3] ?? 255) / 255
    };
    const value = comps?.get('G_PLANET_VALUE');
    this.valueStyle = {
      font: value?.val('Font_Name') || 'EmpireAtWar-Medium',
      pt: value?.num('Font_Point_Size', 6) ?? 6,
      offset: pair(value, 'Offset', [30, -11]),
      outline: !/^(false|no|0)$/i.test(value?.val('Text_Outline') || ''),
      scale: value?.num('Scale', 1) ?? 1
    };
    this.statusStyles = [
      ['G_WEATHER', 'Encyclopedia_Weather_Icon', [-20, -31]],
      ['G_PLANET_ABILITY', 'Planet_Ability_Icon', [0, -34]]
    ].map(([n, tag, fallback]) => ({ tag, offset: pair(comps?.get(n), 'Offset', fallback), scale: comps?.get(n)?.num('Scale', 1) ?? 1 }));
    const last = (c, key, fallback) => {
      const v = c
        ?.all(key)
        .map(n => n.text.trim())
        .filter(Boolean)
        .pop()
        ?.split(/[\s,]+/)
        .map(parseFloat);
      return v?.length >= 2 && v.every(Number.isFinite) ? v : fallback;
    };
    const icon = n => {
      const c = comps?.get(n);
      return {
        textures: [
          ...(c?.val('Icon_Texture_Name').trim().split(/\s+/).filter(Boolean) || []),
          ...(c
            ?.all('Icon_Alternate_Texture_Name')
            .map(x => x.text)
            .join(' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean) || [])
        ],
        scale: c?.num('Scale', 1) ?? 1
      };
    };
    this.statusRow = {
      start: last(comps?.get('G_CONFLICT'), 'Offset', [30, -16]),
      value: last(value, 'Offset', [30, -11])[1],
      ground: last(comps?.get('G_GROUND_ICON'), 'Default_Offset', [34, -26])[1],
      hero: icon('G_HERO'),
      build: icon('G_BUILD'),
      corruption: icon('G_CORRUPTION_ICON')
    };
    this.pipStyles = ['G_SPACE_LEVEL_PIPS', 'G_GROUND_LEVEL_PIPS'].map(n => {
      const c = comps?.get(n);
      return {
        textures: c?.val('Icon_Alternate_Texture_Name').trim().split(/\s+/).filter(Boolean) || [],
        offset: pair(c, 'Default_Offset', [34, n.includes('SPACE') ? -13 : -26]),
        scale: c?.num('Scale', 1) ?? 1
      };
    });
    this.iconPrefix = db.faction(this.me)?.str('Alternate_Icon_Prefix') || '';
    this.typePortraits = new WeakMap();
    this.stackPictures = new Map();
    this.labelRasterCache = new Map();
    await this.warmNameFonts();
  }

  overlayScale() {
    return Math.min(innerWidth / 1024, innerHeight / 768);
  }

  overlayPoint(pos, dx = 0, dy = 0, scale = this.overlayScale()) {
    const v = new THREE.Vector3(...pos).project(this.camera);
    if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3) return null;
    return { x: Math.trunc((v.x * 0.5 + 0.5) * innerWidth) + dx * scale, y: Math.trunc((-v.y * 0.5 + 0.5) * innerHeight) - dy * scale };
  }

  representative(units) {
    let ordinary = null,
      hero = null;
    for (const u of units) {
      const type = u.carries || u.type;
      if (!type) continue;
      let candidates = this.typePortraits.get(type);
      if (!candidates) {
        candidates = [];
        const visit = (t, named = false, depth = 0) => {
          if (!t || depth > 4) return;
          named ||= t.bool('Is_Named_Hero');
          const icon = t.str('Icon_Name');
          const prefixed = this.iconPrefix + icon;
          if (icon && (iconCanvasRect(prefixed) || iconCanvasRect(icon)))
            candidates.push({
              icon: iconCanvasRect(prefixed) ? prefixed : icon,
              hero: named,
              rank: t.num('Ranking_In_Category'),
              health: t.num('Tactical_Health')
            });
          if (t.bool('Is_Generic_Hero') && icon) return;
          for (const n of [...t.list('Company_Units'), ...t.list('Squadron_Units')]) visit(db.type(n), named, depth + 1);
        };
        visit(type);
        this.typePortraits.set(type, candidates);
      }
      for (const c of candidates) {
        if (c.hero) {
          if (!hero || c.rank < hero.rank) hero = c;
        } else if (!ordinary || c.health > ordinary.health) ordinary = c;
      }
    }
    return (this.filters & 8 ? hero || ordinary : ordinary || hero)?.icon || '';
  }

  factionColor(owner) {
    const f = db.faction(owner);
    if (
      ((this.simplifiedFactionColors ?? this.setup.simplifiedFactionColors ?? false) ||
        this.galaxy?.players?.find(p => p.faction === this.me)?.tutorial) &&
      f
    ) {
      if (String(owner).toUpperCase() === String(this.me).toUpperCase()) return rgb(db.constants.str('Player_Color'));
      if (f.bool('Is_Playable') && !f.bool('Is_Neutral')) return rgb(db.constants.str('Enemy_Color'));
    }
    return rgb(f?.str('Color'));
  }

  stackPicture(units, owner, comp, empty = false, count = units.length, iconName = null, overlay = null) {
    const index = Math.min(comp.textures.length - 1, Math.ceil(count / Math.max(1, db.constants.num('Ships_Per_Stack', 5))));
    const name = comp.textures[Math.max(0, index)],
      icon = iconName ?? this.representative(units);
    const col = empty && comp === this.fleetComp ? [25 / 255, 85 / 255, 151 / 255] : this.factionColor(owner);
    const key = [name, index, icon, col, comp.size[0], comp.offset[0], overlay].join('|');
    if (this.stackPictures.has(key)) return this.stackPictures.get(key);
    const bg = this.tinted(name, col),
      portrait = icon && this.tinted(icon, [1, 1, 1]);
    if (!bg) return null;
    const w = portrait ? portrait.width * comp.size[0] : 0,
      h = portrait ? portrait.height * comp.size[0] : 0;
    const dy = (bg.height - h) / 2 - index * comp.offset[0];
    const halfW = Math.ceil(Math.max(bg.width / 2, w / 2)),
      halfH = Math.ceil(Math.max(bg.height / 2, h / 2 + Math.abs(dy)));
    const cv = document.createElement('canvas');
    cv.width = halfW * 2;
    cv.height = halfH * 2;
    const ctx = cv.getContext('2d');
    ctx.drawImage(bg, halfW - bg.width / 2, halfH - bg.height / 2);
    if (portrait) ctx.drawImage(portrait, halfW - w / 2, halfH - h / 2 + dy, w, h);
    const badge = overlay && this.tinted(overlay, [1, 1, 1]);
    if (badge) {
      const bw = badge.width * comp.size[0],
        bh = badge.height * comp.size[0];
      ctx.drawImage(badge, halfW - bw / 2, halfH - bh / 2 + (bg.height - bh) / 2 - index * comp.offset[0], bw, bh);
    }
    this.stackPictures.set(key, cv);
    return cv;
  }

  mergeFleets() {
    const g = this.galaxy,
      keep = [],
      first = new Map();
    for (const f of g.fleets) {
      const id = f.planet >= 0 && !f.leg ? f.planet + '|' + f.owner + '|' + (f.slot ?? 0) : null,
        into = id !== null && first.get(id);
      if (into) {
        into.units.push(...f.units);
        const v = this.fleetViews.get(f);
        if (v) {
          this.scene.remove(v.inst.root);
          this.fleetViews.delete(f);
        }
      } else {
        keep.push(f);
        if (id !== null) first.set(id, f);
      }
    }
    g.fleets = keep;
  }

  warnApproaching() {
    const seen = (this.legsSeen ||= new WeakMap()),
      first = !this.legsPrimed;
    this.legsPrimed = true;
    for (const f of this.galaxy.fleets) {
      if (!f.leg || seen.get(f) === f.leg) continue;
      seen.set(f, f.leg);
      const p = this.galaxy.planets[f.leg.b];
      if (first || !p || p.owner !== this.me || relation(f.owner, this.me) !== 1 || hidden(f)) continue;
      const now = performance.now();
      if (now - (this.approachWarnedAt ?? -Infinity) < 5000) continue;
      this.approachWarnedAt = now;
      const name = db.t(p.type.str('Text_ID')) || p.name;
      this.galacticLog?.message(String(db.t('TEXT_ENEMY_FLEET_APPROACHING_LOCATION')).replace('##0', name), {
        urgent: true,
        color: [0, 193, 91]
      });
      this.audio?.play(db.faction(this.me)?.str('SFXEvent_Enemy_Fleet_Approaching_Planet'));
    }
  }

  planetChangedHands(planet, old, now, bonus) {
    const mine = now === this.me,
      name = f => db.t(db.faction(f)?.str('Text_ID')) || f || '';
    const text = String(db.t(mine && bonus ? 'TEXT_PLANET_CHANGED_HANDS_BONUS' : 'TEXT_PLANET_CHANGED_HANDS'));
    const args = [db.t(planet.type.str('Text_ID')) || planet.name, name(old), name(now), bonus];
    this.galacticLog?.message(
      text.replace(/%l?[sd]/g, () => String(args.shift() ?? '')),
      { urgent: false, color: [255, 24, 39] }
    );
    if (mine && bonus) this.audio?.playAudioEvent('SFXEvent_Planet_Capture_Bonus_Reward');
    const faction = db.faction(this.me);
    if (mine) this.audio?.play(faction?.str('SFXEvent_Planet_Gained_Control'));
    else if (old === this.me && now && db.faction(now)?.bool('Is_Playable')) this.audio?.play(faction?.str('SFXEvent_Planet_Lost_Control'));
  }

  popCapWarning() {
    const now = performance.now();
    if (now - (this.popCheckedAt || 0) < 250) return;
    this.popCheckedAt = now;
    const used = populationUsed(this.galaxy, this.me),
      was = this.popUsed || 0;
    if (was > 0 && was < used && populationCap(this.galaxy, this.me) <= used)
      this.audio?.play(db.faction(this.me)?.str('SFXEvent_Strategic_Pop_Cap_Reached'));
    this.popUsed = used;
  }

  notify(text, faction) {
    if (text) this.galacticLog?.message(String(text), { urgent: true, color: this.factionColor(faction).map(c => Math.round(c * 255)) });
  }

  showPauseShell(on) {
    const ui = this.scriptUI;
    if (!ui) return;
    this.pauseShellOpen = !!on;
    ui.visibility('PAUSE_SHELL', !!on);
    if (!on) return;
    ui.text('attack_button', 'TEXT_BUTTON_RESUME_GAME');
    ui.visibility('attack_button', true);
    ui.ready().then(() => {
      const shell = ui.shells.get('PAUSE_SHELL');
      if (!this.pauseShellOpen || !shell) return;
      ui.place('PAUSE_SHELL', [0, Math.max(768, (1024 * innerHeight) / innerWidth) / 2]);
      ui.play('PAUSE_SHELL');
      const bone = shell.origins.get('TEXT_ATTACK'),
        comp = ui.comps.get('TEXT_ATTACK');
      if (!bone || !shell.root) return;
      let el = this.pauseLabel;
      if (!el || el.parentNode !== shell.root) {
        el = this.pauseLabel = document.createElement('div');
        el.dataset.control = 'TEXT_ATTACK';
        el.className = 'ht';
        el.style.position = 'absolute';
        shell.root.appendChild(el);
        const index = shell.model?.bones.findIndex(b => b.name.toUpperCase() === 'TEXT_ATTACK');
        if (index >= 0) el.dataset.bone = index;
      }
      const off = (comp?.val('Text_Offset') || '').split(/[\s,]+/).map(Number);
      el.style.left = bone.x + (off[0] || 0) + 'px';
      el.style.top = -bone.y - (off[1] || 0) + 'px';
      setComponentText(el, comp, db.t('TEXT_GAME_PAUSED'), { scale: this.overlayScale() });
      snapNativeText(shell.root);
    });
  }

  galacticBattleChanged() {
    this.mergeFleets();
    for (const [f, v] of this.fleetViews)
      if (!this.galaxy.fleets.includes(f)) {
        this.scene.remove(v.inst.root);
        this.fleetViews.delete(f);
      }
    for (const f of this.galaxy.fleets) if (!this.fleetViews.has(f)) this.fleetView(f);
    this.hudTimer = 0;
  }

  async fleetView(f) {
    if (this.fleetViews.has(f) || this.fleetLoading.has(f)) return;
    this.fleetLoading.add(f);
    try {
      const box = db.type('Galactic_Fleet');
      const override = f.units.map(u => u.type.str('Galactic_Fleet_Override_Model_Name')).find(Boolean);
      const file = override || (box && box.str('Galactic_Model_Name')) || 'w_planet_fleet.alo';
      const fac = db.faction(f.owner),
        col = fac ? rgb(fac.str('Color')) : [1, 1, 1];
      const inst = await loadModel(file, { teamColor: new THREE.Color(...col) }).catch(() => null);
      if (!inst || !this.galaxy.fleets.includes(f)) return;
      inst.root.scale.setScalar(box ? box.num('Scale_Factor', 1) : 1);
      this.scene.add(inst.root);
      this.fleetViews.set(f, { inst, ahead: override ? -1 : 1 });
      this.placeFleet(f);
    } finally {
      this.fleetLoading.delete(f);
    }
  }

  placeFleet(f) {
    const v = this.fleetViews.get(f);
    if (!v) return;
    const r = v.inst.root;
    r.visible = visibleTransit(this.galaxy, f, this.me);
    if (f.leg) {
      const d = f.leg.dir;
      r.position.set(...f.pos);
      r.rotation.set(v.ahead * Math.atan2(d[2], Math.hypot(d[0], d[1])), 0, Math.atan2(d[1], d[0]) - (v.ahead * Math.PI) / 2, 'ZYX');
      v.orbit = undefined;
    } else if (f.planet >= 0 && v.orbit !== f.planet) {
      const p = this.galaxy.planets[f.planet].pos;
      r.position.set(p[0] + 18, p[1] + 10, p[2]);
      r.rotation.set(0, 0, 90 * DEG, 'ZYX');
      v.orbit = f.planet;
    }
  }

  tinted(name, col) {
    const key = name + '|' + col.join(',');
    const tints = this.tints || (this.tints = new Map());
    if (tints.has(key)) return tints.get(key);
    const r = iconCanvasRect(name),
      atlas = iconAtlas();
    let cv = null;
    if (r && atlas) {
      cv = document.createElement('canvas');
      cv.width = r.w;
      cv.height = r.h;
      const x = cv.getContext('2d');
      x.drawImage(atlas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = `rgb(${col.map(v => Math.round(v * 255)).join(',')})`;
      x.fillRect(0, 0, r.w, r.h);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(atlas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    }
    tints.set(key, cv);
    return cv;
  }

  stackSpots(ui = this.overlayScale()) {
    const out = [],
      g = this.galaxy,
      side = (innerWidth / innerHeight >= 1.75 && this.fleetComp.wide) || this.fleetComp.side;
    const controllers = new Map();
    for (const p of g.planets) if (p.station && p.spaceLevel > 0) controllers.set(p.index, p.stationOwner || p.owner);
    for (const f of g.fleets) if (!f.leg && !controllers.has(f.planet)) controllers.set(f.planet, f.owner);
    const shown = f => {
      if (!f.units.length || f.leg || f.planet < 0) return false;
      const v = intelligence(g, g.planets[f.planet]);
      return !!v?.discovered && !(f.owner !== this.me && (!v.fleetOverlay || f.units.every(strategicStealth)));
    };
    const contested = new Set();
    for (const f of g.fleets) if (f.owner !== this.me && shown(f)) contested.add(f.planet);
    for (const f of g.fleets) {
      if (!shown(f)) continue;
      const slot = controllers.get(f.planet) === this.me && !contested.has(f.planet) ? f.slot || 0 : f.owner !== this.me ? 0 : f.slot || 2;
      const point = this.overlayPoint(
        g.planets[f.planet].pos,
        slot === 0 ? -side[0] : slot === 2 ? side[0] : 0,
        slot === 1 ? this.fleetComp.offset[1] : side[1],
        ui
      );
      if (point) out.push({ f, p: f.planet, slot: f.slot ?? 0, displaySlot: slot, ...point });
    }
    const panes = new Map(),
      merged = [];
    for (const spot of out) {
      const k = spot.p + ':' + spot.displaySlot,
        first = panes.get(k);
      if (first) {
        first.units.push(...spot.f.units);
        first.fleets.push(spot.f);
      } else {
        spot.units = [...spot.f.units];
        spot.fleets = [spot.f];
        panes.set(k, spot);
        merged.push(spot);
      }
    }
    out.length = 0;
    out.push(...merged);
    const occupiedByPlanet = new Map();
    if (this.dragReach)
      for (const s of out) {
        let slots = occupiedByPlanet.get(s.p);
        if (!slots) occupiedByPlanet.set(s.p, (slots = new Set()));
        slots.add(s.displaySlot);
      }
    if (this.dragReach)
      for (const p of g.planets) {
        if (p.background || !this.dragReach.has(p.index) || !intelligence(g, p)?.discovered) continue;
        const occupied = occupiedByPlanet.get(p.index) || new Set();
        for (let slot = 0; slot < 3; slot++)
          if (!occupied.has(slot)) {
            const point = this.overlayPoint(
              p.pos,
              slot === 0 ? -side[0] : slot === 2 ? side[0] : 0,
              slot === 1 ? this.fleetComp.offset[1] : side[1],
              ui
            );
            if (point) out.push({ f: null, p: p.index, slot, displaySlot: slot, ...point });
          }
      }
    return out;
  }

  surfaceSpots(ui = this.overlayScale()) {
    const out = [];
    for (const p of this.galaxy.planets) {
      const v = intelligence(this.galaxy, p);
      const abilityTarget =
        !p.destroyed && this.dragFleet?.planet === p.index && this.dragFleet.units.some(u => hasPlanetDestruction(u.carries || u.type));
      if (p.background || p.destroyed || !v?.discovered || (!p.type.bool('Planet_Surface_Accessible', true) && !abilityTarget)) continue;
      const units = v.groundCount ? p.garrison.filter(u => u.owner === p.owner) : [];
      const target = abilityTarget || (this.dragFleet?.planet === p.index && canLand(this.galaxy, this.dragFleet, p.index));
      if (!units.length && !target) continue;
      const point = this.overlayPoint(p.pos, 0, this.groundComp.offset[1], ui);
      if (point) out.push({ p: p.index, units, empty: !units.length, ...point });
    }
    return out;
  }

  pickStack(spots, x, y) {
    const ui = this.overlayScale();
    let best = null,
      distance = Infinity;
    for (const s of spots || []) {
      const ground = !('f' in s),
        comp = ground ? this.groundComp : this.fleetComp,
        rect = iconCanvasRect(comp.textures[0]);
      const hw = ((rect?.w ?? 36) / 2) * comp.scale * ui,
        hh = ((rect?.h ?? 45) / 2) * comp.scale * ui;
      const dx = s.x - x,
        dy = s.y - y,
        d = s.p * 8 + (ground ? 4 : (s.displaySlot ?? s.slot ?? 0));
      if (Math.abs(dx) <= hw && Math.abs(dy) <= hh && d < distance) {
        best = s;
        distance = d;
      }
    }
    return best;
  }

  pickFleet(sx, sy) {
    return this.pickStack(this.lastSpots, sx, sy)?.f || null;
  }

  bindInput() {
    const el = this.renderer.domElement;
    const addEventListener = (ev, fn, opts) => this.listen(ev, fn, opts);
    const unlock = () => {
      this.audio?.unlock();
      removeEventListener('pointerdown', unlock, true);
      removeEventListener('keydown', unlock, true);
    };
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
    addEventListener('keydown', e => {
      if (this.over || this.modeSuspended) return;
      if (e.code === 'F2') {
        e.preventDefault();
        this.toggleBenchmark();
        return;
      }
      if (this.planetInfo.open) {
        if (e.code === 'Escape') this.planetInfo.close();
        e.preventDefault();
        return;
      }
      if (this.neutralizePopup?.opened) {
        if (e.code === 'Escape') this.neutralizePopup.close();
        e.preventDefault();
        return;
      }
      if (this.storyDialog?.opened) {
        if (e.code === 'Escape') this.storyDialog.close();
        e.preventDefault();
        return;
      }
      if (this.galacticLog?.opened) {
        if (e.code === 'Escape') this.galacticLog.close();
        e.preventDefault();
        return;
      }
      if (this.menus?.open) {
        if (e.code === 'Escape') this.menus.pop();
        e.preventDefault();
        return;
      }
      if (e.code === 'Escape') {
        this.keys.clear();
        this.mouse.in = false;
        this.toggleMenu();
        e.preventDefault();
        return;
      }
      if (this.net && pressed(e, 'INITIATE_CHAT')) {
        e.preventDefault();
        this.openChat();
        return;
      }
      if (this.controlsLocked || this.scriptUI?.modal) {
        e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      if (pressed(e, 'TACTICAL_OVERVIEW')) this.zoomOut();
      if (pressed(e, 'PAUSE')) this.setUserPaused(!this.userPaused);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, in: false };
    el.addEventListener('pointermove', e => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.in = true;
      if (this.stackDown && !this.stackMoved && Math.hypot(e.clientX - this.stackDown.x, e.clientY - this.stackDown.y) > 12) {
        this.stackMoved = true;
        this.story?.generic(this.dragFleet ? 'start_fleet_drag' : this.dragGround !== undefined ? 'start_land_drag' : '');
      }
      if (!this.dragFleet && this.dragGround === undefined) this.tips?.moved();
      if (this.drag && this.panFree()) {
        this.dragPan(e.clientX - this.drag.x, e.clientY - this.drag.y);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      }
    });
    el.addEventListener('pointerleave', () => {
      this.mouse.in = false;
    });
    el.addEventListener('pointercancel', () => {
      this.drag = this.dragFleet = null;
      this.dragGround = undefined;
      this.dragReach = null;
      this.stackDown = null;
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      if (this.battle || this.controlsLocked || this.scriptUI?.modal) return;
      if (e.button === 2) {
        this.drag = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0 || this.busy) return;
      const ground = this.pickStack(this.lastSurfaceSpots, e.clientX, e.clientY);
      if (ground && this.galaxy.planets[ground.p].garrison.some(u => u.owner === this.me)) {
        this.dragGround = ground.p;
        this.dragReach = reachableFleetPlanets(this.galaxy, ground.p);
        this.stackDown = { x: e.clientX, y: e.clientY };
        this.stackMoved = false;
        el.setPointerCapture(e.pointerId);
        return;
      }
      const spot = this.pickStack(this.lastSpots, e.clientX, e.clientY);
      if (spot?.fleets?.length > 1 && this.fleetCombine !== false) {
        const mine = spot.fleets.filter(x => x.owner === this.me && !x.leg);
        if (mine.length > 1) {
          for (const o of mine.slice(1)) {
            mine[0].units.push(...o.units);
            o.units = [];
          }
          this.galaxy.fleets = this.galaxy.fleets.filter(x => x.units.length);
          this.galacticBattleChanged();
          this.story?.generic('merge_fleets');
        }
      }
      const f = spot?.fleets ? spot.fleets.find(x => x.owner === this.me && !x.leg && x.units.length) || spot.f : spot?.f || null;
      if (f && f.owner === this.me && !f.leg) {
        this.dragFleet = f;
        this.dragReach = baseSpeed(f) > 0 ? humanReach(this.galaxy, f) : null;
        this.stackDown = { x: e.clientX, y: e.clientY };
        this.stackMoved = false;
        el.setPointerCapture(e.pointerId);
        return;
      }
      if (!this.planetSelectionLocked) this.select(this.pick(e.clientX, e.clientY));
    });
    el.addEventListener('pointerup', e => {
      if (e.button === 2) this.drag = null;
      if (e.button === 0 && !this.dragFleet && this.dragGround === undefined && !this.controlsLocked) {
        const icon = this.pickCorruptionIcon(e.clientX, e.clientY),
          planet = icon && this.galaxy.planets[icon.p];
        if (planet && icon.type === -1) {
          this.stackDown = null;
          this.openCorruptionDialog({ actor: null, planet, choices: choicesOf(planet.type), info: true });
          return;
        }
      }
      if (e.button === 0 && this.dragGround !== undefined) {
        const p = this.dragGround,
          target = !this.radar?.contains(e.clientX, e.clientY) && this.pickStack(this.lastSpots, e.clientX, e.clientY);
        this.dragGround = undefined;
        this.dragReach = null;
        const click = !!this.stackDown && !this.stackMoved && Math.hypot(e.clientX - this.stackDown.x, e.clientY - this.stackDown.y) <= 12;
        this.stackDown = null;
        if (click) this.select(p);
        else if (this.net) {
          if (target && (!target.f || target.f.owner === this.me))
            this.order(
              target.p === p
                ? orders.embark(this.galaxy, p, { fleet: target.f, slot: target.slot })
                : orders.embark(this.galaxy, p, { fresh: true, slot: target.slot, to: target.p })
            );
        } else if (target && (!target.f || target.f.owner === this.me)) {
          if (target.p === p) {
            this.story?.generic('drag_land_to_space');
            this.embark(p, { fleet: target.f, slot: target.slot });
            this.story?.generic('land_to_space');
          } else {
            const f = embarkGround(this.galaxy, p, this.me, { fresh: true, slot: target.slot });
            if (f) {
              this.fleetView(f);
              this.moveFleet(f, target.p, target.slot);
            }
          }
        }
        return;
      }
      if (e.button === 0 && this.dragFleet) {
        const overRadar = this.radar?.contains(e.clientX, e.clientY);
        const f = this.dragFleet,
          to = overRadar ? this.radar.pick(e.clientX, e.clientY) : -1;
        const orbit = !overRadar && this.pickStack(this.lastSpots, e.clientX, e.clientY);
        const surface = this.pickStack(this.lastSurfaceSpots, e.clientX, e.clientY),
          special = !overRadar && this.pickSpecial(e.clientX, e.clientY);
        this.dragFleet = null;
        this.dragReach = null;
        const click = !!this.stackDown && !this.stackMoved && Math.hypot(e.clientX - this.stackDown.x, e.clientY - this.stackDown.y) <= 12;
        this.stackDown = null;
        if (click) this.select(f.planet);
        else if (this.net) {
          const g = this.galaxy;
          if (special)
            this.order(
              special.raid
                ? orders.move(g, f, special.p, null, { raid: true })
                : f.planet === special.p
                  ? orders.slot(g, special.record, special.p)
                  : orders.move(g, f, special.p, null, { ability: special.record })
            );
          else if (!overRadar && surface)
            this.order(
              f.planet === surface.p ? orders.land(g, f, surface.p) : orders.move(g, f, surface.p, null, { raid: isRaidForce(f) })
            );
          else if (orbit)
            this.order(f.planet === orbit.p ? orders.transfer(g, f, orbit.slot, null, orbit.f) : orders.move(g, f, orbit.p, orbit.slot));
          else if (to >= 0) this.order(orders.move(g, f, to));
        } else if (special) {
          if (special.raid) {
            if (this.moveFleet(f, special.p)) f.raid = special.p;
          } else if (f.planet === special.p) {
            if (activateSlot(this, special.record, this.galaxy.planets[special.p], f.owner)) {
              this.galacticBattleChanged();
              this.ui?.refresh();
            }
          } else if (this.moveFleet(f, special.p)) special.record.pendingAbility = special.p;
        } else if (!overRadar && surface) {
          if (f.planet === surface.p) this.land(f, surface.p);
          else if (this.moveFleet(f, surface.p) && isRaidForce(f)) f.raid = surface.p;
        } else if (orbit) {
          if (f.planet === orbit.p) {
            if (transferFleetUnits(this.galaxy, f, this.me, orbit.slot, null, orbit.f)) this.galacticBattleChanged();
          } else this.moveFleet(f, orbit.p, orbit.slot);
        } else if (to >= 0) this.moveFleet(f, to);
      }
    });
    el.addEventListener('dblclick', e => {
      if (this.controlsLocked || this.scriptUI?.modal) return;
      const i = this.pick(e.clientX, e.clientY);
      if (i >= 0) this.zoomIn(i);
    });
    el.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        if (this.controlsLocked || this.scriptUI?.modal) return;
        const v = this.view,
          out = v.zoom === 0 && v.dir === 0;
        if (e.deltaY < 0) {
          if (out && this.zoomMap(-1)) {
            this.anchorZoom(e.clientX, e.clientY);
            return;
          }
          const i = this.hover >= 0 ? this.hover : this.selected;
          if (i >= 0) this.zoomIn(i);
        } else if (!out || !this.zoomMap(1)) this.zoomOut();
        else this.anchorZoom(e.clientX, e.clientY);
      },
      { passive: false }
    );
  }

  pick(sx, sy) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), this.camera);
    let best = -1,
      bestD = Infinity;
    const c = new THREE.Vector3(),
      hit = new THREE.Vector3();
    this.galaxy.planets.forEach((p, i) => {
      if (p.background || !p.selectable) return;
      const r = p.type.num('Mouse_Collide_Override_Sphere_Radius', 0) || p.type.num('Scale_Factor', 1) * PLANET_RADIUS;
      c.set(...p.pos);
      if (ray.ray.intersectSphere(new THREE.Sphere(c, r), hit)) {
        const d = hit.distanceTo(ray.ray.origin);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    });
    return best;
  }

  select(i) {
    if (i >= 0 && this.galaxy.planets[i] && !this.scriptUI?.modal) {
      if (this.net) this.order({ c: 'select', p: i });
      else this.story?.signal('STORY_SELECT_PLANET', this.galaxy.planets[i].type.name);
    }
    this.selected = i;
    this.ui?.refresh();
    this.overview?.refresh();
    const m = this.marker;
    if (!m) return;
    m.root.visible = i >= 0;
    if (i >= 0) m.root.position.set(...this.galaxy.planets[i].pos);
    this.tintMarker();
  }

  orientMarker() {
    const m = this.marker,
      p = this.galaxy.planets[this.selected];
    if (!m || !p) return;
    const f = (this.markerF ||= new THREE.Vector3()).copy(this.camera.position).sub(m.root.position).normalize();
    const r = (this.markerR ||= new THREE.Vector3()).set(-f.y, f.x, 0);
    if (r.lengthSq() < 1e-12) return;
    r.normalize();
    const u = (this.markerU ||= new THREE.Vector3()).crossVectors(f, r).normalize();
    m.root.quaternion.setFromRotationMatrix((this.markerBasis ||= new THREE.Matrix4()).makeBasis(r, u, f));
  }

  tintMarker() {
    const m = this.marker,
      p = this.galaxy.planets[this.selected];
    if (!m || !p) {
      this.markerKey = null;
      return;
    }
    const owner = intelligence(this.galaxy, p)?.discovered ? displayOwner(this.galaxy, p) : 'Neutral';
    const col = this.factionColor(owner),
      key = this.selected + '|' + col.join(',');
    if (key === this.markerKey) return;
    if (this.markerIdle && String(this.markerKey).split('|')[0] !== String(this.selected)) this.markerIdle.time = 0;
    this.markerKey = key;
    m.root.traverse(o => {
      const u = o.isMesh && o.material.uniforms,
        base = o.userData.baseColors;
      if (u && base)
        ['diffuse', 'emissive', 'specular'].forEach((k, n) => {
          if (u[k] && base[n]) u[k].value.copy(base[n]).multiply(new THREE.Color(col[0], col[1], col[2]));
        });
    });
  }

  checkConflict(f, p) {
    if (f.planet === p) this.battles.arrive(f, p);
  }

  fireArrival(fleet, p) {
    for (const u of [...fleet.units]) {
      if (u.pendingAbility !== p) continue;
      delete u.pendingAbility;
      if (this.busy || this.over || !this.isHuman(fleet.owner) || blocks(this.galaxy, p, fleet.owner)) continue;
      if (this.asFaction(fleet.owner, () => activateSlot(this, u, this.galaxy.planets[p], fleet.owner))) {
        this.galacticBattleChanged();
        this.ui?.refresh();
      }
    }
  }

  pickCorruptionIcon(x, y) {
    return (this.corruptionIcons || []).find(i => Math.abs(i.x - x) <= i.w / 2 && Math.abs(i.y - y) <= i.h / 2) || null;
  }

  corruptionTip() {
    const encyclopedia = this.galacticLog?.encyclopedia;
    if (!encyclopedia) return;
    const tips = (this.tips ||= new TooltipGate(this, encyclopedia));
    tips.update();
    const idle = this.mouse.in !== false && !this.dragFleet && this.dragGround === undefined,
      at = idle ? this.pickCorruptionIcon(this.mouse.x, this.mouse.y) : null;
    const stack =
        idle && !at && !this.radar?.contains(this.mouse.x, this.mouse.y)
          ? this.pickStack(this.lastSpots, this.mouse.x, this.mouse.y)
          : null,
      fleet = stack?.f ? this.fleetTip(stack) : null;
    if (at) {
      const C = db.constants,
        split = n =>
          C.str(n)
            .split(/[\s,]+/)
            .filter(Boolean),
        marks = split('Corruption_Mission_Requirement_Icon_Name');
      tips.hover({
        id: 'mark:' + at.p + ':' + at.type,
        key: 'mark:' + at.p + ':' + at.type,
        show: () => {
          if (at.type === -1) {
            encyclopedia.showInfo(marks[9] || '', db.t('TEXT_CORRUPTION_ENCYCLOPEDIA_TITLE'), '');
            encyclopedia.linked(db.t('TEXT_TOOLTIP_CLICK_FOR_INFO'), this.mouse.x, this.mouse.y);
          } else
            encyclopedia.showInfo(
              marks[at.type] || '',
              db.t(split('Corruption_Planet_Icon_Encyclopedia_Name')[at.type]),
              db.t(split('Corruption_Planet_Icon_Encyclopedia_Desc')[at.type])
            );
        }
      });
      if (at.type === -1 && tips.popup) encyclopedia.moveLinked(this.mouse.x, this.mouse.y);
    } else if (fleet)
      tips.hover({
        id: 'fleet:' + stack.p + ':' + stack.displaySlot + ':' + stack.f.owner,
        key: 'fleet:' + fleet.key,
        show: () => encyclopedia.showFleet(fleet)
      });
    else {
      const planet =
        idle && !stack && this.hover >= 0 && !this.radar?.contains(this.mouse.x, this.mouse.y) ? this.planetTip(this.hover) : null;
      tips.hover(
        planet ? { id: 'planet:' + planet.key, key: 'planet:' + planet.state, show: () => encyclopedia.showPlanet(planet) } : null
      );
    }
  }

  planetTip(i) {
    const g = this.galaxy,
      p = g.planets[i],
      v = p && !p.background && intelligence(g, p);
    if (!v?.discovered) return null;
    const C = db.constants,
      owner = displayOwner(g, p),
      type = p.currentCorruption ?? -1,
      corruptSide = C.str('Corrupt_Side_Name');
    const corrupted = type >= 0 && !db.faction(p.owner)?.bool('Benefits_From_Corruption');
    const corruption = corrupted
      ? {
          text:
            db.t(
              C.str('Corruption_Planet_Icon_Encyclopedia_Name')
                .split(/[\s,]+/)
                .filter(Boolean)[type]
            ) || db.t('TEXT_ENCYCLOPEDIA_PLANET_CORRUPTED'),
          color: this.factionColor(corruptSide)
        }
      : null;
    const space = [v.spaceLevel ? p.spaceLevel || 0 : 0, Math.min(5, p.type.num('Max_Space_Base', 5))];
    const land = [v.groundLevel ? p.groundStructures.length : 0, Math.min(9, p.type.num('Special_Structures_Land', 3))];
    const data = {
      key: i,
      type: p.type,
      name: this.planetViews[i]?.name || db.t(p.type.str('Text_ID')) || p.name,
      color: this.factionColor(owner),
      corruption,
      destroyed: !!p.destroyed,
      space,
      land
    };
    data.state = [i, owner, type, data.destroyed, space, land].join('|');
    return data;
  }

  fleetTip(spot) {
    const g = this.galaxy,
      planet = g.planets[spot.p],
      v = intelligence(g, planet),
      friendly = f => relation(this.me, f.owner) === 0;
    const here = g.fleets.filter(f => f.planet === spot.p && !f.leg && f.units.length);
    const hostile = !friendly(spot.f),
      listed = hostile ? here.filter(f => !friendly(f)) : here.filter(f => friendly(f) && (f.slot ?? 0) === (spot.f.slot ?? 0));
    const stealthy = f => f.units.every(u => strategicStealth(u)),
      nodes = new Map();
    let reveal = !hostile,
      countOnly = false;
    const order = [...db.types.values()];
    for (const f of listed) {
      if (hostile) {
        if (stealthy(f)) continue;
        if (v?.fleetContents) reveal = true;
        else if (v?.fleetOverlay) countOnly = true;
        else continue;
      }
      for (const u of f.units) {
        const type = u.carries || u.type;
        let n = nodes.get(type);
        if (!n) nodes.set(type, (n = { type, count: 0, unit: u, fleet: f }));
        n.count++;
      }
    }
    if (!nodes.size) return null;
    const list = [...nodes.values()].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    const first = list[0],
      faction = key => String(key || '').toUpperCase(),
      owner = faction(first.fleet.owner),
      C = db.constants;
    const titleKey =
      owner === faction(C.str('Good_Side_Name'))
        ? 'TEXT_GOOD_SPACE_FLEET'
        : owner === faction(C.str('Evil_Side_Name'))
          ? 'TEXT_EVIL_SPACE_FLEET'
          : owner === faction(C.str('Corrupt_Side_Name'))
            ? 'TEXT_CORRUPT_SPACE_FLEET'
            : 'TEXT_PIRATE_SPACE_FLEET';
    const stealth = listed.every(stealthy),
      raid = listed.every(f => isRaidForce(f));
    const strongest =
      countOnly && !reveal && v && v.mask & VIS.MOST_POWERFUL
        ? list.reduce((b, n) => (!b || n.type.num('Damage', 0) > b.type.num('Damage', 0) ? n : b), null)
        : null;
    const known = n => reveal || n === strongest || n.type.list('CategoryMask').some(m => /^super$/i.test(m));
    const cells = list.map(n => ({
      icon: known(n) ? n.type.str('Icon_Name') || 'i_button_temporary.tga' : 'i_button_unknown.tga',
      label: n.count >= 2 ? 'x' + n.count : '',
      badge: known(n) && strategicStealth(n.unit)
    }));
    const picture = this.stackPicture(spot.units || spot.f.units, spot.f.owner, this.fleetComp, false, (spot.units || spot.f.units).length);
    if (!picture) return null;
    const pop = list.reduce((s, n) => s + n.type.num('Population_Value', 0) * n.count, 0),
      body = raid
        ? db.t('TEXT_RAID_FLEET') + (stealth ? ', ' + db.t('TEXT_STEALTH_FLEET') : '')
        : stealth
          ? db.t('TEXT_STEALTH_FLEET')
          : '';
    const key = [
      spot.p,
      spot.displaySlot,
      owner,
      pop,
      stealth,
      raid,
      reveal,
      countOnly,
      cells.map(c => c.icon + c.label + c.badge).join(',')
    ].join('|');
    return { key, picture, title: db.t(titleKey), pop, stealth, raid, body, cells };
  }

  pickSpecial(x, y) {
    const ui = this.overlayScale(),
      rect = iconCanvasRect(this.specialComp.textures[0]);
    const hw = ((rect?.w ?? 36) / 2) * this.specialComp.scale * ui,
      hh = ((rect?.h ?? 45) / 2) * this.specialComp.scale * ui;
    return (this.lastSpecialSpots || []).find(s => Math.abs(s.x - x) <= hw && Math.abs(s.y - y) <= hh) || null;
  }

  specialSpots(ui) {
    const f = this.dragFleet,
      out = [];
    if (!f || f.owner !== this.me) return out;
    const rank = u => (u.carries || u.type).num('Ranking_In_Category', 0),
      record = f.units.reduce((best, u) => (best === null || rank(u) < rank(best) ? u : best), null);
    const hero = record && isHero(record);
    for (const p of this.galaxy.planets) {
      if (p.background || !(p.index === f.planet || this.dragReach?.has(p.index)) || !intelligence(this.galaxy, p)?.discovered) continue;
      const raid = raidCapable(this.galaxy, f, p.index);
      let slot = raid ? RAID_SLOT() : null;
      if (!slot && this.forcedSlots)
        for (const [kind, at] of Object.entries(this.forcedSlots))
          if (at === p.index) {
            slot =
              kind === 'raid'
                ? RAID_SLOT()
                : SLOTS.find(s => s.code === { steal: 1, smuggle: 5, blackmarket: 9, sabotage: 2, corrupt: 7 }[kind]) || null;
            if (slot) break;
          }
      if (!slot && hero) {
        const s = slotFor(this, record, p, f.owner);
        if (s && (f.units.length === 1 || s.code === 6)) slot = s;
      }
      if (!slot) continue;
      const point = this.overlayPoint(p.pos, this.specialComp.offset[0], 0, ui);
      if (point) out.push({ p: p.index, slot, record: raid ? null : record, raid, ...point });
    }
    return out;
  }

  get busy() {
    return !!(this.battle || this.pendingBattle?.busy);
  }

  isHuman(faction) {
    return this.galaxy ? isHumanFaction(this.galaxy, faction) : String(faction || '').toUpperCase() === String(this.me || '').toUpperCase();
  }
  humanFor(faction) {
    const g = this.galaxy,
      humans = g?.humans;
    if (!humans || humans.length < 2) return this.me;
    const players = g.players.filter(p => humans.includes(String(p.faction).toUpperCase()));
    return (players.find(p => relation(faction, p.faction) === 1) || players[0])?.faction || this.me;
  }
  storyLocal(plotOwner) {
    if (!this.net && !this.setup.net) return this.me || this.galaxy?.active;
    if (plotOwner && this.isHuman(plotOwner)) return plotOwner;
    return this.setup.players?.find(p => p.human && this.isHuman(p.faction))?.faction || this.me;
  }
  storyAudience(owner) {
    return !this.setup.net || String(this.storyLocal(owner) || '').toUpperCase() === String(this.me || '').toUpperCase();
  }
  playerName(faction) {
    const ps = (this.setup.players || []).filter(
      q => q.human && !q.left && String(q.faction).toUpperCase() === String(faction).toUpperCase()
    );
    return ps.length ? ps.map(p => p.name || 'Player').join(' & ') : db.t(db.faction(faction)?.str('Text_ID')) || faction;
  }
  get speeds() {
    return STRATEGIC_FRAMES.map(f => f / 30);
  }
  get anyoneSetsSpeed() {
    return true;
  }
  speedChanged(player) {
    this.message(`${player?.name || ''}: ${db.t('TEXT_GAME_SPEED_CHANGED') || 'Game speed changed'}`);
    this.audio?.play('GUI_Chat_Message_SFX');
  }

  multiplayerGalaxy(g) {
    const key = x => String(x || '').toUpperCase(),
      slots = this.setup.players || [],
      humans = slots.filter(p => p.human),
      opt = this.setup.options || {};
    g.humans = [...new Set(humans.map(p => key(db.faction(p.faction)?.name || p.faction)))];
    const chosen = new Set(slots.map(p => key(db.faction(p.faction)?.name || p.faction)));
    const neutral = [...db.factions.values()].find(f => f.bool('Is_Neutral'))?.name || null;
    const absent = f => {
      const t = db.faction(f);
      return !!t && !chosen.has(key(t.name)) && !t.bool('Create_Player_In_Multiplayer_Games', !t.bool('Is_Playable'));
    };
    const gone = new Set(this.setup.singlePlayerCampaign ? [] : g.players.filter(p => absent(p.faction)).map(p => key(p.faction)));
    if (gone.size) {
      const theirs = u => gone.has(key(u.owner));
      g.players = g.players.filter(p => !gone.has(key(p.faction)));
      g.fleets = g.fleets.filter(f => !gone.has(key(f.owner)));
      for (const p of g.planets) {
        p.garrison = p.garrison.filter(u => !theirs(u));
        p.groundStructures = p.groundStructures.filter(u => !theirs(u));
        p.orbitalStructures = p.orbitalStructures.filter(u => !theirs(u));
        if (p.station && gone.has(key(p.stationOwner || p.owner))) {
          p.station = null;
          p.stationOwner = null;
          p.spaceLevel = 0;
        }
        if (gone.has(key(p.owner))) p.owner = neutral;
      }
    }
    const custom = g.campaign.bool('Supports_Custom_Settings') && !this.setup.singlePlayerCampaign && !this.setup.restore;
    for (const p of g.players) {
      const slot = slots.find(s => key(db.faction(s.faction)?.name || s.faction) === key(p.faction));
      if (!slot) continue;
      p.humanType = slot.human ? this.setup.humanTypes?.[key(p.faction)] || 'Human' : undefined;
      p.ai = slot.human ? p.humanType : null;
      if (custom && Number.isFinite(+opt.credits)) p.credits = +opt.credits;
      if (custom && Number.isFinite(+opt.maxTech)) p.maxTech = +opt.maxTech;
      if (custom && Number.isFinite(+opt.tech)) p.tech = Math.min(p.maxTech || +opt.tech, +opt.tech);
    }
    const mine = humans.find(p => p.peer === this.setup.net.me);
    this.localFaction = db.faction(mine?.faction)?.name || g.players.find(p => key(p.faction) === g.humans[0])?.faction;
    const ai = slots.find(p => !p.human && p.difficulty);
    if (ai && !this.setup.difficulty) this.setup.difficulty = ai.difficulty;
  }

  async startNet() {
    this.mpBattles = new MpBattles(this);
    this.speed = 1;
    this.net = new GalacticNet(this, this.setup.net);
    this.message('Waiting for the other players...');
    await this.net.ready();
    if (typeof window !== 'undefined') window.stallLog = this.net.lock.stalls;
  }

  storyPartner(pid) {
    const cfg = this.setup.players?.[pid];
    return !!cfg && cfg.human && !cfg.left && String(cfg.faction || '').toUpperCase() === String(this.storyLocal() || '').toUpperCase();
  }
  storySelect(pid, i) {
    const p = this.galaxy.planets[i];
    if (p && this.storyPartner(pid)) this.story?.signal('STORY_SELECT_PLANET', p.type.name);
  }
  scriptClick(pid, name, native) {
    const cfg = this.setup.players?.[pid];
    if (!cfg) return;
    if (cfg.peer === 0) {
      if (native) this.story?.clickGUI(name);
      else this.scriptUI?.click(name, false, true);
      return;
    }
    const faction = this.story?.clickFaction(name);
    if (faction) {
      (this.menuFactions ||= {})[pid] = faction;
      if (pid === this.localPid)
        this.message(`${db.t(db.faction(faction)?.str('Text_ID')) || faction}: your side when the host starts the game.`);
    } else if (native && this.storyPartner(pid)) this.story?.clickGUI(name);
    else if (pid === this.localPid && !this.toldHostOnly) {
      this.toldHostOnly = true;
      this.message('Only the host sets this up; the faction buttons choose your own side.');
    }
  }

  get held() {
    return (this.scriptPauses || 0) > 0 || !!this.holds?.size;
  }
  scriptPause(on) {
    this.scriptPauses = Math.max(0, (this.scriptPauses || 0) + (on ? 1 : -1));
  }
  holdForDialog(request, owner) {
    if (!this.setup.net || !request?.id) return;
    const audience = String(this.storyLocal(owner) || '').toUpperCase();
    const pids = (this.setup.players || [])
      .map((p, i) => (p.human && !p.left && String(p.faction).toUpperCase() === audience ? i : -1))
      .filter(i => i >= 0);
    if (!pids.length) return;
    (this.holds ||= new Map()).set(request.id, new Set(pids));
    if (!pids.includes(this.localPid))
      this.message(`Waiting for ${pids.map(i => this.setup.players[i].name || 'Player').join(', ')} to read the briefing...`);
  }
  dialogDone(pid, id) {
    const waiting = this.holds?.get(id);
    if (!waiting) return;
    waiting.delete(pid);
    if (waiting.size) return;
    this.holds.delete(id);
    this.story?.generic?.('close_story_dialog');
  }

  execute(pid, cmd) {
    const faction = this.setup.players?.[pid]?.faction;
    if (!faction) return {};
    this.actingPid = pid;
    let r;
    try {
      r = this.asFaction(faction, () => runCommand(this, faction, cmd)) || {};
    } finally {
      this.actingPid = undefined;
    }
    this.syncFleetViews();
    return r;
  }
  hashState() {
    return galaxyHash(this);
  }
  get localPid() {
    return (this.setup.players || []).findIndex(p => p.human && p.peer === this.setup.net?.me);
  }
  netPlayer(pid) {
    const cfg = this.setup.players?.[pid];
    return cfg
      ? { name: cfg.name || this.playerName(cfg.faction), team: String(cfg.faction).toUpperCase(), faction: cfg.faction, left: !!cfg.left }
      : null;
  }
  takeOver(player, pid) {
    const cfg = this.setup.players?.[pid],
      g = this.galaxy,
      id = String(cfg?.faction || '').toUpperCase();
    if (!cfg || !id) return false;
    cfg.left = true;
    for (const [id, waiting] of this.holds || []) if (waiting.has(pid)) this.dialogDone(pid, id);
    if ((this.setup.players || []).some(p => p.human && !p.left && String(p.faction).toUpperCase() === id)) {
      this.mpBattles?.left(cfg.faction, pid, false);
      return false;
    }
    if (g.humans) g.humans = g.humans.filter(f => f !== id);
    const p = g.players.find(q => String(q.faction).toUpperCase() === id);
    if (p) p.ai = db.faction(p.faction)?.str('Basic_AI') || null;
    this.mpBattles?.left(cfg.faction, pid, true);
    this.ai?.reconcile?.().catch(e => console.warn('takeover', e));
    return !!p?.ai;
  }
  commandResult(cmd, r) {
    if (!r) return;
    if (r.why) {
      this.audio?.play('GUI_Bad_Sound');
      return;
    }
    if (r.ok && cmd.c === 'build') this.audio?.play(r.type.str('SFXEvent_Build_Started'));
    if (r.ok && cmd.c === 'cancel') this.audio?.play(r.type.str('SFXEvent_Build_Cancelled'));
    this.ui?.refresh();
    this.overview?.refresh();
  }
  chatLine(from, text, team, mine) {
    if (!from) return;
    this.message(chatText(from, text, team));
    if (!mine) this.audio?.play('GUI_Common_Chat_Receive');
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
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (box.value.trim()) this.audio?.play('GUI_Common_Chat_Send');
        this.net?.lock.say(box.value, team);
        close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    box.focus();
  }

  order(cmd) {
    if (!cmd) return null;
    if (this.net) {
      this.net.lock.command(cmd);
      return null;
    }
    const r = runCommand(this, this.me, cmd);
    this.syncFleetViews();
    return r;
  }
  asFaction(faction, fn) {
    const me = this.me,
      audio = this.audio;
    if (String(faction).toUpperCase() === String(me).toUpperCase()) return fn();
    this.me = faction;
    this.audio = SILENT;
    try {
      return fn();
    } finally {
      this.me = me;
      this.audio = audio;
    }
  }
  syncFleetViews() {
    if (!this.fleetViews) return;
    this.mergeFleets?.();
    for (const f of this.galaxy.fleets) if (!this.fleetViews.has(f)) this.fleetView(f);
    for (const [f, v] of this.fleetViews)
      if (!this.galaxy.fleets.includes(f)) {
        if (v?.inst) this.scene.remove(v.inst.root);
        this.fleetViews.delete(f);
      }
  }
  transferUnits(f, slot, recs, tf) {
    return transferFleetUnits(this.galaxy, f, this.me, slot, recs, tf);
  }
  embarkFresh(p, slot) {
    return embarkGround(this.galaxy, p, this.me, { fresh: true, slot });
  }
  dropUnits(s, t) {
    return dropOverviewUnits(this, s, t);
  }
  queueBuild(p, type) {
    return queueUnit(this.galaxy, p, this.me, type);
  }
  cancelBuild(p, item) {
    return cancelProduction(this.galaxy, p, this.me, item);
  }
  activateHeroSlot(rec, p, owner) {
    return activateSlot(this, rec, p, owner);
  }

  startBattle(p, attacker, defender, mode = 'space', options = {}) {
    const C = db.constants;
    const planet = this.galaxy.planets[p],
      player = this.galaxy.players.find(p => p.faction === defender);
    if (mode === 'space') {
      planet.lastSpaceConflict = this.galaxy.time;
      if (player) player.lastSpaceDefense = this.galaxy.time;
    } else {
      planet.lastGroundConflict = this.galaxy.time;
      if (player) player.lastGroundDefense = this.galaxy.time;
    }
    this.planetInfo.close();
    this.galacticLog?.close();
    this.radar?.flash(p);
    if (!this.noSave && !this.net) {
      try {
        putSave(snapshot(this, db.t('TEXT_GUI_AUTO_SAVE')), 'autosave').catch(e => console.warn('autosave', e));
      } catch (e) {
        console.warn('autosave', e);
      }
    }
    if (mode === 'land' && attacker === this.me) this.audio?.play(db.faction(this.me)?.str('SFXEvent_Land_Invasion_Commencing'));
    this.battle = {
      p,
      attacker,
      defender,
      mode,
      ...options,
      t: 0,
      zoom: C.num('GMC_Battle_Zoom_Time', 1),
      fade: C.num('GMC_Battle_Fade_Time', 0.75)
    };
    this.select(-1);
    if (this.mpBattles) this.mpBattles.begin(this.battle);
    if (!this.fadeEl) {
      this.fadeEl = document.createElement('div');
      this.fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:5';
      document.body.appendChild(this.fadeEl);
    }
  }

  autoResolveFor(b) {
    return { allowed: this.pendingBattle.allowed(b), contrast: packContrast(this.ai?.plans?.autoContrast) };
  }

  blackMarketOwned() {
    return Object.fromEntries(this.galaxy.players.map(p => [p.faction, (p.blackMarket || []).slice()]));
  }

  techLevels() {
    return Object.fromEntries(this.galaxy.players.map(p => [p.faction, p.tech || 0]));
  }

  galacticPerceptions(b) {
    const out = {},
      planet = this.galaxy.planets[b.p];
    if (!this.ai) return out;
    for (const player of this.galaxy.players) {
      const brain = this.ai.controllers.get(String(player.faction || '').toUpperCase())?.brain || this.ai.shared;
      if (!brain) continue;
      const values = {};
      for (const name of brain.eq.keys()) {
        try {
          const v = this.ai.evaluate(name, player.faction, planet);
          if (Number.isFinite(v)) values[name] = v;
        } catch (error) {}
      }
      out[String(player.faction).toUpperCase()] = values;
    }
    return out;
  }

  tacticalTreasury(b) {
    const out = {};
    for (const side of [b.attacker, b.defender]) {
      const player = this.galaxy.players.find(p => p.faction === side);
      if (!player) continue;
      const id = String(side).toUpperCase(),
        c = !this.isHuman(side) ? this.ai?.controllers.get(id) : null,
        parts = [];
      if (c) {
        const allowance = this.ai.goals.sides.get(id)?.on?.tactical || new Map();
        for (const [name, share] of allowance) {
          const cat = c.budget.category(name);
          if (!cat || !(share > 0) || !(cat.total > 0)) continue;
          parts.push([name, Math.min(cat.total, Math.max(0, share * cat.total))]);
        }
      }
      out[id] = {
        credits: player.credits || 0,
        ai: !!c,
        share: parts.reduce((n, [, v]) => n + v, 0),
        parts,
        adjust: c?.adjustment?.credit ?? 1
      };
    }
    return out;
  }

  applyTacticalCredits(r) {
    for (const [id, t] of Object.entries(r.credits || {})) {
      const player = this.galaxy.players.find(p => String(p.faction).toUpperCase() === id);
      if (!player) continue;
      player.credits = Math.max(0, t.credits);
      const budget = this.ai?.controllers.get(id)?.budget;
      if (!budget || !t.ai) continue;
      for (const [name, part] of t.parts || []) {
        const cat = budget.category(name);
        if (cat) cat.total -= part;
      }
      for (const cat of budget.categories.values()) cat.total += (t.delta || 0) * cat.weight;
      budget.service();
    }
  }

  battlePlayers(b, myTeam) {
    const human = { human: true, team: myTeam, auto: true, color: '#3686f2' },
      cpu = { human: false, team: 1 - myTeam, auto: true, color: '#e0352b', difficulty: this.setup.difficulty || 'medium' };
    if (!this.net || !(b.humans || []).length) return [human, cpu];
    const side = (f, team) =>
      this.isHuman(f)
        ? { human: true, team, auto: true, color: team ? '#e0352b' : '#3686f2', faction: f }
        : {
            human: false,
            team,
            auto: true,
            color: team ? '#e0352b' : '#3686f2',
            difficulty: this.setup.difficulty || 'medium',
            faction: f
          };
    return [side(b.attacker, 0), side(b.defender, 1)];
  }

  battleSetup() {
    const g = this.galaxy,
      b = this.battle,
      pl = g.planets[b.p];
    if (b.mode === 'land') return this.landBattleSetup();
    const units = owner =>
      g.fleets.flatMap((f, fi) =>
        f.planet === b.p && !f.leg && f.owner === owner
          ? f.units.map((u, ui) => ({ gid: fi + ':' + ui, type: tacticalTransportType(u).name }))
          : []
      );
    const myTeam = this.net && (b.humans || []).length ? 0 : b.attacker === this.me ? 0 : 1;
    const storyPlots = this.story?.startTactical(pl, true) || [];
    const snap = snapshotGalaxy(g);
    snap.view = this.viewSnap(pl.pos[0], pl.pos[1]);
    return {
      mode: 'space',
      mapFile: pl.type.str('Space_Tactical_Map').trim(),
      credits: 0,
      popCap: 0,
      fog: true,
      teamFactions: [b.attacker, b.defender],
      players: this.battlePlayers(b, myTeam),
      campaign: {
        planet: b.p,
        planetType: pl.type.name,
        campaignName: g.campaign.name,
        galaxy: snap,
        storyPlots,
        autoResolve: this.autoResolveFor(b),
        galacticPerceptions: this.galacticPerceptions(b),
        treasury: this.tacticalTreasury(b),
        tech: this.techLevels(),
        blackMarket: this.blackMarketOwned(),
        corruption: pl.currentCorruption ?? -1,
        upgrades: galaxyWideUpgrades(this.galaxy),
        planetOwner: pl.owner,
        planetWeapons: (pl.groundStructures || [])
          .filter(u => !u.dead && u.type.bool('Is_Special_Weapon_In_Space') && u.type.num('Special_Weapon_Index', -1) >= 0)
          .map(u => u.type.name),
        attacker: { team: 0, units: units(b.attacker) },
        defender: {
          team: 1,
          units: units(b.defender),
          station: pl.station && (pl.stationOwner || pl.owner) === b.defender ? pl.station.name : null,
          orbital: pl.orbitalStructures.filter(s => s.owner === b.defender).map(s => s.type.name)
        }
      }
    };
  }

  applyResult(r) {
    if (r.credits) this.applyTacticalCredits(r);
    if (r.mode !== 'land') this.victory.superweaponBattle(r);
    this.victory.tacticalDeaths(r);
    const story = this.story,
      context = story && this.galaxy.planets[r.planet] ? story.battleContext(this.galaxy.planets[r.planet], r.sides) : null;
    const told = (planet, dead, winnerIndex, space) => {
      if (!story) return;
      try {
        for (const [record, owner, killer] of dead) story.combatDeath(record, planet, owner, killer, false);
        story.objectCache = null;
        story.reasonCache.clear();
        if (r.sides) story.battleFinished(planet, r.sides, [], winnerIndex, space, context);
      } catch (error) {
        console.error(error);
        story.errors.set('Battle result', String(error.message || error));
      }
    };
    if (r.mode === 'land') {
      const g = this.galaxy,
        pl = g.planets[r.planet],
        old = pl?.owner,
        alive = new Set(r.alive || []),
        dead = [];
      if (pl && story && r.sides) {
        const [attacker, defender] = r.sides;
        for (const gid of r.participants || []) {
          const [fi, ui] = String(gid).split(':').map(Number),
            u = g.fleets[fi]?.units[ui];
          if (u && !alive.has(gid)) dead.push([u, attacker, defender]);
        }
        pl.garrison.forEach((u, i) => {
          if (u.owner === defender && !alive.has('g:' + i)) dead.push([u, defender, attacker]);
        });
        pl.groundStructures.forEach((u, i) => {
          if (u.owner === defender && !alive.has('s:' + i)) dead.push([u, defender, attacker]);
        });
      }
      applyInvasionResult(this.galaxy, r);
      if (old !== pl?.owner) {
        this.victory.ownershipChanged();
        story?.planetCaptured(pl, old);
      }
      if (pl) told(pl, dead, r.winner === 'attacker' ? 0 : 1, false);
      this.lastResult = r;
      return;
    }
    const g = this.galaxy,
      alive = new Set(r.alive),
      pl = g.planets[r.planet];
    if (!pl) return;
    const lost = [];
    if (story && r.sides)
      g.fleets.forEach((f, fi) => {
        if (f.planet === r.planet && !f.leg && this.inBattle(f, r))
          f.units.forEach((u, ui) => {
            if (!alive.has(fi + ':' + ui)) lost.push([u, f.owner, r.sides.find(o => o !== f.owner) ?? r.sides[1]]);
          });
      });
    g.fleets.forEach((f, fi) => {
      if (f.planet === r.planet && !f.leg) f.units = f.units.filter((u, ui) => alive.has(fi + ':' + ui) || !this.inBattle(f, r));
    });
    g.fleets = g.fleets.filter(f => f.units.length);
    if (r.victoryType === 12 && r.sides) this.battles.retreat(r.planet, r.winner === 'attacker' ? r.sides[1] : r.sides[0]);
    if (!r.station && pl.station) {
      pl.station = null;
      pl.spaceLevel = 0;
    } else if (pl.station && r.stationLevel !== undefined && r.stationLevel < (pl.spaceLevel || 0)) {
      let type = pl.station;
      while (type && type.num('Base_Level', 0) > r.stationLevel) {
        const n = type.name;
        type = db.type(n.slice(0, -1) + String.fromCharCode(n.charCodeAt(n.length - 1) - 1));
      }
      if (r.stationLevel <= 0) {
        pl.station = null;
        pl.spaceLevel = 0;
      } else {
        pl.station = type || pl.station;
        pl.spaceLevel = r.stationLevel;
      }
    }
    if (r.planetDestroyed) destroyPlanet(this, pl, false);
    told(pl, lost, r.winner === 'attacker' ? 0 : 1, true);
    this.lastResult = r;
  }
  inBattle(f, r) {
    return r.sides ? r.sides.includes(f.owner) : true;
  }

  async embark(p, options = {}) {
    if (this.busy) return false;
    const fleet = embarkGround(this.galaxy, p, this.me, options);
    if (!fleet) return false;
    if (!this.fleetViews.has(fleet)) await this.fleetView(fleet);
    return true;
  }

  raidLanding(units, p) {
    const fleet = this.galaxy.fleets.find(f => f.planet === p && !f.leg && f.units.some(u => units.includes(u)));
    if (
      !fleet ||
      !(this.isHuman(fleet.owner)
        ? this.asFaction(fleet.owner, () => this.land(fleet, p, { records: units, raid: true }))
        : this.computerRaid(fleet, units, p))
    )
      for (const u of units) delete u.raiding;
  }

  computerRaid(fleet, units, p) {
    const g = this.galaxy,
      pl = g.planets[p],
      owner = fleet.owner,
      former = pl.owner;
    if (this.over || !canLand(g, fleet, p, { raid: true })) return false;
    if (former === owner) return landFriendly(g, fleet, p, { records: units, raid: true });
    if (!pl.garrison.length && !pl.groundStructures.length) {
      const ids = invasionForces(g, p, owner)
        .filter(({ gid }) => {
          const [fi, ui] = gid.split(':').map(Number);
          return units.includes(g.fleets[fi].units[ui]);
        })
        .map(u => u.gid);
      this.story?.captureBaseCleanup(pl, owner);
      applyInvasionResult(g, { mode: 'land', planet: p, sides: [owner, former], participants: ids, alive: ids, winner: 'attacker' });
      this.ai?.invalidate();
      this.story?.planetCaptured(pl, former);
      this.galacticBattleChanged();
      return true;
    }
    if (this.isHuman(former)) return !this.busy && !!this.battles.engage(p, owner, former, 'land', { records: units });
    return !!this.battles.invade(p, owner, former, units);
  }

  land(fleet, p, { records = null, raid = false } = {}) {
    const chosen = records ? fleet.units.filter(u => records.includes(u)) : fleet.units;
    if (
      !this.over &&
      !this.busy &&
      fleet.owner === this.me &&
      fleet.planet === p &&
      !fleet.leg &&
      chosen.some(
        u =>
          hasPlanetDestruction(u.carries || u.type) &&
          this.story?.activate(this.story.object(u, this.galaxy.planets[p], fleet.owner).__object)
      )
    )
      return true;
    if (this.busy || fleet.owner !== this.me || !canLand(this.galaxy, fleet, p, { raid })) return false;
    const pl = this.galaxy.planets[p],
      troops = invasionForces(this.galaxy, p, fleet.owner).filter(({ gid }) => {
        const [fi, ui] = gid.split(':').map(Number);
        return chosen.includes(this.galaxy.fleets[fi].units[ui]);
      });
    if (!troops.length) return false;
    if (pl.owner !== fleet.owner) {
      if (!pl.garrison.length && !pl.groundStructures.length) {
        const ids = troops.map(u => u.gid);
        if (this.net) {
          const former = pl.owner;
          this.story?.captureBaseCleanup(pl, fleet.owner);
          this.applyResult({ mode: 'land', planet: p, sides: [fleet.owner, former], participants: ids, alive: ids, winner: 'attacker' });
          this.galacticBattleChanged();
          this.ai?.invalidate();
          this.syncFleetViews();
          return true;
        }
        const snap = snapshotGalaxy(this.galaxy);
        snap.view = this.viewSnap(pl.pos[0], pl.pos[1]);
        stageStart({
          mode: 'galactic',
          players: [],
          teamFactions: [],
          campaign: this.galaxy.campaign.name,
          restore: snap,
          result: { mode: 'land', planet: p, sides: [fleet.owner, pl.owner], participants: ids, alive: ids, winner: 'attacker' }
        });
      } else {
        if (!pl.type.str('Land_Tactical_Map').trim()) return false;
        this.battles.engage(p, fleet.owner, pl.owner, 'land', { invasionIds: troops.map(u => u.gid) });
      }
      return true;
    }
    const changed = landFriendly(this.galaxy, fleet, p, { records: chosen, raid });
    for (const [f, v] of this.fleetViews)
      if (!this.galaxy.fleets.includes(f)) {
        this.scene.remove(v.inst.root);
        this.fleetViews.delete(f);
      }
    return changed;
  }

  landBattleSetup() {
    const g = this.galaxy,
      b = this.battle,
      pl = g.planets[b.p],
      myTeam = this.net && (b.humans || []).length ? 0 : b.attacker === this.me ? 0 : 1;
    const storyPlots = this.story?.startTactical(pl, false) || [];
    const snap = snapshotGalaxy(g);
    snap.view = this.viewSnap(pl.pos[0], pl.pos[1]);
    return {
      mode: 'land',
      mapFile: pl.type.str('Land_Tactical_Map').trim(),
      credits: 0,
      popCap: 0,
      fog: true,
      teamFactions: [b.attacker, b.defender],
      players: this.battlePlayers(b, myTeam),
      campaign: {
        planet: b.p,
        planetType: pl.type.name,
        campaignName: g.campaign.name,
        galaxy: snap,
        storyPlots,
        galacticPerceptions: this.galacticPerceptions(b),
        treasury: this.tacticalTreasury(b),
        orbitOwners: [...new Set(g.fleets.filter(f => f.planet === b.p && !f.leg && f.units.length).map(f => f.owner))],
        sides: [b.attacker, b.defender],
        autoResolve: this.autoResolveFor(b),
        tech: this.techLevels(),
        blackMarket: this.blackMarketOwned(),
        corruption: pl.currentCorruption ?? -1,
        upgrades: galaxyWideUpgrades(this.galaxy),
        attacker: {
          side: myTeam === 0 ? 0 : 1,
          units: invasionForces(g, b.p, b.attacker).filter(u => !b.invasionIds || b.invasionIds.includes(u.gid))
        },
        defender: {
          side: myTeam === 0 ? 1 : 0,
          units: pl.garrison.flatMap((u, i) =>
            u.owner === b.defender ? [{ gid: 'g:' + i, type: u.type.name, markerId: u.markerId ?? -1 }] : []
          ),
          tacticalStructures: (pl.tacticalStructures || []).map(u => ({
            type: u.type.name,
            owner: u.owner,
            position: u.position.slice(),
            baseLevel: u.baseLevel
          })),
          tech: g.players.find(p => p.faction === b.defender)?.tech || 0,
          structures: pl.groundStructures.flatMap((u, i) =>
            u.owner === b.defender ? [{ gid: 's:' + i, type: u.type.name, markerId: u.markerId ?? -1 }] : []
          )
        }
      }
    };
  }

  moveFleet(f, to, slot = null) {
    if (this.busy) return false;
    for (const u of f.units) delete u.pendingAbility;
    delete f.raid;
    if (
      !orderMove(this.galaxy, f, to, null, slot, {
        human: f.owner === this.me,
        denied: () => {
          if (f.owner === this.me) this.audio?.play?.('GUI_Bad_Sound');
        }
      })
    )
      return false;
    if (f.owner === this.me && this.audio && this.audio.play) this.audio.play('Galactic_Fleet_Hyperspace');
    if (f.owner === this.me) this.story?.generic('start_hyperspace');
    return true;
  }

  toggleZoom() {
    if (this.selected < 0 || this.battle || this.view.dir) return;
    if (this.view.zoom === 0) this.zoomIn(this.selected);
    else this.zoomOut();
  }

  viewSnap(x, y) {
    return { x, y, yaw: +(this.view.yaw || 0).toFixed(4), pull: Math.round(this.view.pullTo ?? this.view.pull ?? this.cam.pull) };
  }

  zoomMap(steps) {
    const v = this.view,
      base = this.cam.pull,
      lo = base * 0.4,
      hi = base * 2.5;
    const to = Math.min(hi, Math.max(lo, (v.pullTo ?? base) * Math.pow(1.15, steps)));
    if (to === v.pullTo) return false;
    v.pullTo = to;
    return true;
  }

  planeAt(sx, sy, out = new THREE.Vector3()) {
    const ray = (this.planeRay ||= new THREE.Raycaster());
    ray.setFromCamera(new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), this.camera);
    const plane = (this.plane ||= new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
    plane.constant = -(this.view.z ?? this.cam.plane);
    return ray.ray.intersectPlane(plane, out);
  }

  anchorZoom(sx, sy) {
    const at = this.planeAt(sx, sy);
    this.view.anchor = at ? { sx, sy, x: at.x, y: at.y } : null;
  }

  dragPan(dx, dy) {
    if (!dx && !dy) return;
    const k = (1000 * this.cam.dragFactor * (this.view.pull ?? this.cam.pull)) / this.cam.pull;
    const sx = (dx / innerWidth) * k,
      sy = (dy / innerHeight) * k,
      c = Math.cos(this.view.yaw || 0),
      s = Math.sin(this.view.yaw || 0);
    this.panBy(-(sx * c + sy * s), sy * c - sx * s);
  }

  touchView(dx, dy, turn) {
    if (this.controlsLocked || this.scrollLocked || this.scriptUI?.modal || this.menus?.open || this.planetInfo.open || this.battle) return;
    if (this.panFree()) this.dragPan(dx, dy);
    if (turn) this.view.yaw = ((this.view.yaw || 0) + turn) % (Math.PI * 2);
  }

  get touchZoomStep() {
    return 0.4;
  }

  panFree() {
    const v = this.view;
    return v.dir < 0 || (v.zoom === 0 && v.dir === 0);
  }

  panBy(dx, dy) {
    const v = this.view,
      x = v.x,
      y = v.y;
    v.x += dx;
    v.y += dy;
    this.clampPan();
    if (v.anchor) {
      v.anchor.x += v.x - x;
      v.anchor.y += v.y - y;
    }
  }

  clampPan() {
    const v = this.view,
      b = this.bounds;
    v.x = Math.min(b.x1, Math.max(b.x0, v.x));
    v.y = Math.min(b.y1, Math.max(b.y0, v.y));
  }

  zoomIn(i) {
    const v = this.view;
    if (v.zoom > 0 && v.planet === i) return;
    if (v.zoom > 0 && v.planet !== i) {
      v.planet = i;
      v.zoom = Math.min(v.zoom, 0.999);
      v.dir = 1;
      this.select(i);
      return;
    }
    v.planet = i;
    v.dir = 1;
    this.select(i);
    this.story?.signal('STORY_ZOOM_INTO_PLANET', this.galaxy.planets[i]?.type.name);
    this.radar?.animate('move');
    this.audio && this.audio.play && this.audio.play('GUI_Zoom');
  }

  openPlanetInfo() {
    return this.planetInfo.show(this.galaxy.planets[this.selected]);
  }

  async openBlackMarket(request) {
    if (this.marketPanel?.open) return false;
    if (!this.marketPanel) {
      this.marketLoading ||= loadMarketAssets().then(data => (data ? new MarketPanel(this, data) : null));
      this.marketPanel = await this.marketLoading;
    }
    return !!this.marketPanel && this.marketPanel.show(request);
  }

  async openCorruptionDialog(request) {
    if (this.corruptionPanel?.open) return false;
    if (!this.corruptionPanel) {
      this.corruptionLoading ||= loadCorruptionAssets().then(data => (data ? new CorruptionPanel(this, data) : null));
      this.corruptionPanel = await this.corruptionLoading;
    }
    return !!this.corruptionPanel && this.corruptionPanel.show(request);
  }
  executeCorruptionChoice(actor, planet, choice) {
    return executeCorruption(this, actor, planet, choice);
  }

  async openSliceDialog(request) {
    if (this.slicePanel?.open) return false;
    if (!this.slicePanel) {
      this.sliceLoading ||= loadSliceAssets().then(data => (data ? new SlicePanel(this, data) : null));
      this.slicePanel = await this.sliceLoading;
    }
    return !!this.slicePanel && this.slicePanel.show(request);
  }
  executeSliceChoice(actor, planet, row, only, respawn) {
    return executeSlice(this, actor, planet, row, only, respawn);
  }

  async openHackDialog(request) {
    if (this.hackPanel?.open) return false;
    if (!this.hackPanel) {
      this.hackLoading ||= loadHackAssets().then(data => (data ? new HackPanel(this, data) : null));
      this.hackPanel = await this.hackLoading;
    }
    return !!this.hackPanel && this.hackPanel.show(request);
  }
  executeHackChoice(actor, planet) {
    return executeHack(this, actor, planet);
  }

  async openSabotageMenu(request) {
    if (this.sabotagePanel?.open) return false;
    if (!this.sabotagePanel) {
      this.sabotageLoading ||= loadSabotageAssets().then(data => (data ? new SabotagePanel(this, data) : null));
      this.sabotagePanel = await this.sabotageLoading;
    }
    return !!this.sabotagePanel && this.sabotagePanel.show(request);
  }
  executeSabotageChoice(actor, planet, ability, row) {
    return sabotageStructure(this, actor, planet, row.structure, row.price);
  }

  async openBaseLayout() {
    const i = this.view.planet;
    if (i < 0 || this.view.zoom < 1 || this.battle || this.baseLayout?.open) return false;
    if (!this.baseLayout) {
      this.baseLayoutLoading ||= loadBaseLayoutAssets().then(data => (data ? new BaseLayout(this, data) : null));
      this.baseLayout = await this.baseLayoutLoading;
    }
    return (
      !!this.baseLayout && this.view.planet === i && this.view.zoom === 1 && !this.battle && this.baseLayout.show(this.galaxy.planets[i])
    );
  }

  zoomOut() {
    if (this.baseLayout?.open) {
      this.baseLayout.close();
      return;
    }
    const v = this.view;
    if (v.zoom === 0 && v.dir === 0) return;
    if (v.planet >= 0) this.story?.signal('STORY_ZOOM_OUT_PLANET', this.galaxy.planets[v.planet]?.type.name);
    v.dir = -1;
    this.radar?.animate('attack');
    this.audio && this.audio.play && this.audio.play('GUI_Zoom');
  }

  fit() {
    const w = innerWidth,
      h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = (2 * Math.atan(Math.tan(Math.atan(0.5) / 2) / this.camera.aspect)) / DEG;
    this.camera.updateProjectionMatrix();
    const r = Math.min(devicePixelRatio, 2);
    this.names.width = w * r;
    this.names.height = h * r;
    this.warmNameFonts();
    this.names.style.width = w + 'px';
    this.names.style.height = h + 'px';
    this.overview?.resize();
    this.baseLayout?.resize();
    this.marketPanel?.resize();
    this.corruptionPanel?.resize();
    this.slicePanel?.resize();
    this.hackPanel?.resize();
    this.sabotagePanel?.resize();
    this.scriptUI?.resize();
    this.pendingBattle?.resize();
    this.screenText?.resize();
    this.movies?.resize();
  }

  placeCamera() {
    const v = this.view,
      cm = this.cam,
      g = this.galaxy;
    const k = smooth(v.zoom),
      p = g.planets[v.planet];
    let tx = v.x,
      ty = v.y,
      tz = v.z ?? cm.plane,
      pull = v.pull ?? cm.pull,
      pitch = cm.pitch;
    if (p && k > 0) {
      const r = p.type.num('Scale_Factor', 1) * PLANET_RADIUS,
        o = cm.zoomOffset;
      const oc = Math.cos(v.yaw || 0),
        os = Math.sin(v.yaw || 0),
        ox = o[0] * oc - o[1] * os,
        oy = o[0] * os + o[1] * oc;
      tx += (p.pos[0] + ox * r - tx) * k;
      ty += (p.pos[1] + oy * r - ty) * k;
      tz += (p.pos[2] + o[2] * r - tz) * k;
      pull += (r * cm.zoomPull - pull) * k;
      pitch += (cm.zoomPitch - pitch) * k;
    }
    if (this.battle) {
      const b = this.battle,
        q = smooth(Math.min(1, b.t / b.zoom)),
        P = g.planets[b.p].pos;
      tx += (P[0] - tx) * q;
      ty += (P[1] - ty) * q;
      tz += (P[2] - tz) * q;
      pull += (175 - pull) * q;
      pitch += (-7.5 - pitch) * q;
    }
    const a = -pitch * DEG,
      yc = Math.cos(v.yaw || 0),
      ys = Math.sin(v.yaw || 0),
      back = Math.cos(a) * pull;
    this.camera.position.set(tx + ys * back, ty - yc * back, tz + Math.sin(a) * pull);
    this.camera.lookAt(tx, ty, tz);
    const light = galacticLight(cm.lightOut, cm.lightIn, cm.light, v.zoom);
    const d = light.direction,
      lc = Math.cos(v.yaw || 0),
      ls = Math.sin(v.yaw || 0);
    lighting.sunDir.value.set(d[0] * lc - d[1] * ls, d[0] * ls + d[1] * lc, d[2]);
    lighting.sunColor.value.setRGB(light.intensity, light.intensity, light.intensity);
    lighting.sunSpecular.value.setRGB(2 * light.intensity, 2 * light.intensity, 2 * light.intensity);
    for (const key of ['sunDir', 'sunColor', 'sunSpecular']) planetLighting[key].value.copy(lighting[key].value);
    return k;
  }

  frame(now) {
    if (this.modeSuspended) return;
    requestAnimationFrame(this.frame);
    const elapsed = Math.max(0, (now - this.last) / 1000),
      real = Math.min(0.1, elapsed);
    if (this.bench) this.bench.tick(now - this.last, now);
    this.last = now;
    if (this.over) return;
    this.screenText?.update(elapsed);
    this.audio?.speech?.update();
    this.movies?.update(elapsed);
    if (this.tutorialFx || this.dualFlash) {
      stepDualFlash(this, real);
      this.tutorialFx?.update(real);
    }
    const v = this.view,
      k = this.keys;
    if (v.dir) {
      v.zoom = Math.max(0, Math.min(1, v.zoom + (v.dir * real) / this.cam.zoomTime));
      if (v.zoom === 0 || v.zoom === 1) {
        if (v.zoom === 0) v.planet = -1;
        v.dir = 0;
      }
    }
    if (
      this.panFree() &&
      !this.controlsLocked &&
      !this.scrollLocked &&
      !this.scriptUI?.modal &&
      !this.menus?.open &&
      !this.planetInfo.open &&
      !this.neutralizePopup?.opened &&
      !this.storyDialog?.opened &&
      !this.galacticLog?.opened
    ) {
      const edge = 6,
        m = this.mouse,
        sp = (v.pull ?? this.cam.pull) * 0.9 * real;
      const r =
        (held(k, 'SCROLL_RIGHT') || (m.in && m.x >= innerWidth - edge) ? 1 : 0) - (held(k, 'SCROLL_LEFT') || (m.in && m.x <= edge) ? 1 : 0);
      const f =
        (held(k, 'SCROLL_UP') || (m.in && m.y <= edge) ? 1 : 0) - (held(k, 'SCROLL_DOWN') || (m.in && m.y >= innerHeight - edge) ? 1 : 0);
      const c = Math.cos(v.yaw || 0),
        s = Math.sin(v.yaw || 0);
      if (r || f) this.panBy((r * c - f * s) * sp, (r * s + f * c) * sp);
    }
    if (!this.controlsLocked && !this.scriptUI?.modal && !this.menus?.open && !this.planetInfo.open && !this.battle) {
      const t = (held(k, 'ROTATE_RIGHT') ? 1 : 0) - (held(k, 'ROTATE_LEFT') ? 1 : 0);
      if (t) v.yaw = ((v.yaw || 0) + t * 1.2 * real) % (Math.PI * 2);
    }
    if (v.pullTo !== undefined && v.pull !== v.pullTo) {
      v.pull += (v.pullTo - v.pull) * Math.min(1, real * 10);
      if (Math.abs(v.pullTo - v.pull) < 0.5) v.pull = v.pullTo;
    }
    let zoom = this.placeCamera();
    const A = v.anchor;
    if (A) {
      const at = v.zoom === 0 && v.dir === 0 ? this.planeAt(A.sx, A.sy, (this.anchorHit ||= new THREE.Vector3())) : null;
      if (at) {
        v.x += A.x - at.x;
        v.y += A.y - at.y;
        this.clampPan();
        zoom = this.placeCamera();
      }
      if (!at || v.pull === v.pullTo) v.anchor = null;
    }
    if (this.pendingLinkedTactical && !this.battle?.linked) {
      const request = this.pendingLinkedTactical;
      if (request.pending) {
        this.startBattle(request.planet, request.attacker, request.defender, request.mode);
        this.battle.linked = request;
      } else {
        launchLinkedMission(this, request).catch(error => {
          this.story.errors.set('LINK_TACTICAL', error.message);
          console.error(error);
        });
        return;
      }
    }
    if (this.battle && !this.net && this.advanceBattle(real)) return;
    if (this.net) this.net.pump();
    else if (!this.over) {
      this.story?.update(this.paused ? 0 : real * this.speed, false, real);
      storyMoviesDone(this.story);
    }
    if (this.pendingLinkedTactical && !this.battle?.linked) return;
    if (!this.paused && !this.over) {
      for (const a of this.idlers) a.step(real);
      planetClock.value += real;
      if (!this.battle && !this.net) {
        this.simulate(real * this.speed);
        if (this.over) return;
      }
    }
    this.stepPlanetFlashes(real);
    this.present(real, elapsed, zoom);
  }

  planetFlash(p, on) {
    const fade = this.planetViews[p]?.inst?.fade;
    this.planetFlashes ||= new Map();
    if (on) {
      if (!this.planetFlashes.has(p)) this.planetFlashes.set(p, { phase: 0 });
    } else {
      this.planetFlashes.delete(p);
      fade?.tint.set(1, 1, 1);
    }
  }

  stepPlanetFlashes(real) {
    if (!this.planetFlashes?.size) return;
    const C = db.constants,
      speed = C.num('GUI_Cycle_Speed', 5),
      darken = C.num('GUI_Darken_Level', 0.5),
      color = [6, 0, 0];
    for (const [p, f] of this.planetFlashes) {
      const fade = this.planetViews[p]?.inst?.fade;
      f.phase += real * speed;
      const level = darken * (1 + Math.sin(f.phase));
      fade?.tint.set(1 + color[0] * level, 1 + color[1] * level, 1 + color[2] * level);
    }
  }

  advanceBattle(real) {
    const b = this.battle;
    if (!b || !this.fadeEl) return false;
    b.t += real;
    this.fadeEl.style.opacity = Math.max(0, Math.min(1, (b.t - b.zoom) / b.fade));
    if (b.t >= b.zoom + b.fade && !b.gone) {
      b.gone = true;
      if (b.linked) {
        launchLinkedMission(this, b.linked).catch(error => {
          this.story.errors.set('LINK_TACTICAL', error.message);
          console.error(error);
        });
        return true;
      }
      if (this.mpBattles) {
        this.mpBattles.launch(b);
        return !!b.frame;
      }
      stageStart(this.battleSetup());
    }
    return false;
  }

  netStep(dt) {
    if (this.over) return;
    const held = this.paused || this.busy || this.held;
    this.story?.update(held ? 0 : dt, false, 1 / LOGIC_FPS);
    storyMoviesDone(this.story);
    if (!held && !this.paused && !this.busy && !this.held && !this.over) this.simulate(dt);
    this.pendingBattle?.tick?.();
  }

  simulate(dt) {
    {
      {
        const payments = stepIncome(this.galaxy, dt);
        this.ai?.income(payments);
        stepCorruption(this);
        stepPolitics(this.galaxy, dt);
        this.ai?.update(dt);
        const completed = stepProduction(
          this.galaxy,
          dt,
          this.ai?.productionHooks,
          i => this.battle?.p === i || this.pendingBattle?.request?.p === i
        );
        for (const x of completed.interrupted || [])
          if (x.owner === this.me)
            this.galacticLog?.message(
              String(db.t('TEXT_TOOLTIP_INTERRUPTED_PRODUCTION')).replace('%s', db.t(x.planet.type.str('Text_ID')) || x.planet.name),
              { urgent: true, color: [0, 193, 91] }
            );
        if (completed.length) {
          this.mergeFleets();
          for (const f of this.galaxy.fleets) if (!this.fleetViews.has(f)) this.fleetView(f);
          for (const done of completed) if (done.owner === this.me) this.audio.play(done.type.str('SFXEvent_Build_Complete'));
          for (const done of completed) if (done.tech !== undefined) this.story?.signal('STORY_TECH_LEVEL', String(done.tech));
          if (this.story) for (const done of completed) constructStory(this.story, done.type, done.owner);
          for (const done of completed) this.battles.dirty.add(done.planet);
        }
        stepFleets(this.galaxy, dt * LOGIC_FPS, (f, p) => {
          const raid = f.raid === p && isRaidForce(f) ? [...f.units] : null;
          delete f.raid;
          if (raid) for (const u of raid) u.raiding = true;
          if (!raid && blocks(this.galaxy, p, f.owner, f)) pullIn(this.galaxy, p, f);
          this.mergeFleets();
          const there = this.galaxy.fleets.find(x => x.planet === p && x.owner === f.owner && !x.leg) || f;
          this.checkConflict(there, p);
          this.fireArrival(there, p);
          if (raid) this.raidLanding(raid, p);
        });
        this.warnApproaching();
        this.battles.update();
        stepVisibility(this.galaxy, this.me, dt * LOGIC_FPS);
        if (this.galaxy.visibility?.revealed) this.audio?.playAudioEvent('SFXEvent_Planet_Revealed');
        this.popCapWarning();
        this.victory.update();
      }
    }
  }

  present(real, elapsed, zoom) {
    this.abilityParticles?.update(this.paused ? 0 : real * this.speed);
    if (this.attachedParticles) for (const m of this.attachedParticles.values()) m.update(this.paused ? 0 : real * this.speed);
    (this.corruptionVisuals ||= new CorruptionVisuals(this)).update(this.paused ? 0 : real * this.speed);
    this.galacticLog?.update(elapsed);
    if ((this.hudTimer -= real) <= 0) {
      this.hudTimer = 0.25;
      this.ui?.refresh();
      this.overview?.refresh();
      this.baseLayout?.refresh();
      this.marketPanel?.refresh();
      this.corruptionPanel?.refresh();
      this.slicePanel?.refresh();
      this.sabotagePanel?.refresh();
    }
    for (const f of this.galaxy.fleets) {
      this.placeFleet(f);
      const inst = this.fleetViews.get(f)?.inst;
      if (f.leg && inst?.billboards.length) updateBillboards(inst, this.camera);
    }
    (this.fleetLines ||= new FleetLines(this.scene)).update(this.galaxy, this.me, o => this.factionColor(o));
    for (let i = 0; i < this.planetViews.length; i++) {
      const pv = this.planetViews[i];
      if (!pv?.inst) continue;
      const state = intelligence(this.galaxy, this.galaxy.planets[i])?.discovered ? 0 : 2;
      if (pv.alt !== state) {
        pv.alt = state;
        for (const [n, meshes] of (pv.inst.alts || []).entries())
          if (meshes) for (const m of meshes) m.visible = n === state && !m.userData.hiddenByDefault;
      }
      if (pv.inst.billboards.length) updateBillboards(pv.inst, this.camera);
    }
    if (this.marker && this.marker.billboards.length) updateBillboards(this.marker, this.camera);
    if (this.marker?.root.visible) {
      this.tintMarker();
      this.orientMarker();
    }
    this.updateRoutes(real, zoom);
    this.hover = this.mouse.in ? this.pick(this.mouse.x, this.mouse.y) : -1;
    renderGalacticScenes(this.renderer, this.camera, this.scene, this.backgroundScene, this.midgroundScene, this.midforegroundScene);
    if (this.renderer.endFrame) this.renderer.endFrame();
    this.drawNames(zoom);
    this.overview?.update();
    this.radar?.drawFrame(real);
    this.radar?.refresh();
  }

  drawPlanetStatus(ctx, p, point, scale, ratio) {
    for (const s of this.statusStyles || []) {
      const name = p.type.str(s.tag).trim();
      const img = name && this.tinted(name, [1, 1, 1]);
      if (!img) continue;
      const z = scale * ratio * s.scale,
        cx = (point.x + s.offset[0] * scale) * ratio,
        cy = (point.y - s.offset[1] * scale) * ratio;
      ctx.drawImage(img, cx - (img.width * z) / 2, cy - (img.height * z) / 2, img.width * z, img.height * z);
    }
  }

  statusIcons(p, v) {
    const s = this.statusRow,
      out = [],
      me = String(this.me).toUpperCase(),
      up = x => String(x || '').toUpperCase();
    const named = t => !!t && (t.bool('Is_Named_Hero') || t.list('Company_Units').some(n => db.type(n)?.bool('Is_Named_Hero')));
    const owners = new Set();
    for (const f of this.galaxy.fleets)
      if (f.planet === p.index && !f.leg)
        for (const u of f.units)
          if (!u.dead && named(u.carries || u.type) && (up(f.owner) === me || !strategicStealth(u))) owners.add(up(f.owner));
    for (const u of p.garrison) if (named(u.carries || u.type) && (up(u.owner) === me || v?.groundCount)) owners.add(up(u.owner));
    if (this.simplifiedFactionColors ?? this.setup.simplifiedFactionColors ?? false) {
      if (owners.has(me)) out.push({ name: s.hero.textures[0], scale: s.hero.scale });
      if ([...owners].some(o => o !== me)) out.push({ name: s.hero.textures[1], scale: s.hero.scale });
    } else
      ['Good_Side_Name', 'Evil_Side_Name', 'Corrupt_Side_Name'].forEach((k, i) => {
        if (owners.has(up(db.constants.str(k)))) out.push({ name: s.hero.textures[2 + i], scale: s.hero.scale });
      });
    if (up(p.owner) === me && (p.production?.space?.some(q => up(q.owner) === me) || p.production?.ground?.some(q => up(q.owner) === me)))
      out.push({ name: s.build.textures[0], scale: s.build.scale });
    const type = p.currentCorruption ?? -1,
      icons = db.constants.str('Corruption_Planet_Icon').split(/\s+/).filter(Boolean);
    const corrupt = type === -1 ? db.faction(this.me)?.bool('Benefits_From_Corruption') && icons[8] : this.filters & 4 && icons[type];
    if (corrupt) out.push({ name: corrupt, scale: s.corruption.scale, corruption: type });
    return out;
  }

  drawCorruption(ctx, p, point, scale, ratio, v) {
    const s = this.statusRow;
    let x = (point.x + s.start[0] * scale) * ratio;
    const y = (point.y - (s.start[1] + (this.filters & 1 ? s.value : 0) + (this.filters & 2 ? s.ground : 0)) * scale) * ratio;
    for (const item of this.statusIcons(p, v)) {
      const img = item.name && this.tinted(item.name, [1, 1, 1]),
        z = scale * ratio * item.scale;
      if (!img || !(z > 0)) continue;
      const cx = x + (img.width * z) / 2;
      x += img.width * z;
      ctx.drawImage(img, cx - (img.width * z) / 2, y - (img.height * z) / 2, img.width * z, img.height * z);
      if (item.corruption !== undefined)
        (this.nextIcons ||= []).push({
          p: p.index,
          type: item.corruption,
          x: cx / ratio,
          y: y / ratio,
          w: (img.width * z) / ratio,
          h: (img.height * z) / ratio
        });
    }
    if (p.corruptionKind) {
      const percent = Math.trunc(
        Math.max(
          0,
          Math.min(
            1,
            ((this.galaxy.time || 0) - (p.corruptionStart || 0)) / Math.max(1e-6, (p.corruptionEnd || 0) - (p.corruptionStart || 0))
          )
        ) * 100
      );
      const text = String(db.t(p.corruptionKind === 'remove' ? 'TEXT_CORRUPTION_REMOVE_PERCENT' : 'TEXT_CORRUPTION_PERCENT'))
        .replace('%d%%', percent + '%')
        .replace('%d', percent);
      ctx.font = `${6 * 1.6 * scale}px ${fontFamily('EmpireAtWar-Medium')}`;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2 * scale;
      ctx.fillStyle = 'rgb(255,242,0)';
      const tx = (point.x + 30 * scale) * ratio,
        ty = (point.y - 15 * scale) * ratio;
      ctx.textAlign = 'left';
      ctx.strokeStyle = '#000';
      ctx.strokeText(text, tx, ty);
      ctx.fillText(text, tx, ty);
    }
  }

  drawPips(ctx, p, v, col, point, scale, ratio) {
    const counts = [v.spaceLevel ? p.spaceLevel || 0 : 0, v.groundLevel ? p.groundStructures.length : 0];
    const caps = [Math.min(5, p.type.num('Max_Space_Base', 5)), Math.min(9, p.type.num('Special_Structures_Land', 3))];
    for (let row = 0; row < 2; row++) {
      const s = this.pipStyles[row],
        z = scale * ratio * s.scale;
      let dx = 0;
      for (let i = 0; i < caps[row]; i++) {
        const full = i < counts[row],
          tint = full ? col : col.map(c => Math.floor(c * 255) >> 1).map(c => c / 255);
        const img = this.tinted(s.textures[full ? 0 : 1], tint);
        if (!img) continue;
        const px = (point.x + s.offset[0] * scale) * ratio + dx,
          py = (point.y - (s.offset[1] - (this.filters & 1 ? 11 : 0)) * scale) * ratio;
        ctx.drawImage(img, px - (img.width * z) / 2, py - (img.height * z) / 2, img.width * z, img.height * z);
        dx += img.width * z;
      }
    }
  }

  async warmNameFonts() {
    if (!this.nameStyle) return;
    this.labelRasterCache.clear();
    const s = this.nameStyle,
      v = this.valueStyle;
    const fonts = await Promise.all(
      [...new Set([s.font, ...s.fonts])]
        .map(face => loadComponentFont(face, dialogFontPixels(uiTextHeight(), s.pt)))
        .concat([loadComponentFont(v.font, dialogFontPixels(uiTextHeight(), v.pt))])
    );
    const text = this.planetViews.map(p => p.name.toUpperCase()).join('');
    await Promise.all(fonts.filter(Boolean).map(font => font.ensure(text)));
  }

  drawNameGlyphs(ctx, text, face, style, col, px, py, ratio) {
    const font = componentFont(face, dialogFontPixels(uiTextHeight(), style.pt));
    if (!font) return false;
    const key = JSON.stringify([text, face, innerHeight, col, style.outline]);
    let canvas = this.labelRasterCache.get(key);
    if (!canvas) {
      const image = nativeTextPixels(nativeTextMask(font, text), {
        top: col.map(c => Math.round(c * 255)).concat(255),
        outline: style.outline
      });
      canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d').putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
      if (this.labelRasterCache.size >= 512) this.labelRasterCache.delete(this.labelRasterCache.keys().next().value);
      this.labelRasterCache.set(key, canvas);
    }
    const scale = style.scale;
    ctx.drawImage(
      canvas,
      Math.floor(px / ratio + 0.5) * ratio,
      Math.floor(py / ratio - (canvas.height * scale) / 2 + 0.5) * ratio,
      canvas.width * ratio * scale,
      canvas.height * ratio * scale
    );
    return true;
  }

  drawNames(zoom) {
    const cv = this.names,
      x = cv.getContext('2d'),
      r = cv.width / innerWidth,
      s = this.nameStyle;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, cv.width, cv.height);
    const alpha = Math.max(0, 1 - this.view.zoom * 10);
    this.lastSpots = [];
    this.lastSurfaceSpots = [];
    if (!alpha) return;
    const scale = this.overlayScale(),
      ui = scale * r;
    let orbit = null;
    x.globalAlpha = alpha;
    this.galaxy.planets.forEach((p, i) => {
      const pv = this.planetViews[i],
        point = pv?.show && this.overlayPoint(p.pos);
      if (!point) return;
      const v = intelligence(this.galaxy, p),
        col = rgb(db.faction(displayOwner(this.galaxy, p))?.str('Color'));
      const ring = i !== this.selected && this.tinted(this.ringComp.texture, col);
      if (ring) {
        const z = ui * this.ringComp.scale;
        x.globalAlpha = alpha * this.ringComp.alpha;
        x.drawImage(ring, point.x * r - (ring.width * z) / 2, point.y * r - (ring.height * z) / 2, ring.width * z, ring.height * z);
        x.globalAlpha = alpha;
      }
      const px = point.x * r + s.offset[0] * ui,
        py = point.y * r;
      const count = v?.groundLevel ? p.groundStructures.length : 0;
      const level =
        count < db.constants.num('Num_Structures_For_Medium_Planet_Name', 3)
          ? 0
          : count < db.constants.num('Num_Structures_For_Large_Planet_Name', 5)
            ? 1
            : 2;
      x.font = `${s.pt * 1.6 * ui * s.scale}px ${fontFamily(s.fonts[level] || s.font)}`;
      x.textBaseline = 'middle';
      x.lineJoin = 'round';
      x.lineWidth = 2 * ui * s.scale;
      x.fillStyle = `rgb(${col.map(c => Math.round(c * 255)).join(',')})`;
      if (!this.drawNameGlyphs(x, pv.name.toUpperCase(), s.fonts[level] || s.font, s, col, px, py, r)) {
        if (s.outline) {
          x.strokeStyle = '#000';
          x.strokeText(pv.name.toUpperCase(), px, py);
        }
        x.fillText(pv.name.toUpperCase(), px, py);
      }
      if (this.filters & 1) {
        const s = this.valueStyle,
          text = String(Math.round(displayIncome(this.galaxy, p, (orbit ||= orbitFleets(this.galaxy)))));
        x.font = `${s.pt * 1.6 * ui * s.scale}px ${fontFamily(s.font)}`;
        const vx = (point.x + s.offset[0] * scale) * r,
          vy = (point.y - s.offset[1] * scale) * r;
        if (!this.drawNameGlyphs(x, text, s.font, s, col, vx, vy, r)) {
          if (s.outline) {
            x.strokeStyle = '#000';
            x.strokeText(text, vx, vy);
          }
          x.fillText(text, vx, vy);
        }
      }
      if (v?.discovered && this.filters & 2) this.drawPips(x, p, v, col, point, scale, r);
      if (v?.discovered) this.drawCorruption(x, p, point, scale, r, v);
      if (v?.discovered && this.filters & 4) this.drawPlanetStatus(x, p, point, scale, r);
    });
    const put = (units, owner, comp, sx, sy, empty = false, fleet = null) => {
      const badge =
        comp === this.fleetComp && units.length
          ? units.every(u => strategicStealth(u))
            ? 'i_icon_stealth.tga'
            : fleet && isRaidForce(fleet)
              ? 'i_icon_raid.tga'
              : null
          : null;
      const img = this.stackPicture(units, owner, comp, empty, units.length, null, badge),
        z = ui * comp.scale;
      if (img) x.drawImage(img, sx * r - (img.width * z) / 2, sy * r - (img.height * z) / 2, img.width * z, img.height * z);
    };
    this.lastSpots = this.stackSpots(scale);
    for (const s of this.lastSpots)
      if (!s.f || s.f !== this.dragFleet) put(s.units || s.f?.units || [], s.f?.owner || this.me, this.fleetComp, s.x, s.y, !s.f, s.f);
    this.corruptionIcons = this.nextIcons || [];
    this.nextIcons = [];
    this.corruptionTip();
    this.lastSpecialSpots = this.specialSpots(scale);
    this.lastSurfaceSpots = this.surfaceSpots(scale);
    for (const s of this.lastSurfaceSpots)
      if (this.dragGround !== s.p) {
        x.globalAlpha = alpha * (s.empty ? 0.5 : 1);
        put(s.units, s.empty ? this.me : this.galaxy.planets[s.p].owner, this.groundComp, s.x, s.y, s.empty);
      }
    x.globalAlpha = alpha;
    if (this.dragGround !== undefined) {
      const p = this.galaxy.planets[this.dragGround];
      put(
        p.garrison.filter(u => u.owner === this.me),
        this.me,
        this.groundComp,
        this.mouse.x,
        this.mouse.y
      );
    }
    for (const s of this.lastSpecialSpots) {
      const hover = this.pickSpecial(this.mouse.x, this.mouse.y) === s,
        c = this.specialComp,
        frame = this.tinted(hover && c.over ? c.over : c.textures[0], [1, 1, 1]),
        z = ui * c.scale;
      if (frame) x.drawImage(frame, s.x * r - (frame.width * z) / 2, s.y * r - (frame.height * z) / 2, frame.width * z, frame.height * z);
      x.font = `${6 * 1.6 * ui}px ${fontFamily('EmpireAtWar-Medium')}`;
      x.textBaseline = 'middle';
      x.textAlign = 'right';
      x.fillStyle = `rgb(${c.color.slice(0, 3).join(',')})`;
      x.fillText(s.slot.label, (s.x + c.text[0] * ui) * r, (s.y + c.text[1] * ui) * r);
      x.textAlign = 'left';
    }
    if (this.dragFleet) put(this.dragFleet.units, this.dragFleet.owner, this.fleetComp, this.mouse.x, this.mouse.y);
    if ((this.dragFleet || this.dragGround !== undefined) && this.mouse.in !== false) {
      const orbit = this.pickStack(this.lastSpots, this.mouse.x, this.mouse.y),
        surface = this.dragFleet && !orbit ? this.pickStack(this.lastSurfaceSpots, this.mouse.x, this.mouse.y) : null;
      const takes = orbit && (this.dragFleet ? orbit.f !== this.dragFleet : !orbit.f || orbit.f.owner === this.me);
      const spot = takes ? orbit : surface;
      if (spot) {
        const comp = spot === surface ? this.groundComp : this.fleetComp,
          frame = comp.over && this.tinted(comp.over, [1, 1, 1]),
          z = ui * comp.scale;
        if (frame)
          x.drawImage(frame, spot.x * r - (frame.width * z) / 2, spot.y * r - (frame.height * z) / 2, frame.width * z, frame.height * z);
      }
    }
    if (this.dragFleet && this.mouse.in !== false && canBribe(this.dragFleet.owner)) {
      const f = this.dragFleet,
        overRadar = this.radar?.contains(this.mouse.x, this.mouse.y);
      const to = overRadar
        ? this.radar.pick(this.mouse.x, this.mouse.y)
        : (this.pickStack(this.lastSpots, this.mouse.x, this.mouse.y)?.p ??
          this.pickStack(this.lastSurfaceSpots, this.mouse.x, this.mouse.y)?.p ??
          this.pickSpecial(this.mouse.x, this.mouse.y)?.p ??
          this.hover);
      const memo = this.bribeMemo,
        id = f.planet + '>' + to + '@' + Math.floor(this.galaxy.time);
      if (!memo || memo.f !== f || memo.id !== id) this.bribeMemo = { f, id, total: to >= 0 ? bribeQuote(this.galaxy, f, to, this.me) : 0 };
      if (this.bribeMemo.total > 0) {
        const plate = this.tinted('I_bribe.tga', [1, 1, 1]),
          pw = plate?.width ?? 182,
          ph = plate?.height ?? 31;
        const cx = this.mouse.x * r + (pw / 2 + 20) * ui,
          py = this.mouse.y * r + (ph / 2 + 20 - 7) * ui,
          px = cx;
        if (plate) x.drawImage(plate, cx - (pw * ui) / 2, this.mouse.y * r + 20 * ui, pw * ui, ph * ui);
        const pay = (this.galaxy.players.find(p => p.faction === this.me)?.credits ?? 0) >= this.bribeMemo.total;
        x.font = `${7 * 1.6 * ui}px ${fontFamily('EmpireAtWar-Medium')}`;
        x.textBaseline = 'middle';
        x.textAlign = 'left';
        const put = (text, dx, color) => {
          x.fillStyle = 'rgba(0,0,0,0.8)';
          x.fillText(text, px + (dx + 1) * ui, py + ui);
          x.fillStyle = color;
          x.fillText(text, px + dx * ui, py);
        };
        put(db.t('TEXT_BRIBE_DISPLAY_TEXT'), -78, 'rgb(64,255,64)');
        put(String(this.bribeMemo.total), 47, pay ? 'rgb(255,255,255)' : 'rgb(255,0,0)');
      }
    }
    x.globalAlpha = 1;
  }
}

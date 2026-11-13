import { db } from '../gamedata.js';
import { iconUrl } from '../icons.js';
import { CommandBar } from './hud.js';
import { costOf } from './land.js';
import {
  canBomb,
  bombingRun,
  garrison,
  canGarrison,
  bombardEnabled,
  canBombard,
  bombardCharge,
  bombardOf,
  bombardTargetWhy
} from './landbase.js';
import { CELL } from './terrain.js';
import { Radar } from './radar.js';
import { BeaconView } from './beacons.js';
import { PICKS_UNIT, SILENT, bribeCost } from './landabilities.js';

const $ = id => document.getElementById(id);
const up = n => String(n).toUpperCase();

function playerOf(world, side, factionName, game = null) {
  return {
    id: side,
    get human() {
      const p = game?.players?.[side];
      return p && 'human' in p ? !!p.human : side === game?.me;
    },
    team:
      (world.teamTags ||= new Map()).get(world.team[side]) ||
      world.teamTags.set(world.team[side], { id: world.team[side] }).get(world.team[side]),
    faction: db.faction(factionName),
    factionName,
    get credits() {
      return world.credits[side];
    },
    set credits(v) {
      world.credits[side] = +v || 0;
    },
    get pop() {
      return world.popUsed(side);
    },
    get popCap() {
      return world.popCap(side);
    },
    get reinforcements() {
      return world.ready[side];
    },
    upgrades: {
      has: n => {
        for (const o of world.owned[side]) if (up(o) === up(n)) return true;
        return false;
      },
      [Symbol.iterator]: () => world.owned[side][Symbol.iterator]()
    },
    get techLevel() {
      let n = world.campaignTech?.[side] ?? 1;
      for (const o of world.owned[side]) if (/TECH/i.test(o) && /LEVEL|UPGRADE/i.test(o)) n++;
      return n;
    }
  };
}

const NONE = new Map();
const padReach = s => {
  const b = s.point?.inst?.box || s.inst?.box;
  if (!b || b.isEmpty()) return 0;
  return Math.max(-b.min.x, b.max.x, -b.min.y, b.max.y) * (s.scale || 1);
};
class PadPick {
  constructor(site, world, index) {
    this.site = site;
    this.world = world;
    this.index = index;
    this.id = 'site' + index;
    this.type = site.base ? site.pad : site.point.type;
    this.isPad = true;
    this.isMobile = false;
    this.isSquad = false;
    this.selected = false;
    this.abilities = [];
    this.fighters = [];
    this.members = [];
  }
  get player() {
    const w = this.world,
      s = this.site.base ? this.site.side : this.site.point.side;
    return (s >= 0 && w.ally(s, w.viewer) ? w.sidePlayers[w.viewer] : w.sidePlayers[s]) || null;
  }
  get dead() {
    return false;
  }
  get x() {
    return this.site.x;
  }
  get y() {
    return this.site.y;
  }
  get healthFrac() {
    return 1;
  }
  get maxShield() {
    return 0;
  }
  get shield() {
    return 0;
  }
  get buildQueues() {
    const m = new Map();
    if (this.site.building) m.set('site' + this.index, [this.site.building]);
    return m;
  }
  abilityState() {
    return null;
  }
}

export class LandUI {
  constructor(game, assets) {
    this.game = game;
    const w = (this.world = game.world),
      me = (this.me = game.me);
    this.selection = [];
    this.seeAll = false;
    this.hover = null;
    this.armed = null;
    this.placing = null;
    this.mouse = { x: 0, y: 0, inside: false };
    this.r = { rig: game.view };
    this.pads = new Map();
    w.sidePlayers = game.factions.map((f, side) => playerOf(w, side, f, game));
    this.player = w.sidePlayers[me];
    w.sidePlayers[w.wild] = {
      id: -1,
      team: { id: -1 },
      faction: db.faction('Neutral') || this.player.faction,
      factionName: 'Neutral',
      credits: 0,
      pop: 0,
      popCap: 0,
      reinforcements: [],
      upgrades: new Set(),
      techLevel: 1
    };
    w.hostilePlayer = {
      id: -2,
      team: { id: -2 },
      faction: db.faction('Hostile') || w.sidePlayers[w.wild].faction,
      factionName: 'Hostile',
      credits: 0,
      pop: 0,
      popCap: 0,
      reinforcements: [],
      upgrades: new Set(),
      techLevel: 1
    };

    const siteFor = (b, uc) => {
      const own = this.siteOf(b);
      if (own) return w.siteOptions(own, this.me).includes(uc) ? own : null;
      let best = null,
        bd = Infinity;
      for (const s of w.sites) {
        if (!s.base || !w.siteOptions(s, this.me).includes(uc)) continue;
        const d = Math.hypot(s.x - b.x, s.y - b.y);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    };
    const view = {
      get units() {
        return w.squads.filter(q => q.members.length && !q.arriving && !q.craft);
      },
      squads: [],
      prevUpgrade: {
        get: n => {
          const t = db.type(n);
          return (t && db.type(t.str('Previous_Upgrade_Level_Type'))) || null;
        }
      },
      get fog() {
        return game.setup.fog !== false && !game.reveal;
      },
      canSee: (p, e) => !e.members || e.members.some(u => u.seen !== false),
      weatherNow: () => {
        const name = w.wxNow(),
          m = name !== 'clear' ? w.tables?.weather.get(name) : null;
        return m && m.icon ? m : null;
      },
      tacticalPop: t => (t.has('Land_Override_Population_Value') ? t.num('Land_Override_Population_Value', 0) : undefined),
      abilityBlocked: (q, kind) => (q.abilityState ? w.abilityBlocked(q, kind) : null),
      buildOptions: b => {
        const own = this.siteOf(b);
        if (own) return w.siteMenu(own, this.me);
        const u = b.members[0],
          out = [];
        if (!u) return out;
        return out.concat(u.builds);
      },
      cantBuild: (b, t) => {
        const own = this.siteOf(b);
        if (own && own.building) return 'Already building';
        if (siteFor(b, t)) return w.credits[this.me] < costOf(t) ? 'Not enough credits' : null;
        if (own) return 'Cannot be built there';
        const u = b.members[0];
        return u ? w.cantBuy(u, t, this.me) : 'Cannot be built there';
      },
      startBuild: (b, t) => {
        const s = siteFor(b, t);
        if (s) return w.startSite(s, t, this.me);
        const u = b.members[0];
        return u ? w.buy(u, t, this.me) : 'Cannot be built there';
      },
      queuesOf: b => {
        if (b.isPad) return b.buildQueues;
        const own = this.siteOf(b);
        if (own) return own.building ? new Map([['site' + w.sites.indexOf(own), [own.building]]]) : NONE;
        if (b.player !== this.player) return NONE;
        const m = new Map(),
          qs = w.queues[this.me];
        if (qs.units.length) m.set('units', qs.units);
        if (qs.upgrades.length) m.set('upgrades', qs.upgrades);
        w.sites.forEach((s, i) => {
          if (s.building && s.building.side === this.me) m.set('site' + i, [s.building]);
        });
        return m;
      },
      cancelBuild: (b, name, index) => {
        if (name === 'units' || name === 'upgrades') w.cancel(this.me, w.queues[this.me][name], index);
        else w.cancelSite(w.sites[+name.slice(4)]);
      }
    };
    this.view = view;
    const host = {
      world: view,
      human: this.player,
      audio: game.audio,
      advisor: null,
      map: game.map,
      setup: game.setup,
      get speed() {
        return game.speed;
      },
      get paused() {
        return game.paused;
      },
      togglePause: () => game.togglePause(),
      toggleMenu: () => game.toggleMenu(),
      setSpeed: s => game.setSpeed(s),
      canRetreat: () => game.canRetreat(),
      beaconReady: () => game.beaconReady(),
      retreatClicked: () => game.retreatClicked(),
      message: (text, cls) => game.say(text, cls),
      cine: { toggle: () => game.cine && game.cine.toggle() },
      command: cmd => this.command(cmd)
    };
    $('hud').classList.remove('hidden');
    document.body.classList.add('original-hud');
    this.bar = new CommandBar(host, this, assets);
    this.bar.bWeapon.title = 'Bombing run';
    this.bar.bWeapon.onclick = () => {
      if (this.bar.bWeapon.classList.contains('dis')) return;
      game.audio.play('GUI_Button_Press_2_SFX');
      this.armed = this.armed === 'bombing' ? null : 'bombing';
      this.placing = this.aiming = null;
      if (this.armed) game.say('Click where the bombers should strike');
    };
    this.pb = this.bar.button('pb_switch', {
      onClick: () => {
        if (!canBombard(w, this.me)) return;
        this.armed = this.armed === 'orbital' ? null : 'orbital';
        this.placing = this.aiming = null;
        if (this.armed) game.audio.play(bombardOf(w, this.me).ship?.str('SFXEvent_Bombard_Select_Target'));
      }
    });
    this.pbCharge = this.bar.place(Object.assign(document.createElement('div'), { className: 'hbar' }), 'pb_switch_recharge');
    this.pbCharge.innerHTML = '<i></i>';
    this.bar.root.appendChild(this.pbCharge);
    {
      const back = this.bar.tex('pb_switch_recharge', 'Bar_Texture_Name'),
        fill = this.bar.tex('pb_switch_recharge', 'Bar_Overlay_Name');
      if (back) this.pbCharge.style.backgroundImage = `url("${back}")`;
      if (fill) this.pbCharge.firstChild.style.backgroundImage = `url("${fill}")`;
      this.pbCharge.firstChild.style.backgroundSize = (parseFloat(this.pbCharge.style.width) || 0) + 'px 100%';
    }
    this.pb.hidden = this.pbCharge.hidden = true;
    this.bar.covers = [this.pb];
    const mm = $('minimap');
    const look = e => {
      game.following = null;
      const r = mm.getBoundingClientRect(),
        lo = game.map.playMin,
        hi = game.map.playMax;
      game.view.x = lo[0] + ((e.clientX - r.left) / r.width) * (hi[0] - lo[0]);
      game.view.y = lo[1] + (1 - (e.clientY - r.top) / r.height) * (hi[1] - lo[1]);
    };
    mm.addEventListener('mousedown', e => {
      if (e.button === 0) look(e);
    });
    mm.addEventListener('mousemove', e => {
      if (e.buttons & 1) look(e);
    });
    mm.addEventListener('contextmenu', e => e.preventDefault());
  }

  get hudTimer() {
    return this.game.hudTimer;
  }
  set hudTimer(v) {
    this.game.hudTimer = v;
  }

  select(list, add = false) {
    const next = add ? [...new Set([...this.selection, ...list])] : list.slice(),
      before = add ? this.selection.slice() : [];
    for (const s of this.selection) s.selected = false;
    this.selection = next.filter(s => s && !s.dead && s.selectable !== false);
    for (const s of this.selection) s.selected = true;
    this.game.tacticalStory?.selected?.(this.selection.filter(s => !before.includes(s)));
    this.game.hudTimer = 0;
  }
  mine() {
    return this.selection.filter(s => !s.dead && s.player === this.player);
  }
  movers() {
    return this.mine().filter(s => s.isMobile && !s.native);
  }
  builder() {
    return this.mine().find(s => s.isPad || (s.structure && !s.craft) || this.padOf(s)) || null;
  }
  padOf(s) {
    if (!s || s.isPad || s.dead || !s.members) return null;
    for (const u of s.members) {
      const site = u && !u.dead && u.padSite;
      if (site && site.mdu === u && u.deployed && !site.structure) return site;
    }
    return null;
  }
  siteOf(b) {
    return b ? (b.isPad ? b.site : this.padOf(b)) : null;
  }
  stop() {
    const m = this.movers();
    if (m.length) this.game.command({ c: 'stop', u: m.map(q => q.id) });
  }
  arm(mode) {
    this.armed = mode;
    this.placing = null;
    this.aiming = null;
  }
  startPlacing(type, dragging = false) {
    this.dragPlace = !!dragging;
    this.placing = type;
    this.placeList = [type];
    this.placeTurn = 0;
    this.placePerm = 0;
    this.armed = null;
    this.game.say('Click the ground near a reinforcement point you hold');
  }
  addPlacing(type) {
    if (!this.placing || this.dragPlace) return this.startPlacing(type, false);
    const have = this.player.reinforcements.filter(t => t === type).length;
    if (this.placeList.filter(t => t === type).length >= have) {
      this.game.audio.play('GUI_Bad_Sound');
      return;
    }
    this.placeList.push(type);
  }
  useAbility(kind, units) {
    const own = units.filter(q => !q.dead && q.player === this.player && q.abilityState(kind));
    if (!own.length) return;
    const def = own[0].abilityState(kind).def;
    if (def.aim !== 'none') {
      this.armed = this.armed === 'ability:' + kind ? null : 'ability:' + kind;
      this.aiming = this.armed ? { kind, units: own } : null;
      this.placing = null;
      return;
    }
    const ready = q => {
      const st = q.abilityState(kind);
      return !st.active && !(st.cooldown > 0);
    };
    const on = !own.some(q => q.abilityState(kind).active) || own.some(ready);
    this.game.command({ c: 'ability', u: own.map(q => q.id), kind, on });
    if (def.toggle && !on) this.game.audio.play(def.sfxOff);
    this.game.hudTimer = 0;
  }
  aimAt(u, g) {
    const a = this.aiming;
    this.aiming = null;
    this.armed = null;
    this.game.hudTimer = 0;
    if (!a) return;
    const live = a.units.filter(q => !q.dead);
    if (!live.length) return;
    const def = live[0].abilityState(a.kind)?.def;
    if (!def) return;
    if (def.aim === 'point' ? !g : !u) return;
    this.game.command({
      c: 'ability',
      u: live.map(q => q.id),
      kind: a.kind,
      ...(def.aim === 'point' ? { x: g.x, y: g.y } : {}),
      ...((def.aim !== 'point' || PICKS_UNIT.has(def.kind)) && u && !u.dead && u.squad
        ? { t: u.squad.id, m: u.squad.members.indexOf(u) }
        : {})
    });
  }

  bombAt(g) {
    this.armed = null;
    this.game.hudTimer = 0;
    if (!g) {
      this.game.say('Not on the map', 'bad');
      this.game.audio.play('GUI_Bad_Sound');
      return;
    }
    this.game.command({ c: 'bomb', x: g.x, y: g.y });
  }
  orbitalWhy(g) {
    return !g ? 'Not on the map' : bombardTargetWhy(this.world, this.me, g.x, g.y);
  }
  orbitalAt(g) {
    const why = this.orbitalWhy(g);
    if (why) {
      this.game.say(why, 'bad');
      this.game.audio.play('GUI_Bad_Sound');
      return;
    }
    this.armed = null;
    this.game.hudTimer = 0;
    const r = this.game.command({ c: 'orbital', x: g.x, y: g.y });
    if (!(r && r.why)) this.game.audio.play(bombardOf(this.world, this.me).ship?.str('SFXEvent_Bombard_Incoming'));
  }
  refreshOrbital() {
    const w = this.world,
      on = this.me >= 0 && bombardEnabled(w, this.me),
      ready = on && canBombard(w, this.me);
    this.pb.hidden = this.pbCharge.hidden = !on || !this.pb.style.width;
    if (!on) {
      if (this.armed === 'orbital') this.armed = null;
      return;
    }
    if (!ready && this.armed === 'orbital') this.armed = null;
    this.pb.classList.toggle('dis', !ready);
    this.pb.classList.toggle('sel', this.armed === 'orbital');
    this.pb.style.filter = ready ? '' : 'brightness(0.5)';
    this.pbCharge.firstChild.style.width = 100 * bombardCharge(w, this.me) + '%';
  }
  enter(host) {
    const m = this.movers();
    if (!m.length) return false;
    this.game.command({ c: 'garrison', u: m.map(q => q.id), t: host.squad.id });
    return true;
  }
  canEnter(host) {
    return !!host && !host.dead && host.slots > 0 && this.movers().some(q => q !== host.squad && canGarrison(this.world, q, host));
  }
  canLeave(host) {
    const m = this.mine();
    return !!host && !host.dead && m.length === 1 && m[0] === host.squad && host.squad.members.some(u => u.holds && u.holds.length);
  }
  leave(host) {
    if (!this.canLeave(host)) return false;
    this.game.command({ c: 'ungarrison', u: [host.squad.id] });
    return true;
  }

  padAt(x, y) {
    const w = this.world;
    let best = -1,
      bestD = Infinity;
    for (let i = 0; i < w.sites.length; i++) {
      const s = w.sites[i];
      if (s.base && !s.pad) continue;
      const owner = s.base ? (s.structure ? -1 : s.side) : s.point.side;
      if (!(owner >= 0 && w.ally(owner, this.me))) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= Math.max(s.base ? 60 : 45, padReach(s)) && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best >= 0 ? this.padPick(best) : null;
  }

  padPick(i) {
    const w = this.world,
      s = w.sites[i];
    if (!s) return null;
    if (!this.pads.has(s)) this.pads.set(s, new PadPick(s, w, i));
    return this.pads.get(s);
  }

  command(cmd) {
    return this.game.command(cmd);
  }

  refresh() {
    const sel = this.selection;
    const lost = s =>
      s.isPad && (s.site.base ? !!s.site.structure : !(s.site.point.side >= 0 && this.world.ally(s.site.point.side, this.me)));
    if (sel.some(s => s.dead || lost(s))) this.select(sel.filter(s => !lost(s)));
    const g = this.game,
      u = this.mouse.inside && !g.menus.open ? g.unitAt(this.mouse.x, this.mouse.y) : null;
    this.hover = u && !u.dead && !u.squad.craft ? u.squad : null;
    {
      const a = this.aiming,
        who =
          a && a.kind === 'TACTICAL_BRIBE' && u && !u.dead && !this.world.ally(u.side, this.me)
            ? a.units.find(q => !q.dead && q.abilityState(a.kind))
            : null;
      const cost = who && !u.structure ? bribeCost(this.world, who, u) : 0;
      if (cost > 0) {
        const tip = (this.bribeTip ||= Object.assign(document.createElement('div'), {
          className: 'bribe-cost',
          innerHTML: '<span class="bribe-word"></span><span class="bribe-sum"></span>'
        }));
        if (!tip.isConnected) document.body.appendChild(tip);
        tip.firstChild.textContent = db.t('TEXT_BRIBE_DISPLAY_TEXT');
        tip.lastChild.textContent = String(Math.trunc(cost));
        tip.style.setProperty('--hud', Math.min(innerWidth / 1024, innerHeight / 768));
        tip.style.setProperty('--plate', iconUrl('I_bribe.tga') ? `url("${iconUrl('I_bribe.tga')}")` : 'none');
        tip.style.left = this.mouse.x + 'px';
        tip.style.top = this.mouse.y + 'px';
        tip.hidden = false;
      } else if (this.bribeTip) this.bribeTip.hidden = true;
    }
    this.bar.refresh();
    if (this.world.beacons) {
      const w = this.world;
      this.beaconView ||= new BeaconView(this.game.scene, 'Land_Model_Name', { colorOf: s => w.colors?.[s] });
      this.beaconView.update(w.beacons.live(w.time).filter(b => w.ally(b.owner, this.me)));
    }
    this.bar.bWeapon.classList.toggle('dis', !canBomb(this.world, this.me));
    this.bar.bWeapon.classList.toggle('sel', this.armed === 'bombing');
    this.refreshOrbital();
    this.fogDirty = true;
  }

  radarGround() {
    const w = this.world,
      t = this.game.terrain,
      n = t.size,
      cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d'),
      img = g.createImageData(n, n),
      d = img.data;
    const R = w.tables && w.tables.radar,
      planet = db.type(this.game.map.planet);
    const set = (R && (R.sets.get((planet ? planet.str('Terrain') : '').toUpperCase()) || R.sets.get('DEFAULT'))) || {};
    const of = k =>
      (k & 256
        ? set.impassable
        : k & 2
          ? set.steep
          : k & 32
            ? set.water
            : k & 128
              ? set.infantryonly
              : k & 4
                ? set.obstacle
                : k & 24
                  ? set.wall
                  : set.clear) || [150, 150, 150];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = (n - 1 - y) * n + x,
          o = (y * n + x) * 4,
          L = t.layers[t.layerIndex[i]];
        const c = L && L.texture ? of(w.kind[i]) : [0, 0, 0];
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return cv;
  }
  radarFog(c) {
    const t = this.game.terrain,
      F = t.fog;
    if (!F || this.game.setup.fog === false || this.game.reveal) return null;
    const m = F.image.width,
      src = F.image.data,
      cv = (this.fogCv ||= document.createElement('canvas'));
    if (cv.width !== m) {
      cv.width = cv.height = m;
      this.fogImg = null;
    }
    const g = cv.getContext('2d'),
      img = (this.fogImg ||= g.createImageData(m, m)),
      d = img.data;
    for (let y = 0; y < m; y++)
      for (let x = 0; x < m; x++) {
        const v = src[(m - 1 - y) * m + x],
          o = (y * m + x) * 4,
          lit = v >= 150 ? (v - 150) / 105 : 0;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = Math.round((c[3] ?? 255) * (1 - lit));
      }
    g.putImageData(img, 0, 0);
    return cv;
  }

  radarOn(side) {
    const w = this.world;
    for (const u of w.units) {
      if (u.dead || u.side < 0 || !w.ally(u.side, side)) continue;
      const abs = (u.type.radarAbs ??= u.type.sub('Abilities').flatMap(a => a.all('Enable_Radar_Ability')));
      for (const a of abs)
        if (
          (u.side === side || /^(yes|true)$/i.test(a.val('Affects_All_Allies', 'No'))) &&
          /^(yes|true)$/i.test(a.val('Initially_Enabled', 'Yes'))
        )
          return true;
    }
    return false;
  }

  drawRadar() {
    const cv = $('minimap'),
      g = cv.getContext('2d'),
      w = this.world,
      W = cv.width,
      H = cv.height,
      me = this.me,
      game = this.game;
    this.ground ||= this.radarGround();
    const R = (this.radar ||= new Radar()),
      S = R.settings;
    const side = (game.terrain.size - 1) * CELL,
      lo = game.map.playMin,
      hi = game.map.playMax,
      spanX = hi[0] - lo[0],
      spanY = hi[1] - lo[1],
      X = x => ((x - lo[0]) / spanX) * W,
      Y = y => (1 - (y - lo[1]) / spanY) * H;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.ground, lo[0] / CELL, (side - hi[1]) / CELL, spanX / CELL, spanY / CELL, 0, 0, W, H);
    {
      if (this.fogDirty || this.fogShown === undefined) {
        this.fogDirty = false;
        this.fogShown = this.radarFog((S && S.landFow) || (w.tables && w.tables.radar.fog) || [10, 10, 10, 100]);
      }
      const fog = this.fogShown,
        F = 2 * CELL;
      if (fog && !this.seeAll) g.drawImage(fog, lo[0] / F, fog.height - 1 - hi[1] / F, spanX / F, spanY / F, 0, 0, W, H);
    }
    if (R.landBackdrop) g.drawImage(R.grid(W, H, R.landBackdrop), 0, 0);
    const tone = s => {
      const c = s >= 0 && w.colors?.[s];
      return c ? R.tone([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]) : R.tone([127, 149, 171]);
    };
    const radar = this.seeAll || this.radarOn(me),
      done = new Set();
    const draw = (t, x, y, heading, s) => {
      const c = tone(s);
      if (!t.icon) {
        g.fillStyle = c.rgb;
        g.fillRect(Math.round(X(x) - t.blip / 2), Math.round(Y(y) - t.blip / 2), t.blip, t.blip);
        return;
      }
      let img = c.icons.get(t.icon);
      if (!img && (img = R.icon(t.icon, c.c))) c.icons.set(t.icon, img);
      if (!img) return;
      const hw = (t.sx * W) / 2,
        hh = (t.sy * H) / 2,
        a = (t.facing ? -(heading - Math.PI / 2) : 0) + (t.turn ? Math.PI / 2 : 0);
      if (a) {
        g.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), X(x), Y(y));
        g.drawImage(img, -hw, -hh, hw * 2, hh * 2);
        g.setTransform(1, 0, 0, 1, 0, 0);
      } else g.drawImage(img, X(x) - hw, Y(y) - hh, hw * 2, hh * 2);
    };
    if (S)
      for (const u of w.units) {
        if (u.dead || u.inside) continue;
        const q = u.squad,
          many = q && q.members.length > 1;
        if (many && done.has(q)) continue;
        const team = many && q.type && R.of(q.type).show ? R.of(q.type) : null,
          t = team || R.of(u.type);
        if (!t.show) continue;
        const own = u.side === me || (u.side >= 0 && w.ally(u.side, me)),
          enemy = !own && u.side >= 0;
        if (enemy && (!t.enemy || u.cloaked || (!radar && !u.captures))) continue;
        if (!own && !this.seeAll && u.seen === false && !t.fogged) continue;
        if (many) done.add(q);
        draw(t, u.x, u.y, u.heading || 0, u.side);
      }
    if (S)
      for (const p of w.points) {
        const t = p.type && R.of(p.type);
        if (t && t.show) draw(t, p.x, p.y, 0, p.side);
      }
    if (S && w.beacons)
      R.drawBeacons(
        g,
        X,
        Y,
        W,
        H,
        w.beacons.live(w.time).filter(b => w.ally(b.owner, me)),
        tone
      );
    if (S) R.drawEvents(g, X, Y, W, H, w.time);
    R.drawStoryBlips(g, X, Y, w.storyBlips, w.time);
    const v = game.view,
      r = Math.max(8, ((v.dist * 0.55) / spanX) * W);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.strokeRect(X(v.x) - r, Y(v.y) - r * 0.75, r * 2, r * 1.5);
  }
}

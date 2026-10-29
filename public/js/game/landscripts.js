import { db } from '../gamedata.js';
import { ScriptHost } from './scripts.js';
import { costOf, timeOf, isUpgrade, buildsFor } from './land.js';
import { Mind, target } from './landbrain.js';
import { FLAG } from './landgoals.js';
import { bombingRun, orbitalBombard, garrison, ungarrison, canGarrison } from './landbase.js';
import { bribeCost, setSide as changeSide } from './landabilities.js';
import { simRandom } from './simrandom.js';
import { SPACE_LAYER } from './tacticalcinematics.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const power = q => q.members.reduce((a, u) => a + Math.max(1, u.type.num('AI_Combat_Power', 30)) * Math.max(0, u.health / (u.maxHealth || 1)), 0);

const later = (q, go) => { if (!q || !q.forming || q.members.length) return false; (q.scriptQueue ||= []).push(go); return true; };

function march(w, q, x, y, fight = true) {
  if (later(q, () => march(w, q, x, y, fight))) return;
  const need = Math.max(1, ...q.members.map(u => u.need || 1)), o = w.isOpen(x, y, need) ? { x, y } : w.nearestOpen(x, y, need) || w.nearestOpen(x, y);
  if (!o) return;
  q.foe = null; q.post = null; q.legs = null;
  w.order(q, o.x, o.y);
  q.march = fight ? { x: o.x, y: o.y } : null;
}

class PointThing {
  constructor(world, pt) { this.world = world; this.point = pt; this.id = 'pt' + (pt.uid ??= (world.thingSerial = (world.thingSerial || 0) + 1)); this.isPoint = true; this.isStructure = true; this.members = []; this.fighters = []; this.abilities = []; this.hardpoints = []; }
  get type() { return this.point.type; }
  get x() { return this.point.x; }
  get y() { return this.point.y; }
  get z() { return this.point.z||0; }
  get dead() { return false; }
  get player() { const w = this.world, s = this.point.side; return w.sidePlayers[s >= 0 ? s : w.wild]; }
  get health() { return 1; }
  get healthFrac() { return 1; }
  cats() { return this.point.type.categories(); }
}

class SiteThing {
  constructor(world, site) { this.world = world; this.site = site; this.id = 'site' + (site.uid ??= (world.thingSerial = (world.thingSerial || 0) + 1)); this.isPad = true; this.isSite = true; this.isStructure = true; this.members = []; this.fighters = []; this.abilities = []; this.hardpoints = []; }
  get type() { return this.site.base ? this.site.pad : this.site.point.type; }
  get x() { return this.site.x; }
  get y() { return this.site.y; }
  get dead() { return false; }
  get side() { return this.site.base ? this.site.side : this.site.point.side; }
  get player() { const w = this.world, s = this.side; return w.sidePlayers[s >= 0 ? s : w.wild]; }
  get padOwner() { return this.player; }
  get padChild() { return this.site.building ? { construction: true } : this.site.structure ? { construction: false } : null; }
  padContents() { const s = this.site.structure; return s && s.squad ? s.squad : null; }
  get health() { return 1; }
  get healthFrac() { return 1; }
  cats() { return this.type.categories(); }
}

class LandView {
  constructor(game) {
    this.game = game; this.w = game.world;
    this.fields = []; this.onEvent = () => {};
    this.points = new Map();
  }
  get audio() { return this.game.audio || { play() {} }; }
  get retreat() { return this.game.landRetreat; }
  retreatKey(player) { return player.id; }
  get time() { return this.w.time; }
  get aiSuspended(){return !!this.w.aiSuspended;}
  get fog(){return this.game.setup.fog!==false;}
  set fog(on){this.game.setup.fog=on;this.game.hudTimer=0;}
  canSee(player,object){
    const w=this.w,side=player.id,unit=object.members?.[0]||object;
    if(!unit||unit.dead)return false;
    if(!this.fog||w.ally(unit.side,side)||w.revealUntil[side]>w.time)return true;
    if(unit.cloaked)return false;
    const within=(x,y,r,z)=>Math.hypot(unit.x-x,unit.y-y)<=r&&(unit.flies||w.sightLine(x,y,z,unit));
    for(const reveal of w.reveals)if(reveal.team===player.team&&reveal.until>w.time&&!(reveal.by&&(reveal.by.state==='over'||reveal.by.env!==reveal.env))&&within(reveal.x,reveal.y,reveal.r,1e6))return true;
    for(const eye of w.units)if(!eye.dead&&w.ally(eye.side,side)&&within(eye.x,eye.y,eye.type.num('Land_FOW_Reveal_Range',150)*(eye.structure?1:w.sightMod(eye)),eye.z+Math.max(8,eye.aimZ*1.5)))return true;
    for(const point of w.points)if(point.side>=0&&w.ally(point.side,side)&&within(point.x,point.y,point.type.num('Land_FOW_Reveal_Range',250),point.z+30))return true;
    for(const ping of w.pings)if(w.ally(ping.side,side)&&within(ping.x,ping.y,ping.r,1e6))return true;
    return false;
  }
  recountPop(){}
  removeUnit(q){
    if(q.mapMarker){q.dead=true;if(q.prop){this.w.scene.remove(q.prop.grp);for(const k of q.prop.cells||[])this.w.open[k]=1;if(q.prop.cells?.length)this.w.groundChanged(q.prop.cells);q.prop.cells=[];}return;}
    q.scriptDespawned=true;q.forming=false;
    for(const u of q.members||[]){u.dead=u.gone=true;u.health=0;u.target=null;this.w.unstamp(u);if(u.holder)this.w.scene.remove(u.holder);}
    if(q.members)q.members.length=0;
    this.at=undefined;
  }
  mapObjectsAt(index){return this.w.mapObjects?.get(index)?.map(o=>o.point?this.point(o.point):o);}
  get parentModeDeaths(){return this.w.parentModeDeaths ||= new Set();}
  get reveals() { return this.w.reveals; }
  get tacticalSessions() { return this.w.tacticalSessions; }
  refresh() { this.at = undefined; }
  get units() {
    if (this.at !== this.w.time) { this.at = this.w.time; this.list = this.w.squads.filter(q => q.members.length && !q.arriving && q.side >= 0); }
    return this.list;
  }
  get players() { return this.game.factions.map((f, i) => this.w.sidePlayers[i]); }
  get neutral() { return this.w.sidePlayers[this.w.wild]; }
  get teams() { return [...new Set(this.players.map(p => p.team))]; }
  selectables() { return this.units; }
  spawn() { return null; }
  point(pt) { let e = this.points.get(pt); if (!e) this.points.set(pt, (e = new PointThing(this.w, pt))); return e; }
  site(s) { let e = this.points.get(s); if (!e) this.points.set(s, (e = new SiteThing(this.w, s))); return e; }
  openPads(p) { return this.w.sites.filter(s => this.w.siteOptions(s, p.id).length).map(s => this.site(s)); }
  bombingRun(p, x, y) { return bombingRun(this.w, p.id, x, y); }
  orbitalBombard(p, x, y) { return orbitalBombard(this.w, p.id, x, y); }
  landPool(p) {
    const rd = this.w.ready[p.id];
    if (!rd) return null;
    const all = (this.pools ||= []);
    let E = all[p.id] || (all[p.id] = []);
    if (E.length !== rd.length || E.some((e, i) => e.type !== rd[i])) {
      const old = E.slice();
      E = all[p.id] = rd.map(t => { const i = old.findIndex(e => e.type === t); return i >= 0 ? old.splice(i, 1)[0] : { type: t, owner: null, since: this.w.time }; });
    }
    return E;
  }
  landRoom(p) { return this.w.popCap(p.id) - this.w.popUsed(p.id); }
  landEntry(p, entry, at, onOut) {
    const w = this.w, side = p.id, t = entry.type, rd = w.ready[side];
    if (w.reinforcementsOff?.has(String(w.factions?.[side] || '').toUpperCase())) return;
    const pts = w.points.filter(pt => pt.reinforce && pt.side >= 0 && w.ally(pt.side, side)).sort((a, b) => dist(a, at) - dist(b, at));
    for (const pt of pts) {
      const o = w.nearestOpen(pt.x + 40 + simRandom() * 60, pt.y - 40 + simRandom() * 80);
      if (!o || w.cantReinforce(side, t.name, o.x, o.y)) continue;
      const k = rd.indexOf(t);
      if (k >= 0) rd.splice(k, 1);
      const E = this.pools && this.pools[side];
      if (E) { const j = E.indexOf(entry); if (j >= 0) E.splice(j, 1); }
      Promise.resolve(w.reinforce(side, t.name, o.x, o.y, Math.atan2(at.y - o.y, at.x - o.x))).then(r => { if (r && r.typeName) r.onOut = onOut; else if (r) onOut(r); }, () => {});
      return true;
    }
    return false;
  }
  terrainEffect(t) {
    const T = this.w.tables && this.w.tables.terrainEff;
    if (!T || !T.size || !t) return 1;
    const planet = db.type(this.game.map.planet), row = planet && T.get(planet.str('Terrain').trim().toUpperCase());
    if (!row) return 1;
    const m = t.has('Company_Units') ? db.type(t.list('Company_Units')[0]) : t, mc = m ? m.str('MovementClass').trim().toUpperCase() : '';
    return row.get(mc) ?? 1;
  }
  costOf(t) { return costOf(t); }
  buildersOf(p) { return this.units.filter(q => q.structure && this.w.ally(q.side, p.id) && buildsFor(q.members[0].type, this.game.factions[p.id]).length); }
  buildOptions(b, p) { if (b.isSite) return this.w.siteOptions(b.site, p.id); return b.structure && b.members[0] ? buildsFor(b.members[0].type, this.game.factions[p.id]).filter(t => t.has('Company_Units') || isUpgrade(t)) : []; }
  cantBuild(b, t, p) { if (b.isSite) return !this.w.siteOptions(b.site, p.id).includes(t) ? 'Not available' : this.w.credits[p.id] < costOf(t) ? 'Not enough credits' : null; return this.w.cantBuy(b.members[0], t, p.id); }
  startBuild(b, t, p) { return b.isSite ? this.w.startSite(b.site, t, p.id) : this.w.buy(b.members[0], t, p.id); }
  ownedCount() { return 0; }
  queuedCount(p, t) { const q = this.w.queues[p.id]; return q ? [...q.units, ...q.upgrades].filter(i => i.type === t).length : 0; }
  queuedPop(p) { return this.w.popPlanned ? this.w.popPlanned(p.id) : 0; }
}

class Commander {
  constructor(scripts, side) {
    this.scripts = scripts; this.side = side; this.world = scripts.view;
    this.tried = new Map(); this.mind = null; this.places = []; this.enemies = [];
    this.targetOf = q => target.unit(q.members ? q.members[0] : q);
  }
  get player() { return this.scripts.game.world.sidePlayers[this.side]; }
  get difficulty() { const p = this.scripts.game.players[this.side]; return (p && p.difficulty) || 'normal'; }
  mine() { const w = this.scripts.game.world; return w.squads.filter(q => q.side === this.side && q.members.length && !q.structure && !q.arriving && !q.native && !q.noAI && !q.members[0].inside && !q.members[0].flies); }
  value(q) { return power(q); }
  strengthAt(enemies, at, r = 500) { let s = 0; for (const q of enemies) if (!q.structure && q.members.length && dist(q, at) < r) s += power(q); return s; }
  get waveSize() { return this.mine().reduce((a, q) => a + power(q), 0) * 0.6; }
  look(mind, enemies) {
    const w = this.scripts.game.world;
    this.mind = mind; this.enemies = enemies;
    const zones = w.map && w.map.zones;
    this.places = zones && zones.length ? zones.map(z => z.target || (z.target = target.zone(z))) : w.points.map(pt => target.place(pt.x, pt.y));
  }
  findable(kinds) {
    const goals = this.scripts.game.goals;
    if (!goals || !goals.findable) return null;
    let bits = 0;
    for (const k of String(kinds || '').toUpperCase().split('|').map(s => s.trim())) bits |= k === 'ENEMY' ? FLAG.ENEMY_UNIT | FLAG.ENEMY_STRUCTURE : k === 'FRIENDLY' ? FLAG.FRIENDLY_UNIT | FLAG.FRIENDLY_STRUCTURE : FLAG[k] || 0;
    const zones = this.scripts.game.world.map?.zones;
    const out = goals.findable(this.side, bits).map(t => ({ t, thing: t.zone ? null : t.unit ? this.scripts.thing(t.unit) : goals.thingOf(t) }));
    if (bits & FLAG.TACTICAL_LOCATION && !(zones && zones.length)) for (const t of this.places) out.push({ t, thing: null });
    return out;
  }
  plan(goal, thing = null, most = 1) {
    const P = this.scripts.host.plans;
    if (!P.ready || !P.can(goal)) return false;
    if (P.running(this, goal, thing) || P.count(this, goal) >= most || P.count(this) >= 12) return true;
    const key = goal + '|' + (thing ? thing.id ?? thing.key ?? Math.round(thing.x) + ',' + Math.round(thing.y) : ''), t = this.world.time;
    if (t - (this.tried.get(key) ?? -99) < 8) return true;
    this.tried.set(key, t);
    const inst = P.start(this, goal, thing);
    if (inst) inst.tryKey = key;
    return true;
  }
}

export class LandScripts {
  static async create(game) {
    const s = new LandScripts(game);
    s.host = await ScriptHost.create({
      land: true, world: s.view, map: game.map, setup: game.setup, renderer: null,
      get human() { return game.world.sidePlayers[game.setup.net ? Math.max(0, game.players.findIndex(p => p.human)) : game.me ?? 0]; },
      cmd: s.cmd(), perceive: (p, name, e) => s.perceive(p, name, e),
      spawnNow: (t, p, at) => s.spawnNow(t, p, at),
      targetThing: t => (t.unit && t.unit.squad ? t.unit.squad : t.site ? s.view.site(t.site) : t.point ? s.view.point(t.point) : null),
    }).catch(e => { console.warn('land scripts', e); return null; });
    if (!s.host) return null;
    s.view.scripts = s.host;
    game.world.scriptHost = s.host;
    const w = game.world, before = w.onDeath;
    w.onDeath = u => {
      if (before) before(u);
      const q = u.squad;
      if (q && q.side >= 0 && w.companyLost(u)) s.view.onEvent('killed', { unit: q, killer: u.hitBy !== undefined ? w.sidePlayers[u.hitBy] : null });
    };
    return s;
  }

  constructor(game) {
    this.game = game; this.view = new LandView(game);
    this.commanders = game.factions.map((f, side) => new Commander(this, side));
  }

  cmd() {
    const w = this.game.world;
    const squads = us => us.filter(q => q.members && (q.members.length || q.forming) && !q.structure);
    return {
      move: (us, x, y, attack) => { const l = squads(us); if (attack && l.length > 1) { for (const [q, p] of w.places(l, x, y)) march(w, q, p.x, p.y, true); } else for (const q of l) march(w, q, x, y, !!attack); },
      attack: (us, t) => { const l = squads(us).filter(q => !later(q, () => this.cmd().attack([q], t))); if (t.members && t.members.length) { for (const q of l) q.march = q.post = null; if (l.length > 1) w.attackGroup(l, t); else for (const q of l) w.attack(q, t); } else for (const q of l) march(w, q, t.x, t.y, true); },
      guard: (us, t) => { for (const q of squads(us)) { march(w, q, t.x + 25, t.y, true); } },
      stop: us => { for (const q of squads(us)) if (q.members.length) w.stop(q); },
      canGarrison: (q, t) => !!(q && q.members && t && t.members && t.members[0] && canGarrison(w, q, t.members[0])),
      garrison: (q, t) => { if (q && q.members && t && t.members && t.members[0]) garrison(w, q, t.members[0]); },
      leaveGarrison: q => { for (const u of (q && q.members) || []) if (u.holds && u.holds.length) ungarrison(w, u); const h = q && q.members && q.members.find(u => u.inside)?.inside; if (h && h.holds) ungarrison(w, h, null, null, q); },
      inGarrison: q => !!(q && q.members && q.members[0] && q.members[0].inside),
      garrisoned: q => { const h = q && q.members && q.members[0]; return h && h.holds ? h.holds.filter(x => x.members.some(u => u.inside === h)) : []; },
      hide: (q, on) => { q.scriptHidden=on; for (const u of q.members || []) { u.scriptHidden = on; if (u.holder) u.holder.visible = !on && !u.inside; } },
      face:(q,p)=>{q.scriptHeading=Math.atan2(p.y-q.y,p.x-q.x);if(q.box)q.box=undefined;for(const u of q.members||[]){u.heading=Math.atan2(p.y-u.y,p.x-u.x);u.holder.rotation.z=u.heading+Math.PI/2;}},
      owner: (q, p) => { const side = w.sidePlayers.indexOf(p); if (side < 0 || !q.members) return; changeSide(w, q, side); q.native = false; },
      selectable: (q, on) => { q.selectable = on; },
      selectFor: (p, q) => { const g = this.game; if (q.members && g.ui && w.sidePlayers.indexOf(p) === g.me && q.side === g.me) g.ui.select([q], true); },
      invulnerable: (q, on) => { for (const u of q.members || []) u.invulnUntil = on ? Infinity : 0; },
      teleport: (q, x, y, z) => {
        if(q.mapMarker){q.x=x;q.y=y;if(z!==undefined)q.z=z;return;}
        q.scriptPosition={x,y,z};
        const off = !(x >= 0 && y >= 0 && x <= (w.n - 1) * 20 && y <= (w.n - 1) * 20);
        const space = z !== undefined && z >= SPACE_LAYER / 2;
        for (const u of q.members || []) {
          u.path = []; u.target = null;
          if (space) { if (u.inside && u.inside.away) u.inside = null; u.x = x; u.y = y; u.z = z; u.scriptZ = z; }
          else if (off) { u.inside = { x, y, z: z??0, aimZ: 0, away: true }; u.gunner = false; if (u.holder) u.holder.visible = false; }
          else { const o = w.isOpen(x, y, u.need || 1) ? { x, y } : w.nearestOpen(x, y, u.need || 1) || w.nearestOpen(x, y) || { x, y }; if (u.inside && u.inside.away) u.inside = null; u.x = o.x; u.y = o.y; if(z!==undefined&&u.flies){u.z=z;u.scriptZ=z;} }
        }
        q.foe = null; q.march = null; q.post = null; if (q.box) q.box = undefined;
      },
      damage: (q, n) => { for (const u of (q.members || []).slice()) { if (u.dead) continue; if (n >= u.health + (u.shield || 0)) { u.invulnUntil = 0; if (u.inside && u.inside.away) u.inside = null; w.hurt(u, u.health + (u.shield || 0) + 1, null); } else w.hurt(u, n, null); } },
      animate: (q, kind, loop, index) => { if (q.mapMarker && q.prop) { this.game.playPropAnimation?.(q, kind, loop, index); return; } q.scriptAnimation=kind; for (const u of q.members || []) if (!u.dead && w.playOnce) w.playOnce(u, kind); },
      sell: q => { const u = q.members && q.members[0]; if (u && q.structure && w.sell) w.sell(u); },
      build: (e, type, check) => {
        const site = e.isSite ? e.site : (e.members || []).map(u => u && u.padSite).find(Boolean);
        if (!site || site.structure || site.building || !type) return false;
        const side = e.isSite ? (site.base ? site.side : site.point.side) : e.side;
        if (check && !w.siteOptions(site, side).includes(type)) return false;
        const secs = timeOf(type) * (w.mods[side] ? w.mods[side].build : 1);
        site.building = { uc: type, type, side, left: secs, total: secs };
        return true;
      },
      padContents: e => { const site = e.isSite ? e.site : (e.members || []).map(u => u && u.padSite).find(Boolean); const s = site && site.structure; return s && s.squad ? s.squad : null; },
      ability: (q, kind, on, tgt) => {
        if (later(q, () => this.cmd().ability(q, kind, on, tgt))) return;
        const st = q.abilityState && q.abilityState(kind);
        if (st && !!st.active !== !!on && !(st.cooldown > 0)) {
          const aimed = st.def.aim === 'enemy' || st.def.aim === 'friend', at = aimed && tgt ? (tgt.unit ? tgt : tgt.members ? { unit: tgt.members.find(u => !u.dead) } : tgt.squad ? { unit: tgt } : tgt) : tgt;
          w.useAbility(q, kind, at && at.members ? at : at || null);
        }
      },
      bribeCost: (q, type) => bribeCost(w, q, { type }),
    };
  }

  spawnNow(type, player, at) {
    const w = this.game.world, o = w.isOpen(at.x, at.y) ? at : w.nearestOpen(at.x, at.y) || at;
    w.spawning = null;
    w.spawn(type.name, o.x, o.y, 0, player.id).catch(e => console.warn('script spawn', type.name, e));
    const q=w.spawning?.[0];if(q)q.scriptPosition={x:o.x,y:o.y,z:at.z,preserveFormation:true};return q||null;
  }

  perceive(p, name, e) {
    const c = p && this.commanders[p.id], mind = c && (c.mind || this.mindOf(p.id));
    if (!mind) return 0;
    return mind.fn(name, this.mindTarget(e));
  }
  mindOf(side) { const g = this.game, brain = g.brains[side]; return brain ? new Mind(brain, g.world, side, { difficulty: g.players[side].difficulty || 'Normal' }) : null; }
  mindTarget(e) { return !e ? null : e.isSite ? target.site(e.site, e.type) : e.isPoint ? target.point(e.point) : e.members && e.members[0] ? target.unit(e.members[0]) : e.x !== undefined ? target.place(e.x, e.y) : null; }

  thing(x) { return !x ? null : x.squad ? x.squad : x.members ? x : x.type && x.side !== undefined && x.x !== undefined && !x.squad ? this.view.point(x) : { x: x.x, y: x.y }; }

  losses() { const l = this.host.losses(); return l ? new Map([...l].map(([team, m]) => [team.id, m])) : null; }

  update(dt) { this.host.update(dt); }
}

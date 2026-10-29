import { db } from '../gamedata.js';

export class SpecialWeapon {
  constructor(world, type, player, x, y, z) {
    this.world = world;
    this.type = type;
    this.player = player;
    this.x = x;
    this.y = y;
    this.z = z;
    this.heading = 0;
    this.speed = 0;
    this.isSpecialWeapon = true;
    this.dead = false;
    this.order = { kind: 'idle' };
    this.bonus = { damage: 1, defense: 1, speed: 1 };
    this.mods = { damageDealt: 1, speed: 1 };
    this.firedAt = 0;
    this.readyAt = 0;
    this.left = 0;
    this.nextAt = 0;
    this.target = null;
    this.index = type.num('Special_Weapon_Index', 0);
    this.action = type.num('Special_Weapon_Target_Action_Index', 0);
    this.valid = type
      .str('Special_Weapon_Valid_Targets')
      .split('|')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
  }

  get name() {
    return this.type.name;
  }
  get charge() {
    const w = this.world;
    return this.readyAt === 0 ? 1 : Math.max(0, Math.min(1, (w.time - this.firedAt) / Math.max(1e-6, this.readyAt - this.firedAt)));
  }
  setOrder() {}

  enabled() {
    return !this.world.skirmish || useUpgrades(this.player).length > 0;
  }

  canTarget(t) {
    if (!t || t.dead || t.isSpecialWeapon || t.isPad || !t.player) return false;
    if (t.player.id >= 0 && t.player.team === this.player.team) return false;
    const c = t.isSquad ? (t.fighters[0] ? t.fighters[0].type.categories() : new Set()) : t.type.categories();
    return !this.valid.length || this.valid.some(k => c.has(k));
  }

  fire(t) {
    const w = this.world;
    if (this.charge < 0.99) return 'Not ready';
    if (!this.enabled()) return 'Purchase a special weapon upgrade';
    if (!this.canTarget(t)) return 'Not a valid target';
    const proj = db.type(this.type.list('Projectile_Types')[0] || '');
    if (!proj) return 'No projectile';
    this.proj = proj;
    this.target = t;
    this.left = Math.max(1, this.type.num('Projectile_Fire_Pulse_Count', 1));
    this.delay = this.type.num('Projectile_Fire_Pulse_Delay_Seconds', 0);
    this.nextAt = w.time;
    this.firedAt = w.time;
    this.readyAt = w.time + Math.max(0.1, this.type.num('Projectile_Fire_Recharge_Seconds', 30));
    if (w.skirmish) for (const u of useUpgrades(this.player)) this.player.upgrades.delete(u);
    this.pulse();
    this.announce('Firing');
    w.onEvent('specialWeaponFired', { weapon: this, target: t });
    return null;
  }

  pulse() {
    const w = this.world,
      t = this.target;
    while (this.left > 0 && w.time >= this.nextAt) {
      if (!t || t.dead || (t.isSquad && !t.fighters.length)) {
        this.left = 0;
        break;
      }
      const aim = t.isSquad ? t.fighters[0] : t;
      w.launch(this.proj, this, aim, null, this.x, this.y, this.z, this.proj.str('Damage_Type'), new Map());
      const sfx = this.type.str('SFXEvent_Fire');
      if (sfx) w.audio.play(sfx, this.x, this.y);
      this.left--;
      this.nextAt += this.delay;
    }
  }

  announce(what) {
    const w = this.world,
      h = w.audio && w.audio.human;
    if (!h || !h.faction) return false;
    const mine = h.team === this.player.team;
    const list = h.faction.raw((mine ? 'SFXEvent_HUD_Special_Weapon_' : 'SFXEvent_HUD_Enemy_Special_Weapon_') + what) || [];
    const ev = String(list[this.action] || '').trim();
    return ev ? !!w.audio.play(ev) : false;
  }

  update() {
    const w = this.world;
    if (this.left > 0) this.pulse();
    if (this.readyAt && w.time >= this.readyAt && this.enabled()) {
      this.readyAt = 0;
      if (!this.announce('Ready')) w.audio.playFor(this.player, this.type.str('SFXEvent_Special_Weapon_Ready'));
      w.onEvent('specialWeaponOnline', { weapon: this });
    }
  }
}

export function useUpgrades(p) {
  const out = [];
  for (const n of p.upgrades) {
    const t = db.type(n);
    if (t && (t.bool('Is_Skirmish_Tactical_Super_Weapon') || t.bool('Enable_Special_Weapons'))) out.push(n);
  }
  return out;
}

const weaponSource = mapObjects => {
  const src = mapObjects.find(o => o.type && o.type.behaviors().has('DUMMY_SPECIAL_WEAPON_SOURCE'));
  return src ? { x: src.pos[0], y: src.pos[1], z: src.pos[2] || 0 } : { x: 0, y: 0, z: 0 };
};

export function placeCampaignSpecialWeapons(world, mapObjects, campaign) {
  const names = campaign.planetWeapons || [];
  if (!names.length || !campaign.planetOwner) return;
  const players = world.players.filter(
    p => p.id >= 0 && p.faction && String(p.factionName).toUpperCase() === String(campaign.planetOwner).toUpperCase()
  );
  const owner = players.find(p => p.human) || players[0];
  if (!owner) return;
  const at = weaponSource(mapObjects);
  for (const name of names) {
    const t = db.type(name);
    if (t && t.bool('Is_Special_Weapon_In_Space') && t.num('Special_Weapon_Index', -1) >= 0)
      world.specialWeapons.push(new SpecialWeapon(world, t, owner, at.x, at.y, at.z));
  }
}

export function placeSpecialWeapons(world, mapObjects) {
  const at = weaponSource(mapObjects);
  world.specialWeapons = [];
  for (const p of world.players) {
    if (p.id < 0 || !p.faction) continue;
    for (const key of ['Standalone_Space_Maps_Special_Weapon_A', 'Standalone_Space_Maps_Special_Weapon_B']) {
      const t = db.type(p.faction.str(key).trim());
      if (t && t.bool('Is_Special_Weapon_In_Space')) world.specialWeapons.push(new SpecialWeapon(world, t, p, at.x, at.y, at.z));
    }
  }
}

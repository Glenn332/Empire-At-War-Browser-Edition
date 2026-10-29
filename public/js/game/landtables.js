import { fetchText } from '../vfs.js';
import { parseXML } from '../xml.js';

let tables = null;
export const TERRAIN = {
  CLEAR: 1,
  STEEP: 2,
  OBSTACLE: 4,
  REBELWALL: 8,
  EMPIREWALL: 16,
  WATER: 32,
  SHIELD: 64,
  INFANTRYONLY: 128,
  IMPASSABLE: 256
};

export async function loadLandTables() {
  if (tables) return tables;
  const [sf, wm, ws, da, td, mc, wa, le, dt, am, rm, te] = await Promise.all(
    [
      'SurfaceFX.xml',
      'WeatherModifiers.xml',
      'WeatherScenarios.xml',
      'DifficultyAdjustments.xml',
      'TerrainDecalFX.xml',
      'MovementClassTypeDefs.xml',
      'WeatherAudio.xml',
      'LightningEffectTypes.xml',
      'DynamicTrackFX.xml',
      'AnimationSFXMaps.txt',
      'RadarMap.xml',
      'AITerrainEffectiveness.xml'
    ].map(f => fetchText('Data/XML/' + f).catch(() => null))
  );
  const top = src => (src ? parseXML(src).children.filter(c => c.children.length)[0] : null);
  const t = { surface: new Map(), weather: new Map(), scenarios: new Map() };
  for (const g of top(sf)?.children || []) {
    const kinds = new Map();
    const named = (k, tag) => {
      const v = k.val(tag);
      return v && !/^none$/i.test(v) ? v : '';
    };
    for (const k of g.children)
      kinds.set((k.attrs.name || '').toLowerCase(), {
        decal: named(k, 'Decal_Name'),
        particle: named(k, 'Particle_Name'),
        sound: named(k, 'SoundFX_Name'),
        track: named(k, 'Dynamic_Track_Name'),
        speed: k.num('Speed_Mod', 0),
        defense: k.num('Defense_Mod', 0),
        sight: k.num('FOW_Reveal_Range_Mod', 0),
        range: k.num('Fire_Range_Mod', 0),
        damage: k.num('Terrain_Damage', 0)
      });
    kinds.bones = [
      g.val('Dynamic_Track_Left_Bone') || g.children.map(k => k.val('Dynamic_Track_Left_Bone')).find(Boolean),
      g.val('Dynamic_Track_Right_Bone') || g.children.map(k => k.val('Dynamic_Track_Right_Bone')).find(Boolean)
    ].filter(Boolean);
    t.surface.set((g.attrs.name || '').toUpperCase(), kinds);
  }
  for (const m of top(wm)?.children || []) {
    const e = { sight: new Map(), speed: new Map(), aim: new Map(), objective: '' };
    for (const k of m.children) {
      if (/^Objective_Text$/i.test(k.tag)) {
        e.objective = k.text.trim();
        continue;
      }
      const v = parseFloat(k.text);
      if (!Number.isFinite(v) || !k.attrs.name) continue;
      if (/^Sight_Range/i.test(k.tag)) e.sight.set(k.attrs.name.toUpperCase(), v);
      else if (/^Speed/i.test(k.tag)) e.speed.set(k.attrs.name.toUpperCase(), v);
      else if (/^Weapon_Accuracy/i.test(k.tag)) e.aim.set(k.attrs.name.toUpperCase(), v);
    }
    t.weather.set((m.attrs.name || '').toLowerCase(), e);
  }
  for (const s of top(ws)?.children || []) {
    t.scenarios.set((s.attrs.name || '').toUpperCase(), {
      emitter: s.attrs.emitter_name || '',
      phases: s.children
        .filter(p => /phase/i.test(p.tag))
        .map(p => ({
          name: (p.attrs.name || 'clear').toLowerCase(),
          strength: p.num('Emitter_Intensity', 0),
          seconds: Math.max(1, p.num('Duration', 20)),
          ease: Math.max(0.1, p.num('Ease_Out_Duration', 5)),
          lightning: p.num('Lightning_Intensity', 0),
          fog: p.num('Fog_Plane_Interpolation_Alpha', 0)
        }))
    });
  }
  t.decals = new Map();
  const nums = s =>
    String(s || '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);
  for (const d of top(td)?.children || []) {
    const sc = nums(d.val('Scale')),
      sl = nums(d.val('UV_Slot')),
      slots = [];
    for (let i = 0; i + 1 < sl.length; i += 2) slots.push([sl[i], sl[i + 1]]);
    t.decals.set((d.attrs.Name || '').toUpperCase(), {
      bump: /BUMP/i.test(d.val('Render_Mode')),
      additive: /ADDITIVE/i.test(d.val('Render_Mode')),
      strength: d.num('Intensity', 0.5),
      w: sc[0] || 20,
      h: sc[1] || sc[0] || 20,
      slots: slots.length ? slots : [[0, 0]],
      span: d.num('Slot_Scale', 1),
      seconds: d.num('Fadeout_Time', 20),
      keeps: /^(yes|true)$/i.test(d.val('Permanent')),
      spin: /^(yes|true)$/i.test(d.val('Random_Rotate')),
      vary: d.num('Random_Size_Offset', 0)
    });
  }
  t.difficulty = new Map();
  for (const d of top(da)?.children || []) {
    t.difficulty.set((d.attrs.Name || '').replace(/_Default$/i, '').toLowerCase(), {
      build: d.num('Land_Build_Time_Multiplier', 1),
      credit: d.num('Credit_Multiplier', 1),
      damage: d.num('Damage_Multiplier', 1),
      health: d.num('Health_Multiplier', 1),
      sleep: d.num('Land_AI_Goal_Cycle_Sleep_Duration', 0)
    });
  }
  tables = t;
  t.weatherAudio = { loops: [], now: [] };
  for (const k of (wa ? parseXML(wa).children.find(x => x.children.length)?.children : null) || []) {
    const f = (k.text || '').split(',').map(x => x.trim());
    if (f.length < 3 || /^none$/i.test(f[2])) continue;
    const e = {
      weather: f[0].toLowerCase(),
      from: parseFloat(f[1]) || 0,
      event: f[2],
      lo: parseFloat(f[3]) || 8,
      hi: parseFloat(f[4]) || 15
    };
    (/Intermittent/i.test(k.tag) ? t.weatherAudio.now : t.weatherAudio.loops).push(e);
  }
  t.tracks = new Map();
  for (const d of (dt ? parseXML(dt).children.find(x => x.children.length)?.children : null) || []) {
    const n = (tag, v) => {
      const x = parseFloat(d.val(tag));
      return Number.isFinite(x) ? x : v;
    };
    t.tracks.set((d.attrs.name || '').toUpperCase(), {
      width: n('width', 5),
      segment: Math.max(2, n('segment_length', 7)),
      from: n('fade_begin_distance', 100),
      to: n('fade_end_distance', 150),
      rate: n('fade_distance_per_second', 10),
      texture: d.val('texture_name') || '',
      bump: /BUMP/i.test(d.val('Render_Mode')),
      opacity: n('opacity', 1)
    });
  }
  t.animEvents = new Map();
  for (const line of (am || '').split(String.fromCharCode(10))) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4 || !/^(SURFACE|SOUND)$/i.test(f[0])) continue;
    const key = f[1].toUpperCase(),
      ev = { t: (parseFloat(f[2]) || 0) / 100 / 30 };
    if (/^SOUND$/i.test(f[0])) ev.sound = f[3];
    else {
      ev.surface = f[3];
      ev.bone = f[4] || '';
    }
    if (!t.animEvents.has(key)) t.animEvents.set(key, []);
    t.animEvents.get(key).push(ev);
  }
  t.radar = { sets: new Map(), fog: [10, 10, 10, 100] };
  {
    const src = (rm || '').replace(/<!--[^]*?-->/g, ''),
      rgba = s => s.split(',').map(x => parseFloat(x) || 0);
    for (const m of src.matchAll(/<Passability_Color_Settings name="([^"]+)">([^]*?)<\/Passability_Color_Settings>/g)) {
      const set = {};
      for (const c of m[2].matchAll(/<Color name="passability_([a-z]+)">([^<]+)</g)) set[c[1]] = rgba(c[2]);
      t.radar.sets.set(m[1].toUpperCase(), set);
    }
    const f = /<Land_FOW_Color>([^<]+)</.exec(src);
    if (f) t.radar.fog = rgba(f[1]);
  }
  t.lightning = new Map();
  for (const e of (le ? parseXML(le).children.find(x => x.children.length)?.children : null) || []) {
    const nums = (tag, d) => {
      const v = (e.val(tag) || '').split(',').map(parseFloat).filter(Number.isFinite);
      return v.length ? v : d;
    };
    const w = [e.num('Width_Min', 1), e.num('Width_Max', 1)].sort((a, b) => a - b),
      f = [e.num('Fadeout_Time_Min', 0.2), e.num('Fadeout_Time_Max', 0.4)].sort((a, b) => a - b);
    t.lightning.set((e.attrs.name || '').toUpperCase(), {
      texture: e.val('Texture_Name') || 'lightning_default.tga',
      width: w,
      fade: f,
      displace: nums('Displace', [0.3, 0.3, 0]),
      detail: e.num('Detail', 1),
      bolts: Math.max(1, e.num('Number_Bolts', 3)),
      every: [e.num('Bolt_Creation_Interval_Min', 0.1), e.num('Bolt_Creation_Interval_Max', 0.3)].sort((a, b) => a - b),
      from: nums('Color_Start', [100, 100, 255, 255]).map(x => x / 255),
      to: nums('Color_End', [0, 0, 0, 0]).map(x => x / 255)
    });
  }
  t.moves = new Map();
  for (const c of (mc ? parseXML(mc).children.find(x => x.children.length)?.children : null) || []) {
    let mask = 0;
    for (const w of (c.text || '').split('|')) mask |= TERRAIN[w.trim().toUpperCase()] || 0;
    if (mask) t.moves.set(c.tag.toUpperCase(), mask);
  }
  t.terrainEff = new Map();
  for (const g of (te ? parseXML(te).children.find(x => x.children.length)?.children : null) || []) {
    const m = new Map();
    for (const c of g.children) {
      const v = parseFloat(c.text);
      if (Number.isFinite(v)) m.set(c.tag.toUpperCase(), Math.max(0, v));
    }
    t.terrainEff.set(g.tag.toUpperCase(), m);
  }
  return t;
}

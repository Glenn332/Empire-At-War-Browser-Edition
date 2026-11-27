import { db } from '../gamedata.js';
import { unlockBelowTech } from './galacticproduction.js';
import { expansion } from '../edition.js';

const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();

export const techAdjust = faction => db.faction(faction)?.num('Displayed_Tech_Level_Adjustment', 0) || 0;

function factionValue(campaign, tag, faction, fallback) {
  const row = campaign.tuples(tag).find(t => key(t[0]) === key(faction));
  return row ? +row[1] || 0 : fallback;
}

export function campaignLimits(campaign) {
  return {
    custom: campaign.bool('Supports_Custom_Settings', true),
    minTech: campaign.num('Min_Custom_Tech_Level', 1),
    maxTech: campaign.num('Max_Custom_Tech_Level', 5),
    minCredits: campaign.num('Min_Custom_Starting_Credits', 0),
    maxCredits: campaign.num('Max_Custom_Starting_Credits', 10000)
  };
}

export function campaignDefaults(campaign, faction) {
  return {
    custom: false,
    credits: factionValue(campaign, 'Starting_Credits', faction, 0),
    tech: factionValue(campaign, 'Starting_Tech_Level', faction, 0),
    maxTech: factionValue(campaign, 'Max_Tech_Level', faction, 5),
    autoResolve: 2,
    groundAutoResolve: false,
    randomEvents: true,
    landPopCap: 0,
    spacePopCap: 0
  };
}

export const creditSteps = limits => Math.floor((limits.maxCredits - limits.minCredits) / 1000) + 1;

export function creditsAt(limits, position) {
  const span = limits.maxCredits - limits.minCredits;
  return Math.trunc((Math.trunc(span * position + 0.5) + 999) / 1000) * 1000 + limits.minCredits;
}

export function techRange(limits, faction) {
  const adj = techAdjust(faction);
  return { lo: limits.minTech - adj, hi: limits.maxTech - adj, adj };
}

// The lobby's "auto-resolve all ground battles" choice rides in the shared setup so every peer agrees. A setup or save
// from before the option has no value, which keeps the old attack/retreat prompt.
export function applyGroundAutoResolve(g, setup) {
  const on = setup?.options?.groundAutoResolve;
  if (on !== undefined) g.groundAutoResolve = !!on;
  const events = setup?.options?.randomEvents;
  if (events !== undefined) g.randomEvents = !!events;
  setPopCaps(g, setup?.options);
}

// Pop cap overrides for the battles a galactic conquest fights. 0 keeps the game's own caps (the faction's space cap,
// the planet's ground force limit). Space uses the skirmish lobby's scale; ground caps start near 10, so land gets
// finer steps.
const POP_ROWS = [
  { key: 'landPopCap', id: 'IDC_SWR_LAND_POP_CAP', label: 'Land Pop Cap', max: 1000, step: 5 },
  { key: 'spacePopCap', id: 'IDC_SWR_SPACE_POP_CAP', label: 'Space Pop Cap', max: 10000, step: 50 }
];
const popValue = (r, v) => {
  const n = Math.round(+v / r.step) * r.step;
  return Number.isFinite(n) ? Math.max(0, Math.min(r.max, n)) : 0;
};
export const popCapText = (v, defaultText = 'Default') => (v ? v.toLocaleString() : defaultText);

export function setPopCaps(g, o) {
  if (!g || !o) return;
  for (const r of POP_ROWS) if (o[r.key] !== undefined) g[r.key] = popValue(r, o[r.key]);
}

// Grows a slider dialog by two rows for the land and space pop cap sliders. Everything is measured from the dialog's
// own controls, so a mod that rearranges the dialog keeps its layout: the rows copy a slider row of the dialog when it
// has one with its label and value beside the slider, else they get plain rows across the dialog's width. They go
// under the lowest settings control, and every group box that spans that line grows with them.
export function popCapRowsLayout(def) {
  if (!def?.controls?.length) return {};
  const cs = def.controls,
    isText = c => /^(LTEXT|RTEXT|CTEXT)$/.test(c.kind),
    isSlider = c => /trackbar/i.test(c.cls || ''),
    isButton = c => /BUTTON$/.test(c.kind) || (c.kind === 'CONTROL' && /^button$/i.test(c.cls || ''));
  const rowOf = slider => {
    const near = c => c !== slider && isText(c) && Math.abs(c.y - slider.y) <= 6;
    const label = cs.filter(c => near(c) && c.x + c.w <= slider.x + 4).sort((a, b) => b.x - a.x)[0],
      value = cs.filter(c => near(c) && c.x >= slider.x + slider.w - 4).sort((a, b) => a.x - b.x)[0];
    return label && value ? { label, slider, value } : null;
  };
  const sliders = ['IDC_SKIRMISH_CREDITS_SLIDER', 'IDC_SKIRMISH_STARTING_TECH_LEVEL_SLIDER', 'IDC_SKIRMISH_MAX_TECH_LEVEL_SLIDER']
    .map(id => cs.find(c => c.id === id))
    .filter(Boolean);
  const template = sliders.map(rowOf).find(Boolean);
  const ys = sliders.map(c => c.y).sort((a, b) => a - b),
    gaps = ys.slice(1).map((y, i) => y - ys[i]).filter(d => d >= 20 && d <= 60);
  const step = gaps.length ? Math.min(...gaps) : 36;
  // the dialog's bottom row of buttons, and the tightest group box around the settings
  const buttons = cs.filter(c => c.kind.endsWith('PUSHBUTTON') && c.y > def.h / 2),
    floor = buttons.length ? Math.min(...buttons.map(c => c.y)) : def.h;
  const anchor = template?.slider || sliders[0];
  const box = anchor
    ? cs
        .filter(c => c.kind === 'GROUPBOX' && c.x <= anchor.x && c.x + c.w >= anchor.x + anchor.w && c.y <= anchor.y && c.y + c.h >= anchor.y)
        .sort((a, b) => a.w * a.h - b.w * b.h)[0]
    : null;
  const settings = cs.filter(
    c => c.kind !== 'GROUPBOX' && !isButton(c) && c.y < floor && (!box || (c.y >= box.y && c.y < box.y + box.h)) && c.y > (box ? box.y : def.h * 0.15)
  );
  if (!settings.length) return {};
  const lowest = settings.reduce((a, c) => (c.y > a.y ? c : a)),
    line = lowest.y + Math.min(lowest.h, 20);
  const W = def.w,
    h = template?.slider.h || 11;
  const parts = template
    ? [
        { ...template.label, dy: template.label.y - template.slider.y },
        { ...template.slider, dy: 0 },
        { ...template.value, dy: template.value.y - template.slider.y }
      ]
    : [
        { kind: 'RTEXT', x: Math.round(W * 0.04), w: Math.round(W * 0.32), h: 14, dy: -1 },
        { kind: 'CONTROL', cls: 'msctls_trackbar32', style: 'TBS_HORZ', x: Math.round(W * 0.38), w: Math.round(W * 0.42), h, dy: 0 },
        { kind: 'LTEXT', x: Math.round(W * 0.82), w: Math.round(W * 0.16), h: 14, dy: -1 }
      ];
  // judged by the slider: the stock labels start a little left of their own box
  const left = parts[1].x,
    right = parts[1].x + parts[1].w;
  // a box across the new line grows when the rows fit inside it; a side panel the rows would cut through keeps its
  // size, and the rows start under it
  const spans = cs.filter(c => c.kind === 'GROUPBOX' && c.y < line && c.y + c.h >= line),
    grows = new Set(spans.filter(c => c.x <= left && c.x + c.w >= right)),
    below = Math.max(0, ...spans.filter(c => !grows.has(c)).map(c => c.y + c.h + 8));
  const top = Math.min(0, ...parts.map(c => c.dy)),
    first = Math.max(lowest.y + step, line + 6, below - top),
    grow = first - lowest.y + step * (POP_ROWS.length - 1);
  const extra = POP_ROWS.flatMap((r, i) =>
    parts.map(({ dy, ...c }, k) => ({ ...c, id: r.id + ['_TEXT', '', '_VALUE'][k], text: '', y: first + step * i + dy }))
  );
  const ours = c => POP_ROWS.some(r => c.id.startsWith(r.id));
  return {
    size: { w: def.w, h: def.h + grow },
    extra,
    adjust: c =>
      ours(c) || (c.kind === 'GROUPBOX' && spans.includes(c) && !grows.has(c))
        ? null
        : grows.has(c)
          ? { ...c, h: c.h + grow }
          : c.y >= line
            ? { ...c, y: c.y + grow }
            : null
  };
}

export function popCapSliders(dlg, st, { mark = () => {}, enabled = true } = {}) {
  const fallback = db.text.get('TEXT_DEFAULT') ?? 'Default';
  for (const r of POP_ROWS) {
    if (!dlg.ctl(r.id)) continue;
    st[r.key] = popValue(r, st[r.key] || 0);
    dlg.setText(r.id + '_TEXT', r.label);
    const show = () => dlg.setText(r.id + '_VALUE', popCapText(st[r.key], fallback));
    dlg.slider(
      r.id,
      st[r.key] / r.max,
      v => {
        st[r.key] = popValue(r, v * r.max);
        mark();
        show();
      },
      r.max / r.step + 1,
      enabled
    );
    show();
  }
}

// Only the original game's AI players carry the random-event goals (fleet rampages, planet flips, traps), which they
// switch off when Game.InterventionsEnabled reads 0. The expansion has none, so there the box keeps our ground
// auto-resolve choice; in the original game it is "Allow random events" again and ground auto-resolve gets a box of its own.
export const offersRandomEvents = () => !expansion();

export function optionBoxes(dlg, st, groundLabel) {
  const ground = id =>
    dlg.check(id, st.groundAutoResolve === true, on => {
      st.groundAutoResolve = on;
    });
  if (!offersRandomEvents()) {
    dlg.setText('IDC_ALLOW_RANDOM_EVENTS', groundLabel);
    ground('IDC_ALLOW_RANDOM_EVENTS');
    return;
  }
  dlg.check('IDC_ALLOW_RANDOM_EVENTS', st.randomEvents !== false, on => {
    st.randomEvents = on;
  });
  const box = dlg.ctl('IDC_ALLOW_RANDOM_EVENTS');
  if (!box) return;
  // the second label is too long to sit beside the first, so it takes the row below
  const top = parseFloat(box.style.top) || 0,
    height = parseFloat(box.style.height) || 0;
  if (!dlg.ctl('IDC_SWR_GROUND_AUTORESOLVE'))
    dlg.clone(
      'IDC_ALLOW_RANDOM_EVENTS',
      'IDC_SWR_GROUND_AUTORESOLVE',
      null,
      top + (box.parentNode?._top || 0) + Math.max(20, height * 1.8)
    );
  dlg.setText('IDC_SWR_GROUND_AUTORESOLVE', groundLabel);
  ground('IDC_SWR_GROUND_AUTORESOLVE');
}

export function applyCampaignSettings(g, settings, human) {
  if (!settings?.custom) return;
  const start = settings.tech + techAdjust(human),
    max = settings.maxTech + techAdjust(human);
  for (const p of g.players) {
    const shift = techAdjust(p.faction) ? -1 : 0;
    p.credits = settings.credits;
    p.tech = start + shift;
    p.maxTech = max + shift;
    unlockBelowTech(p);
  }
  g.campaignAutoResolve = settings.autoResolve;
}

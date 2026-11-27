// Select-all and deselect flip every unit icon's stamp key (plain -> selected -> plain) at once.
// The stamp budget bounds how many new stamps one frame builds, so the flip drains over several
// smooth frames instead of stalling one frame with hundreds of canvas builds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/js/game/ui.js', import.meta.url), 'utf8');
const menus = readFileSync(new URL('../public/js/game/menus.js', import.meta.url), 'utf8');
const windowsize = readFileSync(new URL('../public/js/windowsize.js', import.meta.url), 'utf8');

{
  const { UI } = await import('../public/js/game/ui.js');
  const ui = Object.create(UI.prototype);
  ui.stampBudget = 0;
  const unit = { _iconName: 'I_unit.tga' };
  // An exhausted budget returns no stamp and builds none: no document, canvas or atlas touch.
  assert.equal(ui.iconStamp('I_unit.tga', { x: 0, y: 0, w: 10, h: 10 }, '#fff', 28, 2, 1, true, 12, unit, true), null);
  assert.equal(ui.stampBudget, -1, 'the budget is spent even when it refuses the work');
  assert.equal(ui.iconStamp('I_unit.tga', { x: 0, y: 0, w: 10, h: 10 }, '#fff', 28, 2, 1, true, 12, unit, true), null);
  assert.equal(ui.iconStamps.size, 0, 'deferred stamps are not cached');
  // A cache hit never touches the budget.
  ui.stampBudget = 0;
  ui.iconSeen = new WeakMap();
  ui.iconStamps.set('I_unit.tga|#fff|28|2|1', 'cached-canvas');
  const hit = ui.iconStamp('I_unit.tga', { x: 0, y: 0, w: 10, h: 10 }, '#fff', 28, 2, 1, true, 12, unit, true);
  assert.equal(hit, 'cached-canvas', 'a warm stamp is served from the cache');
  assert.equal(ui.stampBudget, 0, 'cache hits do not consume the budget');
}

// Every overlay frame renews the budget, and a deferred icon falls back to a plain draw.
assert.match(source, /this\.stampBudget = 24;/, 'the overlay renews the stamp budget every frame');
assert.match(source, /stamp = stamp \|\| this\.iconStamp\([^)]*true\)/, 'the unit icon goes through the budgeted stamp path');
assert.match(source, /if \(!stamp\) \{\s*this\.plainIcon\(/, 'an unpaid stamp draws the plain icon instead');
assert.match(source, /plainIcon\(g, rect, color, size, mode, alpha, pad, x, y\)/, 'the plain fallback draws box, border and atlas art');
assert.match(source, /if \(\(this\.stampBudget = \(this\.stampBudget \|\| 0\) - 1\) < 0\) return null;/, 'iconStamp refuses past the budget');
assert.match(source, /const stampR = this\.iconStamp\([^)]*true\)/, 'rider icons share the same budget');
assert.match(source, /if \(stampR\) g\.drawImage\(/, 'deferred rider icons are skipped, not rebuilt');
assert.match(source, /stamps\.size > 800/, 'the LRU stamp cap stays in place');

// Fullscreen resolution picking: the window keeps its size and the game renders at the picked
// resolution, scaled up, so a 1920x1080 choice on a 4K screen really runs at 1920x1080.
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
assert.match(lib, /let is_full = win\.is_fullscreen\(\)\.unwrap_or\(false\);/, 'the app backend reports its fullscreen state');
assert.match(lib, /"full": is_full/, 'the window-size response carries the fullscreen flag');
assert.match(windowsize, /full: !!now\.full/, 'windowSizes passes the fullscreen state through');
assert.match(windowsize, /if \(now && now\.full\) \{[\s\S]*?gfx\.scale = Math\.max\(0\.25, Math\.min\(1, Math\.min\(w \/ mw, h \/ mh\)\)\)/, 'a fullscreen pick becomes a clamped render scale');
assert.match(windowsize, /gfx\.window = \[w, h\];\s*gfx\.scale = Math\.max/, 'the picked size is remembered for the windowed case');
assert.match(windowsize, /gfx\.scale = 1;\s*storeGfx\(\);\s*return windowSize\(w, h\);/, 'a windowed pick still resizes the window');
assert.match(menus, /appSizes && \(!fullscreen\(\) \|\| appSizes\.full\) \? appSizes : null/, 'the app offers real resolutions while fullscreen');
assert.match(menus, /pickWindowSize\(w, h\)\.then\(\(\) => \{[\s\S]*?fill\(\)/, 'picking a resolution refreshes the dialog');

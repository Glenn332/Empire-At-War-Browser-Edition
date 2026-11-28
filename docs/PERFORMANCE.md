# Performance: what to measure, what we know, what to build next

Written after the 27–28 Nov 2026 performance pass, for the two open reports: the main screen that
sometimes flickers black, and a battle that ran at about 8 FPS with only two ships. It also collects
the ideas for the next round so they do not have to be rediscovered. Facts first, ideas ranked after.

## Rule one: read the frame before changing anything

The tools that answer "why is this slow" already exist; one look settles most questions:

| Tool | What it tells you |
|---|---|
| F3 | Per-frame stage timings, a real GPU timer, scene stats, the hitch list, and the BOTTLENECK line: GPU (3D render), CPU (game logic), overlay (2D canvas) or browser compositor, with a percentage. `?diag` in the URL opens the panel from the start. |
| F2 | The benchmark overlay: frame-time histogram, 2 Hz figures, per-process table (on Linux: CPU, memory, disk I/O from `/proc`; no portable GPU counter exists, so GPU stays blank there). |
| Ctrl+Shift+B | Bug report zip with the full hitch list, each hitch with its GPU time, and the late-loads table (shader/texture work that should have happened on the loading screen). Press it right after a freeze. |
| Launcher console | The stall watchdog: a frozen screen says whether the main thread ran long tasks or the compositor stopped producing frames. |
| Video options | A/B switches for the biggest fixed costs: render scale, MSAA, shadows, bloom, particle and mesh detail. |
| Linux environment | `WEBKIT_DISABLE_COMPOSITING_MODE=1` (software compositing) and `WEBKIT_DISABLE_DMABUF_RENDERER=0/1` move the app's compositing path for one run without changing the defaults. |

In a battle, F3's bottleneck line is the decision:

- **GPU (3D render) dominates** → fill rate or draw cost: render scale, MSAA, shadows, post chain.
- **CPU (game logic) dominates** → simulation or AI on the main thread. With two ships this should be
  near zero; if it is not, the problem is on the sim side, not in rendering.
- **Overlay (2D canvas) dominates** → the HUD redraw loop.
- **Browser compositor dominates** → the webview, not the game: compositing policy, layer count,
  HiDPI scaling. Fix in the app host, not in render code.

## What the engine already does (do not build it twice)

- Instancing and batching for meshes, glow sprites, bolts and lasers (`instances.js`, `SpriteBatch`,
  `LaserBatch` in `game/render.js`); `?instancing=0` in the URL disables it for A/B tests.
- Incremental spatial obstacle grid (`game/spatialgrid.js`): cell arrays keep their identity, quiet
  frames write nothing.
- Presentation budgets in `game/performance.js`: projected-radius detail tiers (`visualDetail`),
  bounded decorative effects for big fleets (`effectBudget`), nearest-first effect retention, shadows
  only for casters of 45+ units, a 15 Hz shadow throttle with a redraw cache and fit-to-view.
- Selection and command bar redraw only on visible change (`selectionTransformKey`,
  `commandBarStateKey`).
- GPU warm-up (`game/gpuwarmup.js`): one batch per turn; the loading screen drains every fleet pool
  and warms the post chain.
- Overlay: half-resolution bars at 30 Hz, unchanged redraws skipped, GPU compositing on by default.
- Frame caps: menu backdrop 30/15 FPS, `FrameGate` for battles and the galaxy map, user frame cap.
- Multicore: the space simulation steps in its own worker (30 Hz tick, AI budgeted in 4 ms slices),
  particles run in their worker, models, textures and video decode in worker pools sized by
  `workerCount()`, route finding and soldier posing run in WebAssembly.
- The Linux app runs through X11, keeps the DMABUF renderer off NVIDIA, and turns GPU compositing
  back on after the November optimisations (`src-tauri/src/lib.rs`, `prepare_linux_webview()`).

## Case A: the main screen flickers black and is not smooth

Constraint from the report: do not downscale its resolution — find the real cause. Ranked, because
the first two already happened once this week:

1. **The compositor got a transparent or unbuffered layer again.** `739d068` removed the last
   transparent GL layer; a new layer type (a canvas created with an alpha context, a video element,
   a CSS backdrop-filter) reintroduces the flashing path. Probe: watch the console around a flicker
   with the launcher watchdog output, and check whether flicker correlates with scene switches or
   happens while idle. Fix: keep every layer opaque — `alpha: false` on new GL contexts, background
   colours on containers behind canvases.
2. **The GPU compositing path on this driver stalls occasionally.** `edf3974` turned GPU compositing
   back on after the optimisations, and WebKitGTK 2.54.3 on Fedora shipped regressions that same
   week. Probe: run one session with `WEBKIT_DISABLE_COMPOSITING_MODE=1` and compare — does the
   flicker disappear, or only slow down? Fix: if a driver class is clean in software but flaky in
   GPU compositing, encode that as a measured rule in `prepare_linux_webview()`, or add an in-app
   toggle that is read before the webview starts (needs one restart).
3. **The menu backdrop's frame cap stutters against the refresh rate.** A 30 FPS cap that lands
   unevenly on a 60 or 144 Hz screen can look worse than a slightly higher cap with even pacing.
   Probe: `?diag`, watch the frame-interval histogram while idle. Fix: pace the cap against the
   measured refresh instead of wall-clock intervals.

## Case B: about 8 FPS with two ships

With two ships the simulation and the AI cannot be the cost. A frame that slow is a fixed per-frame
expense or a stall outside the game. Ranked by how often each one explained a report like this:

1. **Webview compositing stall (app only).** The tell: F3's BOTTLENECK line says *browser
   compositor* while the GPU bucket stays small. Probe: same save and settings in the browser
   (`npm start`) versus the app; then A/B the two environment toggles. If the app crawls and the
   browser flies, it is the webview — fix in `prepare_linux_webview()`, not in render code.
2. **Post chain at native resolution.** Bloom and the other passes cost the same with 2 or 200
   ships. Probe: F2 open, drop render scale to 0.5 — if the frame time roughly halves, the GPU is
   fill-rate bound. Fix: the adaptive governor (idea 1 below).
3. **MSAA on an integrated GPU.** `aa` defaults on. Probe: toggle MSAA off. Fix: default it off when
   the OS-named GPU (already detected in `9517c6f`) belongs to a known slow class.
4. **Shadow pass over planet and big ships.** Probe: shadows off. Fix: lower the default
   `shadowRange` on such GPUs.
5. **Late compile or upload after loading.** Probe: press Ctrl+Shift+B a minute into the battle and
   read the `lateLoads` table in the report. Fix: add whatever still loads late to the pool warm-up.
6. **Overlay redraw loop.** Something that animates every frame (shield bars, a countdown) makes the
   HUD redraw at every overlay tick. Probe: F3's overlay bucket, then hide HUD groups one by one.
   Fix: extend the change-key (`commandBarStateKey`) over whatever animates.

Whatever F3's bottleneck line says decides the branch; the matching fix is listed above. A report
with the F2 and F3 numbers attached (Ctrl+Shift+B) turns this case from guessing into one commit.

## Ideas for the next round, ranked

1. **Adaptive render scale governor** — small change, huge on 4K and integrated GPUs. Measure the
   median frame milliseconds `diag` already collects; step `gfx.scale` between 0.5 and 1.0 until a
   target (16.6 ms) holds, stop after two stable steps. Presentation-only, so multiplayer cannot
   feel it. An "Auto" entry in video options is one slider change (`gfx.js`, `game/render.js`
   `fit()`, `main.js` `applyGraphics()`).
2. **Use the model LOD chains that are already parsed.** `model.js` walks every `_LOD0…_LODn` mesh
   chain today and then keeps only the highest-poly mesh (`lodBest`). Keep the chains and let
   `Instances` choose the mesh from the projected radius `visualDetail` already computes: tier 0
   takes the lowest chain. Dense fleets lose most of their triangle cost at tactical distances
   without a single new file format.
3. **Squadron-scale far layer** (the idea behind "grid renderer"). Below about 5 px projected
   radius a whole fighter squadron becomes one instanced glow in the existing `SpriteBatch` instead
   of posed meshes; a per-frame posed-unit budget retires detail when the budget is exceeded and
   returns it when the camera zooms in.
4. **One-pass bloom** — the post chain is several passes; WebGL2 multiple-render-targets halves the
   bloom cost. Only worth doing after the governor, because render scale already scales the same
   pixels.
5. **Live budget enforcement** — `effectBudget` keys off fleet size; let the governor feed it, so a
   frame over budget drops smoke, trails and glow before it drops gameplay readability.
6. **Move the last main-thread work off it** — shot-model posing, health-bar baking and any
   remaining texture decoding still touch the main thread; `diag.task()` marks them, so the F3
   numbers point at which to move next.
7. **WebGPU** (`gpu/env.js` `wantGPU`) — removes driver-side sync stalls and gives better GPU
   timing, but the webview compositor cost in the app stays; try it in the browser first.
8. **App compositor diet** — keep stacking contexts above the canvas minimal, and consider exposing
   the compositing/DMABUF choice in the app's own settings (read before webview start, one restart
   hint), so players can escape a driver regression without a terminal.

## Ground rules

- Presentation never touches simulation state: lockstep multiplayer hashes the sim (`stateHash`),
  so a performance fix that reaches into the sim desyncs matches. Everything above lives in the
  presentation layer.
- Fixes are engine-level, never per-mod.
- Measure with F3/F2 before and after; a change that is not visibly better in the benchmark
  (`play.html?benchmark=100`, `play.html?mode=land&benchmark=30`) goes out with the numbers that
  show it.
- The Linux webview is a moving target: encode driver rules as measurements in
  `prepare_linux_webview()`, not as folklore.

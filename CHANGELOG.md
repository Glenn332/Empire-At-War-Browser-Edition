# Changelog

What changed, why, and the bugfixes. Newest first. Commit hashes link each entry to the exact change.

## 28 November 2026 — Linux desktop fixes, a performance pass, new video options, better diagnostics

Thirty-six commits since `98ade26`, plus one merged-in fix. The short version for players:

- Thrawn's Revenge launches again, and mods can be picked in the launcher.
- The Linux app got its sound back, stops freezing while scrolling, and stopped flashing black.
- Battles, the main menu and the cinematic intro stop stuttering: shader and texture warm-ups, frame
  caps for the menu backdrop, an incremental obstacle grid, effect budgets for huge fleets, a smaller
  shadow map, and a cheaper 2D overlay.
- New in video options: an MSAA toggle and a render-scale slider.
- F3 now names the bottleneck of the frame (GPU, CPU game logic, 2D overlay or the browser
  compositor) with a percentage, and Ctrl+Shift+B packs a bug report that carries the full hitch
  list with GPU timing.

Also merged in on this push: `2c759bb` — *Galactic conquest no longer fills memory with every battle
played* (particle threads, retained texture pictures, renderer dispose handlers; measured heap after
five galaxy/battle switches with a big mod: 4317 MB → 1117 MB).

### Fixed

| Problem | What was wrong | Fix |
|---|---|---|
| Thrawn's Revenge would not launch | The mod folder was not layered into the opened game | `037d19c` local-folder and mod loading on Fedora; `32168cf` `--mod` / `STEAMMOD=` / `MODPATH=` become the bottom layer of the mod stack, deduplicated case-insensitively, under the launcher's toggled mods |
| No sound in the Linux app | The AppImage bundles GStreamer plugins; on multilib hosts (Fedora's i686 copies in `/usr/lib`) those are 32-bit, so WebKit found no appsink and silence was total | `037d19c` the app checks the plugin architecture and points `GST_PLUGIN_SYSTEM_PATH_1_0` at the system's 64-bit plugins when the bundle is wrong |
| Launcher froze when scrolling | WebKitGTK failed to composite a huge sun-glow shadow on HiDPI, and a WebKitGTK 2.54.3 scroll regression (26 Nov Fedora update) froze the webview mid-scroll | `0452c34` drop the giant composited shadow; `48a02ca` force 1:1 webview zoom so hover and the compositor agree at fractional scales; `906a5c0` → `c687e6e` the renderer rule went to every GPU and back to NVIDIA-only once the real culprit turned out to be the WebKitGTK update; `614fccb` a stall watchdog in the console tells a main-thread long task from a compositor frame gap |
| Launcher flashed black | The webview background was unset and the full-screen fleet canvas was a transparent GL layer, the layer type the software compositor is known to flash | `739d068` the webview starts opaque in the page's colour and the fleet canvas clears opaque with the starfield and horizon planet inside it; `0452c34` survive fleet-canvas context loss by hiding and pausing until the context returns |
| Main menu lagged, worst when scenes switched | First shader compile and texture upload of every newly shown scene happened mid-play, and the 3D backdrop drew at full speed | `e5071e4` menus warm their GPU work in one-batch-per-turn passes (`gpuwarmup.js`); `1fdd5fd` frame caps for the menu backdrop (30 FPS, 15 when a movie plays or a subpage is open) |
| Entering a battle froze at the cinematic intro | A mod fleet's shader pools drained one compile per frame during play, so the camera reveal stalled frames for seconds | `8e866be` the loading screen scans both fleets and drains every pool before control is handed over; `93ebd13` the post chain warms on the loading screen too |
| Ctrl+A froze the battle and dropped selection rings | The selection ring batches were built lazily on first selection: a material compiled mid-play and the blob texture arrived seconds later | `6f05cbc` select-all draws its green outline at once; `facf0c8` the rings warm up ahead of time; `e5071e4` the select stamp keeps the redraw budget bounded |
| Render scale did nothing in land battles | `applyGraphics()` returned early when the renderer had no `.post`, and the land game uses a plain `THREE.WebGLRenderer` | `6d32e15` the post section is conditional, the re-fit always runs |
| Render scale slider felt inverted; blurry overlay at half resolution | The slider multiplied instead of divided; the half-res overlay drew the HUD bars fuzzy | `f422056`, `9187ca1` (which also moved shader compilation for the whole mod roster off the main thread) |
| `npm run app --debug` was as slow as a release build | Every debug run paid for bundling | `1de3c46` `--debug` builds the debug profile with `--no-bundle`, runs `src-tauri/target/debug/empire-at-war-browser-edition` directly and stages files in parallel: about 15 s instead of 5 min, launcher untouched |
| Cargo warned about dead code when building on Linux | Windows-only procstats and GOG helpers compiled on Linux too | `468ec26` `#[cfg]` gates keep them out of Linux builds |
| Model loading could hang forever | An ALO worker that never answered (a wedged real worker or a silent stub in a test host) blocked the pool for good | `4bab912` the pool tears itself down and later loads parse on the thread |
| Land combat crash on a damaged model | `hardpointFacing` walked a missing model root | `b473436` the guard, and a test that follows per-gun hard-point arming |
| CPU and memory figures missing in the benchmark overlay on Linux | Process figures were Windows-only | `8e866be` `/proc` answers CPU, memory and disk I/O per process; there is no portable GPU counter, so GPU stays blank there on purpose |

### Performance

- **Shader and texture warm-up** — `gpuwarmup.js` uploads one batch per turn so WebKitGTK can paint
  between batches (`e5071e4`); the loading screen drains every fleet pool (`8e866be`) and warms the
  post chain (`93ebd13`). First compile of a shader mid-play was the single worst frame-killer.
- **Presentation-only budgets** (`performance.js`, `1fdd5fd` / `e5071e4`) — projected-radius detail
  tiers, bounded decorative effects for big fleets (`effectBudget`), nearest-first effect retention,
  shadows only for casters of 45+ units at a 15 Hz throttle with a redraw cache and fit-to-view
  (`shadowcache.js`, `shadowfit.js`).
- **Incremental obstacle grid** (`spatialgrid.js`, `1fdd5fd`) — cell arrays keep their identity and
  quiet frames write nothing.
- **Selection and command bar redraw on change only** — `selectionTransformKey` and
  `commandBarStateKey` hash the visible state so Ctrl+A redraws once (`e5071e4`, `6f05cbc`).
- **Overlay diet** — half-resolution HUD bars at 30 Hz (`f422056`), unchanged redraws skipped,
  GPU compositing re-enabled by default once the frame cost dropped (`edf3974`). Overlay unification
  (drawing the 2D overlay into the WebGL canvas as a texture) was tried in `315c744` and reverted in
  `e007f32` on evidence: texture upload is slower than the compositor blend.
- **Shadow map 4096 → 2048** (`1391a5a`), with the MSAA toggle exposed.
- **Multicore** — worker pools sized by core count (`workerCount()`: scan, routes, collect, decode),
  the space simulation steps in its own worker, particles run in their own thread, models, textures
  and video decode in workers; `468ec26` thin LTO cut the Rust build time, and `1de3c46`
  parallelises the staging copy.

### New video options

- **MSAA toggle** (`1391a5a`) with an honest read-out of whether it is really on (`93ebd13`).
- **Render-scale slider** (`b572b22`, fixed in `f422056`, `4b5b6f2`, `6d32e15`): renders the 3D
  scene at a fraction of the screen resolution and scales up, for GPUs that are fill-rate bound.
- The existing supersample, shadow size, detail and frame-cap settings stay in `gfx.js`.

### Diagnostics

- **F3 panel** (`7f87ffb`, `95cf8b6`) — per-frame stage timings, a real GPU timer
  (`EXT_disjoint_timer_query_webgl2`), scene stats (draws, triangles, units), the hitch list with
  per-hitch GPU time, and a BOTTLENECK line: what dominated the last frames among GPU (3D render),
  CPU (game logic), overlay (2D canvas) and the browser compositor, plus a last-30-seconds summary.
- **GPU identity** (`9517c6f`) — the real GPU name from the operating system, not WebKit's masked string.
- **F2 benchmark overlay** (`b33435a`, `5513d04`) — a pure read-out now: the save button moved out,
  the 2 Hz figures scan only the histogram buckets frames actually touched, and the per-process
  table works on Linux (`8e866be`).
- **Ctrl+Shift+B bug report** (`bugreport.js`, `report.rs`) — a zip with screenshot, logs, game
  state, save, replay and the performance JSON: after a freeze the report carries the full hitch
  list with GPU timing per hitch. Press it right after the freeze.
- **Launch-time watchdog** (`614fccb`) — a frozen launcher logs whether the main thread ran long
  tasks or the compositor stopped producing frames.

### Known open issues (reported 28 Nov 2026)

- **The main screen sometimes flickers black and is not smooth.** Do not downscale its resolution;
  the plan is in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- **A battle with only two ships ran at about 8 FPS.** With so few units the simulation cannot be
  the cause; the ranked hypotheses and one-look probes are in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

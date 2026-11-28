# AGENTS.md

A guide for AI agents (and new humans) working in this repository. Read it once, then keep to it.

## What this is

A browser re-implementation of *Star Wars: Empire at War* that reads the player's own game files.
Plain ES modules on three.js — no build step needed to develop. The desktop app wraps it with Tauri
(WebView2 on Windows, WebKitGTK on Linux).

## Layout

- `public/js/` — engine: file formats (`ted.js` maps, `alo.js` models, `dds.js` textures, `bink.js`
  video, `lua.js` scripts, `fxo.js` shaders), rendering (`gfx.js`, `gpu/`, `model.js`), audio,
  networking, app bridge (`platform.js`, `vfs.js`).
- `public/js/game/` — simulation and screens: `sim.js` (units, orders, combat), space and land
  battles, galactic conquest, HUD (`ui.js`, `hud.js`), menus, and the presentation layer
  (`render.js`, `performance.js`).
- `public/js/*worker.js` — worker pools: models, textures, video, fetch, render, collect/scan.
- `src-tauri/` — desktop app host in Rust: local HTTP server, game folder discovery, process stats,
  bug reports, Linux webview policy (`lib.rs`, `prepare_linux_webview()`).
- `tools/` — Node helpers and the test suite (`test-*.mjs`).
- `wasm/` — AssemblyScript: path search and land posing.
- `docs/PERFORMANCE.md` — performance playbook. `CHANGELOG.md` — what changed and why.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Dev server on `http://localhost:8377`. Game data from `../Star Wars Empire at War` or `SWR_GAME=<path>`; `--mod <path>` layers a mod. |
| `npm run test:without-game` | The CI test suite. Run it before pushing. |
| `npm test` | Full suite; parts of it need a game install next to the repo. |
| `npm run app` | Build the desktop app. `npm run app --debug` builds the debug profile, skips bundling, runs `src-tauri/target/debug/empire-at-war-browser-edition` directly (~15 s instead of ~5 min). |
| `npm run wasm` | Rebuild the WebAssembly modules. |
| `npm run format` / `format:check` | Prettier (2-space, no semicolons per config). Markdown is ignored. |

Useful dev URLs (see `README.md`): `play.html?autostart&faction=Empire&enemy=Rebel&map=KUAT`,
`play.html?mode=land`, `play.html?benchmark=100`, `viewer.html?model=EV_STARDESTROYER.ALO`.

## Hard rules

1. **Simulation and presentation are separate.** `sim.js` and the space battle worker are the
   deterministic simulation; lockstep multiplayer hashes their state (`stateHash` in `netgame.js`).
   Presentation (`render.js`, `ui.js`, `performance.js`, frame caps, effect budgets) must never write
   simulation state, and randomness in the sim comes only from `simrandom.js`. A perf fix that leaks
   into the sim desyncs matches.
2. **Engine-level fixes, never per-mod.** Mods load the way the original engine loads them
   (`mods.js`); make behaviour work for every mod, not for one.
3. **No new runtime dependencies.** Vendor libraries live in `public/vendor/` and are pinned; the
   engine is dependency-free on purpose.
4. **Workers must degrade.** A worker that never answers tears its pool down and falls back to
   parsing on the thread (see `alo.js`); any new worker needs the same treatment.
5. **Tests are plain Node scripts** in `tools/test-*.mjs`, runnable without the game. Add one for
   every fix where the behaviour is testable; run `npm run test:without-game` before pushing.
6. **Style** — Prettier handles formatting. Comments explain *why*, including WebKit quirks, and are
   written for a reader who knows neither the file nor the bug.

## Pitfalls

- **WebKitGTK (the Linux app's webview) is the sharp edge.** Compositing, DMABUF, backend and
  GStreamer policy live in `src-tauri/src/lib.rs`, `prepare_linux_webview()` — read it and its
  history before touching app environment variables; each rule there is a measured workaround.
- **First compile/upload of a shader or texture mid-play freezes a frame.** Route any new material
  or texture through the warm-up (`game/gpuwarmup.js`, one batch per turn; pools drained on the
  loading screen).
- **The 2D overlay is composited by the browser.** Redraw it only when its visible state changed
  (change-key hashes in `game/performance.js`), keep it opaque, and do not try to unify it into the
  WebGL canvas — tried in `315c744`, reverted in `e007f32` (texture upload is slower than the
  compositor blend).
- **Diagnostics are part of the contract.** Instrument new stages with `diag.lap()` / `diag.task()`
  so the F3 panel stays truthful; performance fixes go in with before/after numbers.
- **Files are long** (`sim.js` ~7.6k lines, `landgame.js` ~5.3k). Find the owner of a behaviour with
  `grep` on game terms from the XML data, not by reading whole files.
- The project uses AI heavily and ships under GPL-3.0-or-later; generated code is inspected and
  tested before it lands (see `README.md`).

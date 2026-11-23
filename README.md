<p align="center">
  <img src="https://playeaw.com/icons/share.jpg" alt="Star Wars: Empire at War - Browser Edition" width="800">
</p>

<p align="center">
  <b><a href="https://playeaw.com">Play now at playeaw.com</a></b>
  &nbsp;·&nbsp;
  <a href="https://github.com/Glenn332/Empire-At-War-Browser-Edition/releases/latest/download/EmpireAtWarBrowserEdition-setup.exe">Windows app</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Glenn332/Empire-At-War-Browser-Edition/blob/main/progression.md">Progress</a>
  &nbsp;·&nbsp;
  <a href="https://discord.gg/tAaZEVFmn">Discord</a>
</p>

<p align="center">
  <a href="https://ko-fi.com/Z4S429CUIG"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi"></a>
  <a href="https://discord.gg/tAaZEVFmn"><img src="public/icons/discord-button.svg" alt="Join our Discord"></a>
</p>

# Empire at War: Browser Edition

*Star Wars: Empire at War* came out in 2006, and *Forces of Corruption* followed it. Nearly twenty years on, people
still play them, and the modding community keeps them alive with huge total-conversion mods. The original engine has
not kept up. It is 32-bit and single-threaded, and it was built for the hardware of its day. Large mod battles can
bring a modern PC to its knees.

This project brings the game back on a new engine that runs in your browser. It reads your own copy of the game, so
you get the same units, maps, models, sounds, scripts and AI, and it is built to keep big battles running smoothly.

## Where to play

- **In the browser:** go to [playeaw.com](https://playeaw.com). Use Chrome, Edge, Brave or Firefox on a computer.
- **As a Windows app:** [download the installer](https://github.com/Glenn332/Empire-At-War-Browser-Edition/releases/latest/download/EmpireAtWarBrowserEdition-setup.exe).
  The app finds your Steam install and your Workshop mods by itself, and it updates itself.

You need your own copy of *Star Wars: Empire at War - Gold Pack* (the base game and *Forces of Corruption*), for
example from Steam. Nothing of the game is hosted or shipped here. On first start, you point the game at your
installed game folder. You can also import the folder once as a single archive, which works in every browser and
lets you play offline afterwards. The start page walks you through both options.

## What you can play

- **Space skirmish:** the original maps, factions, units, heroes, abilities and HUD, against the computer or
  friends.
- **Land skirmish:** ground battles with reinforcement points, buildings, garrisons and turrets.
- **Galactic conquest:** the campaigns and the galaxy map, with invasions that lead into real space and land
  battles. This mode is still in progress.
- **Multiplayer:** internet and LAN games through the original lobby screens, including saving a multiplayer game.
- **Mods:** Steam Workshop and local mods load the way the original loads them, and you can stack several in your
  own order. Fixes are made in the engine, never for one particular mod.

[progression.md](progression.md) shows exactly what is finished, what is partial and what is still missing.

## Built for big battles

The point is to play battles the original engine struggles with:

- Hundreds of ships and fighters at once. The built-in benchmark starts at 100 against 100 and goes up to 400 ships
  per side.
- Hot paths such as route planning and the soldiers' animation run in WebAssembly. The space battle can step on a
  thread of its own, apart from the drawing.
- Rendering uses WebGL or WebGPU, with instancing and batching, so dense mod battles stay fluid.
- Press **F2** in any battle or on the galaxy map to see frame times live.

## Faithful to the original

The engine is new code, not a port of the original executable. It behaves like the original because it reads the
same files and follows the same rules: the XML unit database, the `.meg` archives, the models and animations,
particles, maps, the Lua story and AI scripts, the audio events and the game's own dialogs. Where the original's
behaviour is not obvious from its data, it is worked out from how the original engine does it. Where something is
still our own approximation, the progress list says so.

## Controls

The controls are the same as the original:

| | |
|---|---|
| Left click / drag | select, box-select (Shift adds, double click selects the same type) |
| Right click | move, or attack what is under the cursor |
| Ctrl + right click | attack-move |
| M / T / F / G / X | move, attack, attack-move, guard, stop |
| WASD / arrows / screen edge / middle-drag | pan |
| Wheel / Q, E | zoom / rotate |
| Ctrl+1…9, 1…9 | set / recall a control group |
| P, + / - | pause, game speed |
| Esc | cancel, deselect, menu |

In land and space strategy views or on the galaxy map, park the mouse at an edge of the battlefield to scroll; move inward to stop. Edge scrolling is on by default and can be disabled with **Pan the camera at the screen edges** in Game Options. It does not steer a possessed soldier or vehicle.

**Battlefront mode (land battles):** press **B** (controller **Y / Triangle**) to switch between first and third person as a trooper. In a vehicle, the same button switches between a centered chase camera and the driver or gunner's view. Press **E** to get out; your infantry view is unchanged. **O → Infantry view / Vehicle view** lets you set each preference. Both are remembered on this browser. Melee heroes keep their third-person camera, and deployed artillery keeps its overhead sight.

The default Battlefront sight is grey over empty ground, blue over allies and red over enemies (orange with colourblind-safe markers). Blaster heat lights the bottom squares from the center out and drains as the weapon cools; ammo weapons keep their count and reload bar. **O → Zoom input** switches between holding and tapping the right mouse button or left trigger. In third person the infantry camera retracts in front of terrain ridges, then eases back out.

In third person, focusing shifts to the right shoulder and leaves just a dot. It stays at the unzoomed sight’s height, slightly left toward the helmet. Zooming in or out without moving your aim keeps the same spot under the sight. In first person, sprinting brings the lowered weapon across the bottom of the view. **V / RB** rolls in the held movement direction (including diagonals), or forward from a standstill. First person dips and tucks the weapon; turn off **Head bob** to disable the camera bank.

In a live ground battle, faction emblems and ticket counts flank the center readout. Aim at a unit to see its name and remaining health; each hit leaves a short-lived white segment marking only the health just lost. Look away and the center clears. There is no reinforcement split bar. The reticle is 20% opaque. Blaster bolts have a bright core and rounded ends that stay visible even when viewed straight down the barrel. Focused shots start at the animated muzzle and converge on the dot; recoil still moves your aim. At a command post, the ring around the emblem drains toward neutral white as control is lost, then fills in the capturing side’s color (blue for allies, red for enemies). Vehicles use the same equipment panel as infantry: vehicle name, weapon icon, and one hull meter with a cyan shield outline. No speedometer or vehicle ammo counter. The upper-right radar rotates with your view: units are local, while distant command posts stay on its rim. Your equipment and health are at bottom left, with the compass along the bottom. Hold **Tab** for personal combat stats or use **M** for the full battlefield map.

## For developers

It is plain JavaScript modules on three.js, with no build step needed to run it.

```bash
npm install
npm start
```

This starts a development server on http://localhost:8377/. It serves the game data straight out of an install next
to this folder (`../Star Wars Empire at War`) or from `SWR_GAME=<path>`. Add `--mod <path>` to lay a mod over it.

Some useful addresses:

- `play.html?autostart&faction=Empire&enemy=Rebel&map=KUAT` skips the setup screen.
- `play.html?mode=land` starts a land battle.
- `play.html?autostart&mode=land&shooter&map=ENDOR&deployUI=2005` opens the ground shooter's 2005-style deployment screen. Choose a class and a friendly position, then **Spawn**. Click a friendly unit to spectate it; only eligible squads are spawn points. The selected class stays centered above Spawn, even while watching a teammate. Try Endor for turbolasers on both sides. Use `deployUI=original`, or switch **O → Deployment screen** during a match, to compare layouts.
- `play.html?benchmark=100` starts the space benchmark, and `play.html?mode=land&benchmark=30` the land one.
- `viewer.html?model=EV_STARDESTROYER.ALO` opens the model viewer.

Other commands:

| Command | What it does |
|---|---|
| `npm run wasm` | rebuild the WebAssembly modules from `wasm/` |
| `npm run build:prod` | build the site into `dist/` |
| `npm run deploy:prod` | build and publish the site and the multiplayer lobby (`lobby/`) to Cloudflare |
| `npm run app` | build the Windows app (`src-tauri/`, Tauri) |

`npm run test:deploy` checks deployment logic without retail data. With `SWR_GAME` set, run
`node tools/test-deploy-disc-catalog.mjs` (add `--base` for the original game) to check the stock skirmish maps.
With the local server running, Chrome and optional `playwright-core` installed, `node tools/test-deploy-framing-browser.cjs`
checks the rendered vehicle silhouettes; run again with `--base` to check the other edition. No retail files are bundled.

The code lives in a few places:

- `public/` is the whole site.
- `public/js/` holds the file formats, rendering and audio.
- `public/js/game/` holds the simulation, AI, HUD, land battles and galactic conquest.
- `tools/` has Node helpers and tests.

## License

Copyright (C) 2026 RIRA

The engine's code is free software: you can redistribute it and/or modify it under the terms of the GNU General
Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option)
any later version. It is distributed in the hope that it will be useful, but without any warranty. See
[LICENSE](LICENSE) for the full text.

Bundled libraries keep their own licenses: three.js and Fengari are MIT (`public/vendor/three/LICENSE`,
`public/vendor/fengari/LICENSE`), and the FFmpeg core is GPL-2.0-or-later (`public/vendor/ffmpeg/COPYING.GPLv2`,
source in `public/vendor/ffmpeg/SOURCE.md`).

## Legal

This is a non-commercial fan project. It is not affiliated with or endorsed by Lucasfilm, Disney, Petroglyph or
Electronic Arts. *Star Wars*, *Star Wars: Empire at War* and its game data are © and ™ Lucasfilm Ltd. / Petroglyph.
The license above covers only this project's own code. It grants no rights to the game, its data, or the Star Wars
names and trademarks. The engine contains none of the original game's code or data; you need your own copy of the
game to play.

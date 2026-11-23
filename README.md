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

## Battlefront land battles: present and proposed

Each pair shows the **present** browser edition ([`main` at `d69de4b`](https://github.com/Glenn332/Empire-At-War-Browser-Edition/commit/d69de4b)) on the left and the **proposed** [PR #7](https://github.com/Glenn332/Empire-At-War-Browser-Edition/pull/7) on the right. The gameplay captures use *Forces of Corruption*, Endor, the same units and a 1200 × 780 viewport. They are separate local runs, not mockups. Click a pair to enlarge it.

**1. Choose where to spawn — menu proposed in [PR #6](https://github.com/Glenn332/Empire-At-War-Browser-Edition/pull/6), shown integrated in #7.** The present screen puts a rectangular map and class statistics in a modal. The [deployment-only PR](https://github.com/Glenn332/Empire-At-War-Browser-Edition/pull/6) keeps the battlefield visible: choose a class on the left, a friendly spawn on the command-post disc, then **Spawn** beneath the selected unit. The original layout is still available under **O → Deployment screen**.

[![Same Stormtrooper on Endor: present map-and-stats dialog versus proposed class portrait above Spawn with a round deployment map](docs/battlefront/deploy.png)](docs/battlefront/deploy.png)

**2. Aim at a trooper.** The proposed right-shoulder view keeps one faint dot just above and left of center. Press and release focus without moving the mouse: the same point on the target stays under the dot. Faction emblems flank the ticket counts; the center meter shows **only the unit you aim at**. Hits briefly mark only the health just lost. Look away and both name and meter clear. The upper-right radar shows local contacts and pins distant command posts by bearing.

[![Stormtrooper aiming at a Rebel: present boxed readouts and lower-right map versus proposed shoulder sight, target health and upper-right radar](docs/battlefront/shoulder.png)](docs/battlefront/shoulder.png)

**3. Look down the blaster.** In the proposed first-person view the carried weapon is visible at the lower right, stays attached through turns, and swings across the bottom when sprinting. The 20%-opacity sight is grey over terrain, blue over allies and red over enemies (orange with colourblind-safe markers). Outside dot-only focus, blaster heat grows outward along the lower arc. Ammo weapons retain their count and reload indicator.

[![Stormtrooper first person: present weapon below the frame versus proposed hands and blaster visible at the lower right](docs/battlefront/first.png)](docs/battlefront/first.png)

**4. Drive onto a command post.** The proposed chase camera frames the T4-B’s hull below the sight. The same lower-left equipment panel used on foot now shows vehicle name, weapon, hull and remaining shields without a speedometer or ammo count. The capture ring around the emblem drains to neutral white, then fills blue for allies or red for enemies.

[![T4-B at a command post: present distant tank and separate status boxes versus proposed centered tank, shared equipment panel and capture ring](docs/battlefront/vehicle.png)](docs/battlefront/vehicle.png)

**5. Follow a bolt.** These are renderer captures of the same stock red blaster shot at the same scale, isolated from the muzzle flash. On `main` the strip disappears when viewed exactly from the rear or front. In the proposal both ends remain visibly circular. Local focused shots leave the animated barrel and converge on the sight; recoil still applies. Ordinary RTS and space projectiles keep their original presentation.

[![Red blaster rendered from four angles on each branch: the present rear and front panels are black; the proposed ones show two round red ends](docs/battlefront/bolt.png)](docs/battlefront/bolt.png)

| In a Battlefront land battle | Control |
|---|---|
| Switch infantry first/third person **or** vehicle chase/driver/gunner | **B / Y / Triangle**. Infantry and vehicle choices are saved separately; **E** exits without changing the on-foot view. |
| Focus | **Right mouse / left trigger**. Choose hold or toggle in **O → Zoom input**. |
| Roll | **V / RB** with a movement direction, including diagonals; stationary rolls go forward. Disable **Head bob** to remove the first-person camera bank. |
| Open the full map / show combat stats | **M** / hold **Tab** |

The views use each unit’s own model, weapon and hull rather than an Endor-specific list. Melee heroes keep third person, deployed artillery keeps its overhead sight, and missiles and model/particle weapons keep their own effects. Modded rigs, textures and loadouts can differ; see [coverage and how to test](docs/battlefront/README.md).

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
- [Start Battlefront on Endor locally](http://localhost:8377/play.html?autostart&mode=land&shooter&map=ENDOR&faction=Empire&enemy=Rebel&deployUI=2005). Use `deployUI=original` to compare deployment layouts in the same build.
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

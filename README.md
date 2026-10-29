<p align="center">
  <img src="https://playeaw.com/icons/share.jpg" alt="Star Wars: Empire at War - Browser Edition" width="800">
</p>

<p align="center">
  <b><a href="https://playeaw.com">Play now at playeaw.com</a></b>
  &nbsp;·&nbsp;
  <a href="https://downloads.playeaw.com/EmpireAtWarBrowserEdition-setup.exe">Windows app</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Glenn332/Empire-At-War-Browser-Edition/blob/main/progression.md">Progress</a>
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
- **As a Windows app:** [download the installer](https://downloads.playeaw.com/EmpireAtWarBrowserEdition-setup.exe).
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
- `play.html?benchmark=100` starts the space benchmark, and `play.html?mode=land&benchmark=30` the land one.
- `viewer.html?model=EV_STARDESTROYER.ALO` opens the model viewer.

Other commands:

| Command | What it does |
|---|---|
| `npm run wasm` | rebuild the WebAssembly modules from `wasm/` |
| `npm run build:prod` | build the site into `dist/` |
| `npm run deploy:prod` | build and publish the site and the multiplayer lobby (`lobby/`) to Cloudflare |
| `npm run app` | build the Windows app (`src-tauri/`, Tauri) |

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

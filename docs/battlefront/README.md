# Battlefront: coverage and review notes

[See the five still comparisons and the firing and roll replays in the project README.](../../README.md#battlefront-land-battles-present-and-proposed) The deployment menu is [PR #6](https://github.com/Glenn332/Empire-At-War-Browser-Edition/pull/6)'s proposal. [PR #7](https://github.com/Glenn332/Empire-At-War-Browser-Edition/pull/7) integrates that menu with the field cameras and HUD. The comparisons use actual `main` (`d69de4b`) as the baseline, not the **Original** menu option in the patched build.

| Area | What was checked with installed retail data |
|---|---|
| Spawn map | All 15 base *Empire at War* and 24 *Forces of Corruption* land skirmish maps; spawn markers and their labels fit the disc. |
| Deployment portraits | Rendered silhouettes for all 26 base / 47 expansion distinct mobile vehicle model and animation pairs. Spot checks at wide and portrait sizes; selecting a class, switching layouts and spawning. |
| Infantry | Ranged infantry and hero samples including Stormtrooper, Rebel Trooper, Plex Soldier, Rebel Infiltrator and Han Solo. Zoom into a chest target, release and reverse; the dot stays on the same world point. Fire a rifle, pistol and launcher and compare their first drawn frame with the animated muzzle. |
| Vehicles | Enter and exit a Scout Trooper bike, T4-B tank, AT-ST and snowspeeder. Check the hull framing, seat view, saved infantry view and shared equipment panel. This is a driving sample, not a driving test of every portrait. |
| Projectiles | In each edition, read actual WebGL and WebGPU pixels of the red/green pill blasters and a blue, particle-atlas Jawa ion blaster. Check both ends, angled shots, the bright core and authored color. A proton torpedo must still select its original effect. |
| Strategy input | Real pointer movement at the edges of land, space and galactic strategy views, plus keyboard movement, map bounds and the saved opt-out. |

## How the GIFs were captured

The **left** half is browser `main` (`d69de4b`); the **right** half is the PR build (`2bba9c4`). Both runs use the same stock Stormtrooper, spawn coordinates on FoC Endor, third-person perspective and input timing. Each pane is captured from that build’s game canvas, with its own camera framing. The labels and crop are added afterward; the soldier animation and bolt are not drawn into the footage.

- **Firing:** one focused trigger press on each side produced the stock `Proj_Hand_Blaster_Red` at 330 world units/second. The clip advances 5 ms of game time per 50 ms display frame. While the shot is live, the inset renders its batch instance with the same material, length and width from a fixed rear view, isolated from terrain and muzzle flashes. The blank rear view on `main` is the observed result, not a missing capture.
- **Rolling:** both runs hold **D**, tap **V**, then release **D** on the same frame. The clip advances 20 ms per 50 ms display frame. Both troopers travel about 31 world units in this capture; only the PR trooper rotates upside down. A short hold at the end of each GIF separates loops.

[Full player-facing change list, including defaults, replacements and the #6 menu.](../../README.md#player-facing-change-list)

## Run the checks

From the repository root, `npm ci`, then run:

```sh
npm run test:deploy
npm run test:battlefront
npm run test:modules
npm run build:prod
```

For map and browser checks, point `SWR_GAME` at your own Gold Pack install and start the dev server with `npm start`. Install Chrome and make `playwright-core` available to Node (for example, `npm install --no-save --package-lock=false playwright-core`). No model, texture, animation or archive is included with the tests.

```sh
node tools/test-deploy-disc-catalog.mjs
node tools/test-deploy-framing-browser.cjs
node tools/test-shooter-view-browser.cjs
node tools/test-shoulder-aim-browser.cjs
node tools/test-infantry-presentation-browser.cjs
node tools/test-bolt-volume-browser.cjs
node tools/test-bolt-volume-browser.cjs --gpu
node tools/test-edge-pan-browser.cjs
```

The retail catalog and the first six browser commands default to FoC: repeat with `--base` for EaW, including `--base --gpu` for the bolt check. `test-edge-pan-browser.cjs` is a mode/input check, not edition-specific. Set `BASE_URL` for a nondefault server (default `http://localhost:8377`); set `CHROME` for a nondefault Chrome binary.

## Boundaries

- The combat visuals apply in Battlefront land battles, including other units' blaster shots in that battle. Ordinary RTS, space and restored non-shooter battles do not get these cameras or bolt shapes. Strategy edge scrolling is independent.
- The equipment view uses the unit's authored rig and muzzle; a rigid, recognizable weapon can supply a fallback. Unsupported rigs are not drawn as a whole body inside the camera. Melee heroes retain their third-person view. Missing deployment art falls back to the unit icon where available.
- The stock catalog checks are not a claim about every Workshop mod, custom texture atlas, or weapon loadout. Capture rules and projectile collision/damage are not redefined by the drawings. Focused local heat blasters no longer add hip-fire spread over the focus dot.

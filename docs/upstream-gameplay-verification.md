# Checking an Upstream gameplay release

The [proposal](upstream-gameplay-mode.md) explains the player’s choice. This page describes how to check a fork’s claim and what has actually been tested.

## Why loading a mod isn’t enough

A small [test mod](../tools/fixtures/submod-build-clock/Data/XML/DifficultyAdjustments.xml) changes an AI production setting on Easy difficulty. Main and a fork loaded the same setting and both passed existing mission and victory checks. But the same two AI orders took different amounts of **game time**, even after restoring the campaign state halfway to main’s deadline:

| AI order | Main | Fork gameplay | Local copy of main |
| --- | ---: | ---: | ---: |
| Merc squad on AlzocIII (Forces of Corruption + test mod) | 8 s | 16 s | 8 s |
| Naval Academy on Bakura (Thrawn’s Revenge + test mod) | 40 s | 80 s | 40 s |

The fork applied the galactic build-time multiplier where main chose the multiplier by production kind. Neither rule has to be “better” for the difference to matter to a mod author. Running a separate, unchanged copy of main restored both timings. **The fork did not ship this mode.** The check drove production directly; it did not test the save menu, AI decision-making, a whole campaign or multiplayer.

**Test setup:** [main `8fc96be`](https://github.com/Glenn332/Empire-At-War-Browser-Edition/commit/8fc96be3bb24faa5c42e42500ac0f7ef67830edf), [Marschitect fork `f5c4908`](https://github.com/Marschitect/Empire-At-War-Browser-Edition/commit/f5c4908fc9df8793111de6ce2738d40f938ef2b5), Windows, Node 22.17.0, Gold Pack Steam build `15987880`, Forces of Corruption, seed `7001`. Optional parent: Thrawn’s Revenge (Workshop `1125571106`, manifest `3674462059394366378`); the test mod loads last. The local copy used the same Node game-file reader as main. Its 371 static files matched the main build (inventory SHA-256 `e582b1ca4c7eb8d4066d2bab7dc1f5deb45efcbe418271ce05d5cfa439d42752`).

## Worked example: a match can still be a failure

In a separate headless Chrome trial of *Fall of the Republic*, the local main and fork candidates had **unreleased gameplay fixes not included in this proposal**. We played the Republic's Abregado Rae mission with FotR alone and with *Republic Reserve*, a Browser-native test submod that pays 500 credits once. The same campaign, mod order and player commands were used on both candidates.

| Player action | Observed on both candidates, with and without Reserve |
| --- | --- |
| Let the Plo rescue cutscene play; take the Twilight to the escape marker | The mission declared the CIS the battle winner. Continue returned to the Republic campaign; saving and reloading kept the Naboo garrison and did not repeat the Reserve payment. |
| Skip that cutscene; order the replacement Twilight to the escape marker | The replacement ship was lost. The escape objective stayed active for at least 90 more simulated seconds without a battle result or campaign return. |

Report the second row as **matched main; mission did not complete**, not as a successful mission or a proven permanent softlock. This was one campaign on a local folder-loading route (FotR item `1976399102`, manifest `1441547591306610300`), not a test of the public releases, a shipped fork mode, or original-game parity. The timing check below, unlike this later trial, runs on the unmodified pinned main build.

## Repeat the timing check

Set `SWR_GAME` to your Gold Pack installation. From **each engine checkout’s root**, run the same [reference script](../tools/test-submod-build-clock.mjs) with its adjacent fixture unchanged. Replace the example paths with your own:

```sh
node /reference/tools/test-submod-build-clock.mjs
node /reference/tools/test-submod-build-clock.mjs --thrawns-revenge /steam/workshop/content/32470/1125571106
```

The script reports the build duration, time left after restoring the campaign, and whether the order completed at main’s deadline. Exit 0 means the trace matched; a missing game installation is a setup error, not a gameplay difference. No retail or Workshop files are supplied.

## Before advertising a shipped mode

- **Check the package.** Use a trusted release or a recorded clean build. Compare the extracted final sites with `node tools/verify-submod-bundle.mjs /trusted/main/site /fork/upstream-mode/site`. Matching files establish what was packaged, not what ran. A link to main’s website is a link, not a fork-hosted mode.
- **Check the launch.** Use a separate browser origin so the fork’s service worker, caches and storage cannot affect play. Verify what the deployed URL serves on first launch, after an update and, if supported, offline. Match headers, external dependencies and services; on desktop, check the file and Workshop bridge too. Never mix fork scripts or mandatory mods into the main build. Import a copy of a save only when the player asks; don’t overwrite the original.
- **Check play, not just startup.** Use the same retail build, language, mod versions, order, settings and starting save or seed. Repeat the same commands and compare campaign, battle and save checkpoints. Include changes to what players can see or do; don’t require identical frame times or identical unseeded runs. If multiplayer is claimed, complete a session with compatible peers and compare commands, synchronization and reconnect/save where main supports them. Cross-version saves and cross-version multiplayer are separate claims.
- **Share a result others can check.** For example: `Fork build: __ | Main build and checksum: __ | Launch URL/app version: __ | Edition and mod-loading method: __ | Mod versions and load order: __ | Scenarios and outcomes: __ | Failures / not tested: __ | Test log: __`. Record relevant service versions. Don’t advertise the mode for an unverified build or configuration. If testing the fork’s changed engine instead, report the specific mods and scenarios that matched, not a blanket promise.

# Can the same submod run on my fork?

**Status: proposal for review, not an adopted standard.** A submod is a content package layered over another mod. An engine fork is a different build of Browser Edition. A fork is free to diverge; the purpose of a compatibility claim is to tell a player which upstream content behavior they can count on, not who may publish a fork. Nothing here changes the loader or requires existing mods to ship a manifest.

For a promise about a **whole game**, rather than one feature, see the [upstream gameplay mode proposal and campaign experiment](upstream-gameplay-mode.md). It distinguishes shipping the reference runtime from running the fork's changed engine.

## What a release can claim

Compare a **specific fork build directly to a specific upstream commit**, using the same game edition, input files, order and settings. A profile is a named set of observable behaviors and passing examples. A claim covers only the profile revision and loading routes actually checked. It does not prescribe a language, storage format, menu layout or internal API.

- **Fork maintainers:** publish the candidate commit, upstream commit, profile and suite revision, editions, loading routes, results and known exceptions. Link the test output or reproduction steps. Rerun for each release that advertises the claim; a new `main` does not move an old claim forward.
- **Forks of forks:** use the unchanged upstream fixtures and expectations on the build you ship. Passing a parent's modified suite or inheriting a badge is not evidence. A third-generation fork can pass even if its parent diverged, or fail even if its parent passed.
- **Mod authors:** in an ordinary README, name the edition, parent mod and version, load order (low to high), and any required profiles or fork-only features. For example: `FoC; Example Fleet 2.0 then Patrol Patch 1.1; loose-stack/1; also requires the upstream faction command-bar feature`. No registry, Workshop ID or new file is required.
- **Extensions:** a fork may add capabilities. Give fork-only data a distinct name or opt-in mode, and keep unchanged upstream content working in the claimed configuration. If a bundled mod changes the result, document the clean compatibility mode and test it. A submod that *requires* an extension is not automatically portable back to upstream or sideways to a sibling fork.

Example release note (placeholders): `Build <fork SHA> vs Glenn332/Empire-At-War-Browser-Edition@<SHA>; loose-stack/1; suite <commit or file hash>; EaW + FoC / dev-server loose folders: PASS; browser folders: not run; evidence: <log>`. Any failed rule means **not conforming for that configuration**; report an untested configuration as **not tested**, not as a pass. These are self-reported results, not upstream endorsements.

## First profile: `loose-stack/1`

This profile answers one question: **which bytes does the engine see for a loose `Data/` file?** Mount only enabled content. Start with the chosen edition's game files; apply mods in the player's order, low to high. For the same logical path the last layer wins, regardless of ASCII letter case or slash direction. A missing file falls through; a zero-byte loose file hides the lower file rather than exposing it or returning empty text. A later nonempty file can restore it. A patch replaces the whole file at this boundary, not selected XML nodes. There is no requirement to merge conflicting mods or to infer their intended order.

The [reference probe](../tools/test-submod-stack.mjs) makes an original, synthetic game tree and two loose mods. They need no game installation or network. `Winner` is changed by both mods, `Mask` is zero bytes in Patch, `ParentOnly` is absent in Patch, and `Edition` exists only in the game tree. These are file reads, not an attempt to boot a synthetic game.

| Enabled mods (low to high) | Winner | Mask | ParentOnly | Edition |
| --- | --- | --- | --- | --- |
| none | `base` | `base` | absent | selected edition |
| Parent | `parent` | `parent` | `inherited` | selected edition |
| Parent, Patch | `patch` | absent | `inherited` | selected edition |
| Patch, Parent | `parent` | `parent` | `inherited` | selected edition |

**Dev-server loader.** From the upstream checkout run `node tools/test-submod-stack.mjs`. Then, from the root of the fork checkout, run `node /path/to/upstream/tools/test-submod-stack.mjs`: the runner stays fixed and imports the loader from the current directory. Expected last line: `loose-stack/1: PASS (dev loader; 4 stacks x 2 editions)`. Record both commits and the suite revision separately: the reference engine commit can predate the probe. A fork with different internals may use an adapter to mount the same fixtures and read bytes through its real loader; publish the adapter and do not change the inputs or expected results.

**Browser folder loader.** A dev-loader pass is not a browser pass. From the checkout root, start a read-only local file server on an unused port:

```sh
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/tools/submod-browser.html` in a Chromium browser and choose **Run with browser-owned folders**. The probe creates real directory handles in the browser's private filesystem, imports them through the game's folder APIs, enables and reorders the mods, then reopens the saved handles from IndexedDB in a fresh frame for each row. Reads use the production VFS, not the dev server. The page refuses an origin with existing game storage. Use a new port for each changed build so cached modules cannot hide a change. Stop the server with Ctrl+C.

To check OS-backed handles separately, run `node tools/test-submod-stack.mjs --keep`, choose **Choose generated folders on disk**, and pick the printed fixture directory, not your game installation. This reads the disk fixtures without editing them. Record which handle source you tested. Neither option tests the game's picker UI, permission recovery, archive import or Workshop discovery. To compare a fork that does not yet ship the probe, copy the unchanged `tools/submod-browser.html`, `tools/submod-browser.js` and `tools/submod-fixture.js` from the suite revision into its `tools/` folder, and serve that checkout on its own port. Do not copy the engine modules.

**Initial dev-loader results.** We ran the original standalone probe (Git blob `e2c8d5f0fe12b68b05e389b1bfcd1b2a1fc53add`, Node 22.17.0 on Windows) against three targets. The Node and browser probes now use [shared fixtures and stack expectations](../tools/submod-fixture.js).

| Target | Dev-loader result |
| --- | --- |
| [Upstream `8fc96be`](https://github.com/Glenn332/Empire-At-War-Browser-Edition/commit/8fc96be3bb24faa5c42e42500ac0f7ef67830edf) | Passed all four stacks in EaW and FoC. |
| [Marschitect fork `f5c4908`](https://github.com/Marschitect/Empire-At-War-Browser-Edition/commit/f5c4908fc9df8793111de6ce2738d40f938ef2b5) | Passed the same eight cases. Its loader and the two language modules it imports were byte-identical to upstream's; this tests reuse across checkouts, not an independent loader implementation. |
| Negative control: upstream loader with only the supplied mod list reversed | Failed on EaW / Parent, Patch: `Winner` returned `parent`, expected `patch`. |

Both upstream and the fork also passed the Node probe after the fixtures were shared. These are observations, not a claim by the fork maintainer.

## Second profile: `tactical-faceplate/1`

A tactical faceplate can use a texture under `Data/Art/Textures/CommandBar/<faction>/`. With a base `probe.png` and an Empire-only replacement of the same name, **Empire must paint the replacement while Rebel must still paint the base**. Disable Patch and both must paint the base again. This profile is for a PNG texture on a tactical faceplate. It makes no claim about galactic bars, replacement ALO models, component XML, the rest of the HUD or an entire playable mod.

The [browser probe](../tools/submod-browser.js) constructs the real tactical `CommandBar` around a synthetic textured quad. It discovers skins through the mounted VFS, waits for the game's own draw call and samples an interior pixel of the resulting canvas. The table gives expected opaque RGB values in **both** editions; a missing or transparent plate fails. The base and patched colors are generated test art, not retail assets.

| Patch enabled? | Empire faceplate | Rebel faceplate |
| --- | --- | --- |
| No | blue `(30, 90, 180)` | blue `(30, 90, 180)` |
| Yes, in either tested order | orange `(240, 96, 32)` | blue `(30, 90, 180)` |

**Browser pilot:** Upstream `8fc96be` on Windows, Chromium 152 (Electron), browser-owned handles: all eight folder configurations and all sixteen rendered faceplates passed. The success line is `PASS: 8 folder stacks, 16 tactical faceplates (browser-owned handles)`. As a negative control, we temporarily made the HUD choose the Empire skin for every faction. EaW / Parent + Patch then failed on Rebel: expected blue, painted orange. The control is not part of the patch. Disk-backed handles, the public fork's browser build and full gameplay were not verified in this run.

Suite fingerprints for this run (Git blob prefixes): browser JS `644e75f`, page `edebfa1`, shared fixtures `b7e906a`, Node probe `81b4582`. Run `git hash-object tools/submod-browser.js tools/submod-browser.html tools/submod-fixture.js tools/test-submod-stack.mjs` to compare a copy.

## What would make a broader claim credible?

Loading the right Lua or XML file is not the same as running it correctly. For example, a fork that reverses mod order fails the first profile. A fork that loads the right files but ignores a faction's custom command bar can **pass** it while visibly breaking that submod. Passing every published profile still means **all those checks passed**, not “every mod plays the same.” The [whole-game contract](upstream-gameplay-mode.md) makes that distinction explicit.

Before adding a profile, propose one player- or author-visible behavior and a redistributable fixture with expected results on a pinned upstream build. Next candidates are XML registration, Lua runtime hooks and loose-vs-MEG precedence. Browser archive import and desktop Workshop discovery need their own route checks. Cross-build saves, multiplayer interoperability and identical performance are separate promises, not implied here. Use the [progress list](../progression.md) to distinguish upstream limitations from fork regressions.

For adoption, first have upstream and one independently maintained fork reproduce the table on a route they actually ship. Add profiles by ordinary upstream PR with fixtures and evidence. Keep published revisions available; incompatible expectations get a new revision, not retroactive edits to an old baseline. If a real mod breaks despite a pass, record the mod/version, order, edition, two engine commits and a minimal reproducer. Correct a false claim or propose a new case, rather than special-casing that mod. No central registry, approval service or CI deployment is needed to try the pilot.

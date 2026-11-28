# Fork mod compatibility standard (proposal)

**Test the fork you ship against a named main Browser Edition web build.** A mod that relies on the behavior you claim must work unchanged: same files, edition, settings and load order. Mod authors do not need to port, repackage, re-upload or add a manifest. The reference is the main web build, not the original Windows game, the tip of `main`, or the fork you branched from.

## What to preserve and how to check it

1. **Pin a reference.** Name the main commit and your fork build. Choose a *profile* (a versioned description of behavior mods can observe) and a loading route your release actually offers. A dev-server result is not a browser-folder result.
2. **Build against the behavior, not the implementation.** Preserve how existing mod files are interpreted. You can replace the loader, rewrite the renderer, or add features. Make conflicting extensions opt-in or give them distinct names; test with the configuration players will use. A mod that opts into a fork-only extension is not thereby portable to main.
3. **Test both builds directly.** Use the same suite revision, unchanged fixtures and expected results, editions, settings and mod order on main and on the fork's own engine. Do this for **every release** that claims compatibility, however far it is from main. If A forks main, B forks A and C forks B, C still tests C against main. B passing is neither necessary nor sufficient for C to pass.
4. **Publish the scope.** Report each profile, edition and route as `PASS`, `FAIL` (an observed mismatch), or `NOT TESTED` with a reason. A setup/adapter error is not a pass or evidence of an engine mismatch. Link the output, suite revision and any adapter used. Changing the reference requires a new comparison; never change old expectations to make a fork pass.

Example release note (placeholders):

```text
Fork C @ <sha> vs Glenn332/Empire-At-War-Browser-Edition @ <main sha>; suite @ <sha>
EaW + FoC / browser folders (browser-owned handles), default mod configuration
loose-stack/1: PASS | tactical-faceplate/1: NOT TESTED (no HUD adapter) | evidence: <log and adapter>
```

## Initial profiles

`Parent` and `Patch` below are loose mods, not engine forks. The [shared fixture](../tools/submod-fixture.js) contains original test files and two solid-color textures; neither a game installation nor a Workshop download is needed. Run the four orders in both *Empire at War* (EaW) and *Forces of Corruption* (FoC).

### `loose-stack/1` — which file wins?

Start with the selected edition's files and apply only enabled mods, low to high. For the same logical `Data/` path the last layer wins, ignoring ASCII case and slash direction. A missing file falls through. A zero-byte file **masks** the lower file (absent, not empty text); a later nonempty file can restore it. The replacement is a whole file, not an XML merge.

| Enabled mods (low → high) | Winner | Mask | ParentOnly | Edition |
| --- | --- | --- | --- | --- |
| none | `base` | `base` | absent | selected edition |
| Parent | `parent` | `parent` | `inherited` | selected edition |
| Parent, Patch | `patch` | absent | `inherited` | selected edition |
| Patch, Parent | `parent` | `parent` | `inherited` | selected edition |

### `tactical-faceplate/1` — which texture is painted?

Given a base `probe.png` and Patch's replacement under `Data/Art/Textures/CommandBar/Empire/`, render a tactical faceplate referencing that texture. Sample an interior pixel for each faction. Both editions must produce these opaque RGB values. This checks the rendered result, not just whether the replacement file can be opened.

| Enabled mods | Empire | Rebel |
| --- | --- | --- |
| none; Parent only | blue `(30, 90, 180)` | blue `(30, 90, 180)` |
| Parent then Patch; Patch then Parent | orange `(240, 96, 32)` | blue `(30, 90, 180)` |

These are **independent, limited claims**. Passing both does not establish support for every mod. For example, XML registration, Lua hooks, and loose-vs-MEG archive precedence have no profile here. To add a profile, specify one mod-visible behavior, supply a redistributable fixture and verify the expected result on a pinned main build. Preserve old revisions; incompatible expectations need a new revision. If a real mod regresses despite a pass, publish the mod/version, order, builds and a minimal reproducer; narrow the claim or add the missing case.

## Run the reference checks

**Dev-server loader (`loose-stack/1` only).** From the reference engine checkout, and again from the candidate checkout, run `node /path/to/suite/tools/test-submod-stack.mjs`. The script and expectations come from the suite; the loader comes from the current directory. Expect `loose-stack/1: PASS (dev loader; 4 stacks x 2 editions)`. For a differently structured loader, use the same [fixture files and read cases](../tools/submod-fixture.js) with an adapter that mounts and reads them through the fork's real loader.

**Browser folder loader (either or both profiles).** Place `tools/submod-browser.html`, `tools/submod-browser.js`, `tools/submod-fixture.js` and `tools/submod-browser-adapter.js` from the same suite revision in **each** checkout. Don't copy any engine modules. From each root, serve the checkout on a fresh, unused loopback port:

```sh
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/tools/submod-browser.html` in Chromium. Choose one profile or both and **Run with browser-owned folders**. The probe mounts directory handles, selects each stack and reopens it in a fresh frame. It reports the folder reads and rendered colors separately; one mismatch does not prevent the other profile from running. Use a different port for the other build. To check OS-backed handles, run the Node probe with `--keep`, then **Choose generated folders on disk** and select the fixture directory it printed, not a game installation. Record which source was tested. Neither option exercises the game's picker UI, archive import or Workshop discovery.

**If your fork has different internals:** replace only the [browser adapter](../tools/submod-browser-adapter.js) and publish it with your results. No upstream module names, HUD classes or database layout are part of the standard. The runner owns the cases and expectations; the adapter operates the fork and returns observations, never canned fixture answers:

| Adapter export (async allowed) | What it does |
| --- | --- |
| `mount(root)` | Import the `game`, `Parent` and `Patch` directory handles through the fork's real folder route. |
| `selectStack(edition, mods)` | Select `eaw` or `foc`, enable only the listed mods in low-to-high order and persist the selection for a fresh frame. |
| `mountedMods()` | In that frame, return the active mod names in order, or `null` if the game folder isn't mounted. |
| `readText(path)` | For `loose-stack/1`, read through the active loader; return text or `null` for absent. |
| `faceplatePixel(faction)` | For `tactical-faceplate/1`, render the actual tactical HUD using `probe.png` and return the sampled `[r,g,b,a]`. |
| `reset()` | Release the test mount and remove only the adapter's test state. |

Omit an unsupported profile's `readText` or `faceplatePixel` export to report `NOT TESTED` without blocking the other profile. Do not import an unused renderer just to test the loader.

## Pilot evidence

On Windows, the same suite was run against [main `8fc96be`](https://github.com/Glenn332/Empire-At-War-Browser-Edition/commit/8fc96be3bb24faa5c42e42500ac0f7ef67830edf) and the [Marschitect fork `f5c4908`](https://github.com/Marschitect/Empire-At-War-Browser-Edition/commit/f5c4908fc9df8793111de6ce2738d40f938ef2b5). Both passed the eight dev-loader stacks (Node 22.17.0). Both also passed the eight browser folder stacks and sixteen faction samples (headless Chrome 157.0.8103.79, browser-owned handles). These are observations on those revisions, not an endorsement or a claim about a deployed site. Disk-backed handles were not tested in this comparison.

Two isolated changes to the reference engine checked that the results are independent: returning the wrong `Winner` text failed only `loose-stack/1`; painting the Empire texture for Rebel failed only `tactical-faceplate/1`. Neither change is included in the suite.

# Proposal: An optional mod compatibility standard for forks

A fork is another version of Browser Edition. **Upstream** means the main Browser Edition project. The proposal standardizes what a fork can tell players about mod support, not how authors package mods. It does not add a mode to the game today.

A **Browser-native** mod targets Browser Edition; a **Legacy** mod targets the original *Empire at War* or *Forces of Corruption*. A mod can target both. These terms describe the intended game, not a file format or a compatibility badge. For either kind, a fork can offer the following choice:

| If you want to… | Choose… | What runs |
| --- | --- | --- |
| Play a mod the way it plays on a particular main release | **Upstream gameplay — [release]** | That exact release, unchanged |
| Play with the fork’s balance changes, fixes or new features | **Fork gameplay** | The fork’s own engine |

For example, suppose you play *Thrawn’s Revenge* with a patch that loads after it. On a fork offering the main release you used, choose **Upstream gameplay** before opening your campaign. Select the same game edition and mod versions, then load *Thrawn’s Revenge* first and the patch second. **The mod author doesn’t need to port the patch, publish it again or add a new file.**

## What the label means

With the same game files, mods, load order, settings and starting state, the rules should match the named release: units cost the same, orders take the same game time, and battles, scripts and saves work as they do there. Its limitations come with it. The label does **not** promise that the mod works on a newer release, in Fork gameplay, or in multiplayer. A fork of a fork still compares itself directly with the named main release, not its parent.

A fork that runs only its own engine can still say, for example, “Mod files loaded in the same order as main `8fc96be` in our browser folder test.” It should not label that **Upstream gameplay**. See the [runnable checks for specific behaviors](submod-compatibility.md). For a Legacy mod, matching Browser Edition is a different claim from matching the original Windows game.

## Checklist for a fork maintainer offering Upstream gameplay

1. **Name the release.** Pin an exact main build. Show it in the mode chooser before opening mods or saves; don’t silently upgrade an existing campaign.
2. **Keep the modes separate.** Launch the unchanged main build without fork code or extra mods. Keep saves and settings separate. If the build is unavailable, tell the player rather than switching engines.
3. **Test what players get.** On main and on the fork as shipped, play the same modded campaign: build a unit, trigger a mission, fight space and land battles, save, reload and finish. Compare outcomes. Test multiplayer separately before claiming it.
4. **Publish the limits.** Name the builds, edition, platform, how the mods were loaded, and what passed, failed or wasn’t tested. Withdraw a claim if a difference turns up. Passing a few checks is not a guarantee for every mod.

**Suggested first step:** One volunteer fork tests one single-player campaign on one named release and shares the results. No fork has to adopt the mode. See the [timing experiment and verification steps](upstream-gameplay-verification.md) for why testing matters.

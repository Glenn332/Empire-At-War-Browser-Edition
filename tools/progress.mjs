import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = 'done',
  P = 'part',
  T = 'todo';

const GROUPS = [
  [
    'Data formats',
    'space',
    [
      ['MEG archives, override order, loose files', D],
      ['XML database with variant inheritance', D],
      ['MasterTextFile strings', D],
      ['ALO models: skeleton, meshes, materials, proxies', D],
      ['ALO particle systems', D],
      ['ALA animations (base game and FoC layouts)', D],
      [
        'TED maps: objects, bounds, lights, skydomes',
        D,
        'each skydome is turned as any object is: Rz(z) Rx(x) and the model quarter turn (minis 29 to 32). Every battle, space or land, skirmish, multiplayer or campaign, starts in a random one of the map environments, stepping past one named Cinematic (Load_Map); the index the map stores is not used for that. Lua Set_New_Environment switches to environment n. Not done: one Load_Map path (map chunk 0x201, not identified) keeps the stored index; the type-filtered chooser has no callers'
      ],
      ['DDS textures (DXT1/3/5, RGBA, mipmaps)', D],
      ['MTD/TGA icon atlas', D],
      ['SFX and music event tables', D],
      ['Command bar definition (CommandBarComponents.xml)', D],
      ['Shadow-blob materials', D],
      [
        'Compiled shaders (.fxo)',
        P,
        'not run as they are: each is re-written by hand. The terrain, water and all three Planet techniques were re-written from their disassembled bytecode; other mesh and shield programs still use parameter-based reproductions. Planet reads authored FXO LOD and cleanup annotations, sampler parameters and fixed-function pass/global sampler states, including mod anisotropy and resource-patched state exclusion. Native D3D9 HAL fixtures execute the original base and mod programs; flat interiors and the full transformed-lighting fixture match browser RGB byte for byte'
      ],
      [
        'Game fonts',
        D,
        'the four EmpireAtWar typefaces are embedded in the executable and read out of it. Our own extension, not an engine feature: every .ttf/.otf under Data/Fonts is loaded, a mod font replaces the face its file name says (Data/Fonts/EmpireAtWar-Medium.ttf, Data/Fonts/Arial.ttf) and is also known by its family and full name; the topmost mod wins. The dev server hands mod fonts to GDI; mods chosen on the start page get their glyph pages drawn in the browser with the same cell metrics and advances as GDI (unhinted, a few advances off by one). A font that is not one of the game faces keeps the game credit sign: $ is taken from the matching original EmpireAtWar face (kept as Data/Fonts/Game/*.ttf, which no mod overrides) in page text and glyph pages, unless the modinfo.json of the mod the font comes from sets includes_credit_symbol to true (then the font keeps its own $)'
      ],
      [
        'Native UI font rendering',
        P,
        'Native WindowsFont and StringTexture calls generate portable per-face, integer-height, float32-stretch and UTF16-page glyph assets from the normal overlay. CreateFont weight400 for resource dialogs and History labels and weight700 for command-bar Text/TextButton components, with full face names, quality4, retained average width, GDI advances and tmHeight, replace browser measurement and synthetic styles. Normal and component variants have distinct browser and server cache keys. Conquest script controls, screen text, readouts, planet names, encyclopedia cards, overview and Base Layout labels and stack/queue counts use their native component weight. Shared component rendering uses raw-advance Max_Text_Width point fitting down to6, actual bitmap-width justification, unscaled model Text_Offset and native outline/emboss effects. The TextComponent integer physical half-width alignment path is retained separately. Production icons show the native second-label price and native queue/population-based color rather than the former invented queued count. Native C_Text lookup, static <= wrapping and line pitch, strict list wrapping, last-glyph padding, even bitmap widths, raw coverage RGBA, asymmetric outline borders, emboss shadow and additive shine are implemented. Independent GDI probes match twelve glyph masks byte for byte; automated fixtures retain original embedded-font hashes and native outline output. Glyphs and composed map labels are cached. Repeated readouts retain their canvases; pending font/page loads cannot restore stale labels. Native glyph quads counter CSS layout width quantization before compositing, snap idempotently to physical pixel origins and resnap when a hidden shell opens. Native dialog resize reflows current fonts, static wrapping, list row metrics and glyph clipping while preserving control nodes, selection and retained list handles. Radio_Button and Check_Box fonts and plain radio label offsets now follow native gadget categories. Normalized sprite dimensions, middle-sprite button height and radio sprite bounds are retained. Native static text has no parent clipping. Raw resolution, font and screen-specific code traces reproduce the narrow-aspect wrapping conditions behind Planet Info heading/list collisions and History hint overflow; the original game has not been observed at that exact window size. Planet Info now uses native fullscreen anchor9, a screen-sized frame and truncated RC centering offsets, while anchor0 dialogs retain fractional centering. Exact native overflow is retained by user choice; no browser-only responsive fitting is applied. The Windows dev server lazily caches atlases; without it the CSS compatibility path draws the text. Earlier normal-weight 1..128 export verified3840 atlases including a second Unicode page in162seconds; current small portable-pack checks retain both weight variants and Unicode pages. Component regressions cover point fitting, effects, resize, cache reuse, stale text and snapping. Live base/mod checks cover overview, Base Layout, scripted campaign setup, production price/progress labels and font rebuilds at1743x1244 and1920x1080; all45 visible mod setup text controls use native glyphs. Native language IDs and whole-DAT fallback share the resolved text and font language. Japanese and Russian request Arial; Russian clamps authored sizes to7 before point or pixel conversion. IDs5..10 exclude the exact unsuffixed EmpireAtWar and Arial Unicode MS names while preserving suffixed and custom faces. Modern hosts retain ANSI charset0, with a separate charset128 atlas variant for the native Windows2000 Japanese branch. Native stretch deadband and float32 rounding retain the first font inside the threshold. Browser queries select the initial context without changing saved preferences. The live game.setLanguage compatibility API follows native GUI refresh: serialized whole-DAT publication, descriptor rebuild from authored metadata, composed text invalidation, in-place layout, retained-key translation and owner callbacks, including same-language requests. Native lists keep row selection, scrolling and live handles; historical literal messages are not reverse-translated. Planet Info, all four log pages, map labels, radar accessibility names, overview and Base Layout, Lua controls, type cards and screen text refresh without panel reconstruction. Story titles, retained chapter text and summary row labels refresh without replaying speech, movies, timers or selection callbacks. Slow glyph completion cannot restore expired screen text, and native point fitting stays resolution driven. Fourteen live translated-DAT checks verify Russian/French/English round-trips, native face restoration, panel/campaign identity, pause counters, script states, Summary sorting and story cursors without console errors. Action points remain for native Steam/OS language selection. Portable exports include the resolved faces and translated UTF16 pages. All11 language policy fixtures, translated DAT integration, fallback, component preload, charset/style cache separation, native GDI hashes and base/mod conquest checks pass. Action points: port legacy tactical/menu text, shared default-font constructor-order handling for differing mod defaults, and expanded original-engine image comparisons.'
      ],
      [
        'Lua scripts (object scripts, AI plans, game scoring)',
        D,
        'a Lua machine is in (Fengari, with what the game own Lua 5.0 environment has around it) and the scripts a skirmish uses run as they are: the object scripts of the data in space battles - each scripted unit its copy, serviced at its rate, with the engine functions those scripts call (the unit, its owner, its type, abilities, finding and spawning things, proximity events, perceptual equations); the game-scoring script, one copy for the battle, told of its start and end, of every unit destroyed and of everything built (the battle summary takes what each side lost from it); the AI plan scripts in space and on land (see Skirmish AI). A function not written yet does not stop a script: it is counted and can be listed. Story scripts belong to the campaign: see Galactic conquest'
      ],
      [
        'Bink movies',
        P,
        'original Bink 1 commandbar movies decode through a lazy single-thread FFmpeg worker, with at most two bounded RGBA chunks retained. Movies.xml supplies file, alpha, start frame and commandbar offset; shell bones and GameConstants supply placement and tint. Native playback forces 30 fps, independent of the file rate and subtitle lifetime. COMMANDBAR_MOVIE replaces the current movie, looping and STOP_COMMANDBAR_MOVIE work, and EOF removes its quad. Base Light_Loop and real-mod Pestage_Loop archive tests verify alpha, animation and exact sequential versus chunk-seek output; independent native FFmpeg produced identical alpha. Player and options-menu pause freeze the current movie; simulation-only story pauses let it continue. Action points: full-screen cinematics, Bink audio, movie music and XML pause flags, smaller decoder distribution, and investigate intermittent commandbar worker memory bounds warnings during mod campaign reloads'
      ],
      ['Save games', P, 'own save format (store in the browser, download, import); the original .sav files are not read'],
      [
        'Campaign and story XML',
        P,
        'CampaignFiles and TradeRouteFiles are read, including all faction Story_Name bindings, ordered Lua_Script groups, nested Active_Plot entries and story event parameters. Action points: the complete event and reward catalogue and original save serialization'
      ]
    ]
  ],
  [
    'Rendering',
    'space',
    [
      ['Mesh shaders: bump, gloss, team colour, additive, alpha', D],
      ['Vertex-shader skinning', D],
      ['Particle emitters', D],
      [
        'Laser bolts and beams',
        D,
        'custom drawn bolts from the texture atlas; a shot type that names a model instead (Projectile_Custom_Render 0, as many mod lasers do) is drawn as that model, instanced'
      ],
      [
        'Shots shown by their model: meshes, particle proxies, particle files',
        D,
        'muzzle flashes, missile exhaust and smoke trails are the model particle systems, started with the shot and left to run out when it ends; particle size is not scaled by Scale_Factor (read from the engine)'
      ],
      [
        'Particle emitters: the inherit-velocity flag and factor',
        D,
        'as the engine: an emitter with its inherit flag set (mini 0x43) moves its world particles each frame by the emitter current velocity times its factor (mini 0x28, default 1); without the flag nothing of the emitter speed is passed on. Ships and shots, space and land, hand their velocity to the effects they carry; object-space particles move with the emitter as before'
      ],
      [
        'Particle systems on a removed object: remove or let run out by the system flag',
        D,
        'as the engine: the particle system byte in chunk 2 (default on) decides; off (most ship engine effects) the effect goes at once, on it stops emitting and runs out where it was, at the last velocity. Used when a ship or death clone is removed and when a shot ends, space and land'
      ],
      ['Skydomes and backdrops', D],
      [
        'Planet shader: clouds, atmosphere, city lights',
        D,
        'all stock Planet techniques are ported from original FXO disassembly: DX9 sph_t3, DX8ATI sph_t2 with clamped vertex specular and its positive cloud-alpha city term, and fixed-function t0 with inverse-transpose normals, material lighting and unscrolled texture stages. Detail1 falls through to t0 because the effects contain no DX8 technique. Native FXO annotations select the first supported technique within the requested detail. Full material parameter keys prevent shared surface textures from aliasing cloud, atmosphere, specular and city values. Original base and mod HAL renders cover varied sampled normals, cloud scroll, nonuniform rotated world matrices, geometric specular and two fill lights; all transformed-fixture RGB pixels match exactly. GLSL does not execute arbitrary replacement shader bytecode; see Compiled shaders'
      ],
      ['Fog of war: grid tiles, regrow, reinforcement overlay', D, "the original has no 'explored' shade; fog grows back after 6 s"],
      ['Selection rings with stencil masking', D, 'rings of neighbouring units join into one outline, as the material defines'],
      ['Wrecks with break-up animations', D],
      [
        'Engine glows',
        D,
        'effects on bones (engines, death clones, props) turn with the bone, so trails leave the thrusters; PTE_ turbo proxies run only while a TURBO ability is active, and vertex burst emitters burst on every mesh vertex; ship and death-clone effects keep their authored size, not scaled by Scale_Factor, as the engine does'
      ],
      [
        'Shield shell: scrolling energy, edge glow, flash and swell on hits',
        P,
        'shader rebuilt from its parameters; impact emphasis is an addition'
      ],
      [
        'Hyperspace arrival',
        D,
        'flown in as the program does it (its exit-hyperspace state, read from the engine locomotors): the ship starts 10,804 behind its arrival point and moves by the game table of 150 frame steps - 25 frames of nothing, 10 at 750, a braking ease to 8.125, 75 at that, an ease to rest; it is drawn from frame 35, when the arrival sound plays, and comes up out of the dark over the remaining 115 frames (the engine puts an unnamed light effect of colour 0,0,0 on it for that long: read here as a fade from black). The streak, flash and squash that were ours are gone, as is the stagger within a squadron. The stagger of a whole fleet arriving at once (a campaign) is not used'
      ],
      [
        'Turret aiming: turn and elevation with travel limits',
        D,
        'only defence satellites and a few Underworld hardpoints are turrets in the data; capital-ship gun mounts are fixed'
      ],
      ['Idle, deploy and build animations', D],
      [
        'Attack animations',
        D,
        'nothing to do: no space skirmish unit has one in the game files (only the Eclipse, the Death Star and land units do)'
      ],
      ['4K asteroid surface (generated)', D],
      [
        'Shadows',
        P,
        'sun shadows cast by the large pieces of large ships only, to keep the cost low; off by default, switched on in the menu'
      ],
      ['Heat haze from heat particle emitters', P, 'optional, off by default; strength set by eye'],
      ['Bloom', P, 'optional, off by default; cutoff and strength set by eye'],
      ['Lens flare from LensFlares.xml', P, 'optional, off by default; only ships block it, not the planet'],
      [
        'Space battle camera',
        P,
        'from TacticalCameras.xml Space_Mode (a mod has its own): start tilt, tilt range, field of view, start and nearest distance, a wheel notch moving the distance and narrowing the view as the game does, the zoom-tilt rule. Ours: it pulls back past Distance_Max to 9000, the distance is not smoothed (the game eases it over Distance_Smooth_Time), no tactical overview. The start yaw is the file Yaw_Default as a world angle, as the engine has it. Ours: C on a selected unit follows it with a free orbiting camera (HUD hidden, mouse orbits, wheel zooms, C or Escape leaves), moving to the next squad member when it dies; Alt+C (rebindable) follows the middle of the squad'
      ],
      [
        'Space: lines to move destinations',
        D,
        'prediction paths: with ShouldDisplayPredictionPaths on (a GameConstant, false in the game, true in the EaW Remake mod) a selected ship shows its route to where it was sent as straight lines in RGBA 128 255 128 128, points closer than 20 joined. Waypoint lines: while Alt is held or the waypoint order is armed, the waypoints of the selected units are joined by lines in RGBA 255 128 128 128 with a w_waypoint_beacon.alo post (WaypointFlagModelName) on each. Ours: each unit shows its own legs where the engine keeps one waypoint list per moving group; the line width is not read; the short marks across the prediction path and the moving dashes of a looping waypoint path (we have no loops) are left out'
      ],
      [
        'Space: squadrons let out by a ship or station',
        D,
        'as the engine: out ahead of the ship along its facing as far as its size; from a ship that moves, with a guard order on it (the player guard order, as EscortEvent): they keep by it as it goes, chase within Guard_Chase_Range and come back, and when it dies the order becomes a move to where it was last; from a station they wait where they came out; the white flag (st_garrison_icon, i_garrison_flag.tga) is drawn beside the icon of our own and allied ones. Ours lets them out of the fighter bay with the ship radius as the distance, where the engine may use a bone and a distance of the spawn data; the flag place beside the icon is ours'
      ],
      [
        'Space: squadron icons (the grab bar)',
        D,
        'as the engine st_grab_bar, drawn from its CommandBarComponent: the whole button, its Blank_Texture_Name frame (the game: a dark square in a white border) and the icon, times one colour - the player colour, the faction colour in a campaign battle, at the alpha of the component Color (Engine PrimAlpha is tex times diffuse, read from its ps_1_1) - the Selected_Texture_Name (the game: a gold border) over it when selected, Mouse_Over_Texture_Name under the cursor; a mod draws them its own way (the EaW Remake: an empty frame, a white box). In a dogfight the icons are laid out in a block: a squadron going for a target is put in the 400-wide battle grid cell its target is in (odd rows half a cell over) and kept there until it is more than sqrt(80000) from the cell middle; the icons of a cell go in rows of ceil(sqrt(n)), 30 apart on a 768-line screen, upward from the cell middle, and glide there. Ours: a squadron joins only once it is that near the cell (the engine way in was not read that far), the grid starts at the battle area corner, and the order is by id'
      ],
      [
        'Cinematic camera: letterbox, self-directed shots, cut to large ships dying',
        P,
        'own shot director; the authored glory camera scripts (.tec) are not used because their coordinate frame is unknown'
      ]
    ]
  ],
  [
    'Space simulation',
    'space',
    [
      ['Capital ship movement and turning', D],
      [
        'Fighter and bomber squadrons',
        D,
        'flight by the engine fighter locomotor: roll before turn, loops, leader and formation, strafing runs at the ordered hardpoint (else the ship), dogfight pairing, idle passes over a spot at full speed, the look ahead that turns a craft away from ships and structures it is about to fly into (circles of hit radius where the engine has model boxes)'
      ],
      ['Hardpoints: weapons, engines, shields, bays', D],
      ['Damage vs armour table, shields, hull', D],
      ['Projectiles: lasers, ion, missiles, torpedoes', D],
      ['Hardpoint targeting', D],
      ['Garrison fighters from carriers and stations', D],
      ['Reinforcements by hyperspace', D],
      ['Build pads and construction', D],
      [
        'Salvage bounty on object deaths (tactical)',
        P,
        'read from and the death routine (bounty.js): paid only while bounty collection is on (a story switch, ENABLE_BOUNTY_COLLECTION and DISABLE_BOUNTY_COLLECTION, set back on by each story reset), to the players allied to the killer that have a rule for the victim faction, never for an ally victim. The worth is Override_Bounty_SP or MP of the type, else the largest Default_Bounty_By_Category of its categories (MP numbers outside a campaign battle); the rules are Bounty_On_Faction_Ability (the skirmish UL_Bounty_Upgrade): Bounty_Percentage_Amount per Stacking_Category (largest in a category, categories add), Target_Faction_Names, Apply_To_All_Allies. The payout is worth times percentage rounded half away from zero, at least 1, credited with the AI credit multiplier, counted for the end screen Salvage collected line, and shown as +N over the wreck for the local player in space. Ours: each fighter pays by its own type and the squadron by its own when its last fighter goes (the engine squadron as an object of its own was not traced); land pays no floating text. Action points: corruption and Nal Hutta bounty abilities in the campaign (Bounty_On_Faction_Ability on the corruption upgrades), and whether the third argument records the credits as earned'
      ],
      ['Mining income', D],
      [
        'Capturing pads and structures',
        D,
        'a build pad left empty with none of its side near goes back to nobody over one transition, as the logs of the original show; what stands on a pad holds it, and a captured structure (the merchant dock) stays taken'
      ],
      ['Station upgrade levels', D],
      ['Tech upgrades', D],
      [
        'Population cap',
        D,
        'the faction own cap for a space battle (Space_Tactical_Unit_Cap: 20 for the Empire, 25 for the others), which is what the program shows and tests a new ship against; the setup screen can override it'
      ],
      [
        'Asteroid fields, nebulae, ion storms',
        D,
        'a nebula: no ability may be switched on inside or for Nebula_Ability_Disable_Time after (read from the engine); what is on is switched off once on the way in, except the kinds the engine ability table gives no nebula flag - hunt, lure, lucky shot, deploy troopers, self-destruct, sprint, ion cannon shot, S-foils, maximum firepower, stim pack (their flag is the table default, taken as off - the default was not found). UnitAbilityTypes.xml, which may change that table, is empty in the game and the trial mod and is not read'
      ],
      [
        'Craft fly through asteroid fields, nebulae and ion storms',
        D,
        'the engine keeps those out of the tree its fighter look ahead asks; impassable asteroids are still avoided'
      ],
      [
        'Check how a route search weighs asteroid fields for a small ship',
        T,
        'the engine occupancy test marks fields with a category bit; how the space path finder uses that bit for a corvette is not traced; ours lets a ship through any field that does not hurt it'
      ],
      ['Nebula haze on ships inside (Nebula_Effect_Color)', D],
      ['Visibility and stealth', D],
      ['Teams sharing a station', D],
      ['Group-move formations (per layer, arrive together)', D],
      ['Route planning around stations, rocks and asteroid fields', D],
      ['Height layers (Space_Layer)', D],
      [
        'Ships steering around each other',
        D,
        'the engine space path finder: a search over place, heading, speed and time with its moves (straight on, turn steps of 360 / MaxRotationsSpace on the turning circle, come round onto the goal and fly onto it, speed up, slow down, creep, turn on the spot at the start), each step costing its time, ruled out by what stands still (except near the start) and made MinObstacleCostSpace / CurrentPathCostCoefficientSpace dearer by ships under way where they are to be then; states told apart by place and heading, SpacePathfindMaxExpansions, the retries of SpacePathingTries growing coarser and greedier, fields only a cost from the fourth, half speed from the fifth; the destination moved to a free place first; shapes as the engine tests them, a reach that depends on the direction (Custom_Hard_X/YExtent or the model box, along and across the course); no pushing apart; ships fly the route speeds. The searches run on a thread of their own (pathworker.js; the answer a step or so later, as the engine also spreads its requests over frames), compiled to WebAssembly (wasm/pathsearch.ts; the JS search the same, as fallback). Ours: a search may take 60 ms there; one that fails all its tries leaves the way to the nearest state reached instead of no move; ships already touching where they start are left to it; the moves onto a final facing are unused (our orders give none); the model box long axis is taken as the length'
      ],
      ['Interdiction (reinforcement block)', D],
      ['Repair stations and structure self-repair', D],
      ['Waypoints', D]
    ]
  ],
  [
    'Abilities',
    'space',
    [
      ['Hunt', D],
      ['Power to weapons / engines / shields', D],
      ['S-foils', D],
      ['Sensor ping', D],
      ['Barrage area', D],
      [
        'Tractor beam',
        D,
        'range of a unit-targeted ability counts from the caster hull, so a Star Destroyer at its attack distance can use it'
      ],
      ['Ion cannon shot', D],
      ['Concentrate fire', D],
      ['Invulnerability', D],
      ['Missile shield', D],
      ['Energy weapon', D],
      ['Full salvo', D],
      ['Harmonic bomb', D],
      ['Blast', D],
      ['Weaken enemy', D],
      ['Corrupt systems', D],
      ['Leech shields', D],
      [
        'Buzz droids',
        D,
        'aimed at any location, spawning the ability Object_Type there; the swarm chases and damages enemies within Chase_Radius and Damage_Radius, wears down by Own_Damage_Per_Second and keeps its own healing abilities (mods use it for repair drones); the AI drops support swarms on its most damaged ship. Objects with Is_Valid_Target false cannot be targeted'
      ],
      ['Stealth', D],
      ['Interdict', D],
      ['Defend', D],
      ['Auto-fire for abilities', D],
      ['Replenish wingmen', D],
      ['Self-destruct', D]
    ]
  ],
  [
    'Skirmish AI',
    'space',
    [
      ['Builds units, structures and upgrades', D],
      ['Attacks, defends, captures pads', D],
      [
        'Three difficulty levels',
        D,
        'easy, normal and hard as the engine applies DifficultyAdjustments.xml (read): only to a computer player, by its own difficulty and the entry its AI player type names - what its units deal to others, the most health and shields they have, what it earns, how long it builds, the contrast of its forces and the rest of its goal system. Land still takes the entry by name and leaves the shield out'
      ],
      ['Uses abilities', D],
      ['Several bots per team', D],
      ['Target priorities (Targeting_Priority_Set)', D],
      [
        'Hand-written tactics of the first space AI (scout, pad rush, escort, artillery, bombing run, sweep, flank, last stand)',
        D,
        'replaced by the engine goal system and the game plans; kept behind ?oldai for comparison'
      ],
      [
        'Original Lua AI plans',
        D,
        'the plan scripts of the data (or of a mod) are run as they are, in space and on land: the goal system of the engine chooses goal and target, the plan whose Category names the goal is given its task forces by the engine plan solver (or buys them), and its threads, blocks and the events of its forces are served; the library Default_ handlers, the evaluator scripts the equations call, map hints and weighted type lists are there. Not run: galactic plans'
      ],
      ['Avoids fields and hazards', D],
      [
        'Goal system (goals weighed by the perceptual equations)',
        P,
        'the decision layer is the engine own, the same one the land battle uses (landgoals.js core, spacegoals.js, spacebrain.js): goals are switched on by the AI template of the player type; every space goal is weighed against its targets - the battle, the squares the map is cut into (AI_SpaceEvaluatorRegionSize), ships, structures and build pads whose type has a space evaluator and that are in view; perceptions are the engine threat grid (AI_Combat_Power smeared over reach) and area sums; selection goes category by category with the bonus for running goals, GoalSetExtensionSize and the memory of failures; the plans are the game Lua plans. Every space goal plan was started by hand for the Rebel, Empire and Underworld players (spaceaudit.js): of 26 goals with a plan, 22 take their ships and act with no script error; Space_Retreat ends at once and Hide_Transports, Ground_To_Space_Damage and Ground_To_Space_Disable do not start, as none of the four has what it needs outside the campaign (retreat is not allowed in a skirmish, there are no transports or ground guns); Fire_Death_Star waits for a Death Star as the script says. Tyber_Manager_Space, Disable_Unit and Debug_Goal_Space have no plan script in the game data. The old proposer is kept behind ?oldai. Open action points are the entries below that begin with Space AI, and: live play was watched for the Empire player on one map only; the check of a plan is ten game seconds, not that it plays out as in the original'
      ],
      [
        'Space AI: which ships a plan is given (the engine plan solver)',
        P,
        'as the engine plan solver (aiplans.js staff): one unit at a time, the best sum of nearness to the target, tech level, room on its line and contrast against the enemy at the target (EnemyContrastTypes, FriendlyContrastTypes, Min and MaxContrastScale, failures, the difficulty multiplier); no type over half the choice while another can be taken; escorts after the main force; the choice stands only if lines, totals, RequiredCategories and the contrast are met, else the goal is not proposed; a goal wanted more takes units from a running plan wanted less. No unit under Health_Low_Percent_Threshold of its health is given; a hero with a script of his own is never put in a plan that lets heroes attach (the escort scoring that would place him is dead code in the x64 program - read). Ships still in the reinforcements are given too and the plan lands them (see below): as the engine (read from the engine) a waiting ship of a type is taken over the best one of that type on the field unless that one already stands at the target (squared distance under 300), and scores 2 above what that field ship scored for nearness. Distance is the straight line, as the engine (it measures a way only on land - ZoneReachabilityClass, read). What a plan script gathered for itself (Collect_All_Free_Units) may be taken by a goal wanted more, as in the engine; the plan ends only when it loses one the solver gave it (read from the engine)'
      ],
      [
        'Space AI: reinforcements of the AI (built ships wait to be called in)',
        P,
        'as read from the engine: a ship the AI builds goes to its reinforcements like a human player; the plan solver gives it to a plan that takes free store units, and the plan script lands it (QuickReinforce: by its own ships, by its escort, at its start position, else a structure, a capital ship or the target) at the spot or on rings 500 further out each try, under the same rule as a player drop; no landing once the station is gone; a force given nothing has no thread run. A waiting ship is preferred to one on the field that is not already at the target (see the plan solver); watched on Kuat: what the Rebel computer player builds is called in within about ten seconds. Where ships land is the game Lua (QuickReinforce) and the engine drop test (SpaceModeClass, read): seen ground, no enemy Reinforcement_Prevention_Radius, inside the map, room to arrive - nothing keeps a drop away from enemy ships, so a force fighting a bigger fleet, or a start point the enemy camps, gets its reinforcements landed there. Ours: the room to arrive is a test against structures, not the engine sweep of Space_Reinforcement_Collision_Check_Distance; the side angle of the ring search read as the start facing; a unit no plan has a line for stays in the pool for good, as in the engine (only a plan or the player calls units in - read: no timer or free-store service lands them); the trial mod build plan buys defence platforms (Defense_Station_Level_One to Three, SpaceStructure | AntiFighter) that none of its plans can take, so its computer players hold three in reserve all game'
      ],
      [
        'Space AI: reachability of a target',
        D,
        'as the engine: a space battle has no reachability test at all (read from the space goal system)'
      ],
      [
        'Space AI: a task force moves as one formation order',
        P,
        'the ships of a force are sent through our group move; the engine reports the move done when every unit has arrived'
      ],
      [
        'Space AI: checked against logs of the original (a logging mod, re/ailog)',
        P,
        'three ten-minute runs of the original on Kuat (easy, medium) give its decisions, purchases and holdings; ours now matches the decision rhythm, the opening, the order of purchases, the pad grabs and captures, the time the merchant dock goes, the all-out attack time and the station levels to within seconds, and leaves the idle human alone as the original does. Still to compare: the Rebel and Underworld AI, other maps, the mod, allied AI, and a game where the human fights. A run on the 14th of October found ours buying no ships from the 2nd to the 9th minute; a probe run of the original showed it does the same against an idle human (see the force perceptions)'
      ],
      [
        'Space AI: the force perceptions (FriendlyForce, EnemyForce and their unnormalized forms)',
        D,
        'checked against the original: a fourth run with the logging mod wrote the perceptions every ten seconds (PERC lines from probe equations, re/ailog_mod; re/ailog/original_kuat_empire_ai_medium_run4.txt). As read from the engine they are a plain sum of AI_Combat_Power over every object of the side - fighters one by one - with the neutral player counted as enemy; the log shows the one exception: the station a skirmish places at the start counts nothing and BaseLevel reads 0 while it stands (seen, not read - the station an upgrade puts in its place counts in full). Ours now gives the same figures (840 against 600 at the start, 10840 with the level two station) and the same turns: the AI wants a new station from the 2nd minute, which holds its ship buying at nought - in that run the original too bought no ships in ten minutes against an idle human, so the earlier runs that did were the exception, not ours'
      ],
      [
        'Space AI: defence satellites and the level five station against an idle human',
        D,
        'compared over the four logs of the original: what it builds early follows the pads it takes first, and those it picks by lot among pads of equal desire - in run four the one next to its station (a mining facility at 21 seconds, two satellites before the second minute, level four at about 464 seconds), in run three the two far ones as ours does (mining at 66 seconds). Run two, with the human idle as well, reached level five at 546 seconds and bought its first capital ship after it; ours level five at about 573 and its first capital ship right after. Run three is no idle game: the human raised his station to level three by 202 seconds, which is why that AI saw a stronger enemy, took its cash drop and built satellites and ships early'
      ],
      [
        'Space AI: the cash drop of a computer player that is behind (Skirmish_Generate_Magic_Cash_Drop_Space)',
        D,
        'its plan buys nothing - a force marked TaskForceRequired, and Give_Money(6000) - and was never begun here, as the check beforehand wanted something bought; the engine lets such a choice stand. Now a computer player under 3000 credits facing more force than its own after the third minute gets its 6000 and goes on to raise its station, as in the log of the original (cash drop at 202 seconds, upgrade at 205). The same holds for the land cash drop. Not yet watched in a game the human is winning'
      ],
      [
        'Space AI: Game.ForceVisibility',
        D,
        'as read from the engine: the share by count of the objects of every player but the one asking - allies too - that are in view, of the equation Parameter_Category; the objects are those of the perception lists (registered by their unit AI behaviour), the same the force sums go over, structures included. Ours: in view is the side sight now (the engine asks the unit AI behaviour, a slot not resolved); with nothing to count the engine divides nought by nought, ours gives nought'
      ],
      [
        'Space AI: the firesale map reveal (BurnUnits plans)',
        D,
        'the plan of the data (or of a mod) shows the whole map to the computer player and, in a skirmish, to the human when Should_Firesale_Space holds - in the game when a computer player has no upgraded station after two minutes, in the trial mod whenever it is within 50 of its population cap. The reveal now ends with the plan that made it (or a restart of that script), as the plan comment says the engine does when its reveal objects go; before, it stayed for the rest of the battle. Watched: on Kuat every computer player upgrades its station at 81 to 86 seconds (the original at 86), so it does not fire in an ordinary game'
      ]
    ]
  ],
  [
    'Interface',
    'space',
    [
      ['Command bar from the original layout', D],
      ['Radar', D],
      ['Selection slots with health and shields', D],
      ['Build slots', D],
      [
        'Production queue',
        D,
        'each queue of a station holds five at once, the one being built included (Max_Build_Queue, else the engine own five): units and the station level upgrades share one, the other upgrades have their own; as the engine tests it only the human player is held to it'
      ],
      ['Research sidebar', D],
      ['Reinforcement window with drag-to-deploy', D],
      ['Droid advisor panel', D],
      ['Unit icons, clickable', D],
      ['Hardpoint reticles', D],
      ['Order buttons', D],
      ['Control groups and hotkeys', D],
      ['Ability buttons', D],
      ['Skirmish setup screen (players, factions, colours, teams, map, advanced options)', D],
      [
        'Map lists: official and custom maps',
        D,
        'the engine list: every map file whose header is of the battle kind, made for two players or more, named by its text id; the Official and Custom Maps buttons switch between the maps flagged custom (header field 11) or not, the custom list also holding the flagged maps of the game Data/CustomMaps folder. Map kinds are labelled with the Space and Land game type names (mods repurpose the lobby list strings), and skirmish and multiplayer setup both show the preview embedded in the map file when there is no loose picture'
      ],
      ['In-game menu: save, load, options (audio, video, game), quit', D],
      ['Game fonts', D],
      [
        'Hero portraits bar',
        D,
        'the enemy team heroes in sight on the left, the player team on the right (the player own first, those clicked to select, then the allies)'
      ],
      [
        'Build limits',
        D,
        'Build_Limit_Current_Per_Player, Build_Limit_Current_For_All_Allies (a team fields one Rogue Squadron), Build_Limit_Lifetime_Per_Player and _For_All_Allies; standing counts the field, the queues and the reinforcement pool; allies may field the same hero once each'
      ],
      ['Waypoint button', D],
      ['Retreat button (disabled in skirmish, as in the original)', D],
      ['Cinematic camera button', D],
      ['Help and holocron', D],
      [
        'Planet special weapon (ion cannon, hypervelocity gun) and its button',
        P,
        'as read from the engine: every side has its faction Standalone_Space_Maps_Special_Weapon at the map special weapon source, charged at the start; each shot in a skirmish is bought as the use upgrade and uses it up; its volley flies from the planet at a unit of a valid kind; recharge, the advisor lines (ready, firing, charging, for both sides), the button with the weapon own icon and tip, the game own targeting pointers, the AI plans fire it. Not seen against the original: the shot in flight'
      ],
      [
        'Losing side credit bonus (Multiplayer_Losing_Team_Bonus_Credit_Percentage)',
        P,
        'as read from the engine: three alliances are counted - two sides and the one playable faction nobody plays, or three sides - and every side but the richest gets that share of the difference in income while it has its station; otherwise nothing is paid. Open: in a log of the original the idle human got about 2 credits a second where the formula gives about 3'
      ],
      [
        'Skirmish opening: the factions default forces, no station garrison',
        D,
        'Space_Skirmish_AI_Default_Forces for every side, and a station launches nothing in a skirmish - seen in the original'
      ],
      [
        'Original main menu and screens',
        P,
        'main menu, single player, options and the demo battle are in. Native custom-campaign and tutorial selectors read advertised campaign sets and exact faction variants. Mods can relabel the tutorial entry as conquest and start a scripted menu campaign. Original RC layouts, skins and localized assets drive the screens. Localized_Menu_Overlay uses the resolved active language, last valid mapping and native empty-slot default; mapped missing artwork does not fall back. Full original textures retain studio marks and mod artwork. Live visible-menu refresh is a browser adaptation beyond native menu creation; cached loads and generation guards preserve open menus. Base French/German and real-mod mapping browser checks pass using labeled English-text DAT fixtures. Action points: original story-campaign entry, native main-menu tactical backdrop scenes, tutorial completion profile import, advanced campaign overrides, generated normal-campaign preview, multiplayer and mod management screens'
      ],
      [
        'Keyboard options and key bindings',
        P,
        'the original five-page IDD_KEYBOARD_OPTIONS_DIALOG from the main and in-game options: a click on a box opens a listening box (ours) that shows the keys held together, any of Ctrl, Shift and Alt and one or more other keys (the engine takes one key and one modifier), starting over when all are let go, with Set to replace, Add to keep it beside the others (up to three per command), Unset to leave the command without keys, or Cancel; key names from TEXT_KEY_* as the engine builds them; a key held by another command asks first with TEXT_KEYBIND_WARNING_0/1 and moves on Yes; Accept stores, Back discards, Defaults restores. Space, land and galactic input and the command bar tips read the bindings (keybinds.js). Defaults are the keys this port used, the engine default table is in its code and not read yet. Pause, game speed and camera turn and tilt have no row in the original and are on a sixth page of ours (Other) behind a tab in its style, with Use Ability 1 to 5: the abilities by their place on the command bar, left to right, each kind counted once, used by every selected unit that has it, in space and on land (ours, in place of the original key per ability). Action points: read the engine default keys, the per-ability rows of the Land, Space and Hero pages (covered by Use Ability 1 to 5 for now), select all, select like, next and previous unit, retreat, reinforce, beacon, camera reset, center and tether, quick save and load, screenshot, toggle interface and the other greyed rows'
      ],
      [
        'Dialog placement, battle loading screen and battle end screen',
        P,
        'as read from the engine: a dialog rectangle is a fraction of the screen and the screen is stretched to the window; each dialog takes the anchor its creation site passes (0 centred; 1 to 8 against an edge or corner, off the dialog frame thickness, Frame_Left and Frame_Top, plus the engine fixed margins: main menu panels top right, chat top left, story dialog top centre; 9, native dialogs only, the whole screen with the background stretched over it and controls moved by the centring offset), so a mod background of any size (the Thrawn mod ships 3840x2160 ones) fills the screen as in the original. The battle loading screen is the engine one for space and land (planet name line, weather, terrain, population, history, weather/native/overlay pictures, the map picture, Begin), the end screen has the engine title, hh:mm:ss time, planet line only in a campaign and the strips under the hero rows. Checked against the original with the mod at 2560x1440. Action points: the story mission loading dialogs (MT/MB texts), the theme text colour the engine passes for the planet texts'
      ],
      ['Battle summary screen', D],
      ['Dialog renderer (GUIDialogs.rc + GUIDialogs.xml)', D],
      ['Loading screen', D],
      [
        'Chat',
        D,
        'multiplayer space, land and galactic: Enter (rebindable) opens IDD_INGAME_CHAT_DIALOG with Send to allies only remembered; 160 characters; lines read Name(All): or Name(Team): from TEXT_CHAT_MESSAGE_ALL and _TEAM in the sender colour; team lines reach allies only; GUI_Common_Chat_Send on sending and GUI_Common_Chat_Receive for others (the shipped SFX file misspells it, so it stays silent as in the original)'
      ],
      [
        'Radar only with a communications array or station (Enable_Radar_Ability)',
        D,
        'enemies show on the radar only while the side has a working Enable_Radar_Ability - on from the start, or switched on by an intact Comm Array hardpoint (HARD_POINT_ENABLE_SPECIAL_ABILITY) of a station of its own or an ally; capture points always'
      ],
      [
        'Space radar (minimap) as the engine draws it',
        D,
        'RadarMap.xml settings and colours, the grid 25 times across over the fog and asteroid fields, each type with its own Radar_Icon_Name from the command bar atlas (stations, mines, capital ships, the default blip) at Radar_Icon_Size of the radar, in the owner colour or the selected colour, turned to its heading unless Radar_Show_Facing is No, a quarter turn with Radar_Rotate_Icon; only what is Is_Visible_On_Radar and, in fog, Visible_On_Radar_When_Fogged; a unit just hit dims; Default_Unit_Die marks every death the player could see with the event model (the red pulse). Orders on the radar: right button a move (Ctrl an attack-move), left button with attack-move, waypoint or guard armed gives that order there, each marked with the GameConstants click event (the growing green or red square, sized from its model animation). Ours: redrawn a few times a second, not every frame; the beacon and control point events not shown'
      ],
      [
        'Radar events (RadarMap.xml: order clicks, a unit lost, a point changing hands, interdiction)',
        D,
        'as the engine: move, attack-move and ground-targeted ability orders from the main view or the radar ping the GameConstants click events, a second click on the same spot swaps the last click for the double-click event; every death the player can see pings Default_Unit_Die; on land the Begin_ and End_Control_Transition_Radar_Event of a point (reinforcement points) ping for players allied with the old owner or the taker; Interdict_Activated stays on the interdictor while its gravity well is on, for every player; beacons ping for allies. Events play their model animation over the icons on the game clock, space and land. Not done: the separate radar blip system (Lua Add_Radar_Blip, story highlights, structure under attack pings)'
      ],
      [
        'Double-click: select all of a type in view',
        D,
        'space and land: a second click within the double-click time on one of our units of the same type selects every one of that type on screen'
      ],
      [
        'Mouse cursors',
        P,
        'MousePointerClass as the engine has it: the pointers of MousePointerFiles.xml (mods included), frames numbered at the first 0 of the name, (delay+1) ticks of about 16 ms a frame, the class default DEFAULTPOINTER_00 for a missing one; POINTER_NORMAL everywhere, and in battles the tactical choice of (drag box, armed commands, bombing run, reinforcements, abilities, select, attack, move, attack move, superweapon). In the game fullscreen (Alt+Enter) the mouse is kept inside the window as ClipCursor does and the pointer is drawn by the page, so edge scrolling works. Open: the galactic and menu callers of the pointer (wait, grab and drop), ability validity, out of range and the attack and move only modes'
      ],
      [
        'Multiplayer beacons',
        D,
        'multiplayer space and land: the command bar ping button (TEXT_PLACE_BEACON) or the PLACE_BEACON key, then a click on the ground; a lockstep command places the faction Multiplayer_Beacon_Type (E_ or R_Multiplayer_Beacon) at the spot, one per player, for Beacon_Lifetime_In_Secs; allies see its model and radar icon, hear SFXEvent_Beacon_Placed and get its Beacon_Radar_Map_Event_Name ping; enemies see nothing. Ours: BeaconPlaceDelay is applied per player as a cooldown (where the engine reads it was not found); the default key is unknown and left unbound. Checked between two players through the LAN lobby, space and land, with matching lockstep hashes'
      ]
    ]
  ],
  [
    'Audio',
    'space',
    [
      ['SFX events: pools, pitch, volume, limits', D],
      ['Battle music playlists', D],
      ['Engine loops and station hum', D],
      ['Fighter fly-bys', D],
      ['Unit responses', D],
      ['Health and damage call-outs', D],
      ['Faction announcer', D],
      ['Field entry lines', D],
      ['Positional mix (saturation distance, priority, pan)', D],
      ['Voice rules (overlap groups, replies, announcer queue)', D],
      ['Ambient / battle music switching', D],
      [
        'Spotted-enemy lines',
        P,
        'the faction lines play when a listed enemy unit comes into view; exactly when the original fires them could not be read from its code'
      ]
    ]
  ],
  [
    'Platform',
    'space',
    [
      ['Runs in the browser, no install', D],
      ['Game data in private storage (OPFS): a tar of the game folder read through its archives', D],
      ['Offline via Service Worker', D],
      ['No game data hosted or downloaded: players bring their own folder or archive', D],
      ['Build stamp and self-reload', P, 'not yet exercised by a real deploy'],
      ['GitHub Pages deploy', D],
      [
        'Windows app with updates',
        D,
        'a Tauri build released through GitHub Releases by a workflow on each v tag (signed installer and latest.json updater feed); the browser asks before leaving a running battle or campaign'
      ],
      [
        'Benchmark mode',
        D,
        'space: ?benchmark=N ships a side; land: ?mode=land&benchmark=N companies a side of what each side buildings sell, met in the middle with no commanders and no fog, the same figures for a minute'
      ],
      [
        'Land battles draw fast',
        D,
        'the troops skinned and rigid meshes alike are drawn in batches, one call for each geometry and material, a skinned one with its bone matrices in a picture read by the shader (landinstances.js, model.js INSTSKIN); each unit in sight has its matrices and its skins worked out once a frame, and what is out of sight, hidden or never moves (scenery) is not walked at all; units far from the eye are brought up to date every other frame; a batch program is made on the side before it is used. Trial mod, 30 companies a side, a minute: 55 frames a second on average before, 93 after; 1 percent low 19 before, 33 after; frames over 33 ms 45 before, 5 after (all in the first second). ?nobatch draws as before'
      ],
      ['Model viewer', D],
      ['Volume settings remembered', D],
      ['Graphics options: shadows, bloom, heat haze, lens flare', D],
      [
        'Touch and mobile',
        P,
        'touch.js plays a finger as the mouse in every mode: tap is a left click, a double tap a double click, drag the left drag, press and hold a right click (held and moved a right drag), two fingers scroll, pinch for the wheel and turn the view. One button of ours, on a touch screen only: fullscreen on and off (with landscape asked for). Still to do: try it on real phones and tablets, the HUD at phone size, tooltips that need hovering, hotkeys with no button (groups, abilities by key, speed). iOS draws with WebGPU as elsewhere (?webgl for WebGL): on WebKit without render bundles (WebKit bugs 320490, 321876), its programs keep every array index in range themselves, and DXT textures are unpacked to RGBA where WebGL has no S3TC (?nodxt tries that on desktop; land terrain layers still need it); ?gfxinfo shows the drawing path on the build tag. Still to check on an iPhone that this ends the flicker'
      ],
      [
        'Other languages',
        P,
        'Native language IDs0..10 select installed or mod DATs through a browser language query or portable-pack default. Native whole-file fallback updates text and conquest fonts together, with language-specific face and minimum-size rules. Installed test data contain only English; translated DAT fixtures cover localized loading and BMP glyph pages. The live conquest API refreshes current text and fonts through native layout and retained-source callbacks without restarting the campaign. Translated-DAT browser checks cover French and Russian and preserve existing panel objects, pause, sorting and story playback state. Speech queues and active SFX capture the selected language. Native filename marker priority, suffix substitution and speech directories select original recordings; only Localize SFX substitute filenames. Server archive views reuse ordered mount indices instead of rescanning folders; the first real-mod alternate view measured about5ms rather than two seconds. Cached server and folder-import archive views mount SFX2D for the selected language while preserving expansion, mod and loose-file order. Missing localized clips retain native failure completion with no English retry. Menu artwork reads language mappings and keeps the full texture. All11 policy, cache, queue, loop, race, missing-file and real archive fixtures pass. Browser checks use original English Tarkin audio, a real German mod alarm and missing French speech, plus native base/mod artwork. Action points: native platform language selection, localized splash screens and full original-engine comparisons for translated installs'
      ],
      [
        'Multithreading',
        T,
        'logic runs on one thread; measured at 1.5 ms a step with 640 units in the field, so there is nothing to win yet'
      ]
    ]
  ],
  [
    'What a mod can change',
    'rest',
    [
      ['A mod folder laid over the game: archives, loose files, files taken away; chosen on the start page or given to the server', D],
      ['Object data: every file GameObjectFiles.xml names, variants, a tag written once for each faction', D],
      [
        'The lists the program follows',
        P,
        'followed: GameObjectFiles, HardPointDataFiles, SFXEventFiles, TargetingPrioritySetFiles, FactionFiles, CommandBarComponentFiles. CampaignFiles and TradeRouteFiles are followed by the galactic loader. Not followed: MousePointerFiles'
      ],
      [
        'The rule files beside them',
        P,
        'of the 34 files the program opens by name 29 are read (TacticalCameras for the land camera: its distances, tilt and overview stops; the space camera keeps its own wider range. GraphicDetails for the steps of the detail slider in the video options. HeroClash for the duel of two heroes who meet on the ground - the melee kind; the action-driven kind has no range in the data and only a story script starts it). SpeechEvents supplies story recordings and localization. Not read: LightSources, UnitAbilityTypes, BlackMarketItems, TradeRouteLines, and the Enum folder (new category and property names work without it: they are read where they are used)'
      ],
      [
        'Factions, their colours, stations, maps, command bar, tech levels, population cap',
        D,
        'all from the data; nothing names a faction in the code any more except three land emblem names kept for data that has no Faction_Anim_Subindex'
      ],
      [
        'Behaviours and abilities of units',
        P,
        "a mod cannot add kinds, only use the program's; ours are those listed under Abilities and Land battles. All 49 ability buttons the trial mod uses are written. Lucky shot, the superlaser and deploy squad are in space only (the mod also gives lucky shot to some ground heroes); that a vehicle does not outlive the thief thrown out of it is from memory of the game, not from the data"
      ],
      [
        'AI data: goals, goal sets, equations, player types',
        D,
        "the mod's own are read, for space and for land. Templates and budgets are read by nothing (in a battle the program does not use them); hint sets and the galactic markup are the campaign's"
      ],
      ["AI plan scripts and the equations' evaluator scripts, space and land", D, 'see Skirmish AI'],
      [
        'Object scripts',
        P,
        "run for space units and land units, with the mod's own script libraries. Of the engine functions the mod's reference lists, battle scripts call about 37 global ones that are answered with nothing - nearly all of them cinematics, camera, radar blips and interface switches - and some twenty object functions that are not there (Highlight, special weapons, bombardment, invading). Written since and not yet seen at work in a battle: Hide_Sub_Object, Turn_To_Face, Play_Animation (land), Get_Hint, Disable_Capture, ability recharge and autofire, Sell, Get_Enemy, Lock_Tech and Unlock_Tech, the type questions, DiscreteDistribution, Game_Message. Create_Generic_Object of an UpgradeObject grants the upgrade to its owner instead of spawning it (EaW Remake hands out its starting faction focus this way)"
      ],
      ['Game-scoring script', D, "a mod's own runs; where it keeps no loss tables the battle's count is shown"],
      [
        'Free-store scripts (what the AI does with units no plan holds)',
        P,
        'in space and on the ground the script the AI player type names (SpaceFreeStoreScript, LandFreeStoreScript - BusyTacticalFreeStore, or those of a mod) is run as it is: its FreeStoreService every ServiceRate, its On_Unit_Service for every unit no plan holds every UnitServiceRate, and a plan may still take a unit the script has given something to do. Is_Good_Against is the engine own (read from the engine): good where, for some category of the other, the contrast weights of PGAICommands (EnemyContrastTypes and FriendlyContrastTypes) give this type - its own entry, else the first of its categories with a weight not one - more than one. Garrisons are not reported. FindTarget on land chooses from the goal system own targets (FindTargetClass and Reachable_Target, read): only things that have a target of their own - no foot soldiers - friend or enemy by alliance, and of the others only what the side sees now or has not yet lost to the fog (ours: the cell under its middle for all the cells under it); it hands back the object itself. Before, its enemy search on land always came back empty. FindTarget in a free-store script weighs with the commander of its side, as in its plans (it found nothing before, so the land free store sent its idle companies to guard the nearest friendly building - a teammate base shield generator at the start of a skirmish - instead of to where its army is). The galactic free stores belong to the campaign'
      ],
      [
        'Story scripts, interventions, galactic AI plans',
        P,
        'campaign story XML and unchanged Lua state machines run through separate galactic and tactical story managers, including scripted setup menus and custom GUI shells. Owned space and land tactical manifests come from STORY_SPACE_TACTICAL and STORY_LAND_TACTICAL; pending master Lua attaches only to the next Active_Plot and every owned subplot has its own environment. Shared XML execution calls Story_Event_Trigger synchronously before completion, rewards and dependent triggers. The original Alderaan destruction and scripted victory chain now increments its campaign flag, with current-mode planet cleanup and no galactic plot replay. Native XML flags use a separate signed-int32 CRC table, persist across tactical snapshots and poll every application service while paused; restored galactic XML continues while Lua remains suspended. Base and actual-mod fixtures cover real mission XML/Lua, original PGStoryMode callback gating, owned faction bridge manifests, callback mutation/errors/reentrancy, native wildcard and pruning behavior, flags and victory waits. Linked missions now retain the same live campaign VM, Lua environments, scoring state and strategic record identities, with native load-map, mission-loss and return callback order. Action points: remaining tactical XML event producers and rewards, tactical mission dialogs and cinematics, native hash-container iteration order, further live original-engine mission comparisons, interventions, persistent Lua and GameScoring state across tactical page restarts and remaining galactic AI services. Galactic AI perceptions read from the engine: IsConnectedToCorruption (any corrupted neighbour), IsCorruptionTransitionActive, TimeSinceCorruptionChange (seconds since a change completed), Game.Timeline (the highest player tech level), BudgetFractionToBuild (price against the budget over the build time plus money on hand, by category or for the player), Human and Enemy TechLevel, TimeSinceConversion (seconds since the planet last changed owner, 1e18 when never; ours notices the change at the next AI update), Space and GroundDefendedPlanets (the share of the player own planets with a space or ground force, for Self, Human or Enemy), TimeSinceGroundConflict. Purge_Goals in galactic plans kills every other removable plan of the player and cancels its undelivered builds. A Thrawns Revenge galaxy (Known Galaxy Small, 21 factions) ran 600 seconds with no unsupported perception, no blocked budget and no plan error. Plan functions from the engine: TaskForce.Activate_Ability (every unit of the force fleet in orbit uses its ready planet abilities on the planet it orbits, nothing to wait on), Is_Corrupted (any corruption) and Fleet.Move_To (Move_Galactic, a wait that ends in orbit at the planet; ours puts the fleets holding the units together first and does not lift units from the ground). Seen working: Remove_Corruption by Vader, Deploy_Saboteur flying stealthed to a Rebel planet and corrupting it, Black_Market_Purchase running through. Galactic stealth: a company or transport is stealthy when every unit in it is, and Galactic_Stealth_Ability is automatic whatever its Activation_Style says, so the saboteur and Tyber Zann no longer start a space battle where they arrive. Open: Deploy_Saboteur ends without its result because the saboteur leaves the map before the plan checks Is_Corrupted (whether the engine keeps the plan thread running with an empty force is not read); Corruption choices for a computer player (read from the engine): the same four requirements as a human (credits, earlier corruptions of the required type, planets, units), the count of a type going up whenever the player applies one - the starter types Intimidation, Piracy and Kidnapping each need an Underworld hero (Tyber Zann, Bossk, IG-88, Silri, Urai Fen) in the player forces, so an Underworld without one cannot corrupt; seen working with Tyber Zann present (Piracy on Bespin, count 1). An equation with an unsupported perception is void and a void budget equation blocks the whole budget, which had stopped the Empire AI from building anything. Ours: for an item already in production BudgetFractionToBuild takes the share of the price for the time left instead of the remainder of its budget allocation'
      ],
      [
        'Models, animations, textures, particles, maps, sounds, music, text',
        D,
        'A texture is read by what is in the file, DDS or Targa (plain or run-length) or a bitmap, as mods ship .tga pictures where the base game has DDS. SpeechEvents and localized recordings follow the normal mod overlay; native Localize flags and language mappings drive sound effects and menu artwork'
      ],
      [
        'Shaders',
        P,
        "a mod's compiled shaders are not run: a material goes to ours by what its shader's name says (bump, gloss, colorize, additive, alpha). Counted over the trial mod's 5,385 models, all but two of the shaders they name are the game's own; the two (MeshBumpSpecColorize, MeshAdditiveOffset) are drawn as bump-and-colorize with a gloss picture, and as additive. A gloss picture of its own (GlossTexture) is used wherever a material names one"
      ],
      ['Interface: dialogs, main menu picture, command bar parts', D, "from the mod's GUIDialogs.xml and command bar files"],
      ['Movies', T, 'Bink']
    ]
  ],
  [
    'Game modes',
    'rest',
    [
      ['Space skirmish', D],
      [
        'Land skirmish',
        P,
        'playable from the setup screen to the end-of-battle screen on every land map, with several commanders a side; the enemy is a stand-in commander'
      ],
      [
        'Galactic conquest',
        P,
        'native campaign entry, scripted setup menus and a partial playable galaxy are available; see the detailed conquest entries below'
      ],
      [
        'Story campaigns',
        P,
        'the three campaigns start (Full_Story_Campaign_Empire, Rebel, Underworld) with no galactic reward unsupported: storyrewards.js adds REVEAL_PLANET, UNIQUE_UNIT, TRIGGER_EVENT, CREDITS, STORY_ELEMENT, REMOVE_UNIT, CHANGE_OWNER, DESTROY_OBJECT, MOVE_FLEET, INVADE_PLANET and the lock and camera rewards; the generic story triggers fire; the Underworld prologue mission runs. Single player New Campaign opens IDD_MAIN_CAMPAIGN_DIALOG (tutorial suggested once, difficulty radios) and starts Full_Story_Campaign_Underworld, as the executable names it. Battles play story speech and screen text (SPEECH, MULTIMEDIA, STORY_SPEECH_DONE: tacticalspeech.js), so scripted dialogue advances; a hidden hinted prop stays hidden through the fog pass. Land scripts: Create_Generic_Object spawns, Play_SFX_Event is heard (Allow_Localized_SFX), Get_Bone_Position reads the bone, Play_Lightning_Effect strikes its bolts, Hide_Sub_Object reaches props, animated props fire their particle proxies, and sound loops follow the cinematic camera. Land units move at Object_Max_Speed_Multiplier_Land times their Max_Speed, as the engine does; small vehicles route with one cell of room; cast shadows follow the cinematic camera. Battle rewards: the retry dialog of story missions (USE_RETRY_DIALOG, ACTIVATE_RETRY_DIALOG; Retry starts the mission again where the engine loads its autosave), DISABLE_REINFORCEMENTS, SET_ADVISOR, ENABLE_FOW, POSITION_CAMERA, CREDITS and STORY_CHECK_DESTROYED. Not played through to the end'
      ],
      [
        'Tutorials',
        P,
        'the tutorial campaigns start and their interface rewards are drawn as the engine draws them (tutorialfx.js, tutorialrewards.js): component flashes, the i_tutorial_arrow.alo arrow, planet label flashes, DUAL_FLASH, HIGHLIGHT_OBJECT with its radar marker, IDD_TUTORIAL_DIALOG, SHOW_COMMAND_BAR, forced ability slots. Ours: an arrow points at the middle of a component (the engine uses its attach bone), a planet label flash is a white glow, Continue sends the generic trigger Continue_Tutorial, HIDE_CURSOR_ON_CLICK has no reader found. Not played through'
      ],
      [
        'Multiplayer',
        P,
        'space and land skirmish for up to 8 slots (humans and AI) in deterministic lockstep: the lobby service web/lobby (Cloudflare Worker) lists games and connects players to the host over WebRTC, with the room as relay when no direct link can be made; the original Internet and LAN lobby and staging dialogs, the Internet lobby listing its games and the LAN lobby hosting private rooms that are never listed and are joined by invite link only; orders travel as commands carried out at the same step everywhere; one seeded random generator; routes searched in batches answered a fixed number of steps later; a state hash every second reports a desync; every space unit of the factions in the battle is loaded first and nothing is fetched during it; the host alone pauses and sets the speed, for everyone at the same step; a player who leaves is taken over by the AI; chat with the game own IDD_INGAME_CHAT_DIALOG (Enter, team members only). Ours: where the chat line stands and that lines that come in are shown with the messages in the sender colour. Land: whole steps one browser task apart, every model and animation that can take the field loaded first, shots from rest-pose bones. Saves: any player saves a multiplayer game (space, land, campaign) with its slots, the host loads one of the same game type with Load Game in staging; each slot keeps its side and shows whose it was, anyone may take an open slot, the save goes to the players in pieces. Open: browsers of different engines may round trigonometry differently, saving on every machine at the same frame as the engine does'
      ],
      [
        'Save and load',
        P,
        'skirmish battles, space and land, and campaigns, save and load in our own format (see Campaign save and load); a single player campaign battle, space or land, is saved with its galaxy in one file and loads back into the battle, then returns to the galaxy (engine: one save holds the galactic and the tactical mode; multiplayer campaigns save on the galaxy only). A game in the background is saved to one slot of its own and offered again after the browser ended the page. A battle save keeps its scripts as the engine does (their Lua state): object, scoring, story and free-store scripts and the AI plans with their task forces, what they wait on and the goal system memory, the story events and objectives, and a retreat under way. Action point: a script waiting inside a call of the engine at the moment of saving is saved without the scripts (they start over), and the mod campaigns story scripts are not yet checked in a saved battle'
      ],
      ['Replays', T],
      [
        'Mod support',
        P,
        "a mod folder is laid over the game as the engine lays it, untouched (chosen on the start page - the folder is read from disk by the browser, its archives and loose files, nothing copied; Chromium browsers only - or imported as a .tar of the folder into the site storage in any browser, read the same way - or given to the development server: --mod). Tried with a total conversion (Thrawn's Revenge): its database, models, animations and maps read; its factions, stations, maps and command bar are taken from its data; what its stations build beyond 256 MB of pictures is fetched while it is being built. its population cap is its own (300) or the one chosen at setup; its computer players use the goal sets their AI player type lists and every equation file the mod has, and build and attack. Its land battles run too, on its own AI plans. A plan line its script joins from pieces (a .. b) is read whole; a team building that is Is_Community_Property (its research station) sells to every player of the team. The start-page picker has been tried with a small made-up mod only, not yet with a big one from a real folder"
      ],
      ['Map editor', T]
    ]
  ],
  [
    'Land battles',
    'rest',
    [
      ['Terrain and heightmaps', D],
      [
        'Terrain textures and blending',
        D,
        'each layer is the game terrain material: texture and bump map at their own size, turn and tilt (the projection is the loader arithmetic read from the program), diffuse and specular colour, lit by the formula of the game terrain shader, under the drifting cloud shadows; the four corner layers of a grid square are mixed in one pass where the game draws a pass per layer; a grid square is left out only when all four corners have a layer with the map hole flag (chunk 0x23), a layer merely without a texture is drawn (with a neighbouring texture, a guess); scenery is drawn under the fog everywhere (props have no HIDE_WHEN_FOGGED) and the terrain-style object shaders (TerrainMeshGloss, TerrainMeshBump, BatchMesh, Grass) are darkened by the fog texture as the ground is; ordinary mesh shaders are not'
      ],
      [
        'Water',
        D,
        'by the game water shader and the code that feeds it: the scene mirrored in the water and bent by two sliding bump layers, mixed with what lies under it by the map tint and reflectivity, fading in from the shore with depth; lava (flowing base under a lit crust) and ice (a lit sheet that mirrors) likewise. What is under the water is not bent by the ripples, and the sky cube map the game tints water by is left out (its source is not known)'
      ],
      [
        'Passability and cover maps',
        D,
        'each vertex is one of the game ground kinds (clear, steep, water, infantry only, impassable - the values of its CellPassabilityType, read from the program) and each unit crosses what its movement class crosses in MovementClassTypeDefs.xml: hover craft go over water, nothing on the ground climbs steep or impassable ground, only those on foot take the infantry paths. The wall, obstacle and shield kinds are put down by objects, not by maps: buildings block by their footprint here and the base shield has its own rule'
      ],
      [
        'Ground pathfinding',
        P,
        'the engine land path finder (LandPathFinderClass, landpath.js), read: the cells (one a vertex, 20 a side) carry the map ground bits plus obstacle under what closes the ground and outside the playable rectangle, clear dropped when another bit is set; the playable rectangle is cut into rectangles of like cells, grown as squares then on to twice the other side, two by one kept as one by one, each with the rectangles touching it, made again when the ground changes; A star over them, a state being a rectangle entered at the cell just inside the shared edge nearest the cell before, a step costing the cell distance (more under a clearance where the way is narrower), the estimate the straight cell distance, no step from one rectangle into the same one twice unless cheaper, never back into the start one, given up after 2 x cells states or 20000 steps; start and goal in one rectangle go straight; the way is the cells either side of each edge crossed, pulled straight by halving and its corners cut in thirds down to 15 apart, a line open when all it crosses is open (by rectangles, then cell by cell), cutting a corner further on also half a cell to each side; a clearance as the later tries of a move ask it (a way without, the narrow stretches searched again with it). The land move request asks it with smoothing and no clearance. Measured on the trial mod land benchmark, 30 companies a side: 3600 searches in 3600 frames (two minutes) took 152 ms (0.04 ms a frame), the rectangles made again in 2 to 12 ms when a building changes the ground. Ours: a start or goal on ground the mover may not enter is moved to the nearest cell it may (the engine move order moves the goal itself first, - not read); a building adds obstacle to its cells (the engine its type OverridePassability, else its behaviour own bits); the danger cost of the moves that avoid the enemy is left out; the engine retries of a move (straight on the first, the search on the second, a clearance of twice the size from the third) are not followed - every route is the second try. The search itself has no memory between searches, so it is the same on every machine'
      ],
      [
        'Land: a place for a group tested as the engine does (read from the engine): open ground, then the same zone (connected for the movement class), then a straight line, and only then a path find - over the path finder regions, not vertex by vertex as ours; a find that fails at a formation place does not rule it out there (ours rules it out)',
        T
      ],
      [
        'Land: big battles cost a fraction of the frame',
        D,
        'troops are posed from frames kept once for each animation of each model and blended (posecache.js), the turn of a turret and the lift of its barrel on top as one more matrix, a unit never animated from its rest pose; the frames are worked out and blended in WebAssembly over skeletons and tracks in flat memory (wasm/landpose.ts; ?nowasm the same in JS); their own bones are posed only when something asks where one is (a muzzle, a footfall, an effect); a unit is posed once a picture, not again at each step; only what the picture frames (with room for shadows) is posed and drawn; scenery and missiles in flight are batched; the skinned batches send the rows of bone matrices in use; nearestFoe and the blast of a shot look in squares about the place, not the whole field. Mod, 30 companies a side, processor time of a frame driven back to back: 26.5 ms on average before, 6 after; the slowest 1 percent 57 ms before, 13 after. ?nocull, ?noloose, ?nocache, ?nowarm each leave one out'
      ],
      [
        'Land: no stalls when new things come on',
        D,
        'shaders are not asked whether they built (?shadercheck asks: it waited on the driver), and what is drawn with shaders not built yet waits a picture or two while they are built on the side; a unit that comes on has its own made first; the warm-up draws everything and readies every batch before the battle is shown; a big spawn is built a few milliseconds at a time in single player, at most 24 new units made ready a picture; a free store looks after each unit by a time of its own, spread over the round'
      ],
      [
        'Land: the 1 percent low of the mod benchmark at 60 frames a second, on screen',
        D,
        'mod, 30 companies a side, a minute with the page in view: 49.7 frames a second on average and 22.4 for the slowest 1 percent before, 135 and 68 after, no frame over 33 ms. Besides the land items above: the scripts of what stands on the field are settled behind the loading screen and their services spread; the search for a place to form up looks only at the squads about the spot (clutterNear) and the ground kind grids are kept by need; troops with glowing parts are batched too; files are fetched on a worker; a big spawn is built a little a picture'
      ],
      [
        'Space: the 1 percent low of the 200 ship benchmark at 60 frames a second, on screen',
        D,
        'base game, ?benchmark=200, a minute with the page in view at the same size: 118.8 frames a second on average and 40.2 for the slowest 1 percent before, 135.8 and 68.8 after; frames over 33 ms 6 before, 1 after. No shader is compiled in battle any more: one particle batch of each kind (blended, added, heat) and every ship batch, those with nothing to draw yet among them (engine glows), are compiled in the warm up. The AI plans and their libraries are compiled behind the loading screen. Music plays through the sound output of the game: the first track opening an output of its own stopped the page for some 50 ms. Carriers let out at most two squadrons a step across the battle (our own pacing, not read from the engine) and come on at their own point of a second; a capture point looks at the units in the cells about it. The radar keeps its grid as one picture and its colours and icons per colour; the unit icons keep the look each was drawn with; laser bolts are written straight into their buffers; the particle thread gets its arrays back. Open: the three.js scene walk still makes some 70 KB of garbage a frame with many ships in view'
      ],
      [
        'Infantry squads',
        D,
        'a soldier whose place in his team lies on ground he cannot stand on (a building, a rock, ground too steep) stands at the edge of it while the team stands, and is with them again once they move; the engine walks a standing soldier straight at his place and never asks about the ground there (read from the engine). Ours: how the engine stops him at the edge is not read (before, he was turned back toward the team and went to and fro there)'
      ],
      [
        'Units against closed ground (buildings, rocks, the map passability)',
        D,
        'as the engine (read: the walk step, TerrainCollisionClass, the local search): only the place a step lands on is tested; onto closed ground there is no step that frame and no sliding, and a way round is looked for from where the unit stands, within its own size and 40; found, it is taken and the way goes on; not, the move ends and it is 45 frames before it looks again. A line counts as clear only if it cuts no closed corner, as the route search has it, so a unit walking a route never steps onto closed ground between the points looked at. Ours: the local search is our route search; a soldier of a team takes a way round however long (left behind, the team would wait for him), to his place or, where his place lies on closed ground while the team walks (a formation wider than a gap), to where the team goes next, and leaves it once he can go to his place straight; one on its own stopped again within half a second of a way round ends its move. Before, a blocked soldier was turned back toward the middle of his team and a unit on its own walked straight on through the closed ground'
      ],
      [
        'Land: read where the engine sends a soldier of a team whose place is on closed ground while the team walks, and whether a team waits for one taking a long way round',
        T
      ],
      [
        'Infantry animation sets',
        D,
        'the whole of a model set is used, with its variants: an idle loop broken by fidgets, three gaits, a walk when slowed, turns on the spot, an aiming stance with each shot played over it, flinches from the side the hit came from, crouched versions under cover, a cheer when the battle is won, and the deaths for being shot, crushed, thrown by the Force or struck by lightning. How often a soldier fidgets or flinches is ours. Not used: the clips for things the battle does not have yet (sliding down a rope from the transport, being eaten, being choked, flying through the air) and the talk clips of the cinematics'
      ],
      [
        'Vehicles and walkers',
        D,
        'they move and fight, turrets turn within their arc, barrels elevate, they fire on the move, lie to the slope and crush; shots leave from the muzzle bones in turn with their flash; each type goes first for the kind of target it ranks first (Turret_Targets_...) and never for those it rules out; the smaller guns on hard points (SPMA-T, 2-M repulsor tank, the Gargantuan) fire on their own at what they are allowed to; the sounds of the damage thresholds play. Hard-point guns fire within their cones about where their bones point, and turret hard points (Is_Turret) turn to their targets within Turret_Rotate_Extent_Degrees, resting where their attachment bone looks'
      ],
      ['Hover and repulsor movement', D],
      [
        'Aircraft',
        D,
        'speeders never stop: they circle while they wait, bank into their turns and fight in strafing runs - in from their strafing height, down onto the target with the guns going while it is in reach and in front of them, over it, up and round again; they are hit only by anti-air weapons, trail smoke when badly hit, sometimes spin away before blowing up, and bring walkers down with the tow cable. Speeds, turn, bank, climb and heights are the type figures; how far a run carries on before coming round and the size of the waiting circle are ours'
      ],
      [
        'Artillery and indirect fire',
        D,
        'rounds of the GRENADE category are thrown as the engine lob solver throws them (read from the engine): gravity times Lob_Mod, the steeper of the two angles at full Max_Speed, and with Can_Lob_Slower tried again at four fifths the speed while it still reaches; nothing that reaches, no shot. Time in the air and height follow, counted in the engine logic frames (30 a game second, read from the engine). Other categories fly straight whatever their gravity, as in the engine. They hurt everything around where they land and cannot be fired inside the minimum range'
      ],
      [
        'Turrets and build pads',
        D,
        'pads are captured and built on, turrets fire, bacta tanks and repair stations heal, sensor nodes see; what stands on a pad can be sold again from the bar own Sell button for the credits its type gives back'
      ],
      [
        'Buildings and base layout',
        D,
        'each team base stands at the start (MP_Default_Pre_Built_Base) or is its build pads, as the setup screen says, and is shared by the team; an unbuilt or fallen building is its pad - the building own model in its ruined state - and is bought on it, the command centre included; buildings show their damage states as they are shot down (they do not go back when repaired until hit again)'
      ],
      [
        'Garrisoning buildings and transports',
        D,
        'what holds a garrison has so many slots and takes certain kinds (Num_Garrison_Slots, Garrison_Category), and each soldier or vehicle fills what its type says (Garrison_Value): a slot holds a squad, so an infantry company goes in whole (ours, from the data: the game soldiers carry no Garrison_Value and bunkers have four or five slots, so counted by the soldier no company would fit). Bunkers let infantry fire out through their ports at longer range; the transports (Juggernaut, HTT, F9-TZ, Gargantuan) carry infantry and light vehicles about. Letting them out of a transport is a button of ours on the bar; out of a bunker, an order to go somewhere'
      ],
      ['Landing zones and reinforcement points', D],
      ['Reinforcement landings (transports)', D],
      ['Population by landing zone', D],
      [
        'Weather effects on combat',
        D,
        'the map scenario runs through its phases, and each weather does what WeatherModifiers says to each unit by its weather category: how far it sees, how fast it goes, and how much wider its shots fall by kind of projectile (lasers, missiles, rockets, grenades, bombs - the table own rule: accuracy a widens the spread to 2 - a)'
      ],
      [
        'Weather rendering',
        D,
        'the scenario emitter (snow, rain, ash, dust) falls around the camera as thick as the phase is strong, easing from one phase to the next; the weather loop and now-and-then sounds of WeatherAudio.xml play; lightning flickers the picture in phases that have it (how often is ours, and no bolt is drawn). The fog plane is the map own distance fog - where it starts, where it is whole, its colour - drawn over ground, water and models, and the weather slides its start toward its end by the game own arithmetic (found in the program). Particles, decals and blob shadows are not fogged'
      ],
      [
        'Bombing runs',
        D,
        'bought as an upgrade and called in from the special-weapon button: three bombers cross the target and drop their bombs, shields keep them off; each bomber is an aircraft with its own health that anti-air weapons shoot at and bring down, and one shot down drops nothing more. Shots at anything in the air are led onto it'
      ],
      ['Sprint (Han Solo, Chewbacca, Kyle Katarn, phase I dark troopers)', D],
      ['Maximum firepower (General Veers)', D],
      [
        'Remote bombs (Underworld saboteur: place and detonate)',
        P,
        'the bomb lies where it was thrown and goes off when told to, when shot, or when its time is up; what Friendly_Damage_Amount means (taken here as what its own side takes inside the blast) is a reading of the name'
      ],
      [
        'Force heroes against buildings, creature attacks (Earthquake_Attack, Arc_Sweep_Attack, Eat_Attack abilities)',
        P,
        'a Jedi or Sith shakes a building apart from the reach the ability gives, a rancor swats and eats infantry, by the figures of the ability blocks, the hero in the animations the engine plays for it (FB_ATTACK, FB_HOLD, FB_RELEASE); the eating was not watched through'
      ],
      ['Gravity control generator (Underworld)', D],
      ['Ysalamiri cage (no Force powers within 250)', D],
      ['Imposing presence (Darth Vader, the Emperor, a falling AT-AT)', D],
      [
        'Demolition charges (Kyle Katarn, Mara Jade)',
        T,
        'nothing in the data uses it: the two carry the DEMOLITION behaviour, but the engine only acts on it through a Demolition_Ability block (reach, the share of the health of the building, Bomb_Type, Bomb_Spawn_Frame, Bomb_Timer_In_Secs) and no unit of the game, the expansion or the trial mod has one - in the expansion they throw a sticky bomb instead, which is in. The block is not read here'
      ],
      [
        'Leaving a captured vehicle (EJECT_VEHICLE_THIEF)',
        P,
        'the thief is inside the vehicle he took and can be thrown out again after the ten seconds the data gives; that the vehicle does not outlive him is from memory of the game, not from the data'
      ],
      [
        'Small visual behaviours (tread scrolling, wind over grass, ground texture under buildings, holstered lightsabers)',
        P,
        'treads run as the engine runs them (each tread by its own way forward, times Tread_Scroll_Rate); a lightsaber is off until wanted and is put away again, with its sounds and its hum, by the rules and figures of HOLSTER_WEAPON; a building lays its own surface on the ground under it. Not in: WIND_DISTURBANCE - craft bending the grass they pass over - since grass does not sway here at all'
      ],
      ['Ambient unit sounds (AMBIENT_SFX behaviour)', D],
      [
        'Cinematic camera on the ground',
        D,
        'as in space: the bar goes, the picture is letterboxed and the camera cuts between whoever is in the fighting - round them, behind them, from down by the ground, over a shoulder at what they shoot - kept clear of the terrain. Which shots and for how long are ours'
      ],
      [
        'Orbital bombardment',
        P,
        'as the engine planetary bombard manager (read from the engine): the faction salvos, shots and delays, each shot straight down from Bombardment_Offset above its point - the first on the target, the rest in the quarter Bombardment_Distribution names - the projectile per salvo and its full blast, the salvo particles, refused under an active enemy shield, Min and Max_Bombard_Interval_Seconds before the next, the upgrade that brought it spent, the ready voices; the AI plan works (TaskForce.Fire_Orbital_Bombardment, the IsOrbitalBombardmentAvailable perception) - seen on the trial mod. Action points: make it available (enableBombard) - with the campaign, as decided; the command bar button for the player; the fog test for the player; the salvo lights; how far the other shots fall (ours: within Bombardment_Blob_Size)'
      ],
      [
        'Base shields and power',
        D,
        'a dome over the generator while the power generator stands: laser fire from outside stops on it (shells, missiles and bombs pass, as its own description says) until the enhanced-shield upgrade is bought, which stops everything and turns the dome its upgraded colour; crossing it is slow and dangerous, no landing near it; turrets and other powered structures stop firing when the power generator is gone'
      ],
      [
        'Capturing structures',
        D,
        'the buildings a map leaves about do what their own scripts say for whoever takes their point: the abandoned factory turns out its five vehicles, cannot be taken again and blows up 45 seconds later; the abandoned mine pays 800 credits and goes up after 3; the sensor array lifts the fog of the whole map; the mercenary outfitter sells; the bunker is a bunker'
      ],
      [
        'Civilians and indigenous units',
        D,
        'spawn houses send out the planet natives, who fight for the faction they or their house favour or against everyone, and keep within their house own distance of it; beasts the maps set loose (rancors) are everyone enemy; harmless wildlife wanders, shies from troops and birds circle (how far they roam is ours). The bonus the briefing texts promise for destroying hostile dwellings is not paid: no figure for it was found. No skirmish map places civilians'
      ],
      [
        'Land hero abilities',
        D,
        'each hero has its abilities with the numbers from its data, cast with the gestures its model has for them; those with a lightsaber or the Force stop blaster bolts inside their reaction arc, send some back at whoever fired and soak up part of the rest (the chances are the abilities own). A few figures the data does not give are ours; some effects are still plain beams (the saber in flight, drained life, the tow cable). Weapon swap, mines and remote bombs are black-market purchases, which a skirmish does not have'
      ],
      [
        'Force powers',
        D,
        'push, crush, lightning, corrupt, confuse, protect, sight and cloak. Force lightning is the game lightning effect: bolts of its table width, number, rhythm and fade, from the hand bone to each victim from the frame the ability names, the victims lit in pulses until they drop. Someone cloaked is drawn see-through to his own side (every other pixel, where his model has no ghost of its own). The grip of Force crush is still a plain beam'
      ],
      [
        'Deployable units (artillery, AT-AA)',
        D,
        'deploy and undeploy play the model own animations and take their time: artillery stands still for both, fires only once set up, and lobs its shells; the AT-AA plants itself for its missile shield'
      ],
      [
        'Mines and sensor nodes',
        D,
        'sensor nodes see; the offensive sensor node drains the life of up to six of the enemy in its reach, tied to them by its lightning effect; mines are bought on the black market; a skirmish checks no purchase, so the mines are there from the start (a campaign battle has them only for a player that bought the item, blackmarket.js)'
      ],
      ['Healing and repair stations', D],
      [
        'Crushing and trampling',
        D,
        'by the game own flags: a crusher on the move flattens whatever of the enemy is squashable (foot soldiers, speeder bikes, not heroes), and a supercrusher - the AT-AT - also what is only squashable by one: light walkers and tanks. The crush is at touching distance, not by the model crusher box'
      ],
      [
        'Line of sight with terrain',
        D,
        'fog of war by reveal range, cut by the weather, and a hill between hides what is behind it; the dimmed ground is drawn by range alone'
      ],
      [
        'Shadows and decals on terrain',
        D,
        'the baked shadow of each map, a decal layer laid on the slope, and under every unit a soft blob shadow - or, with Shadows ticked in the graphics options, real shadows cast by units, buildings and scenery onto the ground and each other (a depth picture from the sun over the ground in view, every other frame)'
      ],
      [
        'Tracks, footprints, scorch marks',
        D,
        'explosions scorch the ground; treads lay their tracks under the tread bones and those on foot a line of prints, as DynamicTrackFX.xml says (width, segment, the distance behind their maker at which they fade); walkers stamp a print where and when their animation plants a foot (AnimationSFXMaps.txt), with its sound and dust; prints and tracks are bump pictures lit by the map sun. Which mark on which ground is SurfaceFX.xml and TerrainDecalFX.xml'
      ],
      [
        'Ragdoll and death animations',
        D,
        'a unit dies as its death clone for that kind of damage says (Death_Clone): the animation for being shot, crushed, thrown by the Force, struck by lightning or pulled down by a tow cable, one of a walker collapses; the wreck lies for the clone own time and ends in its explosion; bodies go when their type says; a clone that is another model (disintegrated, melted) takes the body place. The game has no ragdoll physics: these are its death animations. Wrecks do not block the way'
      ],
      [
        'Land skirmish economy',
        D,
        'credits, income, costs and build times, tech levels and prerequisites, and what the upgrades do: health, shields, damage, defence, speed and income; bombing runs; the enhanced base shield; reflective armour (a chance to stop blaster fire, switched on by its upgrade); weatherproofing; more companies for the free garrison. Not in: the deployment upgrade (landing troops are not vulnerable here to begin with) and orbital bombardment, which needs a fleet'
      ],
      [
        'Land AI',
        P,
        'the decision layer is the engine own, read from the code (landgoals.js, landbrain.js): goals are switched on by the AI templates of the player type; every land goal of the faction sets is weighed against its targets - the battle, the map hint zones, units, buildings, build pads, reinforcement points; perceptions are the engine threat grid and zone sums; selection goes category by category with the bonus for running goals, GoalSetExtensionSize and the memory of failures; the plans are the game Lua plans run as they are. Every goal plan was started by hand for the Rebel, Empire and Underworld players (landaudit.js): 45 or 46 of 52 to 55 take their units and act with no script error. Open action points are the entries below that begin with Land AI, and: live play was watched for the Rebel player on one map, and as a 3 against 3 of computer players (Empire against Rebel) on the trial mod for 15 minutes (Tatooine city): both sides build, buy upgrades and fight to the end with no script error; the Empire side lost most of its army early in Clear_Infantry - small forces sized to the little that stood at the enemy start, met by bigger ones on the way - and, holding no more than its own reinforcement point, stayed at a population of 2 against 7, so it bought far less; a Rebel commander at its population cap burnt its units (BurnUnitsLand, as the data has it). Fixed by that watch: Variable_Target.IsEnemyStartLocation and IsFriendlyStartLocation as the engine (graded by distance from the side own start, the enemy one being one less that in a skirmish) and build plans whose lines name only things built on pads, which were begun and ended a thousand times a battle. Not yet watched: the Underworld player, other maps, a game the human plays; the check of a plan is ten game seconds, not that it plays out as in the original'
      ],
      [
        'Land AI: which units a plan is given (the engine plan solver)',
        P,
        'as the engine plan solver (aiplans.js staff): one unit at a time, the best sum of nearness to the target, tech level, room on its line and contrast against the enemy at the target (EnemyContrastTypes, FriendlyContrastTypes, Min and MaxContrastScale, failures, the difficulty multiplier); no type over half the choice while another can be taken; escorts after the main force; the choice stands only if lines, totals, RequiredCategories and the contrast are met, else the goal is not proposed; a goal wanted more takes units from a running plan wanted less. No unit under Health_Low_Percent_Threshold of its health is given; a hero with a script of his own is never put in a plan that lets heroes attach (the escort scoring that would place him is dead code in the x64 program - read). Distance as the engine land free store measures it (with ZoneReachabilityClass, read): where the cheapest way through the zones (threat first, by hundreds, each zone at least one; then length) stays within Low_Threat_Reachability_Tolerance, the square of its length by hundreds is added to the squared straight line; else the straight line alone. The side waiting companies are offered too (the engine reinforcement list on land) and a plan calls them down by the reinforcement point it holds nearest its spot (Reinforce, WaitForAllReinforcements), seen on the trial mod; contrast is weighed by the planet terrain for the movement class (AITerrainEffectiveness.xml - all ones in the game and the trial mod). Ours: a waiting company no plan has taken after 20 seconds comes down at home, so that a side whose waiting troops fill its population and suit none of its wanted plans is not stuck. What a plan script gathered for itself may be taken by a goal wanted more; the plan ends only when it loses one the solver gave it (read from the engine)'
      ],
      [
        'Land: targeting priority sets (what a unit shoots at first)',
        P,
        'as the engine (read from the engine): a land unit or turret picking its own target goes by its targeting priority set - the one a plan gave it with Set_Targeting_Priorities (TaskForce, GameObject; kept until it leaves the force), else its type Targeting_Priority_Set: a lower weight first, never what the set excludes, last what it does not list, then the kind its guns rank first, then the nearer. Space units take the plan sets too. Not yet: a badly hurt target first, the clear line of fire test, the stickiness time (Targeting_Stickiness_Time_Threshold)'
      ],
      [
        'AI perceptions and script calls that read nothing',
        P,
        'every perception the equations of the game and the trial mod use now has an answer, but Game.IsLandControlGame and IsSetupPhase (nought in a skirmish) and two of space never asked (StarbaseLevel, Energy): IsInsideFriendlyShield and IsInsideEnemyShield (a dome that is up, read; ours: friend or foe of the side asking, as the equations mean it - the engine player argument was not settled), IsBuildPad (the pad itself), ContainsHero (the unit, its company or its garrison), Hints.Name (the hint zone value - ours, not read) and HasUnit in space. Script calls: Should_Switch_Weapons (another of its Projectile_Types does more to the target, shield or hull, by the damage table), Divert and Is_On_Diversion (ours: the order before the diversion is not taken up again), Eject_Garrison (everyone out) and Leave_Garrison of a company inside, which did nothing on land. Is_Affected_By_Laser_Defense and _Missile_Shield by Projectile_Category alone (the shield on ROCKET and MPTL_ROCKET, the laser defence on those and MISSILE - we had guessed lasers), Lock_Current_Orders (the free store and the plans leave the unit alone until its order ends), Get_Contained_Object_Count (garrison or load, else the company or squadron), Block_Goal_Proposal and Unblock (no goal of the player is proposed while a plan holds it). Set_Importance only stores a number nothing reads and stays a no-op; Is_Multiplayer_Mode was already right in battles. A group of ships sent against one target is placed as the engine places it (orders.js attackSlots, read from the engine): layer by layer, those already in reach keep their place, the others stand on rings about the target on the group side - the first at 0.9 of the shortest reach on it, as many as the arc holds by their occupation radii, the next further in - in the order they stand across the line to the target, paced to arrive together; each place moves with the target. A squadron goes for a target it cannot fire on yet as a formation, sent again (looked at once a second) only when the target has gone half its reach from where it was sent, and fights as it will once in reach; Enable_Attack_Positioning (per ship, cleared on joining or leaving a force) or Keep_Moving_In_Battle on the type turns that off. They are placed about where the target will be when the quickest of them can be in reach of it (the nearer root of the meeting time, less what the group shortest reach saves) and steer for that point less the time gone; a place is refused on another ship of its layer, a station, an asteroid field that hurts it, an ion storm or a nebula unless already in one (by the engine mask every space order has on); they set off the nearest the target first, SpacePathfindFrameDelayDelta frames apart (always, in space). Where a ship target will be is where its own planned route has it then, and a place is refused on any route another ship of the layer has planned over the tracker horizon - both from the planner tracks (pathfind.js tracking, the engine object tracker); a craft or a ship with no route goes straight on at full speed while it moves. Ours: the routes are our planner, timed at the speeds it plans. Object.Fire_Special_Weapon: a planet gun fires at a live object when charged and its upgrade is bought, as a click fires it, and gives itself back (the AI ground to space plans fire it again each time it is ready). Weapon swaps (weaponswap.js, read from the engine): a unit fires the projectile at its weapon index; SWAP_WEAPONS flips it between its first two each time it is used, Permanent_Weapon_Swap_Ability sets its Weapon_Index at the start where the black market lets it (the Disruptor mercs), and with more than one projectile each fires by its own recharge and pulses - land and space; seen on the MAL rocket vehicle, Bossk and the Disruptor mercs. With more than one projectile a shot sounds the projectile SFXEvent_Fire and leaves from muzzle i of the type Muzzle_Bone_Name _00, _01 (where there are two or more; otherwise in turn), and in swap mode scatters by the wider of the unit and projectile Targeting_Fire_Inaccuracy (read from the engine). A unit whose weapon is a grenade (Projectile_Category GRENADE) reaches as far as it can be thrown, Max_Speed squared over gravity times lob mod, whatever its Targeting_Max_Attack_Distance (read from the engine): Bossk 179 with his grenade, the Underworld merc 179 not 240, the trial mod grenadiers 290 not 300. Ours: a projectile with no fire numbers of its own takes the unit ones; space scatter stays on its Fire_Inaccuracy_Distance'
      ],
      [
        'Land AI: reachability of a target',
        P,
        'as the engine land goal system: a goal about a place is proposed only if the reach of the zone path finder (LandZonePathFinderClass, landzones.js) from the place zone, never entering a zone whose enemy threat is over what the goal Reachability allows (nothing, the Low, Medium and High tolerances of the game constants, 1e18 for any), holds some zone - from the zone itself, or where it is itself over, the largest such set from a neighbour (ZoneReachabilityClass, read). Checked on the trial mod: the same answers as the old shortcut in all 1275 cases of 85 zones, 3 sides and 5 kinds. Goals about units and buildings are not tested at all (their targets carry no reachability: read). FindTarget.Reachable_Target leaves out a place whose cheapest way from the source given carries more threat than the reachability named, and nothing without a source (read) - no land script of the game or the trial mod gives one, so it was not seen at work'
      ],
      [
        'Land AI: a task force moves as one formation order',
        P,
        'the squads of a force are sent through our group move and group attack; the engine puts the whole force into one formation and reports the move done when every unit has arrived. A move by the zones (Move_To, Attack_Move, Attack_Target with their third argument true; LandMovementBlockStatus, read) goes as the engine: the zone path finder (landzones.js: A star from zone to zone over the links in CRC order of their places, a step the distance between places, times link factors, plus hint factors, more under enemy threat and none into a zone over twice the threat tolerance, only over links that cross ground every unit of the force may cross) gives the way, the force goes to the middle of the next zone, and asks again from there; the last step is the move asked for. No land script of the game or the trial mod asks for it, so it is seen only when tried by hand (a CLEARINFANTRY force went 38, 57, 68, 69, 70, 71 as planned). Ours: arrival at a zone is all units idle or within 350 of its middle (the engine waits for its formation move to report)'
      ],
      [
        'Land AI: when a place was last seen',
        D,
        'as the engine (read from the engine): each side keeps a sight grid on the perception cells (AI_FogCellsPerThreatCell fog cells across), from the Land_FOW_Reveal_Range of its troops, buildings and reinforcement points; a cell stays seen LandFOWRegrowTime after; how long since a target was seen is the mean over the cells of its zone (a unit, the zone it stands in) of how long each has been fogged - nought in view, the whole battle never seen. Ours: one look per company from its first trooper, sight over hills as over the open'
      ],
      [
        'Land AI: Game.ForceVisibility',
        D,
        'the space one, which the land evaluator registers too (read): the share by count of the units of every side but its own - allies too - of the equation category that stand where the side sees now (its sight grid); used by the land budgets of the templates'
      ],
      [
        'Land AI: the firesale map reveal (FogOfWar.Reveal_All on land)',
        D,
        'FogOfWar.Reveal_All and FogOfWar.Reveal of a script now reach land sight (land.js updateSight): the revealed team sees every unit, the ground fog and the radar fog lift (a local Reveal lights its circle, over hills). The reveal ends with Undo_Reveal or with the plan that made it (over, or the script begun again), as in space. Checked on Tatooine from the console. Our guess: ground lit by a whole map reveal counts as seen afterwards (grey fog, not black)'
      ],
      [
        'Mobile defence unit: deploying and building its items (Object.Build)',
        P,
        'as the engine (read: WalkLocomotorBehaviorClass, TacticalBuildObjectsBehaviorClass, Lua Build): a unit whose DeployedBehavior lists TACTICAL_BUILD_OBJECTS is a build pad once it has set up - one item at a time of its own Tactical_Buildable_Objects for its faction, standing on its Tactical_Build_Attachment_Bone_Name; it cannot pack up while something stands there or is going up; nothing may start while an enemy is within its Capture_Point_Radius; Object.Build costs nothing and with its check builds only what is allowed; what stands there goes with the unit. Seen on the trial mod with its Tracked_Mobile_Base (the mod does not load the game mobile defence units, and its build plan names none). Ours: the plan Activate_Ability(DEPLOY) block waits for the setting up. Action point: the player cannot yet open the build menu of a set-up unit (how the original bar shows it is not known)'
      ],
      [
        'Land units keeping off each other (the engine collision system)',
        P,
        'infantry teams: slots, waiting for stragglers, stepping round other squads, standing teams moving off each other, stopping short of an occupied place - as read from the engine. The old push-apart pass is gone (no such pass in the engine; it shoved a cinematic mouse droid off its mark); only the crush check of a moving crusher remains. Vehicles, and vehicles against teams, as the engine (read: the pair search, MovingVsMovingCollisionClass with its classifier, MovingVsStoppedCollisionClass; landcollide.js): only types with a UnitCollisionClass take part; every FramesPerCollisionCheck frames a mover looks within 80 of it; two on the move collide when their ways meet within MovingVsMovingLookAheadTime, one standing when the mover runs into it within that or its MovementPredictionInterval. Moving against moving: going the same way the one behind holds back (the engine speed rule) or passes when it can get by in the way it has left while the other slows to half; a Giant Vehicle never gives way; head on the smaller class goes round, of one class the faster; crossing, the one further off goes round while the other slows only as it must; a crusher goes through; no way round, both wait 30 to 45 frames, the one ahead going on. Moving against standing: a Giant Vehicle has it stand aside; sent onto it, the mover stops short; else it goes round; failing that a friend not fighting stands aside 45 degrees off its way, a crusher drives through, a big one attacks the enemy in its way, else it waits. Ours: the way round (two points beside what is in the way, on the nearer open side) for the engine local search; after three waits with no way, the two go on through each other until apart (the engine time allowed a collision is read but what it does at the end is not); speeds read in smoothed. Measured on the land benchmark (30 against 30, trial mod): 0.2 ms a sim step. Still missing: two vehicles standing in each other (the engine stopped-against-stopped for them); an infantry team takes part by its own formation box (its depth and width), not by the size the engine gives its team container (not read), so how far a vehicle keeps off a team may differ; a formation common speed is set but unproven for mixed types'
      ],
      [
        'Land formations of several units moving as one, narrower in narrow places',
        P,
        'units sent together that make one formation (vehicles and single units; infantry teams are formations of their own) follow one route for the formation: a point goes along it at the pace of the slowest, waiting up to four seconds for one fallen behind, and each member steers for its place about that point, turned with the route and moved aside from what is close beside it (the side shift the teams use); where the room beside the route is less than the formation width, the members take the rows of a layout that wide for that stretch (the engine narrower layouts, built with the same row rule as the formation itself). At the end each goes to its own place by the spot. Ours: the pace, the waiting and each member speeding up or slowing to hold its place are the team rules applied to a formation, not read for formations; a member with no straight way to its place takes a way round, looked for at most once a second'
      ],
      [
        'Land AI plans not yet seen working: Fire_Magnepulse, Land_Bombing_Run, Sell_Tactical_Structure, Fund_Tactical_Structures',
        D,
        'Land_Bombing_Run calls the run in and is satisfied (the bombers are the faction Skirmish_Land_Bomber now, which a mod sets), Sell_Tactical_Structure sells what stands on its pad - both seen on the trial mod. Fund_Tactical_Structures only acts with no credits at all, which is a campaign battle (it draws on the galactic budget); Fire_Magnepulse needs the Magnepulse Cannon, a special structure built on the planet in the campaign (the trial mod turns the plan off)'
      ],
      [
        'Land command bar and build menus',
        D,
        'the game bar itself: selection slots with health, build menus of buildings and pads, queue, research column, reinforcement window, hero portraits, ability buttons, sell; attack, attack-move, guard and waypoints; the radar shows the ground as the game does - each kind of ground in the colour RadarMap.xml gives it for that kind of planet, under the fog of war in its colour'
      ],
      ['Land maps (.ted terrain chunks)', D],
      [
        'Land audio (footsteps, vehicles, ambience)',
        D,
        'weapon fire, impacts, deaths, unit replies, announcer lines, music and engine loops; footfalls and the other sounds of the animations at the moments AnimationSFXMaps.txt gives (a company footsteps thinned to one in five); the weather loops and gusts. The game own table of map ambience (AmbientMapSounds.xml) is a stub its makers never filled in, so there is none to play'
      ],
      [
        'Land victory conditions',
        D,
        'the land win condition GameConstants names: a side is beaten when every counted building of its base is destroyed; the game end-of-battle screen follows'
      ]
    ]
  ],
  [
    'Galactic conquest',
    'rest',
    [
      [
        'Multiplayer galactic conquest',
        P,
        'game type Campaign from the host settings dialog (IDD_INTERNET_HOST_OPTIONS_DIALOG: name, password, type) lists the Is_Multiplayer campaigns of the loaded data; players pick factions (two different at least), AI slots allowed, unchosen playable factions have no player; IDD_CAMPAIGN_ADVANCED_OPTIONS_DIALOG credits, tech levels, auto-resolve Always or Ask. The galaxy runs in lockstep (galacticnet.js): fixed steps from a worker timer, map orders as commands, seeded randomness, AI limited by work, steps wait for loading, hash check every second, any player sets the speed. Conflicts not between two humans auto-resolve; between humans the IDD_MP_VOTE_DIALOG vote with its countdown; a tactical battle is a lockstep battle of the two humans in a frame over the galaxy, its outcome a galactic command. Data without multiplayer campaigns offers its single-player conquests, a player on the host side (co-op) unless they take another, only the host side getting the story (scripts written for one player serve one side), a mod start menu included: the host clicks decide, other players clicks only choose their own side (faction buttons read from the menu Lua), and LOAD_CAMPAIGN moves every machine to the chosen galaxy; conflicts with the computers are voted on and fought as battles against the AI (each galaxy a frame page on its own channel). Co-op: several players on one faction, in the galaxy and in battle. Find_Player local is the same on every machine (the running plot human owner, else the first human); script movies, speech, dialogs and objectives show only for the player they mean. Players not in a battle watch it as spectators. Tested on base FoC (Heart of the Maw), on mod 2712013423 with one of its campaigns marked multiplayer, and with four players on Thrawns Revenge through its own menu (co-op Empire, two guests on other sides fighting each other, the host and its co-op partner spectating). Open: the story and player features of single-player conquests for sides other than the host one, retreat in battles between players, saving on every machine at the same frame (each player saves alone; loading works from staging), the corruption, slicer, hacker, sabotage, black market and bribe panels and story buttons as commands, IDD_MP_AUTO_RESOLVE_RESULT_DIALOG, Multiplayer_Campaign_Heroes, Land Control win condition'
      ],
      [
        'Retreat from a battle',
        P,
        'the Retreat button of a campaign battle (space and land) opens IDD_RETREAT_DIALOG (Battle Resolution?: Cancel, Auto-Resolve, Retreat) when auto-resolve is allowed for the battle, else retreats at once; Auto-Resolve gathers the units alive now, runs the aggregate resolver with each side damage scaled by Auto_Resolve_Tactical_Multiplier (0.85) and declares a winner; the battle ends as a retreat victory (SUB_TACTICAL_ALL_CAPABLE_ENEMY_UNITS_RETREATED, taken as 12) and what is left of the loser withdraws in the galaxy (space) or stays in orbit (land). The engine disables the button in a battle with no campaign behind it, so it is not part of skirmish. The retreat itself is built from the coordinators (retreat.js; space, land): the dialog Retreat (or the button when auto-resolve is not allowed) asks CanRetreat (1 not a campaign side, 2 for the first 30 seconds of Space_ / Land_Retreat_Allowed_Countdown_Seconds, 5 another side retreating, 3 an enemy gravity well, 6 an enemy superweapon on the map), the faction refusal sounds answer a no, a yes starts the faction countdown (Space_ / Land_Retreat_Countdown_Seconds, 10.99) with the Begin and Enemy_Begin sounds and the countdown text and colour, clicking again or a new refusal cancels it, and at the end the enemy wins by the retreat (type 12) while the retreater units that can go are carried off, come through to the galaxy and withdraw there, and everything else of theirs is lost. Auto-Resolve also asks CanRetreat. Read later: the asker own list decides (Tarkin blocks his own side with code 4, a gravity well the enemy, a tactical superweapon of the asker own in space only), the listed units hold fire and cannot be targeted from the request, pursuers go faster and the listed take more harm until the countdown ends and none after, and in space the ships fly off away from the attacker entry (8.125 a frame, each released one 500 a frame from the 30th frame, to the 89th). Ours: the camera of the flight and the DUMMY_STAR_BASE explosion are not drawn, the direction is the line through the two markers, the attrition protection (no unit carries it) is not in, a retreated ground force always comes through (the engine seems to want a reinforcement point), the loser of an auto-resolve always withdraws where the engine destroys what is left of one that cannot retreat, units still waiting to be called in are left out, and the countdown is a text line near the top of the screen. Read and done: the attrition factors are GameConstants, and on land Blockade_Run_Attrition_Factor is added while a live ship of another owner is in orbit unless the retreater holds an object with Prevents_Blockade_Run_Attrition (the ion cannons), a named hero is never rolled for; CanRetreat answers 1 again for a faction that is not playable or that the story reward DISABLE_RETREAT (a 0 gives it back) has stopped; FORCE_RETREAT and Player.Retreat ask the same question and never move the local human; Disallows_Hyperspace_Retreat is read only by an AI free store path, and the speed and damage factors of a retreat exist in tactical only (read). The auto-resolve progress and result dialogs are opened by the engine only in multiplayer type sessions or with the lobby setting Always, so the port has none. Start_Cinematic_Space_Retreat (the three Rebel space missions use it) makes the ships of a player jump out in stagger, each after the seconds given times 30 frames plus its place in the list times Space_Retreat_Unit_Increment_Wait_Frames, with no countdown and no end to the battle (read; ours: the ship flies off along its heading for 90 frames and is taken off the map). Retreat_Protection_Ability counts: the largest Retreat_Loss_Mitigation of each Stacking_Category are added and taken off the factor of the roll (no data uses it; the engine clamp bytes beside the list were not traced); the factions the story has stopped from retreating go with the snapshot, across the page restart and into a save. The land retreat of a battle launched by force (the LINK_TACTICAL reward or a corruption mission, an engine flag) that the local player did not win tries the base tier before the fleet tier; every other retreat, and the space retreat always, keeps the usual order (read).'
      ],
      [
        'Battle-start fleet arrangement (capital / screen / lead / transport)',
        P,
        'in a campaign space battle each side is laid out by Ship_Class as the engine does (campaignbattle.js): super capitals in a grid at the anchor, then rows of capitals, of corvettes and frigates, of fighters and bombers - the first in a grid of 1 to 6 rows by count, the next on a 225 degree arc, later ones on a 130 degree arc from 25 degrees - transports in a grid 200 behind, a cell twice the largest half-size of the row. Action points: the arcs radii and where they open are ours; a squadron half-size (ours: three of its fighter)'
      ],
      [
        'Planet-based special weapons in space battles',
        P,
        'read from (space mode, structures with Is_Special_Weapon_In_Space and a Special_Weapon_Index of 0 or more): a campaign space battle gets one weapon for each such ground structure of the planet (Ground_Ion_Cannon, Ground_Empire_Hypervelocity_Gun), placed at the first DUMMY_SPECIAL_WEAPON_SOURCE marker or the map origin and owned by the planet owner whoever attacks, with no use upgrade needed; they charge and fire as the skirmish weapons do (superweapon.js, shots from PROJECTILES.XML) and a second weapon of a player is picked when the first is spent. Ours: linked missions do not carry the planet weapons, auto-resolve ignores SpaceAutoResolveStunRate and SpaceAutoResolveHitRate, and weapons are not kept in a saved battle. Action points: Spawn_Special_Weapon story reward, the second command bar slot b_special_weapon2'
      ],
      [
        'Hero respawn timers',
        P,
        'galacticherorespawn.js follows the engine (death hook, scheduler, queue, executor): a lost named hero is queued at the planet with Default_Hero_Respawn_Time (zero or less takes the default, a negative default - the trial mod - means none) and comes back at the nearest planet its owner holds, whether it died in a tactical battle or in auto-resolve; the respawn sound is read from the company type first. Neutralize_Hero_Ability queues both the target and the one who neutralized it with the ability Target_Respawn_Time_In_Secs and Owner_Respawn_Time_In_Secs (the roll inside the range is ours) and the FORCE_RESPAWN story reward brings a queued type back at once. A skirmish has no queue, as in the engine: its heroes are ordinary buildables. Action points: the sabotage hero and Probe_Droid abilities that take a hero off the map and queue it (the others, Siphon, Slicer, Corruption and Black Market, now queue it), the flash of the respawned entry on the command bar'
      ],
      [
        'Black-market purchases of abilities',
        P,
        'blackmarket.js and blackmarketpanel.js follow the engine (the hero ability and its availability, the offer list and price, the panel, the purchase, the ability gates): BlackMarketItems.xml gives the items; a Black_Market_Ability used on a planet of corruption type 6 that is not an ally lists the planet owner faction items for the hero player at (Base_Cost_Credits + the planet Planet_Black_Market_Modifier) times the ability Price_Modifier, times Uncommon_Price_Multiplier while the item faction is below the item Tech_Level. A human gets the panel on the i_black_market.alo shell (one row for each tech level with its tech icon, the item button and its name and price, Purchased in red, grey when it cannot be paid, item and tech tooltips on the encyclopedia stack, Cancel); a click buys at once, tells the story STORY_BUY_BLACK_MARKET and queues the hero to return; the computer player buys one it can pay for at random, weighted by price. The purchase stays on the player (saved with the game); GIVE_BLACK_MARKET and RESTRICT_BLACK_MARKET are story rewards. In a campaign battle an ability marked Must_Be_Bought_On_Black_Market (on the Unit_Ability block or on the named ability) is off, its button on the dark plate, for a player without the item; in a skirmish nothing is checked and every such ability is there. Ours: the player own cost multiplier in the price is left out; the computer pick skips items it already has where the engine pick does not look at that mark; the used-by row of the item tooltip is laid out from the type tooltip; the skirmish-mode rule that compares with the other players highest tech is not applied; RESTRICT_BLACK_MARKET refuses the ability on the planet where the engine hides its slot'
      ],
      [
        'Salvage (bounty) on kills in the galaxy',
        P,
        'the galactic branch of (galacticbounty.js): an object killed in auto-resolve pays its worth (the campaign tables) in full to the killer when the killer faction Benefits_From_Corruption and the planet has corruption type 3, Racketeering (a planet taken by such a faction gets 3 at once), or when the victim faction benefits and the killer owns Nal Hutta; never for an owner or ally, not while ENABLE_BOUNTY_COLLECTION is off, and not for what a conquest clears (no killer). It is credited through the credit adjustment, counted for the Salvage collected line of the auto-resolve summary (zeroed when an auto-resolve begins) and shown nowhere else. The tactical branch is the Salvage bounty entry above. Ours: a planet losing its corrupting owner loses its corruption at once where the engine begins a timed removal. Action points: the faction upgrade objects the corruption types add (icons only, except Racketeering whose bounty is the hard-coded one), stations killed in auto-resolve paying for their type'
      ],
      [
        'AI retreat',
        P,
        'the computer players retreat by the engine own goals: Space_Retreat (Should_Retreat_From_Space = Want x Allowed; the want needs an age of 20 seconds as defender or 120 as attacker and a lost position: enemy at least 4 times its own, 3 times its transports reaching its force, and so on; allowed in a campaign game when CanRetreat says yes) and Land_Retreat (age 30, enemy at least 2 times as attacker or 2.5 as defender), whose plan RetreatPlan.lua calls Withdraw_Units, which now asks the battle for the retreat (retreat.js). The brains answer IsCampaignGame, IsDefender, CanRetreat and IsRetreating from the campaign battle, and a plan of the space folder that names Land_ goals in its Category is loaded in a land battle. Seen live in a space battle (the weakened defender began its retreat at 40 seconds); the ground side is not exercised in a real campaign battle. Action points: Disallows_Hyperspace_Retreat, the galactic AI (it retreats only as a battle outcome), Start_Cinematic_Space_Retreat, Player.Retreat from Lua and the FORCE_RETREAT and DISABLE_RETREAT rewards'
      ],
      [
        'Story scripts: run the campaign and story mission scripts (Data/Scripts/Story) with the story functions they call (Story_Event, Get_Story_Plot, Check_Story_Flag, objectives, cinematics)',
        P,
        'the galactic host runs unchanged GameScoring and ordered story environments, services PGStateMachine and threads on the independent native application clock while paused mode clocks and elapsed plot timers remain frozen, and supplies story plots, GUI operations, player/type/object wrappers, spawning, build locks, flags and data-backed perceptions. Scripted selectors use their own Lua, shell models, text and icons; LOAD_CAMPAIGN forwards exact campaign, faction, difficulty and optional native starting-tech override. Every real script in the tested normal mod startup initializes once and reaches the actual control-unlock path. Generic neutralize-hero abilities supply the original choice dialog used for regime and custom progression choices. Module dependencies are prefetched; an unexpected live dependency is reported instead of replaying world changes. Missing operations remain visible in game.story.report(). Native spawn return semantics, separate generic creation, normalized route fractions, structure capacity and orbit/surface presence now support real faction initialization without invented fallback records. On land Change_Owner moves a company to that player side (the prologue freed prisoners join Tyber), Set_Selectable keeps a company out of the selection and Select_Object selects it for the local player; a type without a locomotor in its behaviours never moves (the prologue door terminals). Action points: strategic object Lua_Script lifecycle, maintenance perception, complete native perception semantics beyond the verified startup subset, further rewards and object abilities, particles, cinematic and speech services, fully dynamic module loading and the scripts of a campaign game that were stopped before their state could be kept now go on after a save or a battle (see Campaign save and load); the plan scripts of the computer players are kept too'
      ],
      [
        'Campaign data and the galaxy it starts with',
        P,
        'every campaign CampaignFiles.xml names is read (play.html?autostart&mode=galactic&campaign=NAME&faction=F; the variant played is the one of the Campaign_Set whose Starting_Active_Player is the faction chosen, as the engine picks it). Its Locations are the planets, every one held at first by the neutral faction and then by the faction of the last starting force put on it (engine); Starting_Credits, Starting_Tech_Level, Max_Tech_Level, Home_Location and AI_Player_Control are read per faction. The starting forces are put down as the engine does it, by the DUMMY_ flag of their plain Behavior list: a station becomes the planet station (Base_Level its space level), special ground and orbital structures join the planet lists (no ground structure where the surface is not accessible), a ground company goes down in its transport while the surface is accessible, fewer than Max_Ground_Forces_On_Planet are there and none of its units must Always_Spawn_In_Orbit (else it waits in orbit in its transport), each squadron and starship is a fleet of its own, Create_Additional_Object is put down with it. Scripted starts use unchanged faction rosters and random-force Lua; native structure capacity and space/ground presence replace an invented one-slot ground-base shortcut, and route perceptions return native fractions. Spawn_Unit retains native nil main returns without phantom objects, while Create_Generic_Object uses separate raw creation. Known Galaxy Small verifies106 authored hero type/faction/planet entries and all14 present factions; Full Galaxy Large verifies119 entries and all18 present factions. Startup markers are consumed once and military rosters do not repeat during continued service. Base/mod regressions and a live mod Summary check pass without console errors. Action points: whether an enemy present keeps a hero on the ground (ours: nobody is an enemy at the start); full script-created galaxy coverage beyond the tested startup flows and persistence through tactical transitions'
      ],
      [
        'Galaxy view and camera',
        P,
        'the galaxy core and planets use their original models and idle animations, including the native zero-Euler object pose plus its fixed 90-degree model-axis turn. GalacticModeClass overrides the constructor lens with horizontal FOV atan(0.5), about 26.565 degrees (projection); the former one-radian lens made planets and spacing about 2.3 times too small. GalacticCameraClass supplies the data-driven pullback, pitch, home location, scroll plane, bounds, right-drag and discrete planet zoom. Native distance fading (verified against raw instructions) now uses camera distance from model origin, the current scene near clip and the world AABB half-diagonal. Authored boxes from every mesh and its full current bone transform participate, including hidden and transparent meshes; these bounds remain separate from gameplay framing bounds. Exclude_From_Distance_Fade bypasses it. Additive RGB uses the fade, while opaque MeshGloss and Planet effect expressions enable SRCALPHA/INVSRCALPHA below full opacity without changing shader phase or depth writes. This reproduces the darker mod galaxy and subtle region bands without an asset-specific dimmer. Base and mod regression tests verify the formula, clips, independent materials, animated bounds and XML exclusion. In-app testing confirmed the mod overview and Kuat zoom without renderer errors; a worst-case forced bounds refresh across 94 real models and 311 mesh callbacks averaged about 0.29 ms per frame over 300 iterations. The 2D overlay uses integer projected pixels and the command bar reference scale min(width/1024,height/768), bottom-up XML offsets, uppercase g_planet_name text with the engine structure-count font alternates and visible owner Color, and the original centred planet_ring texture hidden on the selected planet. Overlays fade within the first tenth of zoom-in and final tenth of zoom-out, with hidden hit handles cleared. Unknown planets select the original ALT2 meshes; mode 2 to ALT2 is verified through the renderer. Only ALT0 and ALT2 are built for the overview. FoC does not instantiate the XML g_political_control bar; no extra political bar is drawn. Action points: full close-up alternate models, keyboard and edge scroll speed, exact pan bounds from render-model AABBs instead of the current planet-center approximation, wheel target fallback and non-Planet material lighting parity. Native galactic lighting now uses the original sin-yaw and negative-cos-yaw direction, linear yaw and pitch interpolation, initial white intensity0.5 and absolute zoom target, with ambient0.05 and zero fills. Planet materials receive this context independently of legacy hull tuning'
      ],
      [
        'Planets: stats, bonuses, terrain',
        P,
        'an invasion changes control through the surviving landed force; defeated base structures are removed, survivors land up to Max_Ground_Forces_On_Planet and overflow remains in orbit. Planet_Capture_Bonus_Reward is paid once per playable player per planet type, and its record and credits survive battle restarts. Action points: the engine presence rule that makes the controller, the other planetary bonuses and terrain effects'
      ],
      [
        'Political control of planets',
        P,
        'galacticpolitics.js, read from PlanetaryBehaviorClass, PlanetFactionChange and the step: the owner of a planet is its political controller and there is one meter per planet, the value from 0 to MaximumPoliticalControl; a campaign (and a load) starts every planet at its target, a planet that changes hands by invasion, Change_Owner, PLANET_FACTION or the revolt of Corrupt_Militia starts again at 0 and climbs one level in Political_Control_Change_Time_Seconds (7 s, 160 s in the trial mod) times a rate - the force alignment and each Stacking_Category of Political_Transition_Bonus_Ability (the percentage taken as the multiplier itself: 0.25 is four times as fast, the mod 0.05 twenty) of what the controller has there; Political_Control_Protection_Ability (Tarkin) freezes a falling meter; the target is the largest entries of the groups summed (type, base level, troops, star base, residual influence, orbit, structures, trade route gains), at least 1 for a controller; income follows the Political_Income_Curve of the value (a planet pays less while it climbs) and a controller is held with a value above 0; the AI perception TargetPoliticalControl and the PLANET_FACTION story reward are in. Not done: the Political_Control_Bonus_Ability and Sabotage_Political_Control_Ability terms and the orbit claim of a planet whose surface cannot be reached (no data uses them); Ours: what presence makes the controller is not run, the owner is changed where the port changes it'
      ],
      [
        'Campaign save and load',
        P,
        'a campaign is saved from the pause menu with the galaxy, the story and where the player looks, and loaded from the same list (a mode galactic save); the page restarts between the galaxy and a battle by the same road, so a return from a battle keeps the story too. The story is the Lua state of every script: luapersist.js writes out the machine the way Pluto does for Lua, on Fengari own objects - tables with the order of their keys, closures with the upvalues they share (a closure and the running frame that made it share one), coroutines stopped in a yield inside pcall with their stacks, frames and saved program counters, string.gmatch iterators; what the host set up before any script ran (libraries, the globals of the engine) is permanent and named by its path, and engine objects (planet, unit, faction, plot, event) are written as where they are found (galacticstorysave.js). Beside it the instances, the threads and events waiting, GlobalValue and ThreadValue, the story goals, the XML events, the state of the script controls and the control lock. Checked on the base game and the trial mod (nine scripts, 13000 Lua objects: 4 MB, written in 0.2 s and read in 0.5 s): a game made from a save goes on exactly as the saved one, Lua state and all, also when saved again. A campaign save is kept packed in the browser private file system, and what travels with a battle page restart goes through the browser database. The plans of the computer players go the same way (galacticplansave.js): each running plan with its environment and the thread of each task force on the line it had reached, the commands it waits on (written by what they are about and made again with the same test), the units of each force and the builds it asked for (named by where they are in the galaxy), its budget row as it was, the marks it put on planets, and the goal system of each side (where it is in its pass, what it proposed, the failures it remembers, which plans the templates allow) and the last route destination the island connectors read; checked on the base game (7 plans) and the trial mod (67 plans, 1.4 MB, written in 0.2 s): the loaded game and the saved one stay identical for a minute of play, galaxy and all. A plan that cannot be written, or put back, costs only its script: the builds it already asked for stay funded. What is not kept is only what is made again by itself in a moment: the commander view of the galaxy, the route and unit pool caches, the conflict manager scan. A save cannot be made in the middle of a call to the engine, and no way to ask for one there was found: the pause menu and the page restarts run between frames, battles of the story and the computer players are started after the frame, and the mission launched by LINK_TACTICAL needs no Lua state because its page covers the live one. The outcome of a battle fought on the battle page goes in after the story is back (the story objects are found by their places in the galaxy as it was left) and the story is told of it as of a battle resolved in the galaxy: each unit lost, the planet that changed hands, the end of the battle (no bounty again). The class summaries the battle events read are the one pair of the engine, rebuilt only when the local player fights a campaign space battle and saved with the story (read). Action points: the events of a mission fought in a linked battle already follow their own road (linktactical.js); the Galactic_Unit_Destroyed_Event and STORY_DESTROY of one battle come all the Lua ones first in the engine, ours go unit by unit'
      ],
      [
        'Trade routes',
        P,
        'only campaign Trade_Routes are drawn, with discovered-endpoint gating and remembered ownership intelligence. TradeRouteLines XML supplies RGBA, width, line and spark textures and render mode; colours interpolate with zoom. Simplified faction colours use Ally and Enemy relationship styles through the native gameplay option. Lines and eight 3.5-square sprites use the native world plane and UVs, signed seeds and bidirectional fifty-logic-update traversal. Base and mod regressions cover styles, textures, modes, geometry and timing. Background models now retain native culling for additive meshes; meshadditive reads UVScrollRate and explicit material RGB. The native effect uses ONE/ONE without texture-alpha multiplication, but the transparent mod selection-ring asset does not agree with a direct port; existing alpha and vertex-colour treatment is retained until the full native texture/render path is resolved. Native background, midground and midforeground scenes render separately with clips 10 to 100000 and a depth clear before foreground passes, preventing additive galaxy art from washing over planets. Galaxy bar (ours): a plate with art at the top edge and art at the bottom and nothing between (the trial mod credits bar) is split in two at the widest empty band, and the top piece and its readouts keep to the top edge of a window taller than 4:3 instead of floating down the screen (the engine rule for such windows was not read). Galaxy bar pieces read in a later pass: ten balance_pip buttons from the bone fight_bar_g, 6 apart, blue up to the share of the fiscal cycle gone (whole tenths, one tick clock with the payday); the population glyph i_icon_planet_pop beside Text_Pop_Cap; the third overlay filter b_filters2 shows the planet type weather and special ability pictures on every marker (g_weather at -20 -31, g_planet_ability at 0 -34). Selection and drag read in a later pass: the galaxy map has no Shift or Ctrl selection and no box (only the close-up has them); a press only becomes a drag after 12 pixels (strictly more), the hover picks the first fit in planet order, not the nearest, fleets that come to one pane are one stack of all their units and a drag from it first merges the own fleets of that pane; in the planet close-up a click on a cell chooses it, Shift adds or takes it off, a click on an empty cell clears the list, a box over more than 12 pixels replaces the list with the cells it holds and a dragged list is dropped cell by cell (ours: the chosen cell is shown with its mouse over art and the box in white, the engine colours were not read). Not done: the engine path request for a drag over another planet (A star over the planets, partly read), the aggregation rules for the foreign controller slots beyond the pane sums, the slot indices kept across a tactical return Speed (ours, not an engine fact): the routes are drawn in a few batches by texture and blend mode (routebatch.js, the same shader with the plane, width and colour read from the vertices), so a campaign of 175 planets draws in 38 calls where it took 593, and the frame costs 3.6 ms instead of 6.3 ms on the trial mod large campaign; the Lua compatibility layer caches how each format string is converted and leaves a table with no array part to the plain next, which cut the frames over 10 ms by two thirds (what is left is the mod own scripts, up to 70 ms every few seconds). Action points: non-Planet material lighting parity including native MeshGloss doubled RGB, additive texture/render-path parity and verification of shader-clock pause semantics'
      ],
      [
        'Fleets and stacks',
        P,
        'orbital fleets use the original g_planet_fleet component: faction-tinted stack backing plus a white-tinted representative Icon_Name at Size.x, displaced by stack depth and Offset.x; local Alternate_Icon_Prefix is tried before the unprefixed atlas name. Ordinary representatives prefer Tactical_Health, with named heroes as a Ranking_In_Category fallback; transported companies and team members supply presentation types. Current scores use base health because live effect modifiers and hero filters are not modelled. Stacks sit above their planet in three XML slots, including explicit widescreen offsets; explicit physical slots now survive company transfers, fleet splitting and merging, arrivals and snapshots; same-owner merges retain separate panes. Existing local-fleet displacement over foreign-controlled orbit is retained pending full native aggregation. The 3D Galactic_Fleet model is hidden while contained in a planet (FleetBehavior), shown only in flight, without a duplicate orbital overlay; its override model and heading follow the data and locomotor. Composed pictures are cached; browser checks passed on base data and 27 owned planets staged with real mod ships and companies, with the compositor around 0.5 ms per frame in both fixtures. Action points: story placeholder cleanup, initial native fleet grouping and full foreign-controller aggregation, full visibility and stealth predicates, raid and stealth badges, live health-effect scoring and hero filter controls'
      ],
      [
        'Fleet movement and hyperspace lanes',
        P,
        'as the engine does it (fleets.js): the cheapest way over the links (two planets within MaximumFleetMovementDistance, or joined by one of the campaign routes at its length over HS_Speed_Factor); a fleet flies at one speed per logic frame (30 a second at the default galactic speed): the lowest Hyperspace_Speed of its ships (a squadron by its fighters) x the faction Hyperspace_Speed_Factor x Object_Max_Speed_Multiplier_Galactic, x the HS_Speed_Factor of a route on that leg - 15.75 a second off the routes and 78.75 on a factor-5 route for a corvette; straight from planet edge to planet edge, no easing, straight on through planets on the way, stopping at one with an enemy station or enemy fleet unless the faction Benefits_From_Corruption; the Galactic_Fleet_Hyperspace sound on the player jump. Read and done in a later pass: the leg factor takes the larger of Corruption_Hyperspace_Bonus (a faction that benefits from corruption, both ends corrupted) and the route HS_Speed_Factor; a fleet with no ship whose type has Hyperspace = Yes has speed 0 and the order is refused with no message (the squadron hold step of the move order is code that never runs in this build); Blockade_Run_Attrition_Factor is not a galaxy rule at all, its one reader is the land battle retreat (see Retreat); every visible fleet in transit draws the Fleet_Movement_Line_Texture_Name ribbon (2 wide, stretched once, fleetlines.js) from the fleet to the edge of the next planet in its owner colour; the galaxy has one speed control, the options slider StrategicGameSpeed (five steps, 10, 20, 30, 45 and 60 logic frames a second, galacticspeed.js), no speed hotkeys, game time stays 30 frames to a second; a fleet whose order names no slot takes the one it left from, then 1, 2, 0 (the first not held by another fleet of its owner). Action points: the arrival at most two frames early (the engine snaps when closer than twice the step), the movement sound for allies that see the fleet'
      ],
      [
        'Orbital and ground slots',
        P,
        'g_planet_land_forces uses the original tinted backing and representative portrait at the projected planet minus Offset.y in screen coordinates. Only nonempty surface forces of the controlling owner are shown while idle. Empty reachable orbital handles appear for an active fleet or surface drag using XML slot offsets and native blue fleet_empty art; an empty surface landing handle uses local colour at half alpha. Companies can embark into any available owned pane, split or merge there and unload or invade through the separate surface target. Ships remain in orbit; friendly landing respects Max_Ground_Forces_On_Planet and planet restrictions. The per-planet script ENABLE_INVASION gate follows native defaults and numeric parsing. Action points: exact fog and special-action drag gates, raid and stealth exceptions, complete foreign-controller slot aggregation and native path validation'
      ],
      [
        'Planet production queues',
        P,
        'Build bar as: a type with any Build_Tab flag is listed (the flag decides only that), on the planet tab when ground made (a price and a ground base level, or a ground structure), else on the space tab; base levels as fixed at load (neither named means a ground base of one, a ground level clears the star level); what cannot be built is hidden. STORY_SELECT_PLANET on every planet selection, STORY_ZOOM_INTO_PLANET and STORY_ZOOM_OUT_PLANET (mod build filters place their category dummies on it). Swap_Texture tabs draw their own picture only when not selected, so the panel shows the selected half lit. unit production uses the engine campaign fields and two independent five-entry queues per planet, space and ground, each advancing only its head. Payment is upfront for the shipped Pay_As_You_Go=false path; price and duration are stored when queued; manual cancellation refunds that stored price even after progress and promotion starts a full stored duration. Eligibility uses affiliation, tech, local station and derived ground base level, planet restrictions, Required_Planets as a local whitelist, orbiting requirements, locks and limits; special structures use AND groups with OR alternatives. Campaign cost and time, Production_Speed_Factor, matching factories and station-versus-tech time factors are applied; price and time discounts take the largest reduction per Stacking_Category and add categories before the cap. Automatic discount activation is inferred from current ownership and location, not the full ability lifecycle. Ships finish in orbit; companies land or remain in their transport when the surface is full. Both queues, timers, paid costs and unlock/production history state survive tactical battle snapshots. Browser checked on base data and a mod post-story fixture. AI queues now pay progressively through native category reservations and difficulty build-time multipliers; missing installments stall progress and cancellation refunds the paid part. The human builds the special ground structures, orbital structures, station upgrades and tech items from the same bar slots as units (the engine sorts every type by its Build_Tab flag; the planet tab takes what needs a ground base, the space tab the rest; clicks queue as does), by the same prerequisites as the AI. Read and done: Pay_As_You_Go (a GameConstants bool, true when left out, false in the base game and the trial mod; every computer player always pays progressively): a human with it on is charged as the item progresses and stalls without funds, a cancel refunds what was paid, and funds never grey the bar; the bar tells a refusal in the order population, funds, queue; a type is only as heavy as the room left (a pop 0 item always fits); the items go into the slots by GUI_Row (row 0 into the odd slots, the rest into the even ones, the type table order, no paging); BUILDABLE_UNIT, LOCK_UNIT (hidden), DISABLE_BUILDABLE and ENABLE_BUILDABLE (kept on the bar, greyed) are three lists as the engine keeps; Build_Max_Instances_Per_Planet (only for special ground and orbital structures, -1 none, counting the structures of the type on the planet whoever owns them and both of its queues; at the maximum the item leaves the bar) caps a shield or a scanner at one and an ion cannon at two while barracks, factories and mines stay unlimited as the data has them; the per player limits are tested after it in the engine order (planet, lifetime, current, 0 meaning none); a tech item is offered only at the level it belongs to; a computer player is held by the population cap only with AI_Uses_Galactic_Pop_Cap. The ground base levels (Build_Tab_Outpost) are never offered by the engine (category GroundBase returns before any price), so they are not action points. Action points: corruption modifiers, lifetime history including starting forces, the related types the engine adds to the per player counts, required-orbit alternative grammar, the unrefunded automatic cancellations the engine makes (no owned starbase for ships, an armed enemy over a starbase upgrade), the tech level +1 side effect of BUILDABLE_UNIT'
      ],
      [
        'Space station construction',
        P,
        'Original AI build plans can construct and upgrade stations through native production eligibility and progressive payment. Action points: remaining cancellation and upgrade edge cases (the human builds station upgrades from the build bar)'
      ],
      [
        'Ground structure construction',
        P,
        'Original AI infrastructure plans construct real land and orbital structures in their authored slots with native prices and timers. Action points: remaining specialized structure lifecycle (the human builds them from the build bar)'
      ],
      [
        'Tech levels and research',
        P,
        'the Empire tech items (TECHBUILDING.XML: DS_Primary_Hyperdrive and the others, Build_Advances_Tech_Level at type) are produced on a ground planet with the research facility like any queue item, and finishing one makes no object but sets the level to the item value (setter kept from 0 to the maximum), tells the story (STORY_TECH_LEVEL) and records the built count; an advance to a level already reached is not offered (the engine test was not traced). SET_TECH_LEVEL raises the maximum first, SET_MAX_TECH_LEVEL sets it alone, SET_TUTORIAL_PLAYER marks the tutorial player (no auto-resolve, simplified colours; player). A campaign battle starts each player at the level it has in the galaxy (space and ground), the tactical upgrades moving it from there. The Empire AI counts a tech item as producible and CanAdvanceTech (the engine test not traced) is true below the maximum with one available. Action points: the human interface for queueing the tech items and other special structures (see the production entry), Give_Random_Sliceable_Tech (the TechPowerUp pickup; the slicer itself is built, see Slicer), the Lua Set_Tech_Level, Tech_Level_Icon_Name, the AI Rebel plan, station garrisons using the campaign tech'
      ],
      [
        'Credits and planetary income',
        P,
        'the engine fiscal scheduler pays once when the simulation reaches its next payday, first after one full Fiscal_Cycle_Time_In_Secs interval: base 45 seconds, trial mod 40. Planet_Credit_Value, force-alignment bonuses and penalties from Force_Strength and MaxCreditIncomeAlignmentBonus / Penalty, positive Political_Income_Curve adjustments, additive Planet_Income_Bonus_Ability contributions and positive Credit_Gain_Factor route bonuses are summed for the object owner; mining colonies apply Additional_Multiplier_On_Mining_Colonies. Each route endpoint uses its own planet base value. Balances retain fractional credits; negative planet income offsets positive income and only the final balance floors at zero. The normal credit ceiling is max(1, owned planets) times Credit_Cap_Per_Planet, and manual refunds and capture rewards use the same credit adjustment. Fiscal schedule persists across tactical battles; pause and battles stop galactic simulation. Ours: political controller follows ownership until political control and alliances are in. Action points: income-halt activation including blockade transitions, black market, gambling, siphons, ledger bounds and ability lifecycle, AI Credit_Multiplier, session conditions that disable the cap; faction Credits_Accumulation_Factor is not in the traced ordinary payout chain and is not applied'
      ],
      [
        'Unit upkeep and population',
        P,
        'production reserves Population_Value for waiting and active entries as well as existing strategic forces; carried companies count once, and capacity sums faction Base_Population_Capacity and owned Additional_Population_Capacity. Read: nobody subtracts Maintenance_Cost from income - its only readers are the two AI perceptions Maintenance and MaintenanceUnnormalized - so the port has no upkeep, and the Ship upkeep line of the trial mod is its own script text; an omitted Population_Value is exactly 0; a unit inside a container with its own population is not counted twice. Action points: allied capacity sharing'
      ],
      [
        'Smugglers',
        P,
        'the Siphon_Credits_Ability (galacticcorruption.js) is built: the stealth hero on a planet of another main faction takes a rolled share (Min_ to Max_Siphon_Percentage) of its income for Siphon_Duration_In_Cycles payday cycles, one siphon on a planet, and the planet owner is paid the rest; it does not time out on a corrupted planet. Not built: the Detect_Hero_Ability discovery and the Eliminate_Hero ending, the AI Remove_Smuggler plan using them, and the smuggler unit display on the planet panel'
      ],
      [
        'Bounty hunters',
        P,
        'the Neutralize Hero ability as NeutralizeHeroAbilityClass: heroes of other owners at the planet, companies opened up, the major and minor rules of the ability and the target, the price with base level, hero protection, earlier neutralizations and corruption, Vigilance, respawn of both, the generic trigger hero_neutralized and the scoring event; a computer player picks at random. Ours: the computer hero acts when its plan leaves it over the planet (when the engine fires it is not read); the per-part tooltip lines and the neutralize messages are not in the game strings'
      ],
      [
        'Spies, probe droids, fog of the galaxy',
        P,
        'galacticfog.js separates persistent discovery from current intelligence. Friendly political control or a qualifying non-stealth fleet visit discovers a planet after the strict Planet_Reveal_Delay_Time check; Planet_Auto_Reveal propagates to strict MaximumFleetMovementDistance neighbours and explicit trade endpoints, never flooding from merely discovered neighbours. Discovery, partial visit counters and remembered ownership survive battle snapshots. Independent engine mask predicates control base levels, income, surface stacks and orbital portraits; Fleet_Presence alone does not admit an enemy portrait, while Num_Fleets or Most_Powerful_Ship does. Income without current intelligence falls back to the public base value, and landing drag targets do not expose hidden defenders. Initially enabled automatic indefinite System_Spy_Ability sources grant their XML See_* flags locally or within strict Galactic_Influence_Range; leaving removes current intelligence. Is_Stealth_Company and initially enabled automatic Galactic_Stealth_Ability suppress ordinary visit discovery. Base preview passed 78 checks; actual mod files passed 328 local checks on 175 planets, with updates about 0.23 ms. Fresh in-app browser access on 8396 succeeded on 2026-10-15: the requested FullLarge_Era_3_Empire URL rendered the mod galaxy, unknown Prakith stayed wireframe when selected, and income/base filters toggled. Live discovery departure and battle-return persistence were not exercised: story startup still has placeholder forces. tools/test-fog.mjs separately passes strict visit delay, departure and snapshot discovery retention, public income fallback and ordinary enemy portrait/defender masks on actual base and mod data (56/175 planets, 17/113 initially unknown); these are explicit QA fixtures, not live story results. Action points: the human ordinary orbital-presence grant producer, timed and manual spy activations and despawn, the Super-category portrait exception in, full stealth exceptions and ability lifecycle, story reveal/unreveal, corruption activation, allied diplomacy, observers and global fog options. The controller of a planet is its owner and a controller is held while its political value is above 0 (galacticpolitics.js)'
      ],
      [
        'Corruption missions (Underworld)',
        P,
        'galacticcorruption.js, corruptionpanel.js and the linked tactical battle follow the engine (types ff., the Corruption_Ability, the dialog, the result, the removal, the completion effects): a planet has one type, -1 or 0..7 (Intimidation, Piracy, Kidnapping, Racketeering, Corrupt_Militia, Bribery, Black_Market, Bonded_Citizens), changed by a timed transition (5 s for a choice, 10 s for a conquest or a removal); the Saboteur landing on a clean planet of a non-allied owner offers the (up to three) Corruption_N choices, a human in the original dialog (columns, requirement icons with their counters, grey and red when not met, tooltips) and the computer player by the weights read; the credits go first, the required units are destroyed (unless the type is marked Destroy_When_Used_As_Corruption_Prereq no), and a choice with a tactical map and script plays that mission battle (the same transition as LINK_TACTICAL) whose win starts the corruption, otherwise it begins at once; completion pays the Success_Credit_Bonus, unlocks the Success_Unlock_Unit_Type and tells the story (CORRUPTION_CHANGED, TACTICAL_COMPLETE, TACTICAL_FAILED, OPEN_CORRUPTION); a planet a faction that benefits takes starts type 3, one it loses is cleaned over 10 s; Remove_Corruption_Ability by the planet owner with its cost and time; REMOVE_CORRUPTION, RESTRICT_CORRUPTION and ENABLE_GALACTIC_CORRUPTION_HOLOGRAM story rewards. Effects: the Underworld is paid gross income times Corruption_Choice_Income_Percentage for the corrupted planets it does not own, Piracy tariffs from leaving fleets and its unit unlocks, faster hyperspace between corrupted planets, the Rebel and Empire production price and time lists, Intimidation stops the planet abilities and its detection, Bribery detects fleets in 75 and stops squadrons from structures in a land battle, Corrupt_Militia natives fight for the Underworld and its removal makes the planet revolt, the neutralize cost of heroes falls 25 percent on a corrupted planet. The hero is started from the planet panel slot or the map slot (see Ability slots); the dialog shows the planet picture (the engine capture camera) and has the information mode opened from the planet panel; the corruption glow, funnels and path lines are drawn on the galaxy (particle line shape 5, colour multiplier); the Reduce_Technology_Price and Galaxy_Wide_Upgrade abilities work and are switched off by Intimidation. Ours: the art of the glow, funnels and lines and their blend are matched by eye, the planet marks sit beside the planet at a guessed place, the Corruption_N icons of the planets are only partly placed, the required units are taken as whole groups; the Corrupt_Planet_Ability of old style is not in the data'
      ],
      [
        'Ability slots of heroes',
        P,
        'abilityslots.js follows: landing does not start abilities; a hero in the planet panel shows one slot (Slot_00) and a fleet dragged over the map shows a slot beside each planet it could go to; the first of the ten kinds (destroy planet, steal, buy, sabotage, spy, neutralize, siphon, spread corruption, remove corruption, sabotage Death Star) whose Activated_*_Ability_Names holds one of the hero abilities usable there labels the slot, and the drop starts every Ground_Activated ability of the hero; a fleet elsewhere sets out and starts on arrival unless blocked; RESTRICT_ALL_ABILITIES and the other restrictions hide the slots; the slot a dragged fleet or company would be dropped into is framed on hover; the unit a map slot is for is the one of lowest Ranking_In_Category (a tie goes to the first) and a fleet of several shows a hero slot only to destroy a planet; the first map slot sits at the planet height, the Offset x to its left'
      ],
      [
        'Raids (RAID slot)',
        P,
        'raid.js follows: a fleet of Rebel companies - at most two of Infantry, Vehicle or Air, at most one hero, any number of LandHero, at least one limited company, no ships - dragged toward a planet whose owner is not its side or an ally (or has none), with an open surface and no restriction of the companies, is offered the RAID slot in place of a hero slot; dropping on it, or dropping a raid force on the planet surface icon, sends the fleet with the raid marked; arriving there it starts no space battle (what defends the orbit does not stop it) and lands at once, the invasion or the pending land battle choice for a planet that is not friendly, the unloading for a friendly one. A fleet stack on the map shows i_icon_stealth.tga (all ships stealthed) or i_icon_raid.tga, the planet pane marks its fleet panes with the 16 by 16 raid or stealth icon and the tooltip text; the computer player raids through the game own RaidPlan.lua (Is_Raid_Capable and Raid are Move_To with the raid marked) and its arrival lands the same way. Hovering a fleet stack on the map shows the engine fleet popup (the side fleet name, the stack picture, the population in yellow, the stealth and raid marks, the sentence for them, one icon per unit type six to a row with xN, unknown icons for what an enemy stack hides). The popups of the galaxy (this one and the corruption mark) follow the engine timeline (tooltipgate.js): they appear when the cursor has rested for Encyclopedia_Delay (750 ms, Long_Encyclopedia_Delay 4000 with the gameplay option Delay tooltips, now working, default off), a move over the map drops them at once, a new target waits for the old popup to fade, they fade in and out at Encyclopedia_Fade_Rate and stay at least Encyclopedia_Min_Display_Time; the strongest unit of a count-only enemy stack is the one of largest type Damage. Ours: the engine orders the unit icons by the address of the type object, which the port can only take as the order the types were loaded in'
      ],
      [
        'Planet abilities (tech price, wide upgrades, gambling)',
        P,
        'planetabilities.js: Reduce_Technology_Price (one minus the sum of the percentages, at least 0.0001, only for items that raise the tech level), Galaxy_Wide_Upgrade (the free upgrade objects given to a side in every battle, by affiliation and the first link of the chain) and the Grand Arena gambling roll, read from the planet bonus lists; switched off by Intimidation'
      ],
      [
        'Black market',
        P,
        'the purchase logic, the human panel, the computer player buying, the story rewards and the ability gates are in (see Black-market purchases of abilities); the market only appears where a planet has corruption type 6, which needs the corruption missions'
      ],
      [
        'Slicer (R2-D2)',
        P,
        'galacticslicer.js follows SlicerAbilityClass: the Ground_Activated Droids_Team on a planet of another main faction offers the types that are Build_Can_Be_Unlocked_By_Slicer, Build_Initially_Locked, of the player Affiliation, within its tech level and not unlocked or locked; the cost is the Cost_Multiplier_By_Planet_Tech_Availability curve (plus the affinity modifier for Planet_Slice_Affinity_Types) times Slice_Cost_Credits; the computer player picks an affordable one, a human the Steal Technology panel (target_type_back, twelve options, grey when too dear); success pays, unlocks, raises the tech level when it was the only choice, failure doubles the respawn, does nothing or costs the credits; the hero is queued to return after Min_ to Max_Respawn_Time_Per_Tech_Level. Ours: the base-level input of the chance modifier, the wrap of the names by characters, the roll in a respawn range; the legacy IDD_SLICE_DIALOG (dead code in the engine) is not built'
      ],
      [
        'Sabotage and bribery',
        P,
        'galacticsabotage.js and sabotagepanel.js follow GalacticSabotageAbilityClass: the Ground_Activated saboteur on a planet of another side that is not an ally picks at random one of the outcomes the data enables for the planet (with the shipped data only destroying a special structure, on a corrupted planet that has some); a human sees the sabotage menu (i_sabotage.alo: title, description, up to ten structures with icon, name and price, grey when unaffordable, the price red when above the base price), the computer player takes a structure it can pay for at random and, as in the engine, pays nothing and says nothing to the story; the price is Sabotage_Cost_Credits times Sabotage_Cost_Increase_Factor to the number of structures already sabotaged on that planet (flat in the tutorial), a structure with no price is not offered; when it is done the structure goes, the price is paid, the story hears STORY_GALACTIC_SABOTAGE, the planet shows Sabotage_Particle_Effect and the owner SFXEvent_Sabotage_Success, both sides are told (TEXT_SABOTAGE_ACCOMPLISHED_ALLY and _ENEMY), and the hero leaves and is queued to return; the other outcomes (ground base and star base level, production, a timed halt of the planet income, with their English texts) and the vigilance block of a generic hero are in but the data never enables them; SABOTAGE_STRUCTURE, ENABLE_SABOTAGE and RESTRICT_SABOTAGE story rewards. Tactical bribe (Tyber Zann, TacticalBribeAbilityClass): the price is the target Tactical_Bribe_Cost times the hero modifier for the planet (1.0, or 0.75 on a corrupted one), paid from the credits of the side when it is used; with too little only the fail line is heard and nothing recharges; the whole squad changes sides, the effects and sound play, the cloak drops, 50 s recharge; the price is shown as Bribe: N beside the cursor; the computer player bribes what it can pay for in reach; a bribed unit counts for no side in the galaxy afterwards. Galactic bribery (galacticbribe.js): a human order of a faction that benefits from corruption prices every planet between the start and the end - the ships Cheap_Bribe_Cost for an Easily_Bribed owner, else Expensive_Bribe_Cost, nothing where the fleet owner controls it (star base, else fleet in orbit, else nobody - nobody is priced) - the owners are paid their parts and with strictly too little the order is dropped with the deny sound; a computer player is not charged at the order, and at an enemy on its way pays the price (cut by Bribe_Cost_Multiplier, to nobody) only on a corrupted planet held by another, else it fights there; the drag label shows only corrupted planets held by somebody else, white or red by the credits. A star base reduction cancels and refunds the queued upgrade of the base; the effect and sound of a computer player sabotage need the planet discovered; the human route search follows the engine (a planet not discovered, or with a hostile presence, cannot be crossed, a corrupted one can by a faction that benefits at +100, stealth fleets cross, the destination is always allowed); the computer player Tyber bribes with the game own Bribe_Target_Score where the side brain has it, else by combat power; the Bribe label has its plate I_bribe.tga (182 by 31) at the cursor plus 20 units, green text, the number white or red. The relation table of the engine (galacticrelation.js: Enemies beat Allies, a neutral faction is never hostile, a star base needs a level and is hostile by its owner row, a hidden fleet meets no conflict) now decides what stops a fleet; the computer player routes by its goal Reachability (airoute.js: the pathfinder flags, hostile and acceptable planets, +100 through corrupted ones, the planets it knows) and plans again at every arrival, ending where it stands when the next hop is held or there is no way. Ours: the star base owner field of the engine and its extra uses (clearing on a player elimination, the visibility test) are not modelled; the goals target lists are the engine PlanetReachability (airoute.js reachList), a conflict pulls in the fleets on their way there and its defender is the first fleet in orbit that is not hidden and not the attacker, else the star base owner (the port still finds conflicts by its scan of the planets that changed, where the engine acts at the arrival and at the end of production); the enemy force of a planet is a live fleet not hidden whose owner the mover row marks hostile (read)'
      ],
      [
        'Auto-resolve',
        P,
        'a conflict the player is in now asks first, as the conflict managers do: the galactic clock, orders and selection are held and the command bar shows the pending battle shell (pending_battle_shell, i_attack_mode_choice.alo) with the planet name and SPACE or PLANETARY BATTLE IMMINENT in Battle_Pending_Message_Color, the two sides as g_planet_fleet style stack pictures (graph_left is always the player, graph_right the other, tinted by faction colour), and Begin and Auto-Resolve buttons; story_pending_battle_shell offers Begin only when AlwaysBypassAutoResolve, an ENABLE_AUTORESOLVE planet, a campaign with Is_Autoresolve_Allowed false, or in a story campaign (Is_Story_Campaign) a planet and mode pair of Autoresolve_Exclusion_Locations applies (the allowed flag is taken as true when a campaign does not say, its default was not found). The faction pending sound and music play. Begin starts the tactical battle; Auto-Resolve runs the native aggregate resolver at once, with no progress screen, and ends in IDD_BATTLE_END_DIALOG (TEXT_WIN_BATTLE or TEXT_LOST_BATTLE, both loss lists, battle time 00:00:00, Return to Galactic) with the TEXT_AR hero and verdict ticker lines (after the result). The Auto-Resolve box of Gameplay Options and a power overrun (Overrun_Auto_Resolve_Multiple, no hero on the weaker side) resolve without asking, and a computer-only conflict still resolves silently. Space and ground conflicts, the player attacking or defending, share this. Battle_Pending_Timeout_Seconds is only used in multiplayer, so single player never times out. The end screen rows follow the engine: dead types below a cost of 1 skipped (read as Score_Cost_Credits at by the order of the cost fields, not by a traced parser), heroes five a side and the other types twelve with the scroll bar, each with its count as the picture caption above 1 and the name alone, in the order of the type records, and the Salvage collected line shown for a bounty of 1 or more or a faction that benefits from corruption; the efficiency and loss value statics it also sets are not controls of IDD_BATTLE_END_DIALOG, so nothing shows for them (the score dialog has the efficiency lines). Checked against the engine: the right-hand picture takes the colour of the first player in the player list that is an enemy of the local player, whoever is in the conflict, as we do. HIDE_AUTORESOLVE sets, which no code reads, so it has no effect and we no longer act on it. The pictures now follow the engine: graph_left is the side of the local player (the defender when they defend), each side is made of the contents of every object it has at the planet (the fleets) and in a ground conflict the surface forces too, those friendly to the defender on the defender side and the rest with the landing troops on the attacker side, the stack index is the count over Ships_Per_Stack capped by the frames of the picture, with nothing there the defender shows the station in space and then each side its faction infantry icon (ground, faction) or fighter icon (space), and the Simplified Faction Colors option gives the Player colour to the local faction and the Enemy colour to any other playable non-neutral faction (that the two are the GameConstants colours is inferred). Ours: ground structures count toward the defender stack but not the representative, and whether the engine surface list holds structures was inferred from how the ground battle takes its sides. Read and found absent: Begin only leaves the pending shell and sets the mode to the tactical transition, with no planet flash and no camera move, and the pending start only sets the shell, text, sound and music; is the story camera mover (POSITION_CAMERA reward, droid log planet click, ability targets), so the radar flash we show while the prompt is up stays ours and no retarget is built. Action points: the deferred start while the cinematic queue is busy, the other conditions of the single-button shell (a linked mission queued; a local player flag, apparently multiplayer only), the Prevents_Story_Campaign_Autoresolve unit flag, the hero filter bit and faction fallback pictures of the stack pictures, the Invade button of the end screen, the salvage payout of auto-resolve (see Salvage bounty), per-player losses so an ally losses stay off the list (the engine lists only the local player and the players hostile to them), the multiplayer vote dialog IDD_MP_VOTE_DIALOG and the lobby Allow Auto-resolve setting with IDD_AUTO_RESOLVE_DIALOG progress and Withdraw (not built: there is no multiplayer session to vote in or a lobby to set it in; the strategic and tactical resolvers they would drive exist)'
      ],
      [
        'Battle setup: space then land',
        P,
        'space conflicts use the planet Space_Tactical_Map, its station and fleet markers, the battle zoom and fade, population-limited opening forces and reinforcements. Hostile ground ownership alone does not start space combat; hostile orbital forces or a station are required. Station ownership is independent from surface control. Bare scripted companies and embarked companies field their configured transport in tactical space, with strategic gid survival and transport death removing the payload. Selected surface drops stage only those companies rather than every friendly transport in orbit. Land invasions use Land_Tactical_Map with the actual carried companies, defending garrison and built structures; explicit marker compatibility and Base_Position choose structure sites, including additional power generators. One attacker pathfinder is selected by Preferred_Pathfinder_Types with nonheroes first; the rest wait as reinforcements and defenders start without a cap cutoff. Initial landing-point control comes from nearby units, with an attacker override for vehicles. The attacker cap is Base_Population_Capacity plus held point capacity limited by Max_Ground_Forces_On_Planet; defenders use that maximum. Building garrisons (landgarrison.js, every SPAWN_SQUADRON structure, skirmish too) follow the engine SpawnSquadronBehavior: the Starting / Reserve_Spawned_Units_Tech list of the owner tech level or the highest under it, the whole starting garrison at once only for Spawn_Garrison_On_Load in a campaign battle, otherwise one company per Spawned_Squadron_Delay_Seconds from a random entry, the wait restarted by a loss from a full structure, Set_Garrison_Spawn obeyed, remaining temporary (ours: put down at the flyout distance with no walk clear out of the building); campaign build lists replace skirmish ones. Victory uses relevant-unit elimination rather than skirmish base destruction; the optional Land_Base_Destruction_Forces_Retreat route is supported. Undefended surfaces unload without a tactical battle. Action points: initial first-company override flag, the entry farthest from a reinforcement-prevention object, exact garrison spawn-bone flyout and batching, initial capture full XYZ distance (ours XY), capacity contributions from objects besides reinforcement points, retreat and story overrides, campaign tactical credits and costs, planet special weapons, more than two sides at a planet'
      ],
      [
        'LINK_TACTICAL mission launch and return',
        P,
        'native required parameters and optional defaults select the authored TED, attacker, defender, optional existing hero, explicit tactical master XML, sandbox roster and aftermath policy. A covered tactical child retains the original galactic mode and suspended Lua VM; results resume that same campaign without replaying setup. Map-only missions stage TED troops; sandbox missions retain only human strategic forces, with hero and existing space pathfinder preference and superweapons always deployed. TED Player_ID uses faction database order through the generic overlay. Authored land companies and nonselectable walking actors instantiate as script objects rather than scenery, and squad map identities retain object hints. Previous-mode STORY_LOAD_TACTICAL_MAP runs before start-tactical manifests; tactical STORY_VICTORY precedes synchronous previous-mode STORY_MISSION_LOST, then return reconciles losses, bases and reserves before WIN_BATTLES, LOSE_BATTLES and RETREAT. The ship-class lists a WIN/LOSE_BATTLES class filter reads are the one pair of the engine: rebuilt only when a space battle of a campaign begins with the local player on a side, otherwise kept (and saved); the mode is the number the name table gives the first token (1 and 3: every class of the event is in the list, 2 and 4: every class of the list is in the event; 1 and 2 the list of the owner, 3 and 4 the other; a lone FILTER_ token sets none), Param2 is matched by its exact name (read; no shipped data uses a class filter, the CLASS_ spelling and what a squadron, company or station counts for were not traced). XML flag changes round-trip and callbacks can queue the next mission. Human-win RETREAT_PLAYER, RETREAT_AI and DESTROY_AI policies use native full-cost refunds and AI credit adjustment without invented political capture or generic destroy events. Registered leader victory and strategic planet destruction reach the live previous mode synchronously. Native linear fades, letterbox fraction and timing, delayed hyperspace and Resume_Hyperspace_In are supported. Actual base and mod regressions cover 44 installed LINK definitions, authored TED owners, roster policies, live Fengari continuation and pause retention, queue reentrancy, mission loss, AI-winner base cleanup and destruction. Live base Alderaan and Thyferra ground launches reached the original result art and returned with the same campaign VM and pause; Alderaan also retained its mission victory flag. The original ground opening now resolves effective Create_Team_Type identities and live TED hint objects, reaches its scripted fade-in and movie chain, and supports the original Escape cleanup. Native opening services and remaining cinematic work are tracked separately below. Action points: generated default prebattle hyperspace motion and camera branches including Death Star and AI attacker, exact native pending-battle preview, explicit fade and letterbox startup pause gates, trace native persistence eligibility for map-created tactical survivors, complete distinct political and base controllers, additional live land and mod mission comparisons, Evaluate_In_Galactic_Context and other unimplemented mission Lua services'
      ],
      [
        'Tactical mission opening cinematics',
        P,
        'native Find_Hint and Find_All_Objects_With_Hint scan exact effective live object types, retain company Create_Team_Type and map marker identity, and never fabricate position wrappers. Hint strings round-trip through map and dynamic transport objects. Silent Despawn and pending spawn commands retain identity, XYZ, visibility and heading without tactical destruction signals. Native scripted camera keys use polar axes, attachment transforms, Ranged_Target_Z_Adjust, integer simulation frames, quadratic easing and projection restoration; Point_Camera_At changes the tactical XY target. TED environments retain their original names and active index; Set_Cinematic_Environment selects only an authored Cinematic environment and restores the prior set. Lock_Controls, cinematic AI suspension and original Story_Handle_Esc run independently of mode pause. Neutral actors remain distinct from enemies and hostile wildlife in ordinary target selection and Lua player predicates. Movies read original definitions and Bink assets, use the native full-viewport quad, fixed30 FPS, one-based frame events, definition-owned simulation pause, asynchronous block lifetime and balanced cleanup. Original text crawls use native ALO meshes, animated camera, fixed4:3 horizontal-FOV1 projection, localized raster fonts, texture dimensions, wrapping, justification, emissive colors and fade frames. Cinematic transports instantiate the requested TRANSPORT type with native terrain and stored-water height clamp, Hover_Offset, LAND frame fraction, final landing hold, integer idle timer, persistent landing and speed1.15 TAKEOFF cleanup, without invented passengers. Actual original Thyferra Lua, TED, transport ALO/ALA and movie data regressions cover initial fade, movie waits, Escape, native frame and pause boundaries, pending-call races, hints and resource disposal. Live unchanged Thyferra Lua reaches the landing fade with both transports, a live commander and no Lua errors; the original Escape path restores the mission controls. Existing LINK and tactical-story regressions pass with base and mod overlays. Scripted cinematic frames now apply the native Unlocked lens from TacticalCameras.xml through the ordinary overlay, superseding the temporary1..10000 startup lease: base far60000 and actual mod far6000000 retain the authored large star sphere and foreground depth. SKY_DOME only caches its SUN bone; the cinematic sky stays at its scripted transform rather than following or scaling to the camera. Enable_Fog controls a separate environmental fog override; Enable_Distance_Fog changes the current authored environment flag. Cinematic fog-of-war display suspension no longer rewrites the saved setting or explores terrain. Purely emissive MeshGloss materials use the original FXO and fixed-function doubled texture/emissive operation; specular and shininess differences cannot alias their material cache. Original base/mod camera XML, FXO, ALO and unchanged Thyferra Lua regressions pass, including fog off before movies, fog restoration after Escape and independent environment and fog-of-war settings. A browser fixture using the unchanged mission script renders the original star sphere, planet horizon and animated foreground ship with no Lua errors; its two Bink waits were stopped through the existing movie API to inspect the space shot. The same script continues into the ground landing shot with the cinematic sphere removed, environmental fog restored and no Lua errors. Action points: complete tactical MULTIMEDIA and STORY_SPEECH_DONE dialogue chains and other mission Lua services, embedded Bink audio, movie captions and credits, general crawl replacement-shader parity and native animation-index registration beyond original IDLE_00 assets, apply the traced ordinary tactical bounds-aware near/far opacity fades and reduced cull frustum independently of full GPU clipping, complete general MeshGloss lighting and effect-selected sampler states and native shader overrides, complete native cinematic music and remaining visibility leases, full tactical faction diplomacy and remaining combat consumers, and saving in-progress cinematic and coroutine state'
      ],
      [
        'Retreat to the galaxy',
        P,
        'linked mission policies and AI return use the native nearest same-faction orbital control, ground or orbital controller, politically neutral and final any-world tiers, with native land versus space origin eligibility. Land survivors create a separate transport fleet rather than moving unrelated orbital fleets. Action points: manual tactical retreat controls and countdown, interdiction and remaining reserve reconciliation edge cases'
      ],
      [
        'Persistent damage and losses',
        P,
        'space results retain surviving fleet identities and remove destroyed stations; ground results track every strategic company through its Max_Squad_Size groups and reinforcement transport, keeping temporary building garrisons out of the galaxy. Land return consolidates same-owner same-type surviving members, then refills companies at or above Transport_Refill_Threshold (compiled default 0.5), removing smaller remnants. Victory is latched before the 210-frame result delay while combat continues, with results taken after that delay. The end screen returns to the galaxy with the victor on the surface, ships in orbit and uncommitted reserves preserved on defeat. Action points: health and hardpoints in space, persistent tactical build-pad records and explicit structure capture, exact consolidation identity preference, script-transformed company identities'
      ],
      [
        'Death Star, Eclipse, superweapons',
        P,
        'Native TACTICAL_SUPER_WEAPON approach, charge, firing, target deletion and debris waits run from type data and original assets. Authored switch hit geometry, icon completion callback, ETA text and native cinematic camera keys are connected. Planet destruction preserves orbital forces; native victory holds and campaign battle-return producers resolve results. Base/mod Lua and frame regressions plus live firing fixtures pass. Action points: further non-TSW superweapon branches, full tactical XML story host, in-progress save restoration and multi-weapon conflict links'
      ],
      [
        'Planet destruction',
        P,
        'Native strategic PlanetDestructionAbility executes immediately through Ground_Activated abilities and Lua type-filtered Activate_Ability. Native constructor defaults preserve Neutralize popup selectors. Contested-space checks, target political alliance eligibility, pre-cleanup STORY_DESTROY_PLANET and subclass reference pruning, surface-only deletion, corruption reset, preserved owner and orbit, valid destroyed planet wrappers, original destroyed models and ability SFX/particles are connected. Named hero respawn queues use original default delays, including negative mod values, and destroyed worlds receive orbital company transports. Destruction, queue state and contested-space flags survive snapshots. Base Death Star and mod dummy killer fixtures pass. The separate native tactical firing sequence now produces planet destruction and battle-return state, with charging, Attack animation, original effects, camera and switch timing, and preserved orbital combat. Base/mod data and live browser fixtures pass. Action points: full tactical XML story callbacks, shared black-market and owner ability gates, queued human activation after hyperspace, in-progress tactical sequence saves, and complete structure-tied respawn accounting'
      ],
      [
        'Story events and scripted missions',
        P,
        'elapsed, trigger, GUI-click and AI-notification events feed unchanged story scripts, with prerequisites, periodic elapsed timers, branch state, numeric counters and separate clear-on-read AI flags. Completion now propagates through reverse prerequisites immediately, preserving temporary completion until perpetual source propagation ends. STORY_TRIGGER waits for a fresh dependency notification instead of polling completed prerequisites every frame; elapsed activation remains latched. Native forced built-in activation keeps its action and press sound but omits the separate input STORY_CLICK_GUI notification (separate from the reward). DISABLE_STORY_EVENT retains required numeric flags and optional all-plot scope; DISABLE_BRANCH zero enables a case-sensitive local branch. This fixes continuous campaign-start clicks without muting legitimate button audio. Synthetic regressions cover repeat clicks, chained and cyclic dependencies, idle silence, AND/OR groups, timer activation, branch resets and disable scope. Real mod fixtures cover campaign startup pause state, menu launches, all six documents and repeated filter clicks; browser startup reaches its normal briefing and stops requesting idle button sounds. Story transmissions and side-button documents open the native centered IDD_STORY_SUMMARY_DIALOG at its resource width, with Active and Completed tabs, selectable newest-first messages, chapter recap, original Close artwork and pause restoration. Show_Completed_Tab controls visibility. First TEXT supplies each row label; explicit RGBA is dimmed by 0.66 on read or completion, with the native lavender bottom gradient for active read entries. Colours are snapshotted at rebuild and explicit colour accumulators persist across records. History retains duplicate tags, exact-case first-match completion and removal, and removes only read untagged entries on close. GROUPBOX draws its native border without a list background. Choice dialogs retain IDD_STORY_DIALOG. Chapter text, dynamic extra text, colours, images and numeric waits are replayed on selection. MULTIMEDIA now dispatches independent SCREEN_TEXT subtitles and original alpha Bink movies through generic script rewards. The real mod startup shows Pestage above the minimap with its top-left subtitle; browser checks exercise government and campaign message selection, empty Completed tab, native geometry, Close and Escape with an existing manual pause. Action points: native event hash-container iteration order, queued advisor help and story-button flashes for non-popup messages, remaining event conditions and mission rewards, chapter cinematics and the story events of a tactical battle replayed into the restored scripts'
      ],
      [
        'Campaign objectives',
        P,
        'objectives.js and objectivepanel.js as the engine keeps and draws them (list in each game mode, rewards 0x53 to 0x5a and 0x8d, Lua Add_Objective, panel with battle info, numbering, wrap, colours, check and failed boxes and the completion sound), saved with the galactic story. Galactic battles load SANDBOX_STANDARD and fill it as (primary objective, protect and kill the side leaders). Land maps spawn from their markers Map_Load_Spawn_Table as does (chance is the table total, weighted pick, owner from the spawned type Affiliation, the last spawned kept as the battle secondary structure); an attacking human on land gets SANDBOX_LAND_CAPTURE or SANDBOX_LAND_DESTROY by that structure CAPTURE_POINT behavior, objective 2 shows its Secondary_Objective text and completes on STORY_CAPTURE_STRUCTURE by the local faction (signalled on every capture point change of hands) or on its destruction; the weather Objective_Text goes in the battle info section. Checked live on Endor (turbolaser tower spawned, capture objective shown and completed) and by test-sandbox-objectives. Ours: a faction not on the field gets the hostile natives side, power-ups from a spawn table are not placed, the marker filters before spawning are not applied. The planetary credit bonus line (Planet_Capture_Bonus_Reward while the planet is not ours and its capture reward not had) and the native spawner entries (Enemy_ or Friendly_Spawn_Text for the local faction, a hostile one completed by its STORY_CHECK_DESTROYED event and paid Indigenous_Spawn_Destruction_Reward) are added; the panel is not drawn during cinematics and letterboxes. Ours: which spawn text a faction gets is its place among the factions (the index argument is not known)'
      ],
      [
        'Galactic AI',
        P,
        'Galactic AI now executes unchanged plan Lua through native category and goal ledgers, future fiscal income, exclusive task-force reservations and per-category reselection. Plan definitions and contrast tables execute from the original libraries; template plan switches start disabled and apply priority and selector order. Existing units and eligible production are scored with native lines, contrast rows, staging and factory queue horizons. AI builds pay installments, stall without funds, refund only paid amounts on cancellation and preserve wholly backed orphan tasks. Native space and ground power, normalized and nearby force, maintenance, hints, markup, packed threat-distance Find_Path and primary enemy selection support the authored equations. Original Produce_Force, Form_Units, Move_To, launch, landing and invasion blocks issue real queues and fleet orders. Seeded base and mod runs complete production and execute ConquerPiratePlan military moves without Lua runtime errors; reservation exclusivity, pause, arithmetic equivalence and production funding after tactical snapshots are tested. Mod service including ongoing story and native scoring callbacks measured around24 ms per 1/15-second simulation step across21 controllers, with compiled equations, cached static type tests and validated bracketed difficulty enums; this is CPU simulation cost rather than a rendered frame benchmark. Frame pacing (ours, not traced in the engine): the goal systems, the plan scripts and then the free store script calls (On_Unit_Added, On_Unit_Service) of all computer players each share about four milliseconds of each frame, the free stores taking turns to go first; a pass, a goal selection or a plan turn that does not fit goes on next frame, and a selection is taken one goal at a time. The weighted lot of a selection draws and tests only the drawn goal (same odds). Production eligibility, factory rows, discount contexts and galaxy-wide unit counts are worked out once per one-second planning pool. Measured on the mod Thrawn campaign with 21 players at 4x speed: frames over 16 ms fell from 172 to 5 in 40 seconds, at 1x to 3. Mod story pass (measured on the mod Thrawn campaign at 1x): the fiscal cycle pass of the deepcore story script took 30 to 44 ms in one frame. pairs in the Lua 5.0 order is now a JavaScript iterator (it was a Lua closure and a third of the VM instructions of the pass; same order, checked against the old one on 12000 random tables with changes during the loop, and a story saved inside such a loop keeps its place), __iter is native and Find_First_Object uses the type index: the pass now takes 28 to 39 ms with its VM instructions halved (about 42000, a few ms of interpreter time). What is left is host work that runs once a cycle on cold JavaScript paths: EvaluatePerception about 10 ms for 657 calls (45 to 55 us each against 1 to 11 us when warm), the SCREEN_TEXT rewards of the mod display about 5 ms (a glyph bitmap per row), object queries about 3 ms. Not sliced across frames: Fengari (a Lua 5.3 port) can yield from a count hook, pcall and xpcall are yieldable and host calls are not (a hook would check lua_isyieldable), but the engine (then) resumes every thread of a script to its next yield inside one frame, so nothing else ever runs in the middle of a pass. A sliced pass would let the galactic simulation, player input from DOM events, plot rewards and Story_Event_Trigger callbacks into the same environment, other scripts, the AI, battle starts (Get_Game_Mode) and saves run half way through it, and GetCurrentTime would move inside it; holding all of that until the pass ends stalls the map for as long as the spike does. Speed pass on the mod Full Large era 3 campaign (21 computer players, about 1000 fleets; ours, results unchanged): the AI path matrix packs the edge distances once per galaxy and keeps its last result when the usable planets and the power over each did not change (95 percent of rebuilds, checked identical); faction relations are read from the faction lists without a force view; the free stores walk only their owner units; income, route reach and fleet merging index the fleets in orbit once per call; detach puts the moved units in the kept location list instead of rebuilding it per unit; perception name patterns are matched once per name; the vendored Fengari has no element deletes on its stack (about 15 percent faster Lua). Browser, first 40 s: 73 to 123 fps, 1 percent low 24 to 48, frames over 16 ms 284 to 19. tools/bench-galactic.mjs times the simulation half of a galaxy frame headless (--detail per part and per story script). Action: the mod story script cycle pass (GCPlayerAgnostic_TR_Progressive) still takes 30 to 80 ms once a fiscal cycle, about half Lua VM and half 1300 EvaluatePerception calls on cold paths; next is a dispatch table for GalacticMind.read, cheaper HasSpaceForce and HasSpaceUnitsBitfield (they scan every fleet), not slicing. Action: single goal staffing steps (solve on a new one second pool, about 2000 factory rows) still overrun the AI budget by 5 to 10 ms. Action: test-plan-persist fails at HEAD 6acb230 too (plans next times differ after a load, likely since the four millisecond AI frame budget). AI-only space encounters and defended Lua invasions now use the native immediate aggregate autoresolver with original default Lua contrasts, native enum hash order, derived company and squadron power and categories, attrition, transport quotas, hero and Super rules, station downgrade and forced overrun retreat. Arriving owners retain attacker identity and third factions fight separate pairs. Losing survivors retreat through the native destination tiers, with direct off-lane space legs. Land outcomes preserve surviving record identities and complete failed invasion blocks even when attackers survive; ownership, losses, retreat routes and conflict cooldowns persist through snapshots. Shared Lua 5.0 table.remove behavior keeps original cleanup scripts running after casualties. Base and actual-mod arithmetic and lifecycle regressions pass; seeded 120-second original AI execution completes builds, attacks and defended captures without script errors. Specialized resolution now follows defender-first Super and child killer precedence, ordinary versus forced-retreat attrition timing, attack-only Land_Bomber_Type support and native space roster boundaries. Land includes the separate ground-base combatant and saved tactical build-pad defenses, with native owner/base-level pruning, restoration at current pad orientation and snapshots. Battle win/loss domain, Ship_Class, count and planet filters, destruction counts, named-hero defeat, station base loss and conquest ownership events dispatch to active native events, including the distinct conquest counter reset rule; XML counters and activation state persist independently of Lua coroutines. Original scoring callbacks run before deletion, station losses score once through their original Lua and captures notify old/new owners. Active movement and invasion blocks receive native conflict callbacks with only the task force, and Force_Test_Space_Conflict supplies an end block. Sparse Lua pairs skips missing array slots so multi-faction scoring continues without nil entries. Snapshot budget bindings retain funded builds across AI controller swaps. Base/mod tests cover these branches, original scoring Lua, persistent defenses and callback arguments; the 120-second mod run completes 88 builds and 14 battles without Lua errors and restores every queued build. Action points: separate native planet-destruction abilities, full registered campaign victory manager, live nested tactical containers and shared per-owner story plot instances, human tactical-return Lua callbacks, exact engine RNG sequencing, galactic free-store service and hero attachment, magic plans and cross-goal budget transfers, remaining corruption and political perceptions, incremental template scans and full native frame scheduling, exact staffing tie and build-delay parity, per-AI fog histories and persistence of the computer player plan coroutines. Snapshot restoration resumes dispatched construction and the story scripts, but recreates the AI plans Campaign battles: Evaluate_In_Galactic_Context answers the perceptions of each campaign player galactic AI with the battle planet as target, worked out on the galaxy page as the battle begins (the galaxy stands still meanwhile); Find_Player gives every campaign faction a player, one that owns nothing when it is not in the battle. Galactic free store (GalacticFreeStoreClass, galacticfreestore.js): the script the AI player type names (GalacticFreeStoreScript) runs as it is - On_Unit_Added for each unit no plan holds as it comes in, FreeStoreService every ServiceRate, On_Unit_Service every UnitServiceRate (the game script misspells it, so only a mod uses it); FreeStore.Move_Object splits or lifts the unit into a fleet of its own and moves it a hop at a time over planets without enemy power; a safe company carried in orbit is landed. A company is landed on a planet of the player or an ally (the planet stays its owner), a move stops before an orbit held by anyone else (a starbase owner, else a fleet there), and a save keeps the store, its moves, its service times and the script Lua state, which a load puts back without On_Unit_Added. A new game fills the store while the campaign loads (On_Unit_Added for every unit); later units are added at once as they come in, and the per-unit pass goes through every unit, as the engine does in one service; ours spreads the calls over frames under the AI frame budget, in the same order, and a save keeps the rest of the pass. The Has(Ground|Space)UnitsBitfield perceptions are in (PlanetForcePerceptualEvaluatorClass). Land battle credits: a player spends its galactic credits; a computer player starts with its Tactical_Budget_Allowance share (none in the game data, where it is commented out) and Release_Credits_For_Tactical gives it the rest it holds back (all with no amount); what is left goes back to the galaxy, the computer player difference spread over its budget categories by weight. Ours: a category allocation is its total in our budget ledger. The galactic camera comes back looking at the battle planet; a campaign without Home_Location starts at the centre, as the engine does. A free store move is held to the hop its threat-weighted network chose, so relocating units do not path through enemy worlds.'
      ],
      [
        'Galactic interface and droid log',
        P,
        'the galactic bar now uses the original i_galactic_controls.alo faceplate and control quads, faction textures and CommandBarComponentFiles XML; credits, fiscal cycle, tech, population and planet income readouts, unit build buttons, space/ground tabs, pause and both production queues use that layout. The model determines the number of build slots, including mod extensions. The engine rounds displayed credits while retaining fractional balances. Build option ordering, mouse-wheel pages and the three-pixel click-versus-drag threshold remain ours until read; clicks on stack handles select their planet and drags keep their fleet/landing action. Base native buttons were exercised in the browser. The trial mod moves its standard tabs off-screen and forwards visible filter clicks through STORY_CLICK_GUI and FORCE_CLICK_GUI; its production mechanics were tested with a post-story fixture and a test tab switch. Production tabs now swap one complete native-size atlas picture at the XML Icon_Offset or Mouse_Over_Offset, fixing the duplicated squashed category panel. In-app mod testing on 2026-10-15 confirmed native income/base toggles and semantic space/ground selected states; the shared category image retained its 120:232 atlas aspect ratio at XML scale 0.5 but its native location was mostly below the viewport, so visible category artwork and story click forwarding remain unverified. Political colouring still uses the documented ownership fallback, not political simulation. Native income, base and hero filters use the original buttons; income and five space/nine ground pips follow XML offsets and capacity, with occupied faction tint and empty half tint. Ground capacity is Special_Structures_Land, not Max_Ground_Base; compiled defaults are 3 ground and 5 space slots. Filter state survives battle returns. Planet close-ups now read the i_main_organize model override and its original fleet panes, Pad controls, structure controls and bone-only text anchors. Zoomed_Terrain_Index selects the authored land_art ALT, with quarter opacity when surface intelligence is absent. Troops use native atlas-sized big_ icons with ordinary fallback; structures use plain icons, original capacity and empty-slot art. Ground company pads retain holes as units leave. Fleet type stacks reserve right and down neighbours at the engine 52-pixel threshold, shift expanded portraits by 22 native pixels, and repack compact when needed. Root position and scaling come from and ShellComponentClass, including the half-pixel translation. Count-only intelligence produces unknown portraits without type labels; own orbit remains visible over foreign ground. Actual base and mod data checks cover visibility, stable pads, reserved pathfinder cells, expanded wide icons and compact fallback. The base starting garrison was inspected in the browser; a controlled real-mod fixture showed the native terrain, three company portraits and structure row without runtime errors, with refreshes averaging about 0.37 ms across 100 iterations. This fixture does not validate story startup. Original portrait cells now support single-company and Ctrl same-type transfers between ground and the three fleet panes, including transparent native empty-cell targets. Action points: full multitype and Shift selection, pathfinder assignment, special action slots, station model preview, persistent GUI indices across battle returns, exact initial fleet grouping order and slot-owner assignment, drag-pinned packing and panel overflow, close-up planet ALT and sky rendering; the weather and ability filter, the flash of the fiscal pip is done (the pip at the current level pulses 2 Hz, Flash_Texture_Name or else the first Selected_Texture_Name faded from full to nothing in half a second, stopped while the game is paused; read), the generic Tab/Group/Toggle button semantics of the mod production filters, help/droid log, full force/planet panels, filters and other dashboard controls. Read and done 2026-10-21: the planet marker takes the owner colour (alHModel tint, the m_lightScale of every mesh; Neutral while unknown), faces the engine camera basis each frame so its rings lie flat, and restarts its idle animation on a new planet; the status icon row (hero icons by side or by you/enemy with Simplified Faction Colors, build) sits at g_conflict Offset with the filter shifts and each icon at its texture width times Scale; the pending battle shell is put at the top edge (half the 2D scene height) and slid in by its IDLE_00 animation, played once and held; a selected Selected_Alpha button draws its Selected picture in place of the icon. Lua Attach_Particle_Effect on a planet (read from the engine): the type Galactic_Model_Name effect follows the planet with its facing, unscaled, in the scene its flags name, for Particle_Lifetime_Frames of game time, stacking per call - mods show planet meters and emblems this way; a particle frame index past the atlas wraps back into it. Action points: the conflict, smuggler, smuggled and bounty hunter status icons; the galactic pause shell (pause_shell, i_attack_mode.alo)'
      ],
      [
        'Campaign entry and scripted GUI',
        P,
        'additive button layers (mouse over, selected without Selected_Alpha, Draw_Additive) add the texture whole colour as Engine PrimAdditive does (ONE/ONE, alpha ignored), so glows stored under low alpha show at full strength - the red tint a mod menu lays over choices that cannot be taken; native tutorial/custom selectors use the original RC and skin, including first-wins font records, fresh per-control font descriptors, wrapped static text, independent native X/Y layout scaling, physical glyph-width compensation and RC-sized frame backgrounds. Tutorial and choice lists use native icon columns, three-pixel gaps and scrollbar geometry. The mod conquest menu is a tutorial-tagged loader campaign, not a DLL hook. Its unchanged scripts drive category, map, era, faction, reset, difficulty and Start controls through generic GUI and story APIs. Shells use full parent/bone transforms, original textures, text anchors, group selection, per-layer tint and blending, native disabled-art colour replacement and nearest-depth/first-mesh hit ordering. Escape retains its native pause-menu path through story control locks. Native controls forward story clicks and forced clicks run their normal handler. Extra dashboard buttons retain original art and open installed story documentation. Base and actual-mod tests cover selector payloads, real menu branches, normal startup, native geometry, event cadence and all six side-button story bindings including repeated Lua-generated dialogs. Actual mouse launches also verified Known Galaxy Small, 4 ABY, Empire and Admiral, plus Full Galaxy Large, 4 ABY and Empire of the Hand; the selected map, faction and difficulty reached the loaded campaign. The reported Start failure was an unselected era, confirmed by the user. Action points: expanded original-engine image comparisons, tutorial completion profile import, advanced normal-campaign settings, generated preview rendering, further mods and the plan scripts of the computer players after a restart'
      ],
      [
        'Galactic radar',
        P,
        'Background and script-addressable radar hits now follow the original ALO triangles rather than their rectangular bounds, so neighbouring minimap buttons retain their full input coverage. Commandbar artwork uses native atlas dimensions, component Scale and bone offsets independently of collision quads; the mod pause icon uses its authored25.6-square reference size. Base/mod tests cover actual script radar controls and four viewport sizes. galacticradardata.js follows the fixed 380 by 460 world projection, independent of campaign bounds. Every instantiated PLANET with an owner has a native g_radar_blip icon; current owner intelligence controls faction Color, while undiscovered planets remain neutral at alpha 128 and cannot be selected or accept fleet drops. Native normal, hover, selected and separate white additive flash pictures come from the atlas. The original i_galactic_radar skinned model supplies the camera frame and MOVE / ATTACK animations at speed 1.5; center-ray Z0 projection, the minus-ten Y offset, XML-size clamping and half-pixel translation follow. The dashboard scan texture scrolls additively over the baked galaxy art. Left release recenters the saved overview target at Z10 without clamping or changing selection; selecting a known blip immediately switches a close-up in camera states 1/3 while preserving state 2 zoom-out. The native zoom button ignores transition reversals. Base Layout uses its own radar quad and rebuilds the layout after selection or recentering; fleet drops use existing validated movement. Persistent and finite flashes follow ButtonComponentClass timer, byte fade and three-cycle rules, with a battle producer. Base and real-mod checks pass native data, projection, fog, camera states, flashes and asset resolution for 55/174 planets. Browser checks exercised base selection, unclamped recentering, close-up switching, Base Layout switching and return, a fleet order and flash overlay; the real-mod fixture rendered its own shell and native animations without new errors. Refresh plus frame update averaged about 0.19 ms base and 0.47 ms mod over 300 calls. The mod fixture adjusts ownership for three real planets and does not validate story startup. Action points: connect Add/Remove_Radar_Blip and reveal lifecycle to the campaign story host, and support dynamic story-created planet controls'
      ],
      [
        'Base Layout map and placements',
        P,
        'the Base Layout button opens the original map_shell and map_overlay_shell model overrides, with native backdrop, map preview, fade, additive scrolling scan textures, controls, typography, weather and bonus icons. The map uses the actual texture dimensions times XML Scale; the early TED UI header supplies IDs, type CRCs and normalized positions without decoding terrain. IN_BASE markers sort by distance from their centroid; OUT_BASE and defense markers retain authored order. Specific and additional structures are fixed, with native disabled alpha and shield-range art; ordinary buildings and defending companies retain saved marker IDs and swap only within their category. The orbit palette groups companies by type and supports individual embark, landing and occupied-marker exchange below Max_Ground_Forces_On_Planet; full surfaces disable palette dragging. Entry requires accessible surface and ground-content intelligence, enemy previews are read-only, opening does not pause, and Back or zoom-out returns to the ground overview. Marker IDs survive galaxy snapshots and are resolved to full TED position and rotation at tactical setup. Place_Other_Type_At_Every_Specific_Marker_Position creates the replacement type at every compatible fixed marker and omits the strategic model; the native last-friendly-same-type death rule marks the linked strategic structure lost. Base and mod tests cover real TED headers, specific markers, swaps, transfers, capacity rejection, visibility, snapshot compatibility and tactical spawn boundaries; repeated tactical replacements and their loss aggregation are checked where the map supplies them. Browser checks exercised base-game dragging, embark, landing and reopen persistence; controlled base and real-mod fixtures rendered their own map and shell with two animated overlay meshes and no runtime errors. Refresh averaged about 0.75 ms on base data and 0.89 ms on mod data over 100 calls; these fixtures do not validate mod story startup. The strict Base Layout snapshot round-trip passes for base and mod data after campaign players initialize native advisor-hint defaults. Action points: the corruption access exception, filter controls, exact native click-versus-drag threshold; the current three-pixel threshold remains ours'
      ],
      [
        'Planet Info screen',
        P,
        'the original planet_info TextButton opens IDD_PLANET_INFO from GUIDialogs.rc and GUIDialogs.xml, including mod layouts and skins (native callback). The screen snapshots the selected discovered planet once, without surface or current-content intelligence requirements; normal galactic simulation continues, map inputs are blocked, Escape and Close preserve selection, view and pause, and battle startup closes it. Title and optional owner text use faction Color; current income and Describe_Population, Wildlife, Terrain, Weather, Tactical, Advantage and History supply the native fields. Body text is white and tactical notes are cyan. Large weather art derives from the load variant of Encyclopedia_Weather_Icon; Native_Icon_Name and load_overlay are direct, while Land_Tactical_Map supplies the optional map thumbnail. Original small-frame insets and blend modes are retained. The portrait rebuilds the native ALT1 rest pose into one opaque 512-square capture with native rotation, projection, framing, viewport and Battle_Load_Planet lighting constants, restoring the game renderer afterward. Native text-list wrapping, fixed scrollbar art, centered thumb dragging, one-row arrows and update-count repeat follow the engine. Static fields decode escaped newlines and use their separate line spacing; list rows preserve literal escapes. GUI font sizes use the native screen-height and integer-pixel calculation. Base and real-mod data checks cover 55/174 planets, original dialog overrides, missing-map cases, native field selection, discovery and battle gates, destroyed income, wrapping and font sizing. Browser checks exercised the native entry button, base artwork and portrait, mod layout and map, Close and Escape, unchanged selection/view/pause, continued unpaused time and full viewport restoration. No ownership fixture was needed for the mod screen; story startup remains outside this check. The screen has no per-frame work after capture. Native GDI masks and metrics now drive the dialog and list. The shared Planet.fxo DX9 port restores authored atmosphere alpha, cloud RGB, unnormalized sampled normals, vertex rim and night terms, SH fill, exponent16 normal-alpha specular and doubled surface/cloud lighting. Offscreen captures retain the verified native light direction, diffuse/specular intensity, zero fill lights and original camera. Base and mod FXO filtering are read generically. Live Planet materials retain separate native lighting: TED mini3 supplies sun specular RGB times twice intensity, mini8..13 supply native yaw and pitch, and both fill lights and ambient remain distinct. Regression fixtures cover native galactic direction, zoom intensity and environment uploads. Planet Info and Summary now rebuild ALT1 rest geometry, preserve the root transform, recompute capture billboards, wait for textures and technique selection, and dispose temporary material copies. Planet Info frames the full authored rest AABB including hidden, alternate, LOD and transparent meshes and forces LightScale RGBA to1; Summary retains source instance LightScale and fade. Original native HAL pixel-center probes establish the half-pixel projection adaptation. Captures preserve opaque target alpha and restore the shared lighting, target and viewport. Actual installed assets render at shader levels0..3 without changing saved graphics preferences. Browser checks verify the mod campaign Summary and the base Planet Info portrait without errors; failed-render regressions verify full lighting and renderer restoration and temporary material disposal. Full-frame original FXO comparisons now include every viewport and interior edge. Top-down capture projection adapts D3D9 top-left fill and integer pixel centers, with capture-only winding and face-normal reversal. XML viewport order is left/right/top/bottom with float32 endpoint truncation. Every pixel matches for all three techniques in flat, transformed and eight boundary/cull fixtures. Action points: expand full native portrait image comparisons across further models'
      ],
      [
        'Galactic Log, History, Tech Tree and Summary',
        P,
        'the droid help button opens the four original GUIDialogs RC/XML pages with remembered top-level navigation and simulation-only pause restoration. Log entries retain native cycle, caller color, date and separator triples, measured wrapping and initial bottom scroll; the dynamic legend tints icons, not text, and original helper and weather assets are used. Advisor messages use urgent push-front or normal FIFO order, faction SFX and character-duration holds; zero holds still log. Sequential frame-90 hints, three mode flags, Lua Enable_Advisor_Hints and tactical snapshot continuity are connected. Native PlayerClass constructors initialize all three flags enabled with index0 and next frame90. Fresh browser campaign players now initialize that state before UI access; snapshot serialization and restoration use shared canonical flag defaults. Older browser snapshots recover missing modes without overwriting explicit false, and live, saved, restored and separate-player flag objects remain independent. Base/mod regressions cover untouched and disabled-state round-trips, legacy fields, frame0, read-only snapshot creation and mode-specific Lua updates. History records credit reserve, owned planets, tech and resolved company combat power at native frame intervals, halves its sample buffer and draws the native 512x256 chart with three GameConstants factions, metric axes and endpoint labels separated by native StringTexture height, with native pixel-center anchors and the separate overflow comparison cache. Chart glyphs and endpoint positions regenerate on viewport resize. Tech Trees read faction dialog names, authored arrows and type controls, native locked tint, persistent Land/Space choice, and original component-based type cards including raw ordered ability icons and matchup art. Summary provides six Production/Economy rows and ten flattened fleet rows, native captures and sort comparators, row scrolling, planet navigation, queue-head progress, capacity totals, raw income ledgers and grouped counts. Linked labels use original tooltip art, cursor snapshots and Tooltip_Delay. Base and real-mod regressions cover 55/93 planets, six/22 Tech Tree layouts and 111/721 mapped type icons; browser checks cover all four pages, scrolling, queue ordering, zero-hold logging, hint flags, sorting, navigation and pause/selection memory. History sampling averaged below 0.3 ms in these fixtures. Action points: finish campaign upgrade production and full native stealth/container military accounting, integrate native hotkey bindings, and expand native image comparisons across further models. Native glyph masks, metrics, effects and all original Planet.fxo detail techniques replace the shared font and portrait approximations. Summary uses ALT1 rest geometry with source LightScale and fade, capture-camera billboards and the verified D3D9 pixel-center correction; portrait resource promises are cached with stale-row guards'
      ],
      [
        'Encyclopedia cards on the command bar',
        P,
        'galacticencyclopedia.js follows: the type rows, abilities and weather of the hovered object, wrapped by character count as the engine wraps them; checked on the base game only'
      ],
      [
        'Fleet management drag and drop',
        P,
        'Original organize ALO Pad and Q grid triangles now handle company loading, unloading, fleet splitting and merging. Native empty ordinary fleet cells become transparent enabled drop controls during a drag; accessible empty ground pads remain enabled. Legacy offscreen q_fleet collision quads are not moved or replaced by frame-sized hit areas. Normal portrait drag selects one company and Ctrl selects matching display types from that parent only. Expanded portraits retain both occupied cells as drag sources. Strategic fleet drags expose three empty reachable orbital slots for the gesture using g_planet_fleet XML geometry and native blue fleet_empty art; a separate half-alpha local g_planet_land_forces handle starts surface landing after orbit is clear. Chosen physical slots persist through movement and campaign snapshots; same-owner fleets merge only in the same slot. Embark and unload preserve company records and select the first XML Company_Transport_Unit; selected invasions stage only the chosen companies. ENABLE_INVASION uses the first named planet, optional default enable and native numeric parsing and persists across returns. Installed base/mod tests cover identity, restrictions, selected invasion, slots, real tactical transport spawn and payload losses; real mouse checks cover both overview pane transfers and a clear-orbit enemy arrival followed by the surface invasion target. Reachability is cached once per gesture. Nearest-center overlap selection and the three-pixel drag threshold remain browser inferences. Action points: pathfinder assignment, remaining Shift and multitype selection rules, exact native path and special-action gates including raid and stealth exceptions, native foreign-fleet aggregation and controller slot mapping, persistent GUI indices across tactical page returns and broader native mouse comparisons'
      ],
      [
        'Speed and pause controls',
        P,
        'The native shared galactic pause counter handles nested player, story reward and dialog requests. Balanced script resume leaves an existing player pause active; player commandbar state remains independent of the counter. PAUSE_GALACTIC always increments, UNPAUSE_GALACTIC decrements and PAUSE_GALACTIC_GAME uses its optional parameter. Original Lua documentation callbacks continue while simulation time is paused. Incoming story goals refresh the open summary while preserving numeric row selection instead of toggling it closed. Base/mod regressions and live government/resource panel checks cover this path. Action points: complete original speed and hotkey bindings and further nested campaign/tactical transition coverage'
      ],
      [
        'Victory conditions',
        P,
        'Native registration reads Human and AI campaign condition lists, default conditions0/6 plus AI1, neutral exclusion, authored targets and compiled defaults. Conditions0/1/2/4/5/8/9/10 use native ownership axes, playable and alliance checks, AI versus AI exception, current credits, leader attribution and respawn queues, named planets and strict cycle thresholds. Registered producer requests3/6/7, first-result latch, frame countdown, nested ENABLE_VICTORY and deferred checks, VICTORY reward16 and selective STORY_VICTORY broadcast are connected. Manager and leader state survive campaign snapshots. Original campaign score dialog uses native fonts/artwork, local faction text and images and original GameScoring Lua values. Base/mod lifecycle, story and battle regressions pass, with isolated browser score checks. Tactical superweapon behavior now uses native XYZ approach, fixed-frame charge and Attack animation, original switch completion timing and ETA artwork/font, the native 25.5-second camera keys and ease curve, original explosion/debris types and common planet cleanup while preserving orbital survivors. Tactical victory holds, relevant-unit checks and 210-frame normal results, leader condition7/16 and linked-weapon return conditions3/6 are connected. Installed base/mod Lua, timing and result fixtures pass; live mouse-driven base and mod battles reach destruction and the original result dialog, and a mod battle returns the destroyed planet to the galaxy. Native victory requests queue during firing; latch-time music, superweapon-specific voice branches and persistent original raster-font win/loss notices precede the result countdown. Current-mode STORY_PLANET_DESTROYED now executes synchronous subplot Lua, rewards and dependent triggers before cleanup; scripted VICTORY clears all firing holds and broadcasts STORY_VICTORY before the outer destruction finishes. Native210-frame normal and30-frame suppressed results, nested ENABLE_VICTORY and distinct cross-mode XML flags are covered by original Alderaan XML and real PGStoryMode tests. Action points: full convergence of the political presence rule, remaining tactical XML event and reward services and full LINK_TACTICAL mission transitions, in-progress tactical sequence saves, multi-weapon conflict-link setter trace, full-screen campaign movie chain, and the computer player plan scripts after a return'
      ],
      [
        'Galactic music and ambience',
        D,
        'galacticmusic.js as the engine plays it: the local faction Strategic_Map_Music_Event on entering the map and when the shared pause counter returns to zero (which brings it back after the pending-battle music), Play_Music, Stop_All_Music, Resume_Mode_Based_Music; MusicEvents play with Volume_Percent, fades and Loop, files in written order with the place kept per event. The engine has no galactic ambient loop, reads no Strategic_Win or Lose music and never opens Galactic_Map_Score_Name'
      ],
      ['Cinematics between missions', T],
      [
        'Story speech with subtitles (SpeechEvents.xml: mission, tutorial and cinematic lines)',
        P,
        'SpeechEvents.xml is read through the normal game and mod overlay. SPEECH, MULTIMEDIA and chapter DIALOG play original MP3 or WAV recordings through a separate FIFO group. Files entries are uniform random alternatives; matching Text_ID indices, captured active language and integer Volume_Percent follow the native schema. Existing queued recordings retain their captured language through a switch; new recordings use the resolved selected language. Native helper searches WAV before MP3, substitutes the first English marker and preserves literal filenames. Missing translations complete without an English retry. Ordinary speech does not invent subtitles; MULTIMEDIA retains explicit SCREEN_TEXT. Actual audio EOF or stream-open failure releases summary WAIT SPEECH and emits STORY_SPEECH_DONE; numeric WAIT retains integer UI milliseconds. Cancellation reports each active and pending event to StoryMode without releasing the natural-completion flag, while Lua Stop_All_Speech stops only physical speech streams. The summary callback stops its commandbar movie; message changes preserve speech until a new DIALOG replaces it. Player pause and the options menu freeze speech and Bink playback, while summary and PAUSE_GALACTIC simulation pauses let them continue. Speech has fixed pitch, event volume multiplied by global voice volume, gesture unlock and a four-recording decoded cache. Base and mod tests cover 1858 and 181 event definitions, real file resolution, FIFO, cancellation, stream failure, language capture, pause offsets, live volume, script rewards and chapter waits. Browser checks use the original Tarkin chapter and ERND_TAR0106_ENG.MP3: 4.676 seconds of recorded audio, EOF-driven wait release and movie shutdown, plus options pause and resume. The installed mod Pestage introduction specifies no speech and remains silent; no mod-specific voice mapping is added. Action points: embedded Bink audio, external-hologram automatic subtitle routing, tactical story-host integration and further voiced campaign coverage'
      ]
    ]
  ]
];

const score = s => (s === D ? 1 : s === P ? 0.5 : 0);
const tally = items => ({
  n: items.length,
  done: items.filter(i => i[1] === D).length,
  part: items.filter(i => i[1] === P).length,
  todo: items.filter(i => i[1] === T).length,
  pts: items.reduce((a, i) => a + score(i[1]), 0)
});
const pct = t => ((100 * t.pts) / t.n).toFixed(1);
const all = GROUPS.flatMap(g => g[2]),
  space = GROUPS.filter(g => g[1] === 'space').flatMap(g => g[2]);
const tAll = tally(all),
  tSpace = tally(space);

const COLORS = { [D]: '#2ea043', [P]: '#c69026', [T]: '#6e7681' };
function squarify(items, x, y, w, h) {
  const out = [],
    total = items.reduce((a, i) => a + i.v, 0);
  let rest = items.map(i => ({ ...i, a: (i.v / total) * w * h }));
  const worst = (row, side) => {
    const s = row.reduce((a, i) => a + i.a, 0);
    return Math.max(...row.map(i => Math.max((side * side * i.a) / (s * s), (s * s) / (side * side * i.a))));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    let row = [rest[0]],
      i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
    rest = rest.slice(row.length);
    const s = row.reduce((a, r) => a + r.a, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const r of row) {
        const ch = r.a / cw;
        out.push({ ...r, x, y: cy, w: cw, h: ch });
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      const ch = s / w;
      let cx = x;
      for (const r of row) {
        const cw = r.a / ch;
        out.push({ ...r, x: cx, y, w: cw, h: ch });
        cx += cw;
      }
      y += ch;
      h -= ch;
    }
  }
  return out;
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function panel(groups, title, x0, y0, W, H) {
  const t = tally(groups.flatMap(g => g[2]));
  let svg = `<text x="${x0}" y="${y0 - 10}" class="title">${esc(title)}: ${pct(t)}% (${t.pts % 1 ? t.pts.toFixed(1) : t.pts}/${t.n})</text>`;
  svg += `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#0d1117"/>`;
  const boxes = squarify(
    groups.map(g => ({ v: g[2].length, g })).sort((a, b) => b.v - a.v),
    x0,
    y0,
    W,
    H
  );
  for (const b of boxes) {
    const items = b.g[2].slice().sort((p, q) => score(q[1]) - score(p[1]));
    const pad = 2,
      bx = b.x + pad,
      by = b.y + pad,
      bw = b.w - pad * 2,
      bh = b.h - pad * 2;
    const cols = Math.max(1, Math.round(Math.sqrt((items.length * bw) / bh))),
      rows = Math.ceil(items.length / cols);
    const cw = bw / cols,
      ch = bh / rows;
    items.forEach((it, i) => {
      const cx = bx + (i % cols) * cw,
        cy = by + Math.floor(i / cols) * ch;
      svg += `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${(cw - 1).toFixed(1)}" height="${(ch - 1).toFixed(1)}" fill="${COLORS[it[1]]}"><title>${esc(b.g[0])}: ${esc(it[0])} — ${it[1] === D ? 'done' : it[1] === P ? 'partial' : 'missing'}</title></rect>`;
    });
    svg += `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" fill="none" stroke="#0d1117" stroke-width="3"/>`;
    const label = esc(b.g[0]);
    svg += `<text x="${(b.x + 6).toFixed(1)}" y="${(b.y + 16).toFixed(1)}" class="lab bg">${label}</text><text x="${(b.x + 6).toFixed(1)}" y="${(b.y + 16).toFixed(1)}" class="lab">${label}</text>`;
  }
  return svg;
}
const W = 1180,
  H = 430,
  PW = 560,
  PH = 330;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif">
<style>.title{font-size:17px;font-weight:700;fill:#e6edf3}.lab{font-size:12px;font-weight:700;fill:#fff}.lab.bg{stroke:#0d1117;stroke-width:3px;stroke-linejoin:round}.key{font-size:12px;fill:#c9d1d9}</style>
<rect width="${W}" height="${H}" fill="#0d1117"/>
${panel(
  GROUPS.filter(g => g[1] === 'space'),
  'Space skirmish',
  20,
  40,
  PW,
  PH
)}
${panel(GROUPS, 'Whole game', 600, 40, PW, PH)}
<g transform="translate(20 ${H - 28})">
<rect width="14" height="14" fill="${COLORS[D]}"/><text x="20" y="12" class="key">done</text>
<rect x="80" width="14" height="14" fill="${COLORS[P]}"/><text x="100" y="12" class="key">partial (counts as half)</text>
<rect x="270" width="14" height="14" fill="${COLORS[T]}"/><text x="290" y="12" class="key">missing</text>
<text x="380" y="12" class="key">One cell per feature; box size = number of features in the group. Hover a cell for its name.</text>
</g></svg>\n`;
fs.writeFileSync(path.join(HERE, '..', 'progression.svg'), svg);

const mark = { [D]: '✅', [P]: '🟡', [T]: '⬜' };
let md = `# Progression

How much of *Star Wars: Empire at War — Forces of Corruption* the browser version covers.

![Feature coverage](progression.svg)

| | Coverage | Done | Partial | Missing | Features |
|---|---|---|---|---|---|
| **Space skirmish** | **${pct(tSpace)}%** | ${tSpace.done} | ${tSpace.part} | ${tSpace.todo} | ${tSpace.n} |
| **Whole game** | **${pct(tAll)}%** | ${tAll.done} | ${tAll.part} | ${tAll.todo} | ${tAll.n} |

**How to read this.** Each cell is one feature or system from a hand-kept inventory (\`tools/progress.mjs\`), not a
measurement of code. A feature is *done* when it works in play, *partial* when it works but is simplified or rests on
an interpretation of the data, and *missing* when nothing exists. Partial counts as half. Features are not weighted by
size, and the land and galactic lists are coarser than the space ones, so the whole-game figure still flatters the port.
Regenerate with \`node tools/progress.mjs\`.

## By group

| Group | Scope | Coverage | Done | Partial | Missing |
|---|---|---|---|---|---|
`;
for (const [name, scope, items] of GROUPS) {
  const t = tally(items);
  md += `| ${name} | ${scope === 'space' ? 'space skirmish' : 'rest of the game'} | ${pct(t)}% | ${t.done} | ${t.part} | ${t.todo} |\n`;
}
md += `\n## What we have, and what we do not\n\n✅ done · 🟡 partial · ⬜ missing\n`;
for (const [name, , items] of GROUPS) {
  const t = tally(items);
  md += `\n### ${name} — ${pct(t)}%\n\n`;
  for (const s of [D, P, T]) for (const it of items) if (it[1] === s) md += `- ${mark[s]} ${it[0]}${it[2] ? ` — *${it[2]}*` : ''}\n`;
}
fs.writeFileSync(path.join(HERE, '..', 'progression.md'), md);
console.log(`space skirmish ${pct(tSpace)}% (${tSpace.pts}/${tSpace.n}), whole game ${pct(tAll)}% (${tAll.pts}/${tAll.n})`);

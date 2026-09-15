# Implementation notes and assumptions

Written while implementing `specs/2026-09-15-towarzysz-design.md`. Everything
here is a decision the spec left open, or a place where the spec met a fact
about the client or the registry and had to bend. Each one is easy to revisit.

## Assets

1. **The art is drawn by the repository, not sourced from the Mixer.** The spec
   picked KingBell's Pixel Art Sprite Mixer to remove the art budget, but its
   output is an interactive tool's, not a ready sheet in our nine-row layout,
   and the itch.io host was never reachable from the build environment. So
   `render/sprites.ts` draws all seven archetypes instead: 16x16 frames, four
   columns by nine rows, in the same vocabulary as the fallback figure (hats,
   tusks, ears, horns, a heavy brow). Nothing from the Mixer was acquired or
   used, so the CC-BY attribution it required is gone from `README.md`,
   `DESCRIPTION.md`, `plugin.json`, `plugin.ts` and the panel.
2. **The sheet is generated per companion at load, not shipped per archetype.**
   The first pass did ship it: PNGs in `assets/sheets/`, embedded as data URIs
   into a generated `render/sheets.ts` by `tools/embed-sheets.mjs`, recoloured
   at load by matching a fixed source palette on exact RGB. All of that is
   gone. Since the art was already code, the files were only a cache of a
   function cheap enough to call - a sheet is ~4.6k pixels and builds in well
   under a millisecond, a handful of times per session. What the change bought:
   - The rolled palette is drawn with directly, so the recolour pass, the
     exact-RGB source palette and its "never anti-alias a pixel" rule all
     disappear, and shades are derived (`shade(skin, 0.82)`) instead of listed.
   - `parts` stops being a problem. A shipped sheet is keyed by archetype, but
     `hasWeapon` and `hairLong` vary per roll, so it had to carry both and
     *erase* what the companion lacked - the alternative being four sheets per
     archetype. Now they are simply not drawn.
   - No binary in the source tree, no generate-and-commit step, no `.png`
     import problem for the registry, and the bundle got 8 kB smaller even
     after adding the drawing code (95.5 kB -> 87.6 kB).
   - The art became unit-testable: `drawSheetPixels` is pure, so
     `test/sprites.test.ts` asserts on the pixels themselves.
   The cost is that a hand-painted sheet can no longer be dropped in without
   writing the loader back. Nothing wants to do that today.
3. **`tools/png.mjs` survives only for the preview.** `yarn preview-sprites`
   bundles `render/sprites.ts` through esbuild and writes a contact sheet, so
   the art can be eyeballed without the client. Nothing in the plugin encodes
   or decodes a PNG any more.
4. **Bundle size**: registry limits are 2 MB zip and 8 MB unpacked, and the
   client's GitHub Pages path has no limit. Neither is close - the art is a few
   hundred lines of code and no assets at all.
4b. **The chip's canvas backing was never sized on a 1x display.**
   `resizeBacking` compared the freshly computed `dpr` against its own initial
   `dpr = 1` and returned early, leaving the canvas at the default 300x150 that
   CSS then squeezed into 39x30 - a tiny, distorted figure for everyone not on
   a HiDPI screen. It now compares against the backing store itself. The
   fallback figure had the same bug; it only became obvious with a sheet.

4c. **Idle life was not in the spec.** The spec gave the companion reactions
    and a doze and nothing in between, which leaves a figure that breathes and
    blinks for minutes at a time - readable as a static image. `walk`,
    `flicker` and `warp` were added as three more primitives, and
    `companion/ambient.ts` decides when one plays. Four decisions inside that:
    - **The animator polls the scheduler, rather than a timer driving it.**
      The frame clock is the only clock, so the busy check is free
      (`this.active` is the whole condition), a chip that is not rendering is a
      companion standing still, and there is no timer to tear down. The cost is
      that the scheduler only advances while something is drawing, which is
      what we want anyway.
    - **They are priority 0**, below every reaction, so a kill cuts through a
      walk and the doze is never interrupted from the inside.
    - **The direction is the sign of the intensity.** `walk` and `warp` need a
      side to go to, and everything already carries an intensity; adding a
      field to `play()` for two primitives was worse than documenting that
      these two read its sign. `heading()` in `render/animator.ts` is the
      only place that looks at it.
    - **They never speak.** Speech is a reaction to the player; a line attached
      to the companion's own fidgeting would read as nagging, and the
      restraint machinery exists precisely to avoid that.
    The frequency is `settings.ambientLevel` (`wylaczony`/`rzadko`/
    `normalnie`/`czesto`), still `version: 1` - a missing field normalises to
    `normalnie` like the rest of `settings`.
4d. **A front view has no stride.** The walk cycle is four frames but only
    three leg positions: both feet down and apart, and two passes with the
    other foot up each time. The two contacts are told apart by the arm swing,
    because from the front that is all there is. The animator supplies the
    bounce and mirrors the whole figure with a negative `sx` for the
    direction, so the sheet carries one walk, not two.
4e. **`tools/showcase/` was added** because the canvas layer was the one part
    with no way to look at it short of loading the client. It imports the
    plugin's own modules and wires them like `plugin.ts`, so it is a preview
    and not a second implementation; `Chip.render` being public (it was
    already, for a test harness) is what lets it scrub frame by frame.

4e2. **Sheet frames need a gutter.** The chip scales a 16 px frame by 1.5 CSS
    pixels, and at a fractional scale the browser samples a hair outside the
    source rectangle even with `imageSmoothingEnabled = false`. With the frames
    packed edge to edge that pulled the feet of the frame above into the empty
    top rows of the frame below - invisible until `rest`, the first animation
    whose frame has empty top rows, showed two grey dashes floating over the
    companion's head. `FRAME_PAD` (1 px) now separates every cell, `frameRect`
    steps by the cell and returns the frame inside it, and `LoadedSheet` carries
    both sizes. The frames themselves are unchanged, pixel for pixel.
4f. **An animation is one entry in one file.** It used to be four: the name in
    the `Primitive` union, a row and a frame count in `ANIMATIONS`, the frames
    in `POSES`, the motion in `PRIMITIVE_DEFS`, and a weight in the ambient
    table - with a test whose job was to catch the frame count drifting between
    two of them. `render/animations.ts` now holds all of it per animation and
    everything else is derived: `Primitive` is `keyof typeof SPECS`, the sheet
    row is the declaration order, the frame count is `frames.length`, and the
    idle-life draw is built from the entries that carry an `ambient` weight.
    `render/pose.ts` was split out to hold the vocabulary both halves share, so
    there is no cycle: pose <- animations <- animator / sprites.
    The animator seeds `base.frame` with the animation's own frame for `t`
    before calling its `pose`, so only an animation with its own frame timing
    (the walk cycle, the warp's phases) mentions frames at all. The refactor was
    checked by snapshotting every sheet pixel for eight companions and 63 pose
    samples per animation before and after: identical apart from `idle`'s frame
    index, which nothing reads (the animator draws the idle bob itself).
4g. **The art is KingBell's Pixel Art Sprite Mixer**, the tool the spec
    originally wanted to take art from and eventually did. Sprites CC-BY 4.0,
    the tool's own code MIT; see 4j2 for how that was established, and 4i for
    what is taken from each.

4h. **The Mixer art is pulled by manifest, not vendored wholesale.** The tool's
    assets are public and CC-BY, and its ~1,255 files could all be fetched;
    `tools/mixer/manifest.json` names the handful we actually map to instead,
    and `yarn mixer add-anim` / `add-archetype` grows it. Three reasons beyond
    taste: the bundle only carries what is used, the manifest doubles as the
    map from their animation names to ours, and the download cache stays
    git-ignored so the repository keeps its no-binaries rule.
    The bake packs frames as run-length base64 over a shared palette rather
    than shipping PNGs, because the registry compiles `.ts`, `.js` and `.json`
    only - the same constraint that killed `tools/embed-sheets.mjs` (note 2),
    handled with text this time instead of a data URI.
4i. **The pipeline reads the tool's own tables instead of measuring pixels.**
    The first version scraped the preview GIFs and inferred everything else, and
    every inference was wrong in a way that took a bug report to find: a hat
    anchored to the top of the figure followed a raised sword, anchored to the
    top of the skin it drifted against a breathing sleeper, and the item files
    turned out to be whole characters, so subtracting them left a band of
    trousers that rode up to the companion's eyes. Template matching the head
    silhouette was tried too; the slash and the soul bias it.
    None of that was necessary. The tool ships `data/Import_config_Hero.zip`,
    which carries `base.png` (703 cells), `heads.png` (333 heads) and a
    `conf.json` holding the cell size, the key colours the art is drawn in, and
    `parts.head[anim][frame]` - how far the head layer moves, per frame, for 120
    animations. The frame layout is a lookup in their `app.js`
    (`getAnimX0`), read back out as a table. Where a hat goes on a ducking
    companion is a number the artist wrote down, and now we read it.
    Deleted with the guesswork: the GIF decoder and `omggif`, the face and eye
    anchors, the item diffing, the neck crop, the near-colour merge, and the
    per-frame offset estimation. `tools/mixer/decode.mjs` is down to packing.
4i2. **Effects go in front of the hat.** Their compositor draws base, then
    head, then face, and we copied that - which put the soul rising out of a
    dead companion *behind* their hat brim. `more` is the tool's spare slot and
    in our frames it is exactly the three things that belong in front: the sword
    of a swing, the soul, and the skull. So the head layer skips any pixel that
    is already an effect. They hide the head instead where a frame has no use
    for it (an offset of 32, past the bottom of the cell - `die_skull`,
    `re_warp` and `dash_flash_step_one` all do that), but `die_soul` keeps the
    head at 7 throughout, so the ordering is ours to fix.
    `more` also keeps a fixed pale tone rather than following the roll: a soul
    rising off a brown companion would be a brown bubble on a brown body.
4i3. **A held death settles.** `die_soul`'s last frame still carries two pixels
    of soul, on its way out of shot, and a companion who stays dead until the
    respawn stayed dead with those two pixels hanging over them. The bake counts
    the effect pixels left in a clip's final frame and marks it a *remnant* when
    there are only a few; the animator then settles a held animation onto the
    plain body instead. The threshold matters: `die_skull` ends on fifty-odd
    effect pixels because the skull *is* the ending, and that one is left alone.
4j2. **The licence was checked properly the second time.** This was first
    refused on the grounds that the author had told a commenter "not the code".
    itch.io's own metadata panel says **Code license: MIT**, **Asset license:
    CC-BY 4.0**; the comment was him declining to hand out layer files for
    rebuilding his generator, not a retraction. The MIT notice travels into the
    generated module, and the CC-BY link-back is in `README.md`,
    `DESCRIPTION.md` and the panel.
4k2. **Cells are 16x24, drawn one sprite pixel to one chip pixel.** The preview
    GIFs are 32x48 because they are displayed at 2x; the art itself is half
    that, which is why the chip needs no scaling at all now - nothing to blur,
    no half-pixels to line up - and why the bake halved in size (45 kB to 22 kB)
    while gaining fidelity.
4l2. **The base body is bare-headed on purpose.** Hair and hats are both
    `heads.png` layers in the tool, so a clip drawn without one - every weapon
    animation - shows a bald companion. That is what "the villager loses his
    hat in the lunge" was: not our compositing, their art doing what it should.
    Every archetype now wears a head, which is also what makes the seven read
    apart: straw hat, pointed hat, buckled wizard hat, beast head, horns,
    horned helm, pointed ears.

4o0. **Timing comes from the art too.** Our durations were written for a
    four-frame sheet, so against theirs everything crawled: the warp ran at
    2.1x its drawn speed, the death at 3.5x, the sit at 9.4x. An animation now
    leaves `durationMs` out and gets `delayMs x frames` from the bake - the
    pace the artist chose. The three that mean to outlast their clip say so:
    `walk` strolls for 3.4 s and `rest` sits for 9 s with the clip looping
    underneath at its own speed (`looped()`), and `warp` takes 1.8 passes
    because it plays out, waits, and comes back in.
4o0b. **And the duration must still be the animation's own.** Taking it from
    the clip was right for an animation that plays once and wrong for every
    other: a walk that should stroll for 3.4 s finished in the 520 ms of one
    jog, and a nine-second sit in 960 ms. Only an entry with no `durationMs` of
    its own follows the row it drew (`fromSource`), which is also what lets the
    four deaths each run to their own length.
4o1. **The warp is their arrival clip, backwards then forwards.** Their
    `re_warp` opens on four empty frames, materialises the companion high and
    small, and settles into a stand - it is an arriving, not a leaving. So the
    way out is the same frames in reverse, the empty end of them is the beat
    where the companion is gone, and the way back in is the clip played
    forwards. It no longer travels sideways either: the trick is the
    disappearing, and walking about is what `walk` is for.
4o2. **The idle only ever showed half its frames.** The idle bob alternated
    "frame 0 or 1 of 2", which is phase 0 and phase 0.5, and on their
    four-frame idle that is frames 0 and 2 - 1 and 3 were never drawn. It
    sweeps the whole clip now. The hand-rolled breathing bob and blink went
    with it: their idle does both, and ours was a second, slower bob on top.
    `rest` and `flicker` had the same bug for the same reason - both were
    written as "frame 0 or 1 of two" - and a test now sweeps every animation and
    fails unless every frame of its clip is reached.

4p. **A death is one of four, and it lasts until the respawn.** `topple` names
    a list in the manifest - `die_soul`, `die_skull`, `die_melt`, `die_shrink` -
    which the bake lays down as `topple`, `topple#1`, `topple#2`, `topple#3`,
    and the animator picks a row each time it plays. All four were chosen for
    how they *end*, because the companion stays in that last frame:
    `die_poof` and `die_smoke` finish with the body gone, which would leave an
    empty footer.
    `base_die`, their four-frame collapse, plays first for a quarter of the
    animation, so the fall and the leaving are two beats, the way the game
    prints "Umierasz." and then "Oddalasz sie.".
    The holding is `PrimitiveDef.holds`: it plays once, stops on its last frame,
    and only `revive()` ends it. That comes from `reset`, which the client fires
    when the character's object number changes - a respawn. Nothing about it is
    persisted, so a relog finds the companion on their feet, and `wake()` (a
    typed command) deliberately does not lift it: only coming back to life does.

## Data model

5. **`PersistedState.settings` was added** (`voiceOverride`, `globalCooldownMs`,
   `idleMinutes`). The spec's panel lists a voice override and a cooldown but
   the spec's state shape had nowhere to keep them. Still `version: 1`; missing
   fields are repaired on load rather than rejected.
6. **A tampered or invalid `spec` in storage is replaced by the seed's spec**,
   keeping mood, stats and mutes. Only a wrong `version` or unparseable JSON
   throws the whole record away.
7. **Sessions** are counted per character load (each connection or character
   switch increments `stats.sessions`).

## Events (the spec's "exact v1 event list" question)

8. **Kill**: the `kill` event with `killer: "ME"` only. Team kills do not
   count; `enemyKilled` is not used (it duplicates `kill` for our purposes).
   A streak is kills within 90 s of each other.
9. **Hurt**: `Char.State.hp` is a condition index (0 = "ledwo zywy" ..
   6 = "w swietnej kondycji"), so "drops sharply" became "drops by one or more
   levels", with intensity and mood scaling by the number of levels lost.
10. **Death**: the game prints `Umierasz.` and then `Oddalasz sie.`, and the
    first of those is the event - the second is the soul leaving and would only
    double-fire. The `reset` the client's `PlayerIdentity` emits when the
    character's object number changes is kept as a fallback for a missed line:
    it counts as a death for a character the plugin already knows, after the
    first Char.Info of the connection has settled, with an unchanged GMCP name
    (so a character switch is not a death). The two are linked by a
    `deathReported` flag rather than a time window, because the respawn can be
    minutes after the death.
11. **Loot**: triggers on `Bierzesz ...`, `Dostajesz ...` and `... wyplaca ci
    ... monet`, valued via `text/coins.ts` (mithryl 24000, gold 240, silver 12,
    copper 1 - the client's own deposit rates). A full-size haul is 10 gold and
    up.
11b. **Coin phrases name the noun once for a whole list**: "9 srebrnych i 30
    miedzianych monet" has one `monet` for two metals, so anchoring the parse
    on the noun (as the first version did) silently dropped the silver.
    `coinsToCopper` now walks out from each metal adjective instead, and
    accepts it only when the run that follows - connectors, amounts, further
    metals - ends in `monet...`. That last condition is what keeps "dwie surowe
    czerwonozlote ryby" from being valued as gold.
12. **Spend**: `Kupujesz ...`, `Placisz ...`, and the shopkeeper's two ways of taking
    the money - `... zgarnia ... monet` and `... odbiera od ciebie ... monet ... w
    zamian za zakupiony towar`. Those last two are the only ones that say how much,
    so the line is parsed for coins and the slump scales with the price. The
    `odbiera` pattern keeps its "za zakupiony towar" tail on purpose: without it the
    phrase covers any handover, a quest hand-in included. Mood is untouched either
    way: spending is not a mood event.
12b. **Sell** (`Sprzedajesz ...`) is its own event and speech category. It is a
    deliberately quiet reaction, because when the game prints the payment it
    arrives on the next line and fires a full `loot` of its own; the sale is
    the smaller half of that pair, not a duplicate of it.
12c. **Drink**: `Char.State.intox` and `Char.State.headache`, read the way
    `improve` and `hp` are - numbers that move, not lines of text. The client's
    own bars give the scales: `intox` ("UPI") is 0..9 and `headache` ("KAC")
    0..6, both 0 by default. `intox` climbs with every sip and falls with every
    minute, so reacting to the number would be an evening of staggering:
    `INTOX_STAGES` and `HANGOVER_STAGES` cut each scale into three - a first
    warmth, properly drunk, barely upright; a dull head, a bad one, the kind you
    swear off drink over - and only an *upward* crossing is an event. Sobering
    up, and a head wearing off all morning, are silent, and re-arm the stage they
    left, so the next bout reacts from wherever it starts. The first frame after
    a login or a character switch is a baseline, as it is for `improve`: logging
    in drunk is not a drink.
12d. **The two new animations** are baked from the tool like the rest, not drawn:
    `sway` is its `run_wobble` (a walk that cannot hold a line) and `wince` its
    `hurt_skull`. Both loop their clip under a longer animation of ours, the way
    `walk` and `rest` do - a stagger is two rocks, and a headache has to outlast
    being hit. Swapping either is one command: `yarn mixer add-anim wince base_hurt`.
13. **Gems**: the same read-out pattern the client's `/ocenkamienie` uses.
    A stone worth reacting to starts at **1 mithryl** - gold-priced stones are
    common enough to be noise. Low is under 1 gold; in between draws nothing.
    From **2 mithryls** the reaction is priority (note 17b).
14. **Idle**: no `command` event for `idleMinutes` (default 5, configurable in
    the panel). The doze is sustained until the next command.
15. **Purchases and improve** rely on GMCP `Char.State.improve` semantics as
    `arkadia-konfetti` reads them: first reading is a baseline, only climbs
    count, 15 is the top.

## Speech

16. The four voices are written by me and are placeholders in tone as much as
    in content; every category has a `spokojnie` bucket and most have `zle`
    and `dobrze` too. ASCII-folded, checked by a test.
17. Per-category probabilities and cooldowns are in `voice/speak.ts`
    (`CATEGORY_RULES`); the global cooldown default is 45 s. A declined request
    never starts a cooldown. The same line is not repeated back to back when
    there is a choice.
17b. **A priority tier was added** on top of the spec's restraint model. The
    spec treats restraint as one flat gate, which in practice silences exactly
    the events worth reacting to - the `hurt` lines that precede a death hold
    the cooldown right across it. So `resolve()` may mark a reaction
    `priority`, and such a request skips the global cooldown and nothing else:
    mutes, the category's own cooldown and its probability all still apply, and
    a priority line restarts the global cooldown for everything else.
    The flag sits on the **reaction, not the category**, because the gem case
    needs a value threshold: `gemGood` is priority at 2 mithryls
    (`GEM_PRIORITY_COPPER`) and an ordinary remark at 1. `PRIORITY_CATEGORIES`
    lists the categories that can carry it, drives the note in the settings
    panel so the exemption is not invisible to someone who set a long pause,
    and is checked against `resolve()` by a test.
17c. **`priorityWindowMs` rations the exemption per category.** Deaths and
    niebotyczne postepy are rare because the game makes them rare, so their own
    cooldown is limit enough and their window is 0. Valuable stones are rare
    per stone but arrive in bags: appraising one would otherwise let the
    companion speak every 60 s (gemGood's cooldown) no matter what pause the
    player set, which turns the setting into a lie. gemGood gets 10 minutes.
    Two details that matter: a request inside the window is **demoted, not
    dropped** - it still speaks if the global cooldown happens to be clear; and
    the window counts **uses of the exemption**, not priority events, so a
    stone found in a quiet moment leaves it unspent.
18. `/towarzysz powiedz` and the panel's "Powiedz cos" bypass restraint on
    purpose, so the bubble can be checked without waiting for an event.

## UI

19. The chip registers an **empty** footer component and appends its own
    element into the handle's span, because the client clones any Node passed
    to `registerFooterComponent` and the plugin would lose its canvas.
20. Chip size: a 26x28 sprite-pixel canvas at 1.5 CSS px per pixel (39x42 px).
    That is a few pixels taller than the client's other footer chips; the
    constant is `PIXEL_SCALE` in `ui/chip.ts`.
21. Mood labels on the chip: `markotnie` / `spokojnie` / `radosnie` -
    adverbs, so they fit any companion.
22. The settings panel uses `registerPersistentPopup` (so a pinned panel is
    restored) and falls back to `createPopup` on an older client; the reroll
    confirmation is `window.confirm`.
23. Archetype labels in the panel are the plain Polish nouns (`mag`,
    `goblin`...); they name the archetype, not the companion's gender.

## Tooling

24. **No `yarn.lock` is committed.** The `@arkadia/plugin-types` tarball on
    GitHub Pages was not reachable from the build environment, so a lockfile
    could not be generated honestly. `yarn install` in CI creates one; commit
    it after the first successful run if you want reproducible installs like
    the sibling plugins have.
25. `tsconfig` has `noUncheckedIndexedAccess`, unlike the siblings; it caught
    two real bugs during implementation and costs a few `as` casts.
25b. **Node tools here use `fileURLToPath`, never `new URL(...).pathname`.**
    The latter is `/E:/...` on Windows, so `resolve()` produces `E:\E:\...`.
    The since-deleted `tools/embed-sheets.mjs` had exactly that bug: it found
    no assets, wrote nowhere, and left the generated file it was supposed to
    fill as an empty stub - silently, because it never errored.
25c. `tools/png.mjs` is a 60-line RGBA PNG encoder rather than a dependency.
    It is only used by the preview tool now, which is even less reason to take
    a package for it.
26. The registry-style bundle (virtual FS, relative imports only) was
    simulated locally and compiles; the publish workflow zips
    `plugin.json plugin.ts companion voice render ui events text`.

## Open questions from the spec

- **Repo and plugin name**: kept `arkadia-towarzysz` / "Towarzysz" / slug
  `towarzysz`.
- **Which sheets first**: all seven, generated (see 1).
- **Exact v1 event list**: as implemented above; the table in README.md is the
  current truth.

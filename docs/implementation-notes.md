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

## The day's temper

18. **The mood could not really go bad**, which made a third of every voice
    pack unreachable. The table is a dozen frequent positives (kills, coins,
    postepy) against three negatives that are rare (a death) or small (a few
    hit points), and the drift pulled both back to the same neutral 0 - so
    every evening looked alike and the `zle` lines were written for a bucket
    almost nobody saw.
19. **The fix is a resting point, not a starting value.** A starting value is
    erased by twenty minutes of drift and the session goes back to looking the
    same; the resting point is where the drift *ends up*. `Mood.resting` is
    optional and defaults to 0, so a mood with no day behaves exactly as it
    always did, and `decay` halves the distance still to cover rather than the
    value - the same curve, a different destination.
20. **One roll per session, not per companion.** `companion/temper.ts` rolls a
    band (grim / even / bright) weighted by the rolled voice, then a value
    inside it. It is kept in the save with a `rolledAt`, and `isStale` gives it
    `TEMPER_LIFE_MS` (6 h): a disconnect and a relog are the same evening,
    because a companion who is grim at nine should not be delighted at five
    past because the router blinked. `rolledAt: 0` is the "never rolled"
    sentinel, so a save from before tempers existed and a brand new companion
    take the same code path.
21. **A fresh roll also resets the mood to the resting point.** Otherwise a
    companion who announces a grim day shows yesterday's cheerful bar for the
    next hour, and nobody believes either of them.
22. **A death sets the mood instead of nudging it** (`Reaction.moodSet`, the
    only event that has one). It was -0.35, which on a good evening was a
    fifteen-minute dip; it is -1 now. The recovery is the drift, and the day is
    what it recovers *to*, so the same death costs more on a grim day than on a
    bright one without anything having to say so.
23. **The rest of the negatives were raised** to match - hurt to -0.09 a level
    over four levels rather than three, stun to -0.12, the head to -0.16.

## Gendered lines

24. **Polish cannot address the player without knowing who they are.**
    `Char.Info.gender` is 'male' or 'female', so lines that address the player
    in a gendered form carry both: `"Zajecha{les|las} sie."`, expanded in
    `voice/gender.ts` at the moment the bubble goes up. Inline markers rather
    than a form per line, because the overwhelming majority of lines need
    nothing - the companion mostly talks about themselves, about the world, or
    in the present tense. Male is the fallback for an unknown gender, matching
    the client's own default.
25. **The gender is read from GMCP per line, not cached.** Przeobrazenie puts
    the character in somebody else's body and the client updates `Char.Info`
    when it does, so the companion addresses whoever is standing there now.
26. **Only the player's gender varies; the companion's does not.** Their first
    person is written male throughout ("Widzialem", "Mowilem"), and that is
    deliberate rather than an oversight: the name pools carry no feminine names
    for the same reason (see `companion/names.ts`) - the sprite has a single
    body and no female looks, so a feminine companion would be a name and a
    pronoun with nothing behind them. The markers are therefore always about
    who is being spoken *to*, never about who is speaking.

## Data model

4b. **`PersistedState.temper` was added** and is repaired rather than rejected
   when it is missing or broken, like every other secondary field: a bad day is
   not worth a lost tally. Still `version: 1`.
5. **`PersistedState.settings` was added** (`voiceOverride`, `globalCooldownMs`,
   `idleMinutes`). The spec's panel lists a voice override and a cooldown but
   the spec's state shape had nowhere to keep them. Still `version: 1`; missing
   fields are repaired on load rather than rejected.
6. **A tampered or invalid `spec` in storage is replaced by the seed's spec**,
   keeping mood, stats and mutes. Only a wrong `version` or unparseable JSON
   throws the whole record away.
7. **Sessions** are counted per character load (each connection or character
   switch increments `stats.sessions`).
7b. **The mood drifts on time spent playing, not on wall-clock time.** The spec
   had `moodTouchedAt` decay lazily on read - cheap, no timer to keep alive, and
   charging the drift for every hour the browser was shut. With a twenty-minute
   half-life that makes the stored mood a formality: a session opens at
   `spokojnie` however the last one ended. And since almost nothing in the event
   table is a dampener - a death, a bad head, a few hit points - the drift is
   the only thing that brings a good evening down, so it was spending its whole
   budget on the night. Now it is charged in steps: `plugin.ts` ticks
   `advance` every 20 s while the client is connected and `hold` - clock
   forward, value untouched - while it is not, a load re-bases `moodTouchedAt`
   to the load time, and `mood.ts` caps one step at `MAX_STEP_MS` (90 s), which
   is what swallows a sleeping machine, a discarded tab and a save from
   yesterday. The tick is 20 s against that cap on purpose: Chrome throttles a
   hidden tab's timers to once a minute, and a minute still fits in one step.
7c. The tick writes to storage only when the bucket turns over. The number moves
   every twenty seconds and nothing shows it - `zle` / `spokojnie` / `dobrze`
   is what the card and the voice packs read - and the existing saves (an
   event, a disconnect, `beforeunload`) already catch the rest.

## Events (the spec's "exact v1 event list" question)

8. **Kill**: the `kill` event with `killer: "ME"` only. Team kills do not
   count; `enemyKilled` is not used (it duplicates `kill` for our purposes).
   A streak is kills within 90 s of each other.
9. **Hurt**: `Char.State.hp` is a condition index (0 = "ledwo zywy" ..
   6 = "w swietnej kondycji"), so "drops sharply" became "drops by one or more
   levels", with intensity and mood scaling by the number of levels lost.
10. **Death**: the game prints `Umierasz.` and then `Oddalasz sie.`, and the
    first of those is the event - the second is the soul leaving and would only
    double-fire. The `reset` the client's `PlayerIdentity` emits when a life
    ends is kept as a fallback for a missed line, and the two are linked by a
    `deathReported` flag rather than a time window, because the respawn can be
    minutes after the death.
10b. **Which body we are in** decides what that fallback means, and the client
    says so: `player.objectNum` carries the object we are, or `undefined` while
    that is unknown. It is not in `@arkadia/plugin-types` (see note 10d) but the
    client has always fired it. This replaced a timing heuristic - "a `reset`
    within 50 ms of the first Char.Info is a login, a later one is a death" -
    with the question the client is actually answering: a reset is a **death**
    if we were already wearing a body, and a **login** if we were not, because
    a disconnect clears the body. A character switch is caught as before, by
    the GMCP name having already moved on by the time the reset runs.
10c. **Przeobrazenie** falls out of the same event for free, and is the reason
    `player.objectNum` exists separately from `reset`. The client hands out a
    new object id for two different reasons: a new life, which it follows with
    `reset`, and a new body in the same life - the spell and the appearance
    scrolls - which it follows with nothing. So the absence of a reset is the
    signal, and `BODY_SETTLE_MS` (400 ms, generous: taking a death for a
    transformation is the worse mistake) is how long absence takes to
    establish. It fires twice per spell, once when it takes and once twenty
    minutes later when it lapses, which is right - both are the companion
    finding somebody else in front of them.
10d. **Most of these events are undeclared.** The published `ClientEvents` is a
    hand-maintained literal inside the client's `plugin-types/generate-types.cjs`
    rather than anything generated from `src/shared/events/clientEvents.ts`, and
    it carries about ninety of the client's nearly three hundred event names.
    Nothing is gated at run time - `PluginApi.createEventsApi` hands the name
    straight to the bus - so `events/sources.ts` declares the handful it needs
    in an `UndeclaredEvents` interface and subscribes through a thin `listen`
    helper. Extending the literal upstream would let that go away.
11a. **Taking is not earning.** `Bierzesz ...` covers looting a kill *and*
    moving your own coins from one bag to another, and the second is much the
    louder of the two - emptying a pack names bigger numbers than any single
    corpse does, so "Bierzesz siedem mithrylowych monet, wiele zlotych monet,
    ... z otwartego prostego skorzanego plecaka" valued at 168271 copper and
    drew a maximum-intensity gulp for money that had been in the pack all
    evening. `LOOT_SOURCE` requires the line to name a kill as the source -
    `z ciala` or `ze sterty`, the two the client's own `itemCollector.ts` takes
    from, optionally numbered. Coins picked up off the ground name no source
    and are given up with the container shuffling; there is nothing in the line
    to tell those two apart, and the plugin would rather miss one than react to
    something that did not happen.
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
12d. **Fatigue**: `Char.State.fatigue` runs 0 (rested) to 9 (spent) and climbs
    with exertion - the client draws its "ZM" bar from it flipped, which is why
    a full bar is an empty character. Unlike the drink it is not cut into
    stages: there is one thing worth saying about being tired and it is worth
    saying at the bottom of the bar, so a single crossing up into
    `FATIGUE_SPENT` is the event. The number then sits there for as long as the
    running goes on, so the reaction is armed by getting your breath back, not
    by a timer; and as everywhere else, the first reading after a login or a
    character switch is a baseline, because logging in winded is a state and
    not something that just happened.
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
12e. **Knowledge, clearing a room, fishing, decks and bodies.** Five more of the
    client's own events, all of them things it already tracks and none of them
    needing a line of parsing:
    - `knowledgeTickEvent` - the game's "czujesz, ze twoja wiedza ... wzrosla".
      It carries which field grew; the companion does not use it, because the
      voice packs are static lines and nothing interpolates yet.
    - `allEnemiesKilled` fires whenever the last enemy in a room dies, which
      after a lone rat is every single kill. So the source counts our own kills
      since the last clear and reports the group size, and `CLEAR_MIN_KILLS`
      (2) is where clearing a room stops being the kill that already reacted.
    - `fishing.state` runs `idle -> fishing -> biting -> pulling -> idle`. Only
      the bite is a reaction; `pulling` is the fight the bite already announced.
      The last transition back to `idle` is the same whether the fish was landed
      or the rod broke, so the catch is read off the one line that means it -
      `Wyciagasz zlapana rybe na powierzchnie.`
    - `transport.onBoard` is used and `transportDeparture` deliberately is not:
      the two are seconds apart on the same journey, and one stagger per deck is
      a companion at sea while two is a companion with a problem.
    - `stunStart` / `stunEnd` are Lua gags, so the end can be missed in a busy
      fight. `STUN_CAP_MS` (20 s) ends it anyway, and a respawn or a disconnect
      ends it too: a companion still reeling at midnight reads as a bug.
12f. **Stances**: a posture the companion holds *between* reactions, which is
    what a stun and a float on the water are - states, not moments. `stanceFor`
    in `events/bindings.ts` answers "what are they left doing", separately from
    `resolve`'s "what do they do about it", and `Animator.setStance` plays it
    again whenever nothing else is running. That is what makes a reaction cut
    through a stance and hand it back afterwards, with no bookkeeping in the
    plugin; the idle life is deferred while one is held, because a companion
    sitting by the water is not standing idle.
12g. **Three animations that borrow art.** `stun`, `watch` and `shift` describe
    themselves in `render/animations.ts` like everything else, but draw a clip
    another animation already baked - `AnimationSpec.clip` says which. Seeing
    stars is seeing stars whether it is last night's wine (`wince`) or a blow to
    the head (`stun`), and what differs between them is how long they run and
    what ends them, which is not worth a second row on the sheet. `watch` loops
    only the seated frames of `life_rest`: the clip is the whole business of
    getting down and standing back up, and looping the lot would have the
    companion bob. `shift` is the idle life's `warp` at a reaction's priority.
12h. **Postures overlap, so they are ranked.** A fight starts while the float
    is on the water; a fight is interrupted by the end of the world. The
    animator holds one stance, so `stanceFor` now answers with a
    `{ key, primitive }` pair - one key per state the client reports - and the
    plugin keeps a map of them and stands the companion in the most urgent
    (`POSTURE_ORDER`: stun, Apocalypse, combat, fishing). Before that,
    whichever state ended last won, which would have stood a companion up by
    the water because a fight finished. `null` from `stanceFor` still means
    "drop the lot", which is what a death, a disconnect and a character switch
    do.
12i. **Panika** is `Char.State.panic`, the game's own fear meter, 0..4 with the
    client's "PAN" bar drawn from it. Read exactly like the drink: stages
    (`PANIC_STAGES`), a baseline on the first reading, only a crossing upward,
    and calming down silent and re-arming. Most evenings never leave 0, which
    is why it is worth a reaction - and why it is *not* a priority one: it
    climbs inside a fight, where the companion has plenty else to say. Half of
    them get a line, and the animation is `duck_pose` - their single crouch
    frame - with the tremble ours, decaying, because what passes is the fright
    and not the crouch.
12j. **In a fight** is `combatState`, which the client works out from the
    player's own `attack_num` and re-emits on every objects frame, so only the
    edges are read. It resolves to no reaction at all: it is a posture and
    nothing else (`POSTURE_ONLY_EVENT_TYPES`), because a companion who
    announced every fight would be announcing most of the evening. What it
    buys is the weapon: the Mixer draws each weapon as its own idle rather than
    as a layer, so `guard` is `weapon_sword_idle` - the same sword `lunge`
    swings - and `guardStaff` is `weapon_staff_idle` for the two robed
    archetypes. `guardFor` picks between them, so the plugin is the only thing
    that has to know who the companion is. Everybody is armed: the roll's
    `parts.hasWeapon` was considered for this and dropped, because a companion
    standing through a fight with empty hands read as one who had not noticed
    it.
12k. **The Apocalypse** is `worldDestructionTimer`, which the client starts
    from the Rider's own warning and then ticks ten times a second, so again
    only the edges are read. It is the loudest thing the client ever says and
    happens at most once a day, so the line is priority - and the posture is
    `die_head`, one of the deaths in their catalogue: it sinks the figure into
    the floor until nothing shows but the hat and the eyes under it, which is a
    death to the artist and a companion hiding to us. It holds its last frame
    like a death does, and the countdown stopping gives the posture back.
12l. **The pipe** is `pipeLit`, and it is a moment rather than a posture: the
    companion drops onto the footer, takes two drags and gets up again. It was
    a stance for about an hour of this work, which was wrong - a pipe burns for
    a quarter of an hour and the player walks, shops and fights with it lit, so
    a companion sat down for the duration would be sitting through everything
    the pipe does not care about. `smoke` borrows the `rest` clip the way
    `watch` does, but plays it through once - down, sitting, up - and what
    tells it apart from an ambient rest is a new pose field, `puff`: three
    pixels of smoke leaving their head between drags, drawn by `ui/chip.ts`
    next to the sleep marks. One remark as it is lit, and the pipe going out is
    nothing anybody noticed.
12m. **Mail** has no client event at all: `scripts/newMail.ts` colours the line
    and prints it under a `[ POCZTA ]` header without firing anything, so the
    line is the event (`MAIL_PATTERN`). The sender's name is in it and goes
    unused - the lines are written once and cannot know who wrote to you. The
    animation is `base_press`, their arm-out pose, with the lean ours so it
    reads as pointing at the letter rather than pressing a wall.
13. **Gems**: the same read-out pattern the client's `/ocenkamienie` uses.
    A stone worth reacting to starts at **1 mithryl** - gold-priced stones are
    common enough to be noise. Low is under 1 gold; in between draws nothing.
    From **2 mithryls** the reaction is priority (note 17b).
14. **Idle**: no `command` event for `idleMinutes` (default 5, configurable in
    the panel). The doze is sustained until the next command.
14b. **Boredom** is the other half of a quiet stretch: no *event* for
    `BORED_AFTER_MS` (7 min) while the player is still typing. The two clocks
    are driven by opposite things on purpose - the idle one restarts on a
    command, the boredom one on an event - because being bored is exactly the
    combination of nothing happening and somebody there to notice it. A command
    inside `BORED_ACTIVE_MS` (3 min) is what "there" means, capped by the idle
    window so that a companion who has already dozed off is not also bored:
    that is one state, not two. The clock re-arms itself whether or not it
    fired, so a player who walks away for an hour is bored at again when they
    come back rather than never. Not configurable - unlike the idle pause,
    there is no setting for it, because there is no session it would spoil.
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
    lists the categories that can carry it and is checked against `resolve()`
    by a test.
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
18. `/towarzysz powiedz` and the card's "Zagadnij" bypass restraint on
    purpose, so the bubble can be checked without waiting for an event.

## UI

19. The chip registers an **empty** footer component and appends its own
    element into the handle's span, because the client clones any Node passed
    to `registerFooterComponent` and the plugin would lose its canvas.
20. Chip size: a 26x28 sprite-pixel canvas at 1.5 CSS px per pixel (39x42 px),
    which is far taller than a footer row. **The canvas is out of the flow.**
    The chip's own box is its one line of text - the name, the height of any
    other footer chip - and the canvas is absolutely
    positioned inside a slot of the canvas's width, its bottom edge on that
    line. The companion stands on the footer and overflows upwards into the
    output: the row does not grow, nothing shifts, nothing is cut. Measured in
    the showcase: chip 12 px tall, canvas 42, 30 px of it above the row, and a
    mock footer bar is exactly as tall with the chip in it as without.
20b. Two things have to agree for that to work: the footer handle's own span
    gets `overflow: visible` from `plugin.ts`, and the bubble anchors on
    `chip.anchor` (the canvas) rather than on the chip element, which would
    measure the name instead of the companion.
20c. **The bubble stands beside them, not over them.** It used to hang above
    the canvas, which covered the one thing it was commenting on - and the
    companion jumps, warps and sits down inside that box. So it goes to the
    right of the canvas (`BUBBLE_GAP`), lifted by `BUBBLE_LIFT` so its bottom
    edge clears the name, with the tail on the edge facing them. The footer
    chip sits at the right-hand end of the row, so "no room on the right" is
    the ordinary case rather than the exception: it flips to the left side and
    moves the tail across. Only when neither side fits does it go back to
    hanging above.
21. **The chip shows the name and nothing else.** The mood label - `markotnie`
    / `spokojnie` / `radosnie`, adverbs so they fit any companion - is on the
    card and in `/towarzysz status`. In the footer it was a second word nobody
    reads, and while it was stacked under the name it cost the row a line.
22. **`/towarzysz` is a card, not a settings panel.** The companion is rolled,
    not configured, so the window only shows them: portrait, archetype, the
    rolled traits and voice, mood, the tally, the palette and how long you have
    been together. What used to be there - the mute grid, the voice picker, the
    cooldown and idle boxes, the ambient level, the one-time reroll - is gone.
    Those settings still exist in the stored state and still work; they are the
    author's tuning, and the only one a player can reach is `/towarzysz cisza`.
    `reroll()` was deleted outright.
22b. The card's portrait is a `Chip` at scale 4 with `label: false` and
    `float: false` - the same renderer, animator and sheet as the footer's, so
    the card cannot drift from what the footer shows. It is built once and
    **re-parented** into each rebuild rather than re-created, it stops while
    the popup is shut, and `Chip.tick` skips a frame whenever its element is
    not in the document.
22c. The window uses `registerPersistentPopup` (so a pinned card is restored)
    and falls back to `createPopup` on an older client.
22d. **"Kopiuj jako obraz"** (`ui/picture.ts`) draws the card's own contents on
    one 344x170 canvas at two device pixels per logical one - the figure at
    five, whole numbers only and smoothing off, or the pixels stop being
    pixels - and puts it on the clipboard. The client offers the same thing in
    Postepy, on the map and in the log browser, and always the same way: the
    `Promise<Blob>` goes *inside* the `ClipboardItem` so the write happens in
    the same turn as the click. Its helper
    (`src/shared/dom/copyCanvasToClipboard.ts`) is not exposed to plugins, so
    this is the same shape of thing built from what a plugin has. Two details
    follow from that: nothing is awaited before the write (the plugin draws
    synchronously and hands the promise over), and the canvas is created in the
    *clicked* document, because the card can be popped out into a window of its
    own and only the focused one may reach the clipboard. Where the clipboard
    cannot be had at all - an http page, an old browser - it saves a file
    instead, and the button says which of the two happened rather than printing
    to the game window. The card sits inside a 12px transparent margin and has
    a rounded corner of its own: chats round the corners of the images they
    show - Discord rounds the file, not a frame around it - and a card drawn
    edge to edge came back with its corners bitten off.
23. Archetype labels on the card are the plain Polish nouns (`mag`,
    `goblin`...); they name the archetype, not the companion's gender.
23b. `metAt` was added to the stored state for the card's "Towarzyszy od ...". A
    save that predates it is dated from the first load that finds it missing,
    and a date from the future is not believed.

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

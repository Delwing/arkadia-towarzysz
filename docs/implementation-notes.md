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
12. **Spend**: `Kupujesz ...`, `Placisz ...`, and `... zgarnia ... monet` - the
    shopkeeper's side of a purchase, and the only one of the three that says
    how much, so the line is parsed for coins and the slump scales with the
    price. Mood is untouched either way: spending is not a mood event.
12b. **Sell** (`Sprzedajesz ...`) is its own event and speech category. It is a
    deliberately quiet reaction, because when the game prints the payment it
    arrives on the next line and fires a full `loot` of its own; the sale is
    the smaller half of that pair, not a duplicate of it.
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
20. Chip size: a 26x20 sprite-pixel canvas at 1.5 CSS px per pixel (39x30 px).
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

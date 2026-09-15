# Implementation notes and assumptions

Written while implementing `specs/2026-09-15-towarzysz-design.md`. Everything
here is a decision the spec left open, or a place where the spec met a fact
about the client or the registry and had to bend. Each one is easy to revisit.

## Assets

1. **No sprite sheet is bundled.** The spec says acquiring a sheet needs an
   explicit go-ahead, and the itch.io host was not reachable from the build
   environment anyway. The whole pipeline is in place - `assets/sheets/*.png`
   plus a JSON spec, `yarn embed-sheets`, `render/sheets.ts`, palette recolour
   in `render/sheet.ts` - and until a sheet lands the plugin draws the
   procedural fallback figure for every archetype. The fallback was designed to
   carry v1 on its own: readable eyes and mouth, arms that raise, a weapon, and
   per-archetype flavour (hats, tusks, ears, horns, a heavy brow).
2. **Sheets are embedded by a generator, not by esbuild's `dataurl` loader.**
   The registry compiles the published sources itself and its virtual
   filesystem only resolves `.ts`, `.js` and `.json`; a `.png` import fails
   there. `build.mjs` keeps the loader for local experiments only.
3. **The Mixer's source palette is a per-sheet field**, not a constant in code,
   because the exact colours are unknown until a sheet is in hand.
4. **Bundle size**: registry limits are 2 MB zip and 8 MB unpacked, and the
   client's GitHub Pages path has no limit. Seven trimmed sheets as base64 will
   fit; the embed tool prints the total so it can be watched.

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
10. **Death**: the client prints no dedicated death line the plugin could
    trigger on, but its `PlayerIdentity` fires `reset` when the character's
    object number changes mid-session, which it treats as a death and respawn.
    The plugin counts a `reset` as a death when it arrives for a character it
    already knows, after the first Char.Info of the connection has settled,
    and the GMCP name has not changed (so a character switch is not a death).
    If Arkadia prints a reliable death line, adding it as a trigger in
    `events/sources.ts` would be a one-liner.
11. **Loot**: triggers on `Bierzesz ...`, `Dostajesz ...` and `... wyplaca ci
    ... monet`, valued via `text/coins.ts` (mithryl 24000, gold 240, silver 12,
    copper 1 - the client's own deposit rates). The exact wording of the take
    line is an assumption. A full-size haul is 10 gold and up.
12. **Spend**: `Kupujesz ...` and `Placisz ...`. Assumed wording.
13. **Gems**: the same read-out pattern the client's `/ocenkamienie` uses.
    High is 10 gold and up; low is under 1 gold; in between draws nothing.
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
26. The registry-style bundle (virtual FS, relative imports only) was
    simulated locally and compiles; the publish workflow zips
    `plugin.json plugin.ts companion voice render ui events text`.

## Open questions from the spec

- **Repo and plugin name**: kept `arkadia-towarzysz` / "Towarzysz" / slug
  `towarzysz`.
- **Which sheets first**: none yet (see 1). When one arrives, a human-ish and a
  monstrous one first, as the spec suggests.
- **Exact v1 event list**: as implemented above; the table in README.md is the
  current truth.

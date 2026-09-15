# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A plugin for the Arkadia Web Client (a Polish MUD client): a pixel-art
companion in the footer, rolled once per character, who reacts to session
events with animations and occasional speech. No runtime dependencies - the
bundle is this repository's own TypeScript plus a type-only import of
`@arkadia/plugin-types`.

`README.md` is the long-form reference and is kept current: the full event ->
reaction table, the mood model, the idle-life weights, the Mixer pipeline. Read
the relevant section of it before changing behaviour rather than re-deriving it
from the code. `docs/specs/2026-09-15-towarzysz-design.md` is the original
design; `docs/implementation-notes.md` records decisions made against it and has
stale passages (it predates the switch to Mixer art - there is no
`render/sprites.ts` any more).

## Commands

```
yarn install
yarn typecheck                  tsc --noEmit
yarn test                       vitest run
yarn test test/mood.test.ts     one file
yarn test -t "clamps at both"   one test by name
yarn test:watch
yarn build                      esbuild -> dist/plugin.js
yarn dev                        watch + serve dist/ on :5177
yarn showcase                   click-through preview on :5178
yarn mixer <cmd>                the sprite pipeline (list / add-anim / set-head / bake / preview)
```

CI runs `yarn typecheck && yarn test && yarn build`. There is no linter.

## Architecture

One direction of flow, and each arrow is a module that knows nothing about the
next:

```
client event -> events/sources.ts -> GameEvent -> events/bindings.ts -> Reaction
             -> mood.nudge -> animator.play -> speak.maybe -> chip/bubble repaint
```

- `events/sources.ts` is the only module that talks to the client API. It
  subscribes, parses Polish game lines, and normalises everything into the
  `GameEvent` union. Nothing below it knows the client exists.
- `events/bindings.ts` is a pure function `GameEvent -> { primitive, intensity,
  category, moodDelta }`, plus `stanceFor` for the states that leave a lasting
  posture (stun, the Apocalypse, a fight, a float on the water). Those overlap,
  so it answers with a `{ key, primitive }` pair and `plugin.ts` keeps one per
  key and holds the most urgent (`POSTURE_ORDER`).
- `render/animator.ts` is a pure state machine over the animation table in
  `render/animations.ts`; `pose(now)` is asked once per frame and the chip draws
  whatever comes back. It also polls `companion/ambient.ts`, so a chip that is
  not being drawn is a companion standing still.
- `plugin.ts` is the only wiring: it owns the timers, the alias, the footer
  component, the popup and the save debounce.

Intensity is the scaling trick that lets ~20 animations cover a hundred game
actions: a small coin and a huge haul are the same `gulp` at different
amplitudes. Prefer scaling an existing primitive over adding one.

### The purity boundary

`companion/`, `voice/`, `events/`, `text/`, `render/mixer.ts` and the rest of
`render/` except `sheet.ts` touch no DOM, and all of it is unit-tested in
`test/` (one test file per module, vitest, node environment). `render/sheet.ts`,
`ui/` and `plugin.ts` are the canvas/DOM layer and are verified by hand in the
client or through `yarn showcase`. Keep new logic on the pure side of that line
so it can be tested.

## Rules that are easy to break

- **The roll must never touch `Math.random`.** `companion/roll.ts` is a pure
  function of `hash(characterName + ":" + rerollsUsed)` via `companion/rng.ts`;
  losing localStorage must not lose the companion. The roll's step order
  (archetype -> name -> voice -> palette -> parts) is load-bearing: inserting a
  draw in the middle changes every existing companion.
- **Nothing may throw into the client's event loop.** Every callback handed to
  the client API is wrapped, logging included.
- **User-facing text is ASCII-folded Polish** (diacritics stripped: "Przejdz sie",
  "zle", "czesto"), matching the client. Source files are ASCII with CRLF line
  endings; keep them that way.
- **Version lives in three places** and must agree: `package.json`,
  `plugin.json` and `PLUGIN_VERSION` in `plugin.ts`. The publish workflow fails
  the build if `package.json` disagrees with the tag, and the registry rejects
  the rest.
- **`render/mixer-art.ts` is generated.** Edit `tools/mixer/manifest.json` and
  run `yarn mixer bake`; never hand-edit the module. The source bundle lives in
  the git-ignored `tools/mixer/cache/`, so a re-bake is offline but a clean
  checkout needs `yarn mixer` to pull it first.
- **`@arkadia/plugin-types` is a tarball at a fixed URL** that is republished
  with a fresh version on every push to the client, so its lockfile entry is
  stale by design. Both workflows delete that entry before `yarn install
  --update-checksums`. Do not "fix" the lockfile drift.
- **The client's published event types lag reality.** `ClientEvents` in the
  types package is a hand-kept subset; the bus itself gates nothing, so
  `events/sources.ts` casts through `unknown` to subscribe to undeclared events.
  That is deliberate, not sloppiness.

## Adding things

**An animation:** one entry in `render/animations.ts` (timing, priority,
optional `ambient` weight, optional `pose` override) and one `yarn mixer
add-anim <name> <their anim>` line. The `Primitive` union, the animator table,
the idle-life draw and the showcase's controls are all derived from that entry.
Keep `pose` to what a frame cannot carry - where the companion stands, which way
they face, effects laid over the top - because the Mixer frames already animate
themselves.

**A reaction:** a variant in the `GameEvent` union, a case in
`events/bindings.ts`, the subscription/trigger in `events/sources.ts`, a
category in `companion/types.ts`, lines in all four packs in `voice/voices.json`
plus its entry in the restraint table in `voice/speak.ts`, and a row in the
README's table.

## Publishing

`dist/` is deployed to GitHub Pages on push to master. Tagging `v*` runs
`publish.yml`, which zips the *sources* (`plugin.json`, `plugin.ts` and the
module folders) for the Arkadia registry, which compiles them itself with
esbuild over a virtual filesystem understanding relative imports of `.ts`, `.js`
and `.json` only. So: no image or binary assets may enter the published tree
(the art is code), no bare-specifier runtime imports, and no import may reach
outside the folders listed in `plugin.json`.

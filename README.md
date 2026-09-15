# arkadia-towarzysz

A companion plugin for the [Arkadia Web Client](https://github.com/Delwing/arkadia-web-client-extension).
A pixel-art figure lives in the client's footer. They are rolled once per
character - random archetype, look, voice and name - react to what happens in
your session with small animations, and occasionally say something in a speech
bubble above the footer. They have a mood that drifts with how the session is
going. They have no needs, cannot be neglected, and cannot die.

The design is in [`docs/specs/2026-09-15-towarzysz-design.md`](docs/specs/2026-09-15-towarzysz-design.md);
the decisions and assumptions made while implementing it are in
[`docs/implementation-notes.md`](docs/implementation-notes.md).

## Layout

```
plugin.ts              entry: init/destroy, wires everything, owns the alias
companion/types.ts     shared data model
companion/rng.ts       string hash + seeded PRNG (the roll must never touch Math.random)
companion/names.ts     name pools
companion/roll.ts      seed -> CompanionSpec (deterministic)
companion/state.ts     load/save persisted state, per character
companion/mood.ts      mood scalar: nudge, decay, bucket
voice/voices.json      the four voice packs
voice/catalog.ts       typed access to voices.json
voice/speak.ts         line selection + restraint (cooldowns, probability, mutes)
render/sprites.ts      the sprite art: one companion -> a sheet of pixels (pure)
render/sheet.ts        that buffer -> an offscreen canvas, plus frame extraction
render/colour.ts       hex/rgb and shading helpers
render/fallback.ts     procedural pixel figure, drawn if no sheet can be built
render/animator.ts     animation primitives + intensity -> per-frame pose
ui/chip.ts             footer component: canvas, name, mood label
ui/bubble.ts           speech bubble anchored above the chip
ui/settings.ts         the /towarzysz panel
events/bindings.ts     game event -> (primitive, intensity, speech category, mood delta)
events/sources.ts      client events and triggers -> game events
text/polishNumbers.ts  "dwadziescia trzy" -> 23
text/coins.ts          coin phrases -> copper
test/                  Vitest, DOM-free modules only
tools/preview-sprites.mjs  a contact sheet of the art, to look at a change
tools/png.mjs          dependency-free RGBA PNG encoder, for that preview
```

Nothing in `companion/`, `voice/`, `events/bindings.ts`, `text/` or
`render/sprites.ts` touches the DOM, so all of it is unit-tested - the sprite
art included, since it is a pure pixel buffer until `render/sheet.ts` puts it
on a canvas. The canvas and UI layers are verified by hand in the client.

Other files: `plugin.json` is the registry manifest (keep its `version` in sync
with `package.json` and `PLUGIN_VERSION` in `plugin.ts`); `DESCRIPTION.md` is the
plugin's page in the registry, in Polish.

## Build

```
yarn install
yarn build
```

Outputs `dist/plugin.js`. Host the `dist/` directory anywhere reachable from
the Arkadia client. `yarn typecheck` and `yarn test` run the checks CI runs.

## Develop

```
yarn dev
```

Watches sources and serves `dist/` on `http://localhost:5177`, so the plugin
entry is at `http://localhost:5177/plugin.js`. Add that URL in the client's
plugin manager, or open the client with
`?add-script=http://localhost:5177/plugin.js` once.

## Publishing

The registry compiles the published sources itself with esbuild over a virtual
filesystem that understands relative imports of `.ts`, `.js` and `.json` only.
That has two consequences:

- The publish zip carries `plugin.json`, `plugin.ts` and the module folders
  (see `.github/workflows/publish.yml`), not `dist/`.
- There are no image files to publish. The sprite art is code
  (`render/sprites.ts`), which the registry compiles like any other module.

## Sprite art

There is no sprite sheet in the repository and none in the bundle. The art is a
function: `render/sprites.ts` draws one companion's whole sheet - 16x16 frames,
four frame columns by nine animation rows - as a plain pixel buffer, and
`render/sheet.ts` puts that buffer on an offscreen canvas the chip draws from.
A sheet is built when a character loads or rerolls, a few times per session,
in well under a millisecond.

Generating per companion rather than per archetype is what keeps it simple: the
frames come out in the rolled colours directly, so there is no palette swap, and
a companion rolled without a weapon or without long hair simply never has one
drawn - no erasing, no four sheets per archetype for the combinations of
`parts`.

To look at a change without starting the client:

```
yarn preview-sprites                          # sprites-preview.png, one companion per archetype
yarn preview-sprites out.png Delwing Zbyszek  # particular characters
```

Two rules hold the art together. Frames are 16 pixels tall because the chip
scales a frame to the fallback figure's `FIGURE_H`, so at 16 one sheet pixel is
exactly one screen pixel and nothing blurs. And the animator and the frames
split the motion: `render/animator.ts` moves, rotates and squashes the whole
figure, the frames carry only what it cannot move - limbs, eyes, mouth. Nothing
is pre-rotated and the jumps are not drawn.

`render/fallback.ts` is the safety net, drawn directly if a sheet cannot be
built at all.

## How the reactions work

```
client event
  -> events/sources.ts     normalises to a GameEvent (kill streak, hp drop, coins parsed...)
  -> events/bindings.ts    resolves to { primitive, intensity, category, moodDelta }
  -> mood.nudge(moodDelta)
  -> animator.play(primitive, intensity)        always
  -> speak.maybe(category, mood)                usually declines
  -> ui/chip.ts repaints, ui/bubble.ts shows a line if one was produced
```

| Client signal | Primitive | Category | Mood |
| --- | --- | --- | --- |
| `kill` with `killer: "ME"` | `lunge`, scales with the 90 s streak | `kill` | +0.04 |
| `gmcp.char.state.improve` climbs | `cheer` | `improve` | +0.25 |
| `improve` reaches 15 | `cheer` x2.5 | `improveMax` | +0.45 |
| `gmcp.char.state.hp` drops (condition index 0..6) | `flinch`, scales with the drop | `hurt` | -0.05 per level |
| `Umierasz.` (or a `reset` after a respawn, if the line was missed) | `topple` | `death` | -0.35 |
| `Bierzesz ... monet ...` / `Dostajesz ...` / `wyplaca ci ... monet` | `gulp`, scales with the copper value | `loot` | up to +0.15 |
| `Kupujesz ...` / `Placisz ...` / `... zgarnia ... monet` | `slump`, scales with the price when the line gives one | `spend` | 0 |
| `Sprzedajesz ...` | `gulp` x0.8 - the coins, if any, land separately | `sell` | +0.05 |
| gem valuation >= 1 mithryl | `glitter` | `gemGood` | +0.10 |
| gem valuation < 1 gold | `slump` | `gemBad` | -0.02 |
| no command for 5 min (configurable) | `doze` (until the next command) | `idle` | 0 |

Restraint (all persisted, all in `/towarzysz`): a global cooldown (default
45 s), per-category cooldowns and probabilities (`voice/speak.ts`), a global
mute and per-category mutes. Animation is never gated by any of it.

## Storage

One key per character in localStorage: `plugin:towarzysz:<characterName>`.
The companion is a deterministic function of the character name and the
number of rerolls used, so losing storage does not lose the companion. If
localStorage is unavailable the plugin runs from memory for the session.

## Licensing

The sprite art is this repository's own: `render/sprites.ts` draws it, so it
carries the same licence as the rest of the plugin and needs no third-party
attribution. The design originally planned to use KingBell's
[Pixel Art Sprite Mixer](https://kingbell.itch.io/pixel-sprite-mixer)
(CC-BY 4.0) - no asset from it was ever acquired or used.

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
render/sheet.ts        sprite sheet load, palette recolour, frame extraction
render/sheets.ts       GENERATED: embedded sheets (tools/embed-sheets.mjs)
render/fallback.ts     procedural pixel figure, used when there is no sheet
render/animator.ts     animation primitives + intensity -> per-frame pose
ui/chip.ts             footer component: canvas, name, mood label
ui/bubble.ts           speech bubble anchored above the chip
ui/settings.ts         the /towarzysz panel
events/bindings.ts     game event -> (primitive, intensity, speech category, mood delta)
events/sources.ts      client events and triggers -> game events
text/polishNumbers.ts  "dwadziescia trzy" -> 23
text/coins.ts          coin phrases -> copper
test/                  Vitest, DOM-free modules only
tools/embed-sheets.mjs assets/sheets/*.png -> render/sheets.ts
```

Nothing in `companion/`, `voice/`, `events/bindings.ts` or `text/` touches the
DOM, so all of it is unit-tested. Rendering and UI are verified by hand in the
client.

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
- Sprite sheets cannot be imported as `.png`. They are embedded as data URIs
  into `render/sheets.ts` by `yarn embed-sheets` and committed. See
  `assets/sheets/README.md` for the input format.

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
| `reset` from the client's PlayerIdentity after a respawn | `topple` | `death` | -0.35 |
| `Bierzesz ... monet ...` / `Dostajesz ...` / `wyplaca ci ... monet` | `gulp`, scales with the copper value | `loot` | up to +0.15 |
| `Kupujesz ...` / `Placisz ...` | `slump` | `spend` | 0 |
| gem valuation >= 10 gold | `glitter` | `gemGood` | +0.10 |
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

Sprite assets are from KingBell's
[Pixel Art Sprite Mixer](https://kingbell.itch.io/pixel-sprite-mixer)
(CC-BY 4.0; the Mixer's code is MIT). Attribution is also in `plugin.json`,
`DESCRIPTION.md` and the `/towarzysz` panel.

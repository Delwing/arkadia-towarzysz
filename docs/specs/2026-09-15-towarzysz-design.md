# Towarzysz — design

**Date:** 2026-09-15
**Status:** approved, ready for implementation planning
**Repo:** `E:\Code\arkadia-towarzysz` (standalone, alongside `arkadia-notatnik` and `arkadia-konfetti`)

## Summary

A pixel-art companion who lives in the Arkadia web client's footer. They are rolled once per
character — random archetype, look, voice and name — and react to what happens in your session
with small animations, and occasionally says something in a speech bubble above the footer.
They have a mood that drifts with how the session is going, which colours what they say. They
have no needs, cannot be neglected, and cannot die.

The design goal is a companion, not a chore: they should be pleasant company in peripheral
vision and easy to forget about, never a system that demands maintenance.

The companion may be any gender or none — human, orc, goblin, ogre or something stranger. That
is part of the roll, so this document says "they".

## Decisions

Each of these was settled during design; the rationale matters because it constrains later
changes.

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Pixel sprite**, not emoji or ASCII | Only medium that animates expressively at footer size. Emoji renders differently per OS; ASCII at chip size is a face, not a character. |
| 2 | Art from **KingBell's Pixel Art Sprite Mixer** | Removes the art budget entirely — 115 ready animations including attacks, walks, deaths. CC-BY 4.0 assets, MIT code, free for commercial use. |
| 3 | The sprite is a **companion**, a separate person — not a mirror of the player | A companion can comment on you. An avatar can only echo you. |
| 4 | **Rolled, not designed** — random look, voice and name, one per character | You get attached to what you were dealt in a way you never do to what you configured. Also guarantees variety across characters and players with zero design effort. |
| 5 | Speech goes in a **bubble over the footer**, never into the game output | Keeps the game log clean and keeps them ignorable. Explicitly chosen over printing lines via `api.output.print()`. |
| 6 | **Voice packs in JSON**, randomly assigned | The voice is the part you will tinker with for months; that must not mean touching TypeScript. New voices become new files. |
| 7 | **Mood that drifts**, no decay and no needs | One number that biases line selection — the cheapest thing that makes them a person rather than a soundboard. The full tamagotchi (hunger, neglect, consequences) was considered and rejected: it contradicts every other choice here. |
| 8 | **Only face-visible archetypes** — magician, wizard, villager, monster, ogre, orc, goblin | At footer size the face does all the acting. A full helmet hides the eyes and the companion stops reading as alive. This rules out most armoured-knight parts regardless of how good they look. |
| 9 | **Restraint is a feature** | A companion who comments on everything is noise within an hour and muted forever. Cooldowns, per-category mutes and low speech probability for common events are core requirements, not polish. |

## Non-goals

- No hunger, decay, sickness, neglect or death.
- No evolution or gear progression in v1 (deferred; see Deferred).
- No printing into the game output.
- No player-facing character creator — rolling is the point.
- No closed helmets or face-covering headgear, ever — including in any later gear progression.
- No network calls at runtime. Assets are bundled.

## Architecture

Small modules with one job each, so the logic modules stay testable without a DOM.

```
plugin.ts              entry: init/destroy, wires everything, owns the alias
companion/roll.ts      seed -> CompanionSpec (deterministic)
companion/state.ts     load/save persisted state, per character
companion/mood.ts      mood scalar: nudge, decay, bucket
voice/voices.json      the four voice packs
voice/speak.ts         line selection + restraint (cooldowns, probability, mutes)
render/sheet.ts        sprite sheet load, palette recolour, frame extraction
render/animator.ts     animation primitives + intensity -> per-frame transforms
ui/chip.ts             footer component: canvas, name, mood label
ui/bubble.ts           speech bubble anchored above the chip
events/bindings.ts     client event -> (primitive, intensity, speech category, mood delta)
```

**Dependency direction:** `plugin.ts` → everything; `events/bindings.ts` → `mood`, `speak`,
`animator`; `ui/*` → `render/*`. Nothing in `companion/`, `voice/` or `events/` touches the
DOM, so all of it is unit-testable.

### Data flow

```
client event
  → events/bindings.ts   resolves to { primitive, intensity, category, moodDelta }
  → mood.nudge(moodDelta)
  → animator.play(primitive, intensity)        always
  → speak.maybe(category, mood)                usually declines
  → ui/chip.ts repaints, ui/bubble.ts shows a line if one was produced
```

`speak.maybe` returning `null` is the common case and is not an error.

## Data model

```ts
type Archetype =
  | 'magician' | 'wizard' | 'villager'      // human-ish, faces visible
  | 'monster'  | 'ogre'  | 'orc' | 'goblin'; // not human, faces very visible

interface CompanionSpec {
  archetype: Archetype;
  name: string;          // from that archetype's name pool
  voiceId: string;       // key into voices.json
  palette: {             // applied to the sprite sheet at load
    skin: string; hair: string; armour: string; belt: string; legs: string;
    weapon: string | null;
  };
  parts: { hairLong: boolean; hasWeapon: boolean };
}

interface PersistedState {
  version: 1;
  spec: CompanionSpec;
  rerollsUsed: number;   // max 1
  mood: number;          // -1..+1
  moodTouchedAt: number; // epoch ms, for decay on load
  mutes: { global: boolean; categories: string[] };
  stats: { kills: number; deaths: number; sessions: number };
}
```

**Storage key:** `plugin:towarzysz:<characterName>` in `localStorage`, matching the
`plugin:konfetti:settings` convention already in use. Character name comes from
`api.gmcp.get()?.char?.info?.name`, with `api.events.on("gmcp.char.info", …)` to catch it
arriving late or changing.

### Rolling

The roll picks, in order: **archetype**, then a name from that archetype's pool, then a voice,
then the palette and parts. Voice is drawn independently of archetype — a goblin who speaks as
the *Ponury wieszcz* is exactly the kind of pairing that makes rolling worth doing.

The roll is **deterministic from a seed**: `hash(characterName + ":" + rerollsUsed)`. The same
character always gets the same companion even if `localStorage` is cleared, which means losing
your storage does not lose your companion. A reroll increments `rerollsUsed`, changing the seed.
**One reroll only**, so this is someone you have had since the beginning rather than a slot
machine.

## Mood

A single scalar in `[-1, +1]`, starting at `0`.

- **Nudges** (indicative, to be tuned): kill `+0.04` (a streak multiplies the same nudge, it is not a separate event), big loot `+0.15`,
  improve `+0.25`, max improve `+0.45`, gravel `-0.02`, taking damage `-0.05`, death `-0.35`.
- **Clamped** to `[-1, +1]` after every nudge, so grinding kills cannot bank infinite goodwill.
- **Decays** toward `0` with a half-life of roughly 20 minutes of wall-clock time, applied
  lazily on read using `moodTouchedAt` rather than on a timer.
- **Buckets** for line selection: `zle` (≤ −0.35), `spokojnie` (between), `dobrze` (≥ +0.35).

The point of the mood is that the same event draws a different remark on a good night than
after your third death.

## Name pools

One pool per archetype family, so the name matches what you were dealt. Roughly 880 names
in all, so two companions rarely share one. All ASCII-folded, and all masculine or
genderless: the sprite has a single body with no female looks, so a `Bozena` would be a
name with nothing behind it. `companion/names.ts` holds them, `test/names.test.ts` guards
the shape.

| Archetype | Pool | Flavour | Sample |
|---|---|---|---|
| villager | `VILLAGER_NAMES` (266) | old Polish and Slavic given names, the everyday sort | Zbrozek, Goscirad, Wrociwoj, Zbylut |
| magician, wizard | `MAGE_NAMES` (149) | dithematic names, the old gods, the folk-magic trades, magical herbs | Czaroslaw, Swarozyc, Planetnik, Piolun |
| orc | `ORC_NAMES` (110) | noise, teeth and ironmongery | Zgrzyt, Charkot, Berdysz, Wrzod |
| goblin | `GOBLIN_NAMES` (143) | short and snickering - vermin, scraps, small-time crooks | Klak, Chochlik, Rzezimieszek, Nochal |
| ogre | `OGRE_NAMES` (100) | weight, timber and appetite, led by the folk giants | Waligora, Wyrwidab, Kloc, Zarlok |
| monster | `MONSTER_NAMES` (111) | the folklore bestiary, and what it leaves behind | Strzygon, Utopiec, Boruta, Pomor |

## Voice and restraint

`voices.json` holds four packs — *Wierny giermek*, *Zgryzliwy weteran*, *Ponury wieszcz*,
*Maloomowny*. Structure:

```json
{
  "weteran": {
    "name": "Zgryzliwy weteran",
    "lines": {
      "kill":  { "spokojnie": ["No wreszcie."], "zle": ["..."], "dobrze": ["..."] },
      "death": { "spokojnie": ["Mowilem, zeby uciekac. Za kazdym razem."] }
    }
  }
}
```

Missing mood bucket falls back to `spokojnie`; missing category means they stay silent.

All user-facing text is **ASCII-folded Polish**, matching the rest of the client (`Mowilem`,
not `Mówiłem`). This is the existing convention in `arkadia-konfetti` and the client's own
scripts.

**Restraint rules** — all of these are requirements:

- Global cooldown, default **45 s**. A line that would violate it is dropped, never queued.
- Per-category cooldown, longer for common events.
- Per-category speech probability: rare events approach 100 % (death, max improve), common
  events sit low (kill ≈ 8 %). They should stay quiet through twenty kills and say something
  about the twenty-first.
- Global mute and per-category mutes, persisted.
- Animation is **not** gated by any of this. They always react visually; they rarely speak.

## Rendering

- One sheet per archetype, each trimmed to the frames the primitives actually use. Selection
  rule for any part: **if it covers the eyes, it is out.**
- The sprite sheets ship **bundled as data URIs** (esbuild `loader: { '.png': 'dataurl' }`),
  so there is no runtime fetch and no CORS surface. Bundle size needs checking once a real
  sheet is in hand; if it is uncomfortable, fall back to a trimmed sheet with only the frames
  actually used.
- Per-companion colour comes from **recolouring the sheet once at load** on an offscreen
  canvas, keyed by the Mixer's known palette, then caching the result.
- **Animation primitives**, each taking an intensity multiplier: `lunge`, `cheer`, `gulp`,
  `slump`, `glitter`, `flinch`, `topple`, `doze`, `sway`, `wince`, plus the always-running `idle` (breathing
  bob, periodic blink). Intensity scaling is what lets one small set of animations cover a
  hundred scripted actions — a small coin and a huge haul are the same `gulp` at different
  amplitudes.
- **Fallback:** if the sheet fails to load for any reason, fall back to a procedurally drawn
  pixel figure. The plugin must never render nothing.

### UI placement

- The chip is registered with
  `api.ui.registerFooterComponent('towarzysz', element)`, which returns a handle exposing
  `.element`, `.setContent()`, `.setVisible()` and `.remove()`.
- The bubble is **appended to `document.body`**, absolutely positioned against the chip's
  bounding rect, at **z-index ≈ 1105** — above popups (~1104), below the output context menu
  (10100). This is the same band `arkadia-konfetti` established for its overlay.
- The bubble is `pointer-events: none` and auto-hides after ~4 s.

## Commands and settings

A single alias, matching the konfetti pattern:

- `/towarzysz` — opens settings: mute toggles, voice override, cooldown, and the one-time
  reroll (behind a confirmation, since it is irreversible).
- `/towarzysz cisza` — quick global mute toggle.

## Licensing

Sprite assets are **CC-BY 4.0** and the Mixer's code is MIT. Attribution goes in `README.md`,
in `plugin.json`'s description, and in the `/towarzysz` settings panel, with a link back to
<https://kingbell.itch.io/pixel-sprite-mixer> as the author requests.

**No asset has been downloaded yet.** Acquiring a sheet is the first implementation step and
needs an explicit go-ahead.

## Error handling

| Failure | Behaviour |
|---------|-----------|
| Sprite sheet missing or corrupt | Procedural fallback figure; log once, never throw |
| `localStorage` unavailable or throwing | Run from in-memory state for the session |
| Persisted state fails to parse or has an unknown `version` | Reroll from the deterministic seed; the companion comes back identical |
| Character name not yet known at init | Defer the roll until `gmcp.char.info` arrives; chip shows a neutral placeholder |
| Voice pack missing a category | Silence, which is always a valid outcome |

Nothing in this plugin is allowed to throw into the client's event loop; every handler is
wrapped.

## Testing

`arkadia-konfetti` ships with typecheck only. This plugin has enough pure logic to justify
Vitest for the DOM-free modules:

- `roll.ts` — determinism: same seed gives the same spec; different `rerollsUsed` gives a
  different one; every generated spec is valid.
- `mood.ts` — clamping at both ends, decay half-life, bucket boundaries.
- `speak.ts` — cooldowns respected, mutes respected, probability honoured with a seeded RNG,
  missing categories return `null`.
- `bindings.ts` — every client event maps to a valid primitive and category.

Rendering and UI are verified by hand in the client.

## Deferred

- **Evolution / gear progression** — the companion gears up as the character does. Wants the Mixer's
  armour parts and a milestone ladder; a natural v2.
- **More voices** — trivial to add once the JSON contract exists; possibly community-authored.
- **A second companion** shown alongside — considered and dropped for footer space.
- **Reacting to guild or race** — `Char.Info.guild_occ` and `race` are available and could
  bias the roll so a mage's companion looks the part.

## Open questions

1. Repo and plugin name — `arkadia-towarzysz` / "Towarzysz" is a placeholder chosen to match
   the `arkadia-notatnik` / `arkadia-konfetti` naming. Trivial to change before first commit.
2. Which of the seven archetype sheets to pull first, and how many frames each needs to carry.
   Starting with two (one human-ish, one monstrous) would prove the roll without seven sets of assets.
3. Exact v1 event list. The bindings table below is the proposed starting set.

## Proposed v1 event bindings

| Client event | Primitive | Intensity | Category | Mood |
|---|---|---|---|---|
| `enemyKilled` / `kill` | `lunge` | scales with streak | `kill` | `+0.04` |
| `gmcp.char.state.improve` rises | `cheer` | 1 | `improve` | `+0.25` |
| `improve` reaches max (15) | `cheer` | 2.5 | `improveMax` | `+0.45` |
| `gmcp.char.state.hp` drops sharply | `flinch` | scales with loss | `hurt` | `−0.05` |
| death trigger | `topple` | 1 | `death` | `−0.35` |
| coin loot parsed | `gulp` | scales with amount | `loot` | `+0.15` |
| purchase / spend | `slump` | 1 | `spend` | `0` |
| `stoneValue` high | `glitter` | 2.2 | `gemGood` | `+0.10` |
| `stoneValue` low | `slump` | 1 | `gemBad` | `−0.02` |
| `gmcp.char.state.intox` (0..9) crosses a stage | `sway` | scales with the stage | `intox` | `+0.06`, `0` at the third |
| `gmcp.char.state.headache` (0..6) crosses a stage | `wince` | scales with the stage | `hangover` | `−0.08` .. `−0.16` |
| no input for 5 min (configurable) | `doze` | 1 | `idle` | `0` |

All of these already fire in the client; none requires new parsing.

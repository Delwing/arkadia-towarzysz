# Sprite sheets

Put one trimmed sheet per archetype here, with a spec next to it:

```
assets/sheets/goblin.png
assets/sheets/goblin.json
```

Then run `yarn embed-sheets` and commit the regenerated `render/sheets.ts`.

Archetypes: `magician`, `wizard`, `villager`, `monster`, `ogre`, `orc`, `goblin`.
Selection rule for any part: **if it covers the eyes, it is out.**

Spec shape (`goblin.json`):

```json
{
  "frameWidth": 32,
  "frameHeight": 32,
  "animations": {
    "idle":    { "row": 0, "frames": 2 },
    "lunge":   { "row": 1, "frames": 4 },
    "cheer":   { "row": 2, "frames": 4 },
    "gulp":    { "row": 3, "frames": 3 },
    "slump":   { "row": 4, "frames": 2 },
    "glitter": { "row": 5, "frames": 3 },
    "flinch":  { "row": 6, "frames": 3 },
    "topple":  { "row": 7, "frames": 4 },
    "doze":    { "row": 8, "frames": 2 }
  },
  "sourcePalette": {
    "skin":   ["#e0ac7e", "#c68e63", "#f1c9a5"],
    "hair":   ["#4a2c17", "#2b1b10"],
    "armour": ["#6b4a2a", "#4a3219"],
    "belt":   ["#3a2a1a"],
    "legs":   ["#3a2f2a", "#2a2220"],
    "weapon": ["#b0b8c0", "#7a828a"]
  }
}
```

`sourcePalette` lists the exact colours the Mixer used for each role; the first
one is the base tone, the rest are its shades. Every listed colour is swapped for
the companion's rolled colour at load, with the shade ratio preserved.

Assets are CC-BY 4.0 from KingBell's Pixel Art Sprite Mixer:
<https://kingbell.itch.io/pixel-sprite-mixer>. No sheet has been acquired yet;
until one lands here the plugin draws its procedural fallback figure.

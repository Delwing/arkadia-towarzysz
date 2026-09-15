import { describe, expect, it } from 'vitest';
import { ARCHETYPES, PRIMITIVES, type Archetype, type CompanionSpec } from '../companion/types';
import { PRIMITIVE_DEFS } from '../render/animator';
import { frameRect } from '../render/sheet';
import { ANIMATIONS, drawSheetPixels, FRAME_H, FRAME_W, SHEET_H, SHEET_W, type SheetPixels } from '../render/sprites';
import { roll } from '../companion/roll';

function spec(overrides: Partial<CompanionSpec> = {}): CompanionSpec {
  return {
    archetype: 'villager',
    name: 'Test',
    voiceId: 'maloomowny',
    palette: {
      skin: '#80c0ff',
      hair: '#ff0000',
      armour: '#00ff00',
      belt: '#0000ff',
      legs: '#ffff00',
      weapon: '#ff00ff',
    },
    parts: { hairLong: true, hasWeapon: true },
    ...overrides,
  };
}

function pixelAt(sheet: SheetPixels, x: number, y: number): [number, number, number, number] {
  const i = (y * sheet.width + x) * 4;
  return [sheet.data[i] as number, sheet.data[i + 1] as number, sheet.data[i + 2] as number, sheet.data[i + 3] as number];
}

/** Every distinct opaque colour on the sheet, as #rrggbb. */
function colours(sheet: SheetPixels): Set<string> {
  const seen = new Set<string>();
  for (let i = 0; i + 3 < sheet.data.length; i += 4) {
    if (sheet.data[i + 3] === 0) continue;
    seen.add(
      `#${[sheet.data[i], sheet.data[i + 1], sheet.data[i + 2]]
        .map((v) => (v as number).toString(16).padStart(2, '0'))
        .join('')}`,
    );
  }
  return seen;
}

function opaqueCount(sheet: SheetPixels): number {
  let n = 0;
  for (let i = 3; i < sheet.data.length; i += 4) if (sheet.data[i] !== 0) n++;
  return n;
}

/** The opaque pixels of one frame. */
function frameCount(sheet: SheetPixels, animation: keyof typeof ANIMATIONS, column: number): number {
  const { row } = ANIMATIONS[animation];
  let n = 0;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (pixelAt(sheet, column * FRAME_W + x, row * FRAME_H + y)[3] !== 0) n++;
    }
  }
  return n;
}

describe('ANIMATIONS', () => {
  it('has a row for every primitive, with the frame count the animator plays', () => {
    for (const primitive of PRIMITIVES) {
      expect(ANIMATIONS[primitive], primitive).toBeDefined();
      expect(ANIMATIONS[primitive].frames, primitive).toBe(PRIMITIVE_DEFS[primitive].frames);
    }
  });

  it('gives every animation its own row, and the sheet room for all of them', () => {
    const rows = Object.values(ANIMATIONS).map((a) => a.row);
    expect(new Set(rows).size).toBe(rows.length);
    expect(SHEET_H).toBe(rows.length * FRAME_H);
    expect(SHEET_W).toBe(Math.max(...Object.values(ANIMATIONS).map((a) => a.frames)) * FRAME_W);
  });
});

describe('drawSheetPixels', () => {
  it('fills a sheet of the declared size', () => {
    const sheet = drawSheetPixels(spec());
    expect(sheet.width).toBe(SHEET_W);
    expect(sheet.height).toBe(SHEET_H);
    expect(sheet.data.length).toBe(SHEET_W * SHEET_H * 4);
  });

  it('draws something in every frame of every animation, for every archetype', () => {
    for (const archetype of ARCHETYPES) {
      const sheet = drawSheetPixels(spec({ archetype }));
      for (const [name, animation] of Object.entries(ANIMATIONS)) {
        for (let column = 0; column < animation.frames; column++) {
          expect(frameCount(sheet, name as keyof typeof ANIMATIONS, column), `${archetype}.${name}[${column}]`).toBeGreaterThan(40);
        }
      }
    }
  });

  it('leaves the unused columns of a short animation empty', () => {
    const sheet = drawSheetPixels(spec());
    // `slump` has two frames on a four-column sheet.
    expect(frameCount(sheet, 'slump', 2)).toBe(0);
    expect(frameCount(sheet, 'slump', 3)).toBe(0);
  });

  it('is fully opaque or fully transparent, never in between', () => {
    const sheet = drawSheetPixels(spec());
    for (let i = 3; i < sheet.data.length; i += 4) {
      expect(sheet.data[i] === 0 || sheet.data[i] === 255).toBe(true);
    }
  });

  it('is deterministic for the same spec', () => {
    expect([...drawSheetPixels(spec()).data]).toEqual([...drawSheetPixels(spec()).data]);
  });

  it("paints in the companion's own colours, with no palette swap needed", () => {
    const found = colours(drawSheetPixels(spec()));
    expect(found).toContain('#80c0ff'); // skin
    expect(found).toContain('#ff0000'); // hair
    expect(found).toContain('#00ff00'); // armour
    expect(found).toContain('#0000ff'); // belt
    expect(found).toContain('#ffff00'); // legs
    expect(found).toContain('#ff00ff'); // weapon
  });

  it('draws different archetypes differently', () => {
    const seen = new Map<Archetype, string>();
    for (const archetype of ARCHETYPES) {
      seen.set(archetype, [...drawSheetPixels(spec({ archetype })).data].join(','));
    }
    expect(new Set(seen.values()).size).toBe(ARCHETYPES.length);
  });
});

describe('parts', () => {
  it('draws no weapon at all for a companion rolled without one', () => {
    const armed = drawSheetPixels(spec());
    const unarmed = drawSheetPixels(spec({ parts: { hairLong: true, hasWeapon: false }, palette: { ...spec().palette, weapon: null } }));
    expect(colours(armed)).toContain('#ff00ff');
    expect(colours(unarmed)).not.toContain('#ff00ff');
    expect(opaqueCount(unarmed)).toBeLessThan(opaqueCount(armed));
  });

  it('ignores a leftover weapon colour when the parts say there is no weapon', () => {
    // The palette can still carry a colour; `parts` is what decides.
    const sheet = drawSheetPixels(spec({ parts: { hairLong: true, hasWeapon: false } }));
    expect(colours(sheet)).not.toContain('#ff00ff');
  });

  it('adds long hair beside the face only when it was rolled', () => {
    const long = drawSheetPixels(spec({ parts: { hairLong: true, hasWeapon: true } }));
    const short = drawSheetPixels(spec({ parts: { hairLong: false, hasWeapon: true } }));
    expect(opaqueCount(long)).toBeGreaterThan(opaqueCount(short));
    // Column 4 beside the face, row 3 of the idle frame: hair when long, empty when not.
    expect(pixelAt(long, 4, 3)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(short, 4, 3)[3]).toBe(0);
  });

  it('leaves archetypes without a long-hair look unchanged', () => {
    const long = drawSheetPixels(spec({ archetype: 'goblin', parts: { hairLong: true, hasWeapon: true } }));
    const short = drawSheetPixels(spec({ archetype: 'goblin', parts: { hairLong: false, hasWeapon: true } }));
    expect([...long.data]).toEqual([...short.data]);
  });
});

describe('every rolled companion', () => {
  it('draws without throwing and fills its idle frame', () => {
    for (let i = 0; i < 300; i++) {
      const rolled = roll(`Postac${i}`, i % 2);
      const sheet = drawSheetPixels(rolled);
      expect(frameCount(sheet, 'idle', 0), `${rolled.archetype} ${rolled.name}`).toBeGreaterThan(40);
    }
  });
});

describe('frameRect', () => {
  const sheet = { frameWidth: FRAME_W, frameHeight: FRAME_H, animations: ANIMATIONS };

  it('walks the columns of the animation row', () => {
    expect(frameRect(sheet, 'lunge', 2)).toEqual({ x: 32, y: 16, width: 16, height: 16 });
  });

  it('wraps an index past the last frame', () => {
    expect(frameRect(sheet, 'slump', 3)).toEqual({ x: 16, y: 64, width: 16, height: 16 });
  });

  it('falls back to idle for an animation the sheet does not have', () => {
    expect(frameRect({ ...sheet, animations: { idle: ANIMATIONS.idle } }, 'glitter', 1)).toEqual({
      x: 16,
      y: 0,
      width: 16,
      height: 16,
    });
  });
});

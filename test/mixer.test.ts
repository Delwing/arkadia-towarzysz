import { describe, expect, it } from 'vitest';
import { ARCHETYPES, type Archetype, type CompanionSpec } from '../companion/types';
import { clipOf, PRIMITIVES, type Primitive } from '../render/animations';
import {
  drawMixerPixels,
  hasMixerArt,
  mixerAnimations,
  MIXER_CELL_H,
  MIXER_CELL_W,
  MIXER_FIGURE_H,
  recolour,
  unpack,
} from '../render/mixer';
import { MIXER_CLIPS, MIXER_FRAME_H, MIXER_FRAME_MS, MIXER_FRAME_W, MIXER_HEADS, MIXER_PALETTE, type MixerClip } from '../render/mixer-art';
import { PRIMITIVE_DEFS } from '../render/animator';
import { basePose, frameIndex } from '../render/pose';
import type { SheetPixels } from '../render/mixer';

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

/** Opaque pixels of one frame cell. */
function frameCount(sheet: SheetPixels, row: number, column: number): number {
  let n = 0;
  for (let y = 0; y < MIXER_FRAME_H; y++) {
    for (let x = 0; x < MIXER_FRAME_W; x++) {
      const i = ((row * MIXER_CELL_H + y) * sheet.width + (column * MIXER_CELL_W + x)) * 4;
      if (sheet.data[i + 3] !== 0) n++;
    }
  }
  return n;
}

describe('the baked art', () => {
  it('covers every archetype, so no companion falls back by accident', () => {
    for (const archetype of ARCHETYPES) expect(hasMixerArt(archetype), archetype).toBe(true);
  });

  it('covers every animation the animator can play', () => {
    // Its own row, or the row of the animation whose art it borrows: three of
    // them differ from another only in how long they run and what ends them.
    for (const primitive of PRIMITIVES) expect(MIXER_CLIPS[clipOf(primitive)], primitive).toBeDefined();
  });

  it('gives every clip its own row, and a figure to draw in it', () => {
    const animations = mixerAnimations();
    const rows = Object.values(animations).map((a) => a.row);
    expect(new Set(rows).size).toBe(rows.length);
    const sheet = drawMixerPixels(spec());
    for (const [name, animation] of Object.entries(animations)) {
      expect(animation.frames, name).toBeGreaterThan(0);
      // Per clip, not per frame: an effect like `warp` legitimately begins with
      // the companion almost gone, so a frame may be nearly empty.
      const biggest = Math.max(
        ...Array.from({ length: animation.frames }, (_, column) => frameCount(sheet, animation.row, column)),
      );
      expect(biggest, name).toBeGreaterThan(40);
    }
  });

  it('dresses every archetype', () => {
    for (const archetype of ARCHETYPES) expect(MIXER_HEADS[archetype], archetype).toBeDefined();
  });
});

describe('every animation against the art it plays', () => {
  it('reaches every frame of its clip, and none beyond it', () => {
    for (const primitive of PRIMITIVES) {
      if (primitive === 'idle') continue; // the animator drives that one; see animator.test.ts
      if (primitive === 'watch') continue; // half a clip on purpose; its own test is below
      const clip = MIXER_CLIPS[clipOf(primitive)];
      const def = PRIMITIVE_DEFS[primitive];
      const seen = new Set<number>();
      for (let t = 0; t <= 1; t += 0.002) {
        const { phase } = def.pose(t, 1, basePose()).frame;
        expect(phase, `${primitive} at ${t}`).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThan(1);
        seen.add(frameIndex(phase, (clip as MixerClip).frames.length));
      }
      // The bug this is here for: picking "frame 0 or 1 of 2" reaches phases 0
      // and 0.5, which on a four-frame clip is frames 0 and 2 and nothing else.
      expect([...seen].sort((a, b) => a - b), primitive).toEqual(
        Array.from({ length: (clip as MixerClip).frames.length }, (_, i) => i),
      );
    }
  });

  it('runs at the speed the art was drawn at, unless it means to outlast it', () => {
    // Anything that plays once should take exactly as long as its frames say.
    // `sway` and `wince` outlast their clips on purpose: a stagger is two rocks
    // of the wobble, and a headache has to last longer than being hit does.
    // Every stance outlasts its clip too: a posture is held for as long as the
    // thing it stands for lasts, and a loop that turns over three times a
    // second reads as a twitch rather than as waiting.
    const longer = new Set<Primitive>([
      'walk',
      'rest',
      'warp',
      'sway',
      'wince',
      'stun',
      'watch',
      'smoke',
      'shift',
      'cower',
    ]);
    for (const primitive of PRIMITIVES) {
      if (primitive === 'idle' || longer.has(primitive)) continue;
      const clip = MIXER_CLIPS[clipOf(primitive)] as MixerClip;
      expect(PRIMITIVE_DEFS[primitive].durationMs, primitive).toBe(MIXER_FRAME_MS * clip.frames.length);
    }
    // And the ones that do outlast it loop underneath rather than crawling.
    for (const primitive of longer) {
      const clip = MIXER_CLIPS[clipOf(primitive)] as MixerClip;
      expect(PRIMITIVE_DEFS[primitive].durationMs, primitive).toBeGreaterThan(MIXER_FRAME_MS * clip.frames.length);
    }
  });

  it('borrows art rather than asking for a row of its own', () => {
    expect(clipOf('stun')).toBe('wince');
    expect(clipOf('shift')).toBe('warp');
    expect(clipOf('watch')).toBe('rest');
    // An animation with art of its own says so by saying nothing.
    expect(clipOf('cheer')).toBe('cheer');
  });

  it('sits the watch on the seated frames of the rest, and never stands it up', () => {
    // `life_rest` is the whole business of getting down and up again: the
    // figure is on its feet for the first two frames and stands back up on the
    // last. A stance loops, so looping the lot would have the companion bob.
    const clip = MIXER_CLIPS[clipOf('watch')] as MixerClip;
    const seen = new Set<number>();
    for (let t = 0; t <= 1; t += 0.002) {
      const { phase } = PRIMITIVE_DEFS.watch.pose(t, 1, basePose()).frame;
      seen.add(frameIndex(phase, clip.frames.length));
    }
    const seated = Array.from({ length: clip.frames.length - 3 }, (_, i) => i + 2);
    expect([...seen].sort((a, b) => a - b)).toEqual(seated);
  });

  it('takes the pipe down and back up again, smoking only in between', () => {
    // A lit pipe travels: the companion marks it and gets up, rather than
    // being sat down for the quarter of an hour it burns. So unlike the
    // fishing stance this plays the whole clip - down, sitting, up - and the
    // puff is what tells the two apart. A companion who streamed smoke
    // without pause would be on fire rather than smoking.
    const clip = MIXER_CLIPS[clipOf('smoke')] as MixerClip;
    const frame = (t: number) => frameIndex(PRIMITIVE_DEFS.smoke.pose(t, 1, basePose()).frame.phase, clip.frames.length);
    expect(frame(0)).toBe(0);
    expect(frame(0.5)).toBeGreaterThan(1);
    expect(frame(0.5)).toBeLessThan(clip.frames.length - 1);
    expect(frame(0.999)).toBe(clip.frames.length - 1);

    let most = 0;
    for (let t = 0; t <= 1; t += 0.002) most = Math.max(most, PRIMITIVE_DEFS.smoke.pose(t, 1, basePose()).puff);
    expect(most).toBeGreaterThan(0.9);
    // No smoke on the way down or on the way up, and none from anything else.
    expect(PRIMITIVE_DEFS.smoke.pose(0.02, 1, basePose()).puff).toBe(0);
    expect(PRIMITIVE_DEFS.smoke.pose(0.95, 1, basePose()).puff).toBe(0);
    expect(PRIMITIVE_DEFS.watch.pose(0.5, 1, basePose()).puff).toBe(0);
    expect(PRIMITIVE_DEFS.rest.pose(0.5, 1, basePose()).puff).toBe(0);
  });
});

describe('unpack', () => {
  it('round-trips a run-length frame', () => {
    // Three of colour 1, two of colour 0, one of colour 4.
    const packed = btoa(String.fromCharCode(3, 1, 2, 0, 1, 4));
    expect([...unpack(packed, 6)]).toEqual([1, 1, 1, 0, 0, 4]);
  });

  it('stops at the frame it was given, however long the runs claim to be', () => {
    const packed = btoa(String.fromCharCode(255, 7));
    expect(unpack(packed, 4)).toHaveLength(4);
    expect([...unpack(packed, 4)]).toEqual([7, 7, 7, 7]);
  });

  it('gives an empty frame rather than throwing on rubbish', () => {
    expect([...unpack('!!!not base64!!!', 3)]).toEqual([0, 0, 0]);
    expect([...unpack('', 3)]).toEqual([0, 0, 0]);
  });
});

describe('recolour', () => {
  it('leaves the transparent slot empty and fills every other one', () => {
    const colours = recolour(spec());
    expect(colours[0]).toBeNull();
    for (let i = 1; i < MIXER_PALETTE.length; i++) expect(colours[i], MIXER_PALETTE[i]).not.toBeNull();
  });

  it("paints the rolled palette over the source's colours", () => {
    const found = colours(drawMixerPixels(spec()));
    expect(found).toContain('#80c0ff'); // skin
    expect(found).toContain('#00ff00'); // armour
  });

  it('paints a head item in the rolled hair colour', () => {
    // The tool's `item` slot is whatever sits on the head, so the roll's hair
    // decides a hat's colour. Which slots a head uses is the artist's choice -
    // horns are drawn as skin, a helmet as clothing - so this asks the one that
    // is a plain hat.
    const bare = colours(drawMixerPixels(spec({ archetype: 'goblin' })));
    const hatted = colours(drawMixerPixels(spec({ archetype: 'villager' })));
    expect(hatted).toContain('#ff0000');
    expect(bare).not.toContain('#ff0000');
  });

  it('keeps the outline black whatever the roll', () => {
    expect(colours(drawMixerPixels(spec()))).toContain('#0b0b0b');
  });
});

describe('drawMixerPixels', () => {
  it('fills a sheet sized by the clips it holds', () => {
    const sheet = drawMixerPixels(spec());
    const columns = Math.max(...Object.values(MIXER_CLIPS).map((c) => c.frames.length));
    expect(sheet.width).toBe(columns * MIXER_CELL_W);
    expect(sheet.height).toBe(Object.keys(MIXER_CLIPS).length * MIXER_CELL_H);
    expect(sheet.data.length).toBe(sheet.width * sheet.height * 4);
  });

  it('is deterministic for the same spec', () => {
    expect([...drawMixerPixels(spec()).data]).toEqual([...drawMixerPixels(spec()).data]);
  });

  it('is fully opaque or fully transparent, never in between', () => {
    const sheet = drawMixerPixels(spec());
    for (let i = 3; i < sheet.data.length; i += 4) expect(sheet.data[i] === 0 || sheet.data[i] === 255).toBe(true);
  });

  it('puts the head on at the offset the tool gives, not at a fixed spot', () => {
    // `base_die` sinks the head from 0 to 7 over its four frames; a sheet that
    // ignored the table would have the hat in the same place in all of them.
    const offsets = MIXER_CLIPS.die?.headOffsets ?? [];
    expect(new Set(offsets).size, 'die head offsets').toBeGreaterThan(1);
    const sheet = drawMixerPixels(spec({ archetype: 'magician' }));
    const row = mixerAnimations().die?.row ?? 0;
    const topRow = (column: number) => {
      for (let y = 0; y < MIXER_FRAME_H; y++) {
        for (let x = 0; x < MIXER_FRAME_W; x++) {
          if (sheet.data[((row * MIXER_CELL_H + y) * sheet.width + (column * MIXER_CELL_W + x)) * 4 + 3] !== 0) return y;
        }
      }
      return MIXER_FRAME_H;
    };
    expect(topRow(3)).toBeGreaterThan(topRow(0));
  });

  it('draws the archetypes differently from one another', () => {
    const seen = new Map<Archetype, string>();
    for (const archetype of ARCHETYPES) seen.set(archetype, [...drawMixerPixels(spec({ archetype })).data].join(','));
    // villager is the bare body; every archetype that carries a layer differs.
    expect(new Set(seen.values()).size).toBeGreaterThan(1);
  });

  it('leaves the gutter between frames transparent', () => {
    const sheet = drawMixerPixels(spec());
    for (let y = 0; y < sheet.height; y++) {
      const i = ((y + 1) * sheet.width - 1) * 4; // last column of the sheet is gutter
      expect(sheet.data[i + 3]).toBe(0);
    }
  });

  it('draws at the size it was drawn', () => {
    // 16x24 cells, shown one sprite pixel to one chip pixel: no scaling, so
    // nothing to blur and no half-pixels to line up.
    expect(MIXER_FIGURE_H).toBe(MIXER_FRAME_H);
    expect(MIXER_FRAME_W).toBe(16);
    expect(MIXER_FRAME_H).toBe(24);
  });
});

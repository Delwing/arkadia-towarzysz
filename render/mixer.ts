/**
 * The Mixer art at runtime: unpack what `tools/mixer.mjs` baked, put the
 * archetype's head on each frame where the tool's own table says it goes, paint
 * the companion's rolled colours into the key-colour slots, and hand back the
 * pixel buffer `render/sheet.ts` turns into a canvas.
 *
 * These are the same three steps the Sprite Mixer itself does (`blitAll`, then
 * `recolor`), which is why there is nothing clever here: the art is drawn in key
 * colours and the offsets are data, so composing a companion is a copy and a
 * lookup.
 *
 * Pure - no DOM, no canvas - so it is unit tested like the rest.
 *
 * Art: KingBell's Pixel Art Sprite Mixer (CC-BY 4.0), credited in README.md and
 * in DESCRIPTION.md, which is what the registry shows.
 */

import type { Archetype, CompanionSpec, Palette } from '../companion/types';
import { hexToRgb, shadeRgb, type Rgb } from './colour';
import { MIXER_CLIPS, MIXER_FRAME_H, MIXER_FRAME_W, MIXER_HEADS, MIXER_PALETTE } from './mixer-art';
import type { SheetAnimation } from './animations';

/** A sheet as plain pixels: RGBA, row-major, fully opaque or fully transparent. */
export interface SheetPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** One transparent row and column between frames; the chip scales, and scaling samples neighbours. */
export const MIXER_PAD = 1;
export const MIXER_CELL_W = MIXER_FRAME_W + MIXER_PAD;
export const MIXER_CELL_H = MIXER_FRAME_H + MIXER_PAD;

/** The art is drawn at the size it is drawn at: one sprite pixel, one chip pixel. */
export const MIXER_FIGURE_H = MIXER_FRAME_H;

/**
 * The tool's spare slot, and what it holds in the frames we use: the sword of a
 * swing, the soul leaving a body, the skull left behind. All three belong in
 * front of whatever the companion is wearing, so they are put back over the head
 * layer after it is drawn - otherwise a hat brim clips the soul on its way up.
 */
const EFFECT_SLOTS = new Set(
  ['more', 'more2'].map((slot) => MIXER_PALETTE.indexOf(slot)).filter((index) => index > 0),
);

function toRgb(hex: string): Rgb {
  return hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
}

/**
 * Which rolled colour fills each of the tool's key-colour slots.
 *
 * Their vocabulary is body / suit / item / more, each with a darker second
 * tone, plus eyes and the outline. Ours is a rolled `Palette`, so: the suit is
 * what the companion wears, and the item is whatever sits on their head, which
 * is why the roll's hair colour decides a hat's colour.
 *
 * `more` is their spare slot, and in the frames we use it is the sword of a
 * swing, the soul leaving a body and the skull left behind. It stays a fixed
 * pale tone rather than following the roll: a soul rising off a companion whose
 * colours happen to be brown would be a brown bubble on a brown body, and the
 * one thing these frames have to do is read at a glance.
 */
const EFFECT: Rgb = { r: 0xc6, g: 0xdc, b: 0xc8 };
const EFFECT_DARK: Rgb = { r: 0x8a, g: 0xa8, b: 0x92 };
function slotColour(slot: string, palette: Palette): Rgb | null {
  switch (slot) {
    case 'skin':
      return toRgb(palette.skin);
    case 'skin2':
      return shadeRgb(palette.skin, 0.8);
    case 'suit':
      return toRgb(palette.armour);
    case 'suit2':
      return shadeRgb(palette.armour, 0.65);
    case 'item':
      return toRgb(palette.hair);
    case 'item2':
      return shadeRgb(palette.hair, 0.7);
    case 'more':
      return EFFECT;
    case 'more2':
      return EFFECT_DARK;
    case 'eyes':
      // Left alone: a companion whose eyes matched their trousers would read as a doll.
      return { r: 0xf1, g: 0xdd, b: 0x9e };
    case 'outline':
      return { r: 0x0b, g: 0x0b, b: 0x0b };
    default:
      return null;
  }
}

/** One colour per palette entry, for this companion. Index 0 stays transparent. */
export function recolour(spec: CompanionSpec): (Rgb | null)[] {
  return MIXER_PALETTE.map((entry, index) => {
    if (index === 0) return null;
    // `#rrggbb` is a highlight the artist fixed; anything else names a slot.
    if (entry.startsWith('#')) return toRgb(entry);
    return slotColour(entry, spec.palette) ?? toRgb(entry);
  });
}

/** Unpack one run-length frame into palette indices. Never throws on a short or long run. */
export function unpack(packed: string, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  let at = 0;
  let bytes: string;
  try {
    bytes = atob(packed);
  } catch {
    return out;
  }
  for (let i = 0; i + 1 < bytes.length && at < pixels; i += 2) {
    const count = bytes.charCodeAt(i);
    const index = bytes.charCodeAt(i + 1);
    const end = Math.min(pixels, at + count);
    while (at < end) out[at++] = index;
  }
  return out;
}

/**
 * How many heads the bake carries for an archetype. The roll needs the count -
 * it picks one of them - and the art is the only place that knows it.
 */
export function headVariants(archetype: Archetype): number {
  return MIXER_HEADS[archetype]?.length ?? 0;
}

/**
 * The head a companion wears. The rolled index is taken modulo what the bake
 * carries, so a head list that shrinks leaves nobody bald.
 */
function headFor(spec: CompanionSpec): { packed: string; index: number } | null {
  const heads = MIXER_HEADS[spec.archetype];
  if (!heads || heads.length === 0) return null;
  const at = Math.abs(Math.trunc(spec.parts.head)) % heads.length;
  return heads[at] ?? null;
}

/** Whether the bake dressed this archetype. Nothing else should guess. */
export function hasMixerArt(archetype: Archetype): boolean {
  return Object.prototype.hasOwnProperty.call(MIXER_HEADS, archetype);
}

/** The clips the bake carries, as sheet rows in declaration order. */
export function mixerAnimations(): Record<string, SheetAnimation> {
  const animations: Record<string, SheetAnimation> = {};
  let row = 0;
  for (const [name, clip] of Object.entries(MIXER_CLIPS)) {
    animations[name] = { row, frames: clip.frames.length };
    row++;
  }
  return animations;
}

/**
 * Build one companion's sheet: every clip a row, every frame a cell, their head
 * on each frame where the tool says it belongs, all in the rolled colours.
 */
export function drawMixerPixels(spec: CompanionSpec): SheetPixels {
  const clips = Object.entries(MIXER_CLIPS);
  const columns = Math.max(1, ...clips.map(([, clip]) => clip.frames.length));
  const width = columns * MIXER_CELL_W;
  const height = clips.length * MIXER_CELL_H;
  const sheet: SheetPixels = { width, height, data: new Uint8ClampedArray(width * height * 4) };

  const colours = recolour(spec);
  const pixels = MIXER_FRAME_W * MIXER_FRAME_H;
  const head = headFor(spec);
  const headPixels = head ? unpack(head.packed, pixels) : null;

  clips.forEach(([, clip], row) => {
    clip.frames.forEach((packed, column) => {
      const frame = unpack(packed, pixels);
      // Their table decides where the head goes. An offset past the bottom of
      // the cell - which is how `re_warp` hides it while the companion is gone -
      // simply lands nowhere.
      const offset = clip.headOffsets[column] ?? 0;
      if (headPixels) {
        for (let y = 0; y < MIXER_FRAME_H; y++) {
          const ty = y + offset;
          if (ty < 0 || ty >= MIXER_FRAME_H) continue;
          for (let x = 0; x < MIXER_FRAME_W; x++) {
            const value = headPixels[y * MIXER_FRAME_W + x];
            if (!value) continue;
            const at = ty * MIXER_FRAME_W + x;
            // An effect stays in front of the hat; everything else the head covers.
            if (EFFECT_SLOTS.has(frame[at] as number)) continue;
            frame[at] = value as number;
          }
        }
      }
      const originX = column * MIXER_CELL_W;
      const originY = row * MIXER_CELL_H;
      for (let y = 0; y < MIXER_FRAME_H; y++) {
        for (let x = 0; x < MIXER_FRAME_W; x++) {
          const colour = colours[frame[y * MIXER_FRAME_W + x] as number];
          if (!colour) continue;
          const at = ((originY + y) * width + (originX + x)) * 4;
          sheet.data[at] = colour.r;
          sheet.data[at + 1] = colour.g;
          sheet.data[at + 2] = colour.b;
          sheet.data[at + 3] = 255;
        }
      }
    });
  });
  return sheet;
}

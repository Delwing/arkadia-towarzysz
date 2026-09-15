/**
 * The one place the sprite sheet needs a canvas: `render/sprites.ts` draws a
 * companion's frames as a pixel buffer, this puts that buffer on an offscreen
 * canvas the chip can `drawImage` from.
 *
 * There is no sheet file, no fetch and no recolour pass. The sheet is built
 * from the spec whenever a companion is loaded or rerolled - a handful of
 * times per session - and the pixels come out in the companion's own colours,
 * with a weapon or long hair only if they were rolled with them.
 *
 * `frameRect` is pure, so it is tested with the rest.
 */

import type { CompanionSpec } from '../companion/types';
import { ANIMATIONS, drawSheetPixels, FRAME_H, FRAME_W, type SheetAnimation } from './sprites';

export interface LoadedSheet {
  image: CanvasImageSource;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, SheetAnimation>;
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a frame sits on the sheet; unknown animations fall back to `idle`, then to frame 0,0. */
export function frameRect(
  sheet: Pick<LoadedSheet, 'frameWidth' | 'frameHeight' | 'animations'>,
  animation: string,
  index: number,
): FrameRect {
  const anim = sheet.animations[animation] ?? sheet.animations.idle;
  const row = anim?.row ?? 0;
  const frames = Math.max(1, anim?.frames ?? 1);
  const column = ((Math.floor(index) % frames) + frames) % frames;
  return { x: column * sheet.frameWidth, y: row * sheet.frameHeight, width: sheet.frameWidth, height: sheet.frameHeight };
}

/**
 * Build this companion's sheet. Throws if there is no usable canvas; the
 * caller falls back to the procedural figure and must never let this throw
 * further.
 */
export function buildSheet(spec: CompanionSpec): LoadedSheet {
  const pixels = drawSheetPixels(spec);
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const image = ctx.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  ctx.putImageData(image, 0, 0);
  return { image: canvas, frameWidth: FRAME_W, frameHeight: FRAME_H, animations: ANIMATIONS };
}

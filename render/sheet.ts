/**
 * The one place the sprite sheet needs a canvas: `render/sprites.ts` draws a
 * companion's frames as a pixel buffer, this puts that buffer on an offscreen
 * canvas the chip can `drawImage` from.
 *
 * There is no sheet file, no fetch and no recolour pass. The sheet is built
 * from the spec whenever a companion is loaded or rerolled - a handful of
 * times per session - and the pixels come out in the companion's own colours,
 * carrying a weapon only if one was rolled.
 *
 * `frameRect` is pure, so it is tested with the rest.
 */

import type { CompanionSpec } from '../companion/types';
import { frameIndex } from './pose';
import type { SheetAnimation } from './animations';
import { drawMixerPixels, mixerAnimations, MIXER_CELL_H, MIXER_CELL_W, MIXER_FIGURE_H } from './mixer';
import { MIXER_FRAME_H, MIXER_FRAME_W } from './mixer-art';

export interface LoadedSheet {
  image: CanvasImageSource;
  frameWidth: number;
  frameHeight: number;
  /** Distance between two frames, which is the frame plus its gutter. */
  cellWidth: number;
  cellHeight: number;
  /**
   * How tall the figure should be drawn, in chip pixels. The drawn art is 16
   * and the Mixer's is 48 at source; this is what the chip scales a frame to,
   * so a taller sheet shows up bigger rather than filling the chip.
   */
  figureHeight: number;
  animations: Record<string, SheetAnimation>;
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a frame sits on the sheet. `phase` is the animation's progress in
 * [0, 1), which this resolves against however many frames *this* sheet carries
 * - the drawn sheet and a Mixer sheet rarely agree on that. Unknown animations
 * fall back to `idle`, then to frame 0,0.
 */
export function frameRect(
  sheet: Pick<LoadedSheet, 'frameWidth' | 'frameHeight' | 'animations'> & Partial<Pick<LoadedSheet, 'cellWidth' | 'cellHeight'>>,
  animation: string,
  phase: number,
): FrameRect {
  const anim = sheet.animations[animation] ?? sheet.animations.idle;
  const row = anim?.row ?? 0;
  const frames = Math.max(1, anim?.frames ?? 1);
  const column = frameIndex(phase, frames);
  // The step between frames is the cell; the rect itself is the frame inside it.
  const stepX = sheet.cellWidth ?? sheet.frameWidth;
  const stepY = sheet.cellHeight ?? sheet.frameHeight;
  return { x: column * stepX, y: row * stepY, width: sheet.frameWidth, height: sheet.frameHeight };
}

/**
 * Build this companion's sheet. Throws if there is no usable canvas; the
 * caller falls back to the procedural figure and must never let this throw
 * further.
 */
export function buildSheet(spec: CompanionSpec): LoadedSheet {
  const pixels = drawMixerPixels(spec);
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const image = ctx.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  ctx.putImageData(image, 0, 0);
  return {
    image: canvas,
    frameWidth: MIXER_FRAME_W,
    frameHeight: MIXER_FRAME_H,
    cellWidth: MIXER_CELL_W,
    cellHeight: MIXER_CELL_H,
    figureHeight: MIXER_FIGURE_H,
    animations: mixerAnimations(),
  };
}

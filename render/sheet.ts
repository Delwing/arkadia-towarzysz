/**
 * Sprite sheet loading, palette recolour, frame extraction.
 *
 * One sheet per archetype, each a grid of `frameWidth` x `frameHeight` cells;
 * every animation is one row. Per-companion colour comes from recolouring the
 * whole sheet once at load on an offscreen canvas, keyed by the sheet's known
 * source palette, and caching the result.
 *
 * Only `loadSheet` touches the DOM (an Image and a canvas). `recolourPixels`
 * and `frameRect` are pure so they can be tested.
 */

import type { Palette } from '../companion/types';

export type PaletteRole = keyof Palette;

export interface SheetAnimation {
  /** Row index in the grid. */
  row: number;
  frames: number;
}

export interface SheetSpec {
  /** A data URI (bundled) - never a URL, there are no runtime fetches. */
  src: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, SheetAnimation>;
  /**
   * The source colours to swap, per role, as `#rrggbb`. The first entry of each
   * list is the base tone; the others are its shades, and are recoloured
   * relative to it so shading survives the swap.
   */
  sourcePalette: Partial<Record<PaletteRole, string[]>>;
}

export interface LoadedSheet {
  image: CanvasImageSource;
  frameWidth: number;
  frameHeight: number;
  animations: Record<string, SheetAnimation>;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1] as string, 16), g: parseInt(m[2] as string, 16), b: parseInt(m[3] as string, 16) };
}

function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

interface Swap {
  target: Rgb;
  /** Multiplier that carries the source shade's relative brightness onto the target. */
  ratio: number;
}

/** Build the exact-colour lookup: source rgb key -> target colour with shading ratio. */
export function buildSwapTable(sourcePalette: SheetSpec['sourcePalette'], palette: Palette): Map<number, Swap> {
  const table = new Map<number, Swap>();
  for (const role of Object.keys(sourcePalette) as PaletteRole[]) {
    const targetHex = palette[role];
    const sources = sourcePalette[role];
    if (!targetHex || !sources || sources.length === 0) continue;
    const target = hexToRgb(targetHex);
    const base = hexToRgb(sources[0] as string);
    if (!target || !base) continue;
    const baseLum = Math.max(1, luminance(base));
    for (const hex of sources) {
      const rgb = hexToRgb(hex);
      if (!rgb) continue;
      table.set((rgb.r << 16) | (rgb.g << 8) | rgb.b, { target, ratio: luminance(rgb) / baseLum });
    }
  }
  return table;
}

/** Recolour RGBA pixels in place. Pixels that are not in the table are left alone. */
export function recolourPixels(data: Uint8ClampedArray, table: Map<number, Swap>): void {
  for (let i = 0; i + 3 < data.length; i += 4) {
    if ((data[i + 3] as number) === 0) continue;
    const key = ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
    const swap = table.get(key);
    if (!swap) continue;
    data[i] = clamp255(swap.target.r * swap.ratio);
    data[i + 1] = clamp255(swap.target.g * swap.ratio);
    data[i + 2] = clamp255(swap.target.b * swap.ratio);
  }
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a frame sits on the sheet; unknown animations fall back to `idle`, then to frame 0,0. */
export function frameRect(sheet: Pick<LoadedSheet, 'frameWidth' | 'frameHeight' | 'animations'>, animation: string, index: number): FrameRect {
  const anim = sheet.animations[animation] ?? sheet.animations.idle;
  const row = anim?.row ?? 0;
  const frames = Math.max(1, anim?.frames ?? 1);
  const column = ((Math.floor(index) % frames) + frames) % frames;
  return { x: column * sheet.frameWidth, y: row * sheet.frameHeight, width: sheet.frameWidth, height: sheet.frameHeight };
}

const cache = new Map<string, Promise<LoadedSheet>>();

function cacheKey(spec: SheetSpec, palette: Palette): string {
  return `${spec.src.length}:${spec.src.slice(-32)}|${palette.skin}|${palette.hair}|${palette.armour}|${palette.belt}|${palette.legs}|${palette.weapon ?? '-'}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolvePromise, reject) => {
    const image = new Image();
    image.onload = () => resolvePromise(image);
    image.onerror = () => reject(new Error('sprite sheet failed to decode'));
    image.src = src;
  });
}

/**
 * Load and recolour a sheet. Rejects on any failure; the caller falls back to
 * the procedural figure and must never let this throw further.
 */
export function loadSheet(spec: SheetSpec, palette: Palette): Promise<LoadedSheet> {
  const key = cacheKey(spec, palette);
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<LoadedSheet> => {
    if (!spec.src.startsWith('data:image/')) throw new Error('sprite sheet must be a bundled data URI');
    const image = await loadImage(spec.src);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d context unavailable');
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    recolourPixels(imageData.data, buildSwapTable(spec.sourcePalette, palette));
    ctx.putImageData(imageData, 0, 0);
    return { image: canvas, frameWidth: spec.frameWidth, frameHeight: spec.frameHeight, animations: spec.animations };
  })();

  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

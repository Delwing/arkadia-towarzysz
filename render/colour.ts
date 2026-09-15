/**
 * Colour helpers shared by the sprite generator and the procedural fallback.
 * Pure, no DOM.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export function hexToRgb(hex: string): Rgb | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1] as string, 16), g: parseInt(m[2] as string, 16), b: parseInt(m[3] as string, 16) };
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Multiply a colour's channels, for a shade (factor < 1) or a highlight (factor > 1). */
export function shade(hex: string, factor: number): string {
  const m = HEX.exec(hex);
  if (!m) return hex;
  const to = (s: string) =>
    clamp255(parseInt(s, 16) * factor)
      .toString(16)
      .padStart(2, '0');
  return `#${to(m[1] as string)}${to(m[2] as string)}${to(m[3] as string)}`;
}

/** Same as `shade`, straight to rgb - what the pixel buffer wants. */
export function shadeRgb(hex: string, factor: number): Rgb {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  return { r: clamp255(rgb.r * factor), g: clamp255(rgb.g * factor), b: clamp255(rgb.b * factor) };
}

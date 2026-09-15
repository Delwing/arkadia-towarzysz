/**
 * One still picture of the companion, on a canvas: who they are, how the day
 * is going and what you have been through together, in something you can paste
 * into a chat. The card's own contents, drawn rather than laid out.
 *
 * The client does this in several places ("Kopiuj jako obraz" in Postepy, on
 * the map, in the log browser) and always the same way: draw a canvas, then
 * hand `clipboard.write` a `ClipboardItem` holding a `Promise<Blob>` so the
 * write itself happens inside the click. Plugins cannot reach that helper
 * (`src/shared/dom/copyCanvasToClipboard.ts`), so this is the same shape of
 * thing, kept to what a plugin has.
 *
 * Everything here is `document`-bound, so it lives with the rest of `ui/` and
 * is verified by eye in the showcase rather than in a test.
 */

import type { PersistedState } from '../companion/types';
import { bucketLabel } from '../companion/mood';
import { temperLabel } from '../companion/temper';
import { voiceName } from '../voice/catalog';
import { frameRect, type LoadedSheet } from '../render/sheet';
import { properName } from '../text/properName';
import { ARCHETYPE_LABELS } from './card';

/** The card inside the picture, in logical pixels. */
export const PICTURE_W = 344;
export const PICTURE_H = 170;
/**
 * Transparent air around the card, on every side. Chats round the corners of
 * the images they show, and they round the file rather than a frame around it,
 * so a card drawn edge to edge arrives in Discord with its corners bitten off.
 * The margin gives that rounding something to eat that nobody will miss, and
 * the card keeps a corner of its own inside it, so the shape is one we chose.
 */
export const PICTURE_MARGIN = 12;
/** The card's own corner, comfortably inside the margin. */
const PICTURE_RADIUS = 8;
/**
 * Device pixels per logical pixel. The text wants more than one and the sprite
 * wants a whole number, so this multiplies the sprite's own scale rather than
 * fighting it.
 */
export const PICTURE_SCALE = 2;
/** How many picture pixels one sprite pixel becomes. */
export const PICTURE_FIGURE_SCALE = 5;

/** Ours, and the bubble's: the companion speaks out of the same palette. */
const INK = '#ece2c8';
const PAPER = '#1b1710';
const EDGE = '#6b5a3a';
const SERIF = 'Georgia, "EB Garamond", serif';

export interface PictureView {
  /** Whose companion this is; it goes in the corner. */
  characterName: string;
  state: PersistedState;
  /** The decayed mood, as the card shows it. */
  mood: number;
}

export type PictureOutcome = 'copied' | 'saved';

/**
 * Draw the picture. `doc` is the document the canvas belongs to, which is the
 * one the click came from: the card can be in a popped-out window, and only
 * the focused document may touch the clipboard.
 */
export function drawCompanionPicture(view: PictureView, sheet: LoadedSheet | null, doc: Document = document): HTMLCanvasElement {
  const canvas = doc.createElement('canvas');
  canvas.width = (PICTURE_W + PICTURE_MARGIN * 2) * PICTURE_SCALE;
  canvas.height = (PICTURE_H + PICTURE_MARGIN * 2) * PICTURE_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.scale(PICTURE_SCALE, PICTURE_SCALE);
  // Everything after this draws the card from its own corner; the translate is
  // the only line that knows the margin is there.
  ctx.translate(PICTURE_MARGIN, PICTURE_MARGIN);
  ctx.textBaseline = 'alphabetic';

  const { state } = view;
  const pad = 12;

  // The card, and its edge.
  ctx.fillStyle = PAPER;
  cardPath(ctx, 0, 0, PICTURE_W, PICTURE_H, PICTURE_RADIUS);
  ctx.fill();
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  cardPath(ctx, 0.5, 0.5, PICTURE_W - 1, PICTURE_H - 1, PICTURE_RADIUS - 0.5);
  ctx.stroke();

  // The alcove the companion stands in: the full height bar the line at the
  // bottom, because the figure is 120 picture pixels tall and the picture is
  // only as tall as it has to be.
  const alcove = { x: pad, y: 8, w: 104, h: 132 };
  ctx.fillStyle = 'rgba(236, 226, 200, .06)';
  ctx.fillRect(alcove.x, alcove.y, alcove.w, alcove.h);
  ctx.strokeStyle = 'rgba(236, 226, 200, .18)';
  ctx.strokeRect(alcove.x + 0.5, alcove.y + 0.5, alcove.w - 1, alcove.h - 1);
  drawFigure(ctx, sheet, alcove);

  const left = alcove.x + alcove.w + 14;
  const width = PICTURE_W - left - pad;

  ctx.fillStyle = INK;
  ctx.font = `700 19px ${SERIF}`;
  ctx.fillText(clip(ctx, state.spec.name, width), left, 30);

  ctx.globalAlpha = 0.85;
  ctx.font = `12px ${SERIF}`;
  ctx.fillText(clip(ctx, ARCHETYPE_LABELS[state.spec.archetype], width), left, 46);
  ctx.globalAlpha = 0.7;
  ctx.font = `11px ${SERIF}`;
  const voice = voiceName(state.settings.voiceOverride ?? state.spec.voiceId).toLowerCase();
  ctx.fillText(clip(ctx, `mowi jak ${voice}`, width), left, 60);

  ctx.globalAlpha = 0.85;
  ctx.font = `11px ${SERIF}`;
  ctx.fillText(clip(ctx, `Nastroj: ${bucketLabel(view.mood)}`, width), left, 82);
  drawMoodBar(ctx, { x: left, y: 87, w: Math.min(width, 176), h: 6 }, view.mood, state.temper.resting);
  ctx.globalAlpha = 0.7;
  ctx.font = `10px ${SERIF}`;
  ctx.fillText(clip(ctx, `Dzis: ${temperLabel(state.temper.resting)}`, width), left, 105);

  drawStats(ctx, left, 131, width, state);

  // The bottom line: whose companion this is and since when. Flatly, and in
  // that order - "X i Y, razem od" read like an anniversary, and the character
  // name cannot be declined into anything better without guessing at its case.
  ctx.globalAlpha = 0.55;
  ctx.font = `9px ${SERIF}`;
  ctx.fillText(`towarzysz postaci ${properName(view.characterName)} od ${metDate(state)}`, pad, PICTURE_H - 9);
  ctx.globalAlpha = 1;

  return canvas;
}

/** A rounded rectangle as a fresh path; `roundRect` is not everywhere yet. */
function cardPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The companion themselves, standing: `idle`'s first frame, drawn at a whole
 * number of picture pixels per sprite pixel and with the smoothing off, or the
 * pixels stop being pixels.
 */
function drawFigure(
  ctx: CanvasRenderingContext2D,
  sheet: LoadedSheet | null,
  alcove: { x: number; y: number; w: number; h: number },
): void {
  if (!sheet) return;
  const rect = frameRect(sheet, 'idle', 0);
  const scale = PICTURE_FIGURE_SCALE;
  const width = rect.width * scale;
  const height = rect.height * scale;
  const x = Math.round(alcove.x + (alcove.w - width) / 2);
  // Feet on a floor line a little above the bottom of the alcove.
  const y = Math.round(alcove.y + alcove.h - 6 - height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.image, rect.x, rect.y, rect.width, rect.height, x, y, width, height);
  ctx.imageSmoothingEnabled = true;
  // The ground they are standing on, so they are not floating in a box.
  ctx.fillStyle = 'rgba(236, 226, 200, .18)';
  ctx.fillRect(alcove.x + 12, y + height, alcove.w - 24, 1);
}

/**
 * The mood, from the middle out, the way the card draws it: left of centre is
 * grim, right is cheerful, and the bright mark is where the day is pulling.
 */
function drawMoodBar(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  mood: number,
  resting: number,
): void {
  const value = Math.max(-1, Math.min(1, mood));
  const middle = box.x + box.w / 2;
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = INK;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.globalAlpha = 0.55;
  const fill = (Math.abs(value) / 2) * box.w;
  ctx.fillRect(value >= 0 ? middle : middle - fill, box.y, fill, box.h);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(middle, box.y, 1, box.h);
  const settled = Math.max(-1, Math.min(1, resting));
  if (Math.abs(settled) > 0.02) {
    ctx.globalAlpha = 0.9;
    ctx.fillRect(box.x + ((settled + 1) / 2) * box.w - 1, box.y, 2, box.h);
  }
  ctx.globalAlpha = 1;
}

/** The day you met, as the card puts it. */
function metDate(state: PersistedState): string {
  const since = new Date(state.metAt);
  return Number.isFinite(since.getTime()) ? since.toLocaleDateString('pl-PL') : '?';
}

/** Kills, deaths, sessions - the card's own strip. */
function drawStats(ctx: CanvasRenderingContext2D, left: number, baseline: number, width: number, state: PersistedState): void {
  const columns: readonly [string, string][] = [
    [String(state.stats.kills), 'zabicia'],
    [String(state.stats.deaths), 'smierci'],
    [String(state.stats.sessions), 'sesje'],
  ];
  const step = width / columns.length;
  columns.forEach(([value, label], i) => {
    const centre = left + step * (i + 0.5);
    ctx.globalAlpha = 1;
    ctx.font = `700 15px ${SERIF}`;
    ctx.fillText(value, centre - ctx.measureText(value).width / 2, baseline);
    ctx.globalAlpha = 0.7;
    ctx.font = `9px ${SERIF}`;
    ctx.fillText(label, centre - ctx.measureText(label).width / 2, baseline + 11);
  });
  ctx.globalAlpha = 1;
}

/** Cut a line to the width there is for it, with an ellipsis if it does not fit. */
function clip(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > width) cut = cut.slice(0, -1);
  return `${cut}...`;
}

/**
 * Put the picture on the clipboard. The `Promise<Blob>` goes *inside* the
 * `ClipboardItem` so that `write` is called in the same turn as the click,
 * which is what Safari - and a fair few permission prompts - insist on.
 */
export function copyPictureToClipboard(canvas: HTMLCanvasElement): Promise<void> {
  const win = canvas.ownerDocument?.defaultView ?? window;
  const clipboard = win.navigator?.clipboard;
  const Item = (win as Window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!clipboard?.write || typeof Item === 'undefined') {
    return Promise.reject(new Error('schowek wymaga HTTPS'));
  }
  return clipboard.write([
    new Item({
      'image/png': new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('nie udalo sie zbudowac obrazu'))), 'image/png');
      }),
    }),
  ]);
}

/** The fallback: hand the picture to the browser as a download. */
export function savePicture(canvas: HTMLCanvasElement, name: string): void {
  const doc = canvas.ownerDocument ?? document;
  const link = doc.createElement('a');
  link.download = name;
  link.href = canvas.toDataURL('image/png');
  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  link.remove();
}

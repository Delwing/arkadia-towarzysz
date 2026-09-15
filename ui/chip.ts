/**
 * The footer chip: a small canvas with the companion and their name. Runs the
 * render loop; asks the animator for a pose each frame and draws either the
 * sprite sheet frame or the procedural fallback figure.
 *
 * The chip claims only as much room in the footer as that one line of text -
 * the same height the client's other chips take. The canvas is taller than
 * that, so it is taken out of the flow and left to overflow upwards out of the
 * footer: the companion is drawn whole, nothing is clipped, and the footer row
 * does not grow around them.
 *
 * The same class, at a bigger scale and with the text and the overflow turned
 * off, is the portrait on the companion's card - one renderer, so the card
 * cannot drift away from what the footer shows.
 */

import type { CompanionSpec } from '../companion/types';
import { Animator, type Pose } from '../render/animator';
import { frameRect, type LoadedSheet } from '../render/sheet';

/**
 * Logical canvas size in sprite pixels: room around the figure for lunges and
 * jumps, and headroom above the tallest art. The drawn figure is 16 tall and a
 * Mixer one 24, so 28 leaves both a few rows to jump into.
 */
export const CANVAS_W = 26;
export const CANVAS_H = 28;
/** CSS pixels per sprite pixel. */
export const PIXEL_SCALE = 1.5;
/** The canvas in CSS pixels - the box the companion is drawn in, flow or not. */
export const SPRITE_W = CANVAS_W * PIXEL_SCALE;
export const SPRITE_H = CANVAS_H * PIXEL_SCALE;

export interface ChipOptions {
  onClick?: () => void;
  animator: Animator;
  /** CSS pixels per sprite pixel. Defaults to the footer's `PIXEL_SCALE`. */
  scale?: number;
  /** The name beside the companion. Off for a portrait, which is under one. */
  label?: boolean;
  /**
   * Whether the canvas hangs out of the flow (the footer, where there is no
   * height to spare) or takes its own room (a card, where there is).
   */
  float?: boolean;
}

export class Chip {
  readonly element: HTMLSpanElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly nameEl: HTMLSpanElement;
  private ctx: CanvasRenderingContext2D | null;
  private sheet: LoadedSheet | null = null;
  private frame: number | null = null;
  /** 0 until the first `resizeBacking`, which is what forces that first sizing. */
  private dpr = 0;
  private readonly animator: Animator;
  private readonly scale: number;
  /** Only a chip you can click says so in its tooltip. */
  private readonly clickable: boolean;
  private visible = true;

  constructor(options: ChipOptions) {
    this.animator = options.animator;
    this.scale = options.scale ?? PIXEL_SCALE;
    this.clickable = Boolean(options.onClick);
    const float = options.float !== false;
    const width = CANVAS_W * this.scale;
    const height = CANVAS_H * this.scale;

    const root = document.createElement('span');
    root.className = 'towarzysz-chip';
    root.setAttribute('data-towarzysz', '');
    root.style.display = 'inline-flex';
    root.style.alignItems = 'center';
    root.style.gap = '4px';
    root.style.verticalAlign = 'middle';
    root.style.cursor = options.onClick ? 'pointer' : 'default';
    root.style.userSelect = 'none';
    root.style.overflow = 'visible';
    root.title = this.clickable ? 'Towarzysz - kliknij, zeby zobaczyc karte' : 'Towarzysz';
    if (options.onClick) {
      root.addEventListener('click', (event) => {
        event.preventDefault();
        options.onClick?.();
      });
    }

    // The slot is what the footer measures: the canvas's width, but only the
    // height the chip's text asks for (`stretch` takes the row's height, it
    // does not set it). The canvas hangs inside it, its feet on the slot's
    // bottom edge, the rest of the figure standing above the footer line.
    const slot = document.createElement('span');
    slot.className = 'towarzysz-chip__slot';
    slot.style.position = 'relative';
    slot.style.display = 'block';
    slot.style.flex = '0 0 auto';
    slot.style.width = `${width}px`;
    // Not floating: the slot is simply the canvas's box.
    if (float) slot.style.alignSelf = 'stretch';
    else slot.style.height = `${height}px`;

    const canvas = document.createElement('canvas');
    if (float) {
      canvas.style.position = 'absolute';
      canvas.style.left = '0';
      canvas.style.bottom = '0';
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.imageRendering = 'pixelated';
    canvas.style.display = 'block';
    slot.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // The name, on one line, and nothing else: the mood is on the card, where
    // there is room to say it properly. In the footer it was a second word
    // nobody reads, and for a while a second line the whole row had to grow for.
    const name = document.createElement('span');
    name.className = 'towarzysz-chip__name';
    name.style.fontWeight = '600';
    name.style.lineHeight = '1.1';
    name.style.fontSize = '11px';
    name.textContent = '...';

    root.appendChild(slot);
    if (options.label !== false) root.appendChild(name);

    this.element = root;
    this.nameEl = name;
    this.resizeBacking();
  }

  /**
   * What a bubble hangs off: the canvas, not the chip. The chip's own box stops
   * at the text, so anchoring to it would put the bubble beside the name rather
   * than beside the companion.
   */
  get anchor(): HTMLElement {
    return this.canvas;
  }

  setSpec(spec: CompanionSpec | null): void {
    this.nameEl.textContent = spec ? spec.name : '...';
    this.element.title = spec
      ? `${spec.name} - towarzysz.${this.clickable ? ' Kliknij, zeby zobaczyc karte.' : ''}`
      : 'Towarzysz czeka na imie postaci.';
  }

  setSheet(sheet: LoadedSheet | null): void {
    this.sheet = sheet;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.style.display = visible ? '' : 'none';
  }

  start(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  destroy(): void {
    this.stop();
    this.element.remove();
  }

  /** Draw one frame at `now`. Public so a test harness can drive it without rAF. */
  render(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.resizeBacking();
    const unit = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;

    const pose = this.animator.pose(now);

    // Feet point: centred, one row above the bottom edge.
    const feetX = (CANVAS_W / 2 + pose.dx) * unit;
    const feetY = (CANVAS_H - 1 + pose.dy) * unit;
    // The beam goes under the figure: they fade out through the light, not in
    // front of it.
    if (pose.beam > 0) this.drawBeam(ctx, pose, unit);
    ctx.save();
    if (pose.alpha < 1) ctx.globalAlpha = Math.max(0, pose.alpha);
    ctx.translate(feetX, feetY);
    ctx.rotate(pose.rot);
    ctx.scale(pose.sx, pose.sy);
    // No sheet means the art could not be put on a canvas at all, which is the
    // same condition that would stop this canvas working: draw nothing rather
    // than carry a second figure around for a case that cannot arrive.
    if (this.sheet) this.drawSheetFrame(ctx, pose, unit);
    if (pose.flash > 0 && this.sheet) {
      const w = this.figureWidth();
      const h = this.figureHeight();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(255,255,255,${(0.7 * pose.flash).toFixed(3)})`;
      ctx.fillRect((-w / 2 - 3) * unit, (-h - 2) * unit, (w + 6) * unit, (h + 3) * unit);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    this.drawOverlays(ctx, pose, now, unit);
  }

  private drawSheetFrame(ctx: CanvasRenderingContext2D, pose: Pose, unit: number): void {
    const sheet = this.sheet;
    if (!sheet) return;
    const rect = frameRect(sheet, pose.frame.animation, pose.frame.phase);
    // The frame's bottom centre sits on the feet point, scaled to the height
    // the sheet asks to be drawn at - 16 for the drawn art, 24 for a Mixer
    // sheet whose frames are 48 tall, which is a clean halving.
    const scale = (this.figureHeight() * unit) / rect.height;
    ctx.drawImage(
      sheet.image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      -(rect.width * scale) / 2,
      -rect.height * scale,
      rect.width * scale,
      rect.height * scale,
    );
  }

  /** How tall the figure is drawn, in sprite pixels; the sheet decides. */
  private figureHeight(): number {
    return this.sheet?.figureHeight ?? 16;
  }

  /** And how wide it therefore is, at the same scale. */
  private figureWidth(): number {
    const sheet = this.sheet;
    if (!sheet) return 12;
    return (sheet.frameWidth * this.figureHeight()) / sheet.frameHeight;
  }

  /** The warp light: a column the figure dissolves into, and a puddle at its feet. */
  private drawBeam(ctx: CanvasRenderingContext2D, pose: Pose, unit: number): void {
    const strength = Math.min(1, pose.beam);
    const centre = (CANVAS_W / 2 + pose.dx) * unit;
    const feet = (CANVAS_H - 1 + pose.dy) * unit;
    ctx.fillStyle = `rgba(150, 205, 255, ${(0.3 * strength).toFixed(3)})`;
    ctx.fillRect(centre - 2.5 * unit, 0, 5 * unit, feet);
    ctx.fillStyle = `rgba(225, 245, 255, ${(0.65 * strength).toFixed(3)})`;
    ctx.fillRect(centre - unit, 0, 2 * unit, feet);
    ctx.fillStyle = `rgba(200, 235, 255, ${(0.55 * strength).toFixed(3)})`;
    ctx.fillRect(centre - 3.5 * unit, feet, 7 * unit, unit);
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, pose: Pose, now: number, unit: number): void {
    if (pose.sparkle > 0) {
      const count = Math.round(pose.sparkle * 6);
      // Around the companion, not around the canvas. These used to be scattered
      // over the whole chip, which was fine while the chip was barely bigger
      // than the figure; the taller canvas the Mixer art needed left a corner of
      // empty space, and that is where the glitter went.
      const spread = this.figureWidth() + 6;
      const height = this.figureHeight() + 4;
      const left = CANVAS_W / 2 + pose.dx - spread / 2;
      const top = Math.max(0, CANVAS_H - 1 - height);
      for (let i = 0; i < count; i++) {
        const seed = i * 97 + Math.floor(now / 120) * 13;
        const x = Math.min(CANVAS_W - 1, Math.max(1, left + ((seed * 31) % spread))) * unit;
        const y = (top + ((seed * 17) % height)) * unit;
        ctx.fillStyle = i % 2 === 0 ? '#fff2a8' : '#ffffff';
        ctx.fillRect(x, y, unit, unit);
        ctx.fillRect(x - unit, y, unit, unit * 0.5);
        ctx.fillRect(x + unit, y, unit, unit * 0.5);
        ctx.fillRect(x, y - unit, unit * 0.5, unit);
        ctx.fillRect(x, y + unit, unit * 0.5, unit);
      }
    }
    if (pose.zz > 0) {
      // Two little z's drifting up and right of the head.
      const phase = (now % 2000) / 2000;
      ctx.fillStyle = 'rgba(220, 230, 255, 0.9)';
      const baseX = (CANVAS_W / 2 + this.figureWidth() / 2 + 1) * unit;
      const baseY = (CANVAS_H - this.figureHeight() - 1) * unit;
      for (let i = 0; i < 2; i++) {
        const p = (phase + i * 0.5) % 1;
        const x = baseX + p * 3 * unit;
        const y = baseY + (1 - p) * 4 * unit;
        // A 3x3 pixel "z".
        ctx.fillRect(x, y, 3 * unit * 0.7, unit * 0.7);
        ctx.fillRect(x + unit * 0.7, y + unit * 0.7, unit * 0.7, unit * 0.7);
        ctx.fillRect(x, y + 1.4 * unit, 3 * unit * 0.7, unit * 0.7);
      }
    }
    if (pose.puff > 0) {
      // Pipe smoke: three pixels leaving the companion's head, rising and
      // thinning. The strength is the drag they just took, so the puffs come
      // and go with the sitting rather than streaming continuously.
      //
      // Only the seated `smoke` asks for this, so the start is where a sitting
      // companion's head is - about two thirds of their standing height, which
      // is where the sit leaves it - rather than anywhere a pose could be.
      const strength = Math.min(1, pose.puff);
      const phase = (now % 2600) / 2600;
      const baseX = (CANVAS_W / 2 + pose.dx + 3) * unit;
      const baseY = (CANVAS_H - 1 + pose.dy - this.figureHeight() * 0.62) * unit;
      for (let i = 0; i < 3; i++) {
        const p = (phase + i / 3) % 1;
        const size = (1 + 0.6 * p) * unit;
        ctx.fillStyle = `rgba(214, 218, 210, ${(strength * (1 - p) * 0.8).toFixed(3)})`;
        ctx.fillRect(baseX + p * 1.5 * unit, baseY - p * 4 * unit, size, size);
      }
    }
  }

  private resizeBacking(): void {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.round(CANVAS_W * this.scale * dpr);
    const height = Math.round(CANVAS_H * this.scale * dpr);
    // Compare against the backing store, not against `this.dpr`: on a 1x
    // display those matched from the start and the canvas kept its default
    // 300x150 backing, which CSS then squeezed into 39x30.
    if (this.canvas.width === width && this.canvas.height === height) {
      this.dpr = dpr;
      return;
    }
    this.dpr = dpr;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private tick = (now: number): void => {
    this.frame = null;
    try {
      // A card that has been torn out of the document still holds its chip;
      // drawing into a canvas nobody can see is the one frame worth skipping.
      if (this.visible && this.element.isConnected) this.render(now);
    } catch {
      // A drawing error must not stop the loop - the next frame may be fine.
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}

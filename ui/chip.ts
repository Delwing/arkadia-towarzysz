/**
 * The footer chip: a small canvas with the companion, their name and the mood
 * label. Runs the render loop; asks the animator for a pose each frame and
 * draws either the sprite sheet frame or the procedural fallback figure.
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

export interface ChipOptions {
  onClick?: () => void;
  animator: Animator;
}

export class Chip {
  readonly element: HTMLSpanElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly nameEl: HTMLSpanElement;
  private readonly moodEl: HTMLSpanElement;
  private ctx: CanvasRenderingContext2D | null;
  private sheet: LoadedSheet | null = null;
  private frame: number | null = null;
  /** 0 until the first `resizeBacking`, which is what forces that first sizing. */
  private dpr = 0;
  private readonly animator: Animator;
  private visible = true;

  constructor(options: ChipOptions) {
    this.animator = options.animator;

    const root = document.createElement('span');
    root.className = 'towarzysz-chip';
    root.setAttribute('data-towarzysz', '');
    root.style.display = 'inline-flex';
    root.style.alignItems = 'center';
    root.style.gap = '4px';
    root.style.verticalAlign = 'middle';
    root.style.cursor = options.onClick ? 'pointer' : 'default';
    root.style.userSelect = 'none';
    root.title = 'Towarzysz - kliknij, zeby otworzyc ustawienia';
    if (options.onClick) {
      root.addEventListener('click', (event) => {
        event.preventDefault();
        options.onClick?.();
      });
    }

    const canvas = document.createElement('canvas');
    canvas.style.width = `${CANVAS_W * PIXEL_SCALE}px`;
    canvas.style.height = `${CANVAS_H * PIXEL_SCALE}px`;
    canvas.style.imageRendering = 'pixelated';
    canvas.style.display = 'block';
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    const text = document.createElement('span');
    text.style.display = 'inline-flex';
    text.style.flexDirection = 'column';
    text.style.lineHeight = '1.1';
    text.style.fontSize = '10px';

    const name = document.createElement('span');
    name.className = 'towarzysz-chip__name';
    name.style.fontWeight = '600';
    name.textContent = '...';
    const mood = document.createElement('span');
    mood.className = 'towarzysz-chip__mood';
    mood.style.fontSize = '8px';
    mood.style.opacity = '0.75';
    mood.textContent = '';

    text.appendChild(name);
    text.appendChild(mood);
    root.appendChild(canvas);
    root.appendChild(text);

    this.element = root;
    this.nameEl = name;
    this.moodEl = mood;
    this.resizeBacking();
  }

  setSpec(spec: CompanionSpec | null): void {
    this.nameEl.textContent = spec ? spec.name : '...';
    this.element.title = spec
      ? `${spec.name} - towarzysz. Kliknij, zeby otworzyc ustawienia.`
      : 'Towarzysz czeka na imie postaci.';
  }

  setSheet(sheet: LoadedSheet | null): void {
    this.sheet = sheet;
  }

  setMoodLabel(label: string): void {
    this.moodEl.textContent = label;
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
    const unit = PIXEL_SCALE * this.dpr;
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
  }

  private resizeBacking(): void {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.round(CANVAS_W * PIXEL_SCALE * dpr);
    const height = Math.round(CANVAS_H * PIXEL_SCALE * dpr);
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
      if (this.visible) this.render(now);
    } catch {
      // A drawing error must not stop the loop - the next frame may be fine.
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}

/**
 * The footer chip: a small canvas with the companion, their name and the mood
 * label. Runs the render loop; asks the animator for a pose each frame and
 * draws either the sprite sheet frame or the procedural fallback figure.
 */

import type { CompanionSpec } from '../companion/types';
import { Animator, type Pose } from '../render/animator';
import { drawFigure, FIGURE_H, FIGURE_W, placeholderSpec } from '../render/fallback';
import { frameRect, type LoadedSheet } from '../render/sheet';

/** Logical canvas size in sprite pixels: room around the figure for lunges and jumps. */
export const CANVAS_W = 26;
export const CANVAS_H = 20;
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
  private spec: CompanionSpec = placeholderSpec();
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
    this.spec = spec ?? placeholderSpec();
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
    ctx.save();
    ctx.translate(feetX, feetY);
    ctx.rotate(pose.rot);
    ctx.scale(pose.sx, pose.sy);
    if (this.sheet) {
      this.drawSheetFrame(ctx, pose, unit);
    } else {
      drawFigure(ctx, this.spec, pose, unit);
    }
    if (pose.flash > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(255,255,255,${(0.7 * pose.flash).toFixed(3)})`;
      ctx.fillRect((-FIGURE_W / 2 - 3) * unit, (-FIGURE_H - 2) * unit, (FIGURE_W + 6) * unit, (FIGURE_H + 3) * unit);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    this.drawOverlays(ctx, pose, now, unit);
  }

  private drawSheetFrame(ctx: CanvasRenderingContext2D, pose: Pose, unit: number): void {
    const sheet = this.sheet;
    if (!sheet) return;
    const rect = frameRect(sheet, pose.frame.animation, pose.frame.index);
    // The frame's bottom centre sits on the feet point; the frame is scaled so
    // its height matches the fallback figure's, keeping the chip size stable.
    const scale = (FIGURE_H * unit) / rect.height;
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

  private drawOverlays(ctx: CanvasRenderingContext2D, pose: Pose, now: number, unit: number): void {
    if (pose.sparkle > 0) {
      const count = Math.round(pose.sparkle * 6);
      for (let i = 0; i < count; i++) {
        const seed = i * 97 + Math.floor(now / 120) * 13;
        const x = ((seed * 31) % CANVAS_W) * unit;
        const y = ((seed * 17) % (CANVAS_H - 2)) * unit;
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
      const baseX = (CANVAS_W / 2 + FIGURE_W / 2 + 1) * unit;
      const baseY = (CANVAS_H - FIGURE_H - 1) * unit;
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

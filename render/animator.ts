/**
 * Animation primitives and the always-running idle. Pure: no DOM, no timers.
 * The chip asks `pose(now)` every frame and draws whatever comes back.
 *
 * Each primitive is a function of normalised time `t` in [0, 1] and an
 * intensity multiplier `k`, so one small set covers a hundred scripted actions:
 * a small coin and a huge haul are the same `gulp` at different amplitudes.
 * Offsets are in sprite pixels; the renderer scales them.
 */

import type { Primitive } from '../companion/types';

export type Eyes = 'open' | 'closed' | 'half';
export type Mouth = 'flat' | 'smile' | 'open' | 'frown';

export interface Pose {
  /** Sprite-pixel offsets. */
  dx: number;
  dy: number;
  /** Scale around the feet. */
  sx: number;
  sy: number;
  /** Radians around the feet; positive falls to the right. */
  rot: number;
  eyes: Eyes;
  mouth: Mouth;
  armsUp: boolean;
  /** 0..1, how much glitter to sprinkle around the figure. */
  sparkle: number;
  /** 0..1, sleep marks. */
  zz: number;
  /** 0..1, hurt flash. */
  flash: number;
  /** Which sheet animation frame to draw, when a sheet is in use. */
  frame: { animation: string; index: number };
}

export interface PrimitiveDef {
  durationMs: number;
  /** Keeps playing until `wake()`; the doze. */
  sustained?: boolean;
  /** Higher wins when one is already playing. */
  priority: number;
  /** The frames the sprite sheet should carry for this primitive (informational for the embed tool). */
  frames: number;
  pose(t: number, k: number, base: Pose): Pose;
}

export function basePose(): Pose {
  return {
    dx: 0,
    dy: 0,
    sx: 1,
    sy: 1,
    rot: 0,
    eyes: 'open',
    mouth: 'flat',
    armsUp: false,
    sparkle: 0,
    zz: 0,
    flash: 0,
    frame: { animation: 'idle', index: 0 },
  };
}

const PI = Math.PI;

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function frameAt(animation: string, t: number, frames: number): Pose['frame'] {
  return { animation, index: Math.min(frames - 1, Math.max(0, Math.floor(t * frames))) };
}

export const PRIMITIVE_DEFS: Record<Primitive, PrimitiveDef> = {
  idle: {
    durationMs: 1,
    priority: 0,
    frames: 2,
    pose: (_t, _k, base) => base,
  },
  lunge: {
    durationMs: 520,
    priority: 2,
    frames: 4,
    pose(t, k, base) {
      const out = t < 0.35 ? t / 0.35 : (1 - t) / 0.65;
      return {
        ...base,
        dx: base.dx + 6 * k * easeOut(out),
        sy: 1 - 0.08 * Math.min(k, 2) * Math.sin(PI * t),
        sx: 1 + 0.06 * Math.min(k, 2) * Math.sin(PI * t),
        mouth: t < 0.6 ? 'open' : 'smile',
        frame: frameAt('lunge', t, 4),
      };
    },
  },
  cheer: {
    durationMs: 950,
    priority: 3,
    frames: 4,
    pose(t, k, base) {
      // One jump; a big intensity adds a second, smaller hop.
      const first = t < 0.6 ? Math.sin((PI * t) / 0.6) : 0;
      const second = k > 1.5 && t >= 0.6 ? Math.sin((PI * (t - 0.6)) / 0.4) * 0.5 : 0;
      const lift = Math.max(first, second);
      // The canvas has two rows of headroom above the figure, so the jump is
      // small in pixels and the intensity goes mostly into the stretch.
      return {
        ...base,
        dy: base.dy - Math.round((1 + Math.min(k, 2.5) / 2.5) * lift),
        sy: 1 + 0.05 * Math.min(k, 2) * lift,
        sx: 1 - 0.04 * lift,
        armsUp: true,
        mouth: 'smile',
        eyes: 'open',
        sparkle: k >= 2 ? 0.6 * lift : 0,
        frame: frameAt('cheer', t, 4),
      };
    },
  },
  gulp: {
    durationMs: 620,
    priority: 1,
    frames: 3,
    pose(t, k, base) {
      const squash = t < 0.5 ? Math.sin(PI * (t / 0.5)) : 0;
      const stretch = t >= 0.5 ? Math.sin(PI * ((t - 0.5) / 0.5)) : 0;
      return {
        ...base,
        sy: 1 - 0.18 * Math.min(k, 2) * 0.5 * squash + 0.08 * Math.min(k, 2) * 0.5 * stretch,
        sx: 1 + 0.08 * Math.min(k, 2) * 0.5 * squash,
        mouth: t < 0.5 ? 'open' : 'smile',
        eyes: 'open',
        frame: frameAt('gulp', t, 3),
      };
    },
  },
  slump: {
    durationMs: 1400,
    priority: 1,
    frames: 2,
    pose(t, k, base) {
      const down = t < 0.7 ? easeOut(t / 0.7) : 1 - (t - 0.7) / 0.3;
      return {
        ...base,
        dy: base.dy + Math.round(2 * Math.min(k, 2) * down),
        sy: 1 - 0.08 * Math.min(k, 2) * down,
        eyes: down > 0.3 ? 'half' : 'open',
        mouth: 'frown',
        frame: frameAt('slump', t, 2),
      };
    },
  },
  glitter: {
    durationMs: 1600,
    priority: 2,
    frames: 3,
    pose(t, k, base) {
      const pulse = Math.sin(4 * PI * t) * Math.sin(PI * t);
      return {
        ...base,
        sx: 1 + 0.05 * pulse,
        sy: 1 + 0.05 * pulse,
        eyes: 'open',
        mouth: 'smile',
        sparkle: Math.min(1, (k / 2.2) * Math.sin(PI * t)),
        frame: frameAt('glitter', t, 3),
      };
    },
  },
  flinch: {
    durationMs: 700,
    priority: 3,
    frames: 3,
    pose(t, k, base) {
      const shake = Math.sin(t * PI * 5) * (1 - t);
      return {
        ...base,
        dx: base.dx - Math.round(4 * Math.min(k, 2.5) * 0.5 * shake),
        rot: -0.08 * Math.min(k, 2) * shake,
        eyes: t < 0.7 ? 'closed' : 'open',
        mouth: 'open',
        flash: Math.max(0, 1 - t * 1.5),
        frame: frameAt('flinch', t, 3),
      };
    },
  },
  topple: {
    durationMs: 4200,
    priority: 5,
    frames: 4,
    pose(t, _k, base) {
      let rot: number;
      let dy: number;
      if (t < 0.15) {
        rot = (PI / 2) * easeOut(t / 0.15);
      } else if (t < 0.85) {
        rot = PI / 2;
      } else {
        rot = (PI / 2) * (1 - easeOut((t - 0.85) / 0.15));
      }
      // The rotation is around the feet, which would swing the body off the
      // right edge of the canvas; slide it back under the chip as it falls and
      // lift it so the lying figure is not clipped by the bottom row.
      dy = -Math.round(5 * Math.sin(rot));
      const dx = -Math.round(6 * Math.sin(rot));
      return {
        ...base,
        dx: base.dx + dx,
        dy: base.dy + dy,
        rot,
        eyes: t < 0.85 ? 'closed' : 'half',
        mouth: t < 0.85 ? 'open' : 'frown',
        frame: frameAt('topple', t, 4),
      };
    },
  },
  doze: {
    durationMs: 3000,
    sustained: true,
    priority: 1,
    frames: 2,
    pose(t, _k, base) {
      return {
        ...base,
        dy: base.dy + 1,
        sy: 0.97 + 0.02 * Math.sin(2 * PI * t),
        eyes: 'closed',
        mouth: 'flat',
        zz: 1,
        frame: frameAt('doze', t, 2),
      };
    },
  },
};

export const IDLE_BOB_PERIOD_MS = 1800;
/** Blink roughly every 3.7 s, held for 130 ms. */
export const BLINK_PERIOD_MS = 3700;
export const BLINK_HOLD_MS = 130;

interface Active {
  primitive: Primitive;
  intensity: number;
  startedAt: number;
}

export class Animator {
  private active: Active | null = null;
  /** Per-companion phase so two chips would never blink in unison. */
  private readonly phase: number;

  constructor(phaseSeed = 0) {
    this.phase = (phaseSeed % 1000) * 7;
  }

  /** Start a primitive; a lower-priority one does not interrupt a higher one. */
  play(primitive: Primitive, intensity: number, now: number): boolean {
    if (primitive === 'idle') return false;
    const def = PRIMITIVE_DEFS[primitive];
    if (this.active) {
      const current = PRIMITIVE_DEFS[this.active.primitive];
      const running = current.sustained || now - this.active.startedAt < current.durationMs;
      if (running && current.priority > def.priority) return false;
    }
    this.active = { primitive, intensity: Number.isFinite(intensity) ? intensity : 1, startedAt: now };
    return true;
  }

  /** Ends a sustained primitive (the doze). Anything else is left to finish. */
  wake(): void {
    if (this.active && PRIMITIVE_DEFS[this.active.primitive].sustained) this.active = null;
  }

  current(now: number): Primitive {
    const active = this.active;
    if (!active) return 'idle';
    const def = PRIMITIVE_DEFS[active.primitive];
    if (def.sustained || now - active.startedAt < def.durationMs) return active.primitive;
    return 'idle';
  }

  /** The pose to draw right now: idle breathing and blinking, plus the active primitive on top. */
  pose(now: number): Pose {
    const base = basePose();
    const bobT = ((now + this.phase) % IDLE_BOB_PERIOD_MS) / IDLE_BOB_PERIOD_MS;
    base.dy = Math.sin(bobT * 2 * PI) > 0 ? 0 : 1;
    const blinkPhase = (now + this.phase * 13) % BLINK_PERIOD_MS;
    if (blinkPhase < BLINK_HOLD_MS) base.eyes = 'closed';
    base.frame = { animation: 'idle', index: bobT < 0.5 ? 0 : 1 };

    const active = this.active;
    if (!active) return base;
    const def = PRIMITIVE_DEFS[active.primitive];
    const elapsed = now - active.startedAt;
    if (!def.sustained && elapsed >= def.durationMs) {
      this.active = null;
      return base;
    }
    const t = def.sustained ? (elapsed % def.durationMs) / def.durationMs : Math.min(1, Math.max(0, elapsed / def.durationMs));
    return def.pose(t, active.intensity, base);
  }
}

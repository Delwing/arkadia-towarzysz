/**
 * Plays the animations: which one is running, what may interrupt what, and the
 * breathing and blinking underneath all of them. Pure: no DOM, no timers. The
 * chip asks `pose(now)` every frame and draws whatever comes back.
 *
 * The animations themselves are not here - they are one table in
 * `render/animations.ts`. Each is a function of normalised time `t` in [0, 1]
 * and an intensity multiplier `k`, so one small set covers a hundred scripted
 * actions: a small coin and a huge haul are the same `gulp` at different
 * amplitudes. Offsets are in sprite pixels; the renderer scales them.
 *
 * The animator also owns the companion's idle life. `companion/ambient.ts`
 * decides when they should do something of their own accord, and `pose()`
 * polls it - the frame clock is the only clock here, so a chip that is not
 * being drawn is a companion who stands still, and a busy one is never
 * interrupted by their own fidgeting.
 */

import { Ambient } from '../companion/ambient';
import type { AmbientLevel } from '../companion/types';
import { ANIMATION_DEFS, restingFrame, sourceMs, variantsOf, type Primitive } from './animations';
import { seededRng, type Rng } from '../companion/rng';
import { basePose, framePhase, type Pose } from './pose';

export { basePose } from './pose';
export type { Pose } from './pose';
export type { Primitive, PrimitiveDef } from './animations';

/** The animation table. One entry per animation, all of it from render/animations.ts. */
export const PRIMITIVE_DEFS = ANIMATION_DEFS;

/**
 * How long the idle clip takes to play through once. Their idle runs at 130 ms
 * a frame; this is slower, because a companion standing in a footer should
 * breathe rather than fidget.
 */
export const IDLE_PERIOD_MS = 1400;

interface Active {
  primitive: Primitive;
  intensity: number;
  startedAt: number;
  /** Which of the animation's rows this playback drew from. */
  variant: string;
  /** That row's own length, so a short death does not run to a long one's clock. */
  durationMs: number;
}

export class Animator {
  private active: Active | null = null;
  /** Per-companion phase so two chips would never blink in unison. */
  private readonly phase: number;
  private readonly ambient: Ambient;
  /** Picks between an animation's variants; seeded, so a test can predict it. */
  private readonly rng: Rng;

  constructor(phaseSeed = 0) {
    this.phase = (phaseSeed % 1000) * 7;
    // Off until a character is loaded: the placeholder figure has no business
    // wandering around the footer.
    this.ambient = new Ambient(phaseSeed, 'off');
    this.rng = seededRng(phaseSeed + 0x9e37);
  }

  /** How often they do something of their own accord; 'off' stops it entirely. */
  setAmbientLevel(level: AmbientLevel): void {
    this.ambient.setLevel(level);
  }

  /** Play an ambient action now, whatever the level and whatever is running. */
  playAmbient(now: number): void {
    const action = this.ambient.force(now);
    this.active = null;
    this.play(action.primitive, action.intensity, now);
  }

  /** Start a primitive; a lower-priority one does not interrupt a higher one. */
  play(primitive: Primitive, intensity: number, now: number): boolean {
    if (primitive === 'idle') return false;
    const def = PRIMITIVE_DEFS[primitive];
    if (this.active && this.running(this.active, now)) {
      if (PRIMITIVE_DEFS[this.active.primitive].priority > def.priority) return false;
    }
    // An animation drawn more than one way picks a row here, once per playback,
    // and runs to that row's own length.
    const variants = variantsOf(primitive);
    const variant = variants.length > 1 ? (variants[Math.floor(this.rng() * variants.length)] as string) : primitive;
    // Only an animation that takes its timing from the art follows the row it
    // drew; one with a duration of its own keeps it and loops the row inside.
    const base = def.fromSource ? sourceMs(variant) || def.durationMs : def.durationMs;
    const durationMs = Math.max(1, base * (def.durationScale ?? 1));
    this.active = {
      primitive,
      intensity: Number.isFinite(intensity) ? intensity : 1,
      startedAt: now,
      variant,
      durationMs,
    };
    return true;
  }

  private running(active: Active, now: number): boolean {
    const def = PRIMITIVE_DEFS[active.primitive];
    return def.sustained === true || def.holds === true || now - active.startedAt < active.durationMs;
  }

  /** Ends a sustained primitive (the doze). Anything else is left to finish. */
  wake(): void {
    if (this.active && PRIMITIVE_DEFS[this.active.primitive].sustained) this.active = null;
  }

  /**
   * Ends a held primitive - the death. The companion gets up when the client
   * says the character did, not when a timer ran out.
   */
  revive(): void {
    if (this.active && PRIMITIVE_DEFS[this.active.primitive].holds) this.active = null;
  }

  /** Whether they are lying where a held animation left them. */
  isHeld(now: number): boolean {
    const active = this.active;
    if (!active || !PRIMITIVE_DEFS[active.primitive].holds) return false;
    return now - active.startedAt >= active.durationMs;
  }

  current(now: number): Primitive {
    const active = this.active;
    if (!active) return 'idle';
    return this.running(active, now) ? active.primitive : 'idle';
  }

  /** The pose to draw right now: idle breathing and blinking, plus the active primitive on top. */
  pose(now: number): Pose {
    const base = basePose();
    // Sweep the whole idle clip rather than alternating two poses: picking
    // "frame 0 or 1 of 2" lands on phases 0 and 0.5, which on their four-frame
    // idle only ever showed frames 0 and 2. The breathing and the blinking that
    // used to live here are in the frames now.
    base.frame = framePhase('idle', ((now + this.phase) % IDLE_PERIOD_MS) / IDLE_PERIOD_MS);

    // Standing idle is the only moment they are free to start something of
    // their own; anything else playing pushes the next one further out.
    if (this.active) this.ambient.defer(now);
    else {
      const action = this.ambient.poll(now);
      if (action) this.play(action.primitive, action.intensity, now);
    }

    const active = this.active;
    if (!active) return base;
    const def = PRIMITIVE_DEFS[active.primitive];
    const elapsed = now - active.startedAt;
    if (!def.sustained && !def.holds && elapsed >= active.durationMs) {
      this.active = null;
      return base;
    }
    const t = def.sustained
      ? (elapsed % active.durationMs) / active.durationMs
      : // A held animation stops on its last frame instead of ending.
        Math.min(1, Math.max(0, elapsed / active.durationMs));
    const pose = def.pose(t, active.intensity, base);
    // The pose names its own animation; if this playback drew from one of its
    // other rows, that is the row to read.
    const frame =
      active.variant !== active.primitive && pose.frame.animation === active.primitive
        ? { animation: active.variant, phase: pose.frame.phase }
        : pose.frame;
    // Once a held animation has run out, settle it: a death whose last frame
    // still carries the tail of a soul would keep those two pixels for ever.
    if (def.holds === true && elapsed >= active.durationMs) {
      const resting = restingFrame(frame.animation);
      if (resting) return { ...pose, frame: { animation: resting, phase: 0.999999 } };
    }
    return frame === pose.frame ? pose : { ...pose, frame };
  }
}

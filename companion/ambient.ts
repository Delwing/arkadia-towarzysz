/**
 * Idle life: what the companion does when nothing is happening to them.
 *
 * Reactions cover the interesting moments, but most of a session is nothing
 * happening at all, and a figure that only ever breathes reads as a static
 * image. So every half-minute or so, when nothing else is playing, they take a
 * short walk, flicker, or warp out and back.
 *
 * Pure: a seeded PRNG and a clock passed in, no timers and no DOM. The
 * animator polls it from its own frame clock, which is also why nothing here
 * has to know whether the tab is visible - a chip that is not rendering is not
 * asking.
 *
 * Nothing here ever speaks: these are the companion's own business, not a
 * reaction to the player, and a line would make idleness feel like nagging.
 */

import { AMBIENT_CHOICES, type AmbientChoice } from '../render/animations';
import { seededRng, type Rng } from './rng';
import type { AmbientLevel, Primitive } from './types';

export { AMBIENT_CHOICES } from '../render/animations';

/** The gap between two ambient actions at `normal`, before the level's scale. */
export const AMBIENT_MIN_GAP_MS = 22_000;
export const AMBIENT_MAX_GAP_MS = 75_000;
/**
 * Quiet kept after anything else played. Without it an ambient could start on
 * the very frame a reaction ended, which reads as part of the reaction.
 */
export const AMBIENT_SETTLE_MS = 5_000;

/** Multiplies the gap. `off` never fires. */
export const LEVEL_SCALE: Record<AmbientLevel, number> = {
  off: 0,
  rare: 2.5,
  normal: 1,
  often: 0.4,
};

export interface AmbientAction {
  primitive: Primitive;
  /**
   * As everywhere else, the amplitude - but `walk` and `warp` also read its
   * sign as the direction to go (see `render/animator.ts`).
   */
  intensity: number;
}

export function pickAmbient(rng: Rng): AmbientAction {
  const total = AMBIENT_CHOICES.reduce((sum, choice) => sum + choice.weight, 0);
  let roll = rng() * total;
  for (const choice of AMBIENT_CHOICES) {
    roll -= choice.weight;
    if (roll < 0) return { primitive: choice.primitive, intensity: choice.intensity(rng) };
  }
  const last = AMBIENT_CHOICES[AMBIENT_CHOICES.length - 1] as AmbientChoice;
  return { primitive: last.primitive, intensity: last.intensity(rng) };
}

/**
 * Decides when the next ambient action is due. The caller polls only while
 * nothing else is playing, and calls `defer` while something is - so a dozing
 * or reacting companion never wanders off mid-animation.
 */
export class Ambient {
  private readonly rng: Rng;
  private level: AmbientLevel;
  /** null until the first poll: the clock's zero is not the plugin's start. */
  private dueAt: number | null = null;

  constructor(seed = 0, level: AmbientLevel = 'off') {
    this.rng = seededRng(seed);
    this.level = level;
  }

  setLevel(level: AmbientLevel): void {
    if (level === this.level) return;
    this.level = level;
    this.dueAt = null;
  }

  currentLevel(): AmbientLevel {
    return this.level;
  }

  /** Push the next action away; called on every frame something else is playing. */
  defer(now: number): void {
    if (this.dueAt === null) {
      this.schedule(now);
      return;
    }
    this.dueAt = Math.max(this.dueAt, now + AMBIENT_SETTLE_MS);
  }

  /** An action when one is due, otherwise null. Call only when nothing else is playing. */
  poll(now: number): AmbientAction | null {
    if (this.level === 'off') return null;
    if (this.dueAt === null || now < this.dueAt) {
      if (this.dueAt === null) this.schedule(now);
      return null;
    }
    this.schedule(now);
    return pickAmbient(this.rng);
  }

  /** One now, whatever the level says - the panel's "przejdz sie" button. */
  force(now: number): AmbientAction {
    this.schedule(now);
    return pickAmbient(this.rng);
  }

  private schedule(now: number): void {
    const scale = LEVEL_SCALE[this.level] || LEVEL_SCALE.normal;
    const span = AMBIENT_MAX_GAP_MS - AMBIENT_MIN_GAP_MS;
    this.dueAt = now + (AMBIENT_MIN_GAP_MS + this.rng() * span) * scale;
  }
}

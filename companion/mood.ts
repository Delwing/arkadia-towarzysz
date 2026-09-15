/**
 * Mood: a single scalar in [-1, +1] that biases line selection.
 *
 * It nudges on events, clamps after every nudge (grinding kills cannot bank
 * infinite goodwill) and drifts back toward 0 with a half-life of about twenty
 * minutes. Very little in the game pushes the mood down - a death, a bad head,
 * a few hit points - so the drift is what actually ends a good evening: it is
 * the dampener, and everything else is a nudge away from level.
 *
 * The twenty minutes are twenty minutes of *playing*. Time with the client
 * closed is not charged for, because a mood that seeps away overnight is not a
 * mood the companion has - it is a mood that resets, and every session would
 * start from `spokojnie` no matter how the last one went.
 *
 * How that is arranged: the drift is charged in steps, from the last touch to
 * `now`, and a step wider than `MAX_STEP_MS` is not a long quiet stretch at the
 * keyboard - it is a sleeping machine, a frozen tab, or a save from yesterday -
 * so it is charged as `MAX_STEP_MS` and no further. `plugin.ts` keeps the steps
 * small by ticking `advance` while the client is connected, and `hold` while it
 * is not: the timestamp moves, the value waits.
 */

import type { MoodBucket } from './types';

export const MOOD_MIN = -1;
export const MOOD_MAX = 1;
/** Half-life of the drift back to 0, in time spent playing. */
export const HALF_LIFE_MS = 20 * 60 * 1000;
/**
 * The most play time a single step may be charged for. Anything wider is time
 * nobody was there for. It is well above the plugin's tick, including the once
 * a minute a background tab is throttled down to.
 */
export const MAX_STEP_MS = 90_000;
/** Bucket edges: `zle` at or below -0.35, `dobrze` at or above +0.35. */
export const BUCKET_EDGE = 0.35;

export interface Mood {
  /** -1..+1 as of `touchedAt`. */
  value: number;
  /** Epoch ms of the last nudge or drift step. */
  touchedAt: number;
}

export function clampMood(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MOOD_MAX, Math.max(MOOD_MIN, value));
}

/** `value` after `elapsedMs` of play. Pure, and unclamped in time. */
export function decay(value: number, elapsedMs: number): number {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  if (elapsed === 0) return clampMood(value);
  return clampMood(clampMood(value) * Math.pow(0.5, elapsed / HALF_LIFE_MS));
}

/** How much play time a step from the last touch to `now` is charged for. */
export function step(mood: Mood, now: number): number {
  return Math.min(MAX_STEP_MS, Math.max(0, now - mood.touchedAt));
}

/** The mood as of `now`, with the step's drift applied. Does not mutate. */
export function read(mood: Mood, now: number): number {
  return decay(mood.value, step(mood, now));
}

/** Charge the drift up to `now`. Returns a new Mood. */
export function advance(mood: Mood, now: number): Mood {
  return { value: read(mood, now), touchedAt: now };
}

/**
 * Move the clock to `now` without charging anything: the time since the last
 * touch was not spent playing.
 */
export function hold(mood: Mood, now: number): Mood {
  return { value: clampMood(mood.value), touchedAt: Math.max(now, mood.touchedAt) };
}

/** Drift to `now`, then add `delta`, then clamp. Returns a new Mood. */
export function nudge(mood: Mood, delta: number, now: number): Mood {
  const current = read(mood, now);
  return { value: clampMood(current + (Number.isFinite(delta) ? delta : 0)), touchedAt: now };
}

export function bucket(value: number): MoodBucket {
  if (value <= -BUCKET_EDGE) return 'zle';
  if (value >= BUCKET_EDGE) return 'dobrze';
  return 'spokojnie';
}

/** User-facing label for the chip, ASCII-folded and gender-neutral. */
export function bucketLabel(value: number): string {
  switch (bucket(value)) {
    case 'zle':
      return 'markotnie';
    case 'dobrze':
      return 'radosnie';
    default:
      return 'spokojnie';
  }
}

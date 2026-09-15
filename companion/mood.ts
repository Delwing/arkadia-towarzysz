/**
 * Mood: a single scalar in [-1, +1] that biases line selection.
 *
 * It nudges on events, clamps after every nudge (grinding kills cannot bank
 * infinite goodwill) and decays toward 0 with a half-life of about twenty
 * minutes of wall-clock time. The decay is applied lazily on read, from the
 * timestamp of the last touch, so there is no timer to keep alive.
 */

import type { MoodBucket } from './types';

export const MOOD_MIN = -1;
export const MOOD_MAX = 1;
/** Wall-clock half-life of the drift back to 0. */
export const HALF_LIFE_MS = 20 * 60 * 1000;
/** Bucket edges: `zle` at or below -0.35, `dobrze` at or above +0.35. */
export const BUCKET_EDGE = 0.35;

export interface Mood {
  /** -1..+1 as of `touchedAt`. */
  value: number;
  /** Epoch ms of the last nudge (or last decay write-back). */
  touchedAt: number;
}

export function clampMood(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MOOD_MAX, Math.max(MOOD_MIN, value));
}

/** The mood as of `now`, with decay applied. Does not mutate. */
export function read(mood: Mood, now: number): number {
  const elapsed = Math.max(0, now - mood.touchedAt);
  if (elapsed === 0) return clampMood(mood.value);
  return clampMood(mood.value * Math.pow(0.5, elapsed / HALF_LIFE_MS));
}

/** Decay to `now`, then add `delta`, then clamp. Returns a new Mood. */
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

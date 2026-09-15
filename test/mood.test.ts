import { describe, expect, it } from 'vitest';
import {
  BUCKET_EDGE,
  HALF_LIFE_MS,
  MAX_STEP_MS,
  advance,
  bucket,
  bucketLabel,
  clampMood,
  decay,
  hold,
  nudge,
  read,
  step,
} from '../companion/mood';

describe('mood', () => {
  it('clamps at both ends', () => {
    let mood = { value: 0, touchedAt: 0 };
    for (let i = 0; i < 100; i++) mood = nudge(mood, 0.25, 0);
    expect(mood.value).toBe(1);
    for (let i = 0; i < 100; i++) mood = nudge(mood, -0.35, 0);
    expect(mood.value).toBe(-1);
    expect(clampMood(Number.NaN)).toBe(0);
    expect(clampMood(5)).toBe(1);
  });

  it('decays toward 0 with the documented half-life', () => {
    expect(decay(0.8, 0)).toBeCloseTo(0.8, 6);
    expect(decay(0.8, HALF_LIFE_MS)).toBeCloseTo(0.4, 6);
    expect(decay(0.8, 2 * HALF_LIFE_MS)).toBeCloseTo(0.2, 6);
    expect(decay(-0.6, HALF_LIFE_MS)).toBeCloseTo(-0.3, 6);
  });

  it('charges the same drift in many small steps as in one', () => {
    let ticked = { value: 1, touchedAt: 0 };
    for (let t = 20_000; t <= HALF_LIFE_MS; t += 20_000) ticked = advance(ticked, t);
    expect(ticked.value).toBeCloseTo(0.5, 6);
    expect(ticked.touchedAt).toBe(HALF_LIFE_MS);
  });

  it('charges one step at most for a gap nobody was playing through', () => {
    const overnight = 8 * 60 * 60 * 1000;
    const mood = { value: 1, touchedAt: 0 };
    expect(step(mood, overnight)).toBe(MAX_STEP_MS);
    expect(read(mood, overnight)).toBeCloseTo(decay(1, MAX_STEP_MS), 6);
    // Which is to say: a night away costs the mood a single step of drift, not
    // the evening it came from.
    expect(read(mood, overnight)).toBeGreaterThan(0.94);
  });

  it('holds the value while the clock moves on', () => {
    const held = hold({ value: 0.8, touchedAt: 0 }, 5 * HALF_LIFE_MS);
    expect(held).toEqual({ value: 0.8, touchedAt: 5 * HALF_LIFE_MS });
    // A hold never moves the clock backwards either.
    expect(hold({ value: 0.8, touchedAt: 10_000 }, 0).touchedAt).toBe(10_000);
  });

  it('never decays backwards in time', () => {
    const mood = { value: 0.5, touchedAt: 10_000 };
    expect(read(mood, 0)).toBeCloseTo(0.5, 6);
  });

  it('applies the drift of the step before the nudge', () => {
    const mood = nudge({ value: 0.8, touchedAt: 0 }, 0.1, MAX_STEP_MS);
    expect(mood.value).toBeCloseTo(decay(0.8, MAX_STEP_MS) + 0.1, 6);
    expect(mood.touchedAt).toBe(MAX_STEP_MS);
  });

  it('buckets on the documented boundaries', () => {
    expect(bucket(-1)).toBe('zle');
    expect(bucket(-BUCKET_EDGE)).toBe('zle');
    expect(bucket(-BUCKET_EDGE + 0.001)).toBe('spokojnie');
    expect(bucket(0)).toBe('spokojnie');
    expect(bucket(BUCKET_EDGE - 0.001)).toBe('spokojnie');
    expect(bucket(BUCKET_EDGE)).toBe('dobrze');
    expect(bucket(1)).toBe('dobrze');
  });

  it('labels are ASCII', () => {
    for (const v of [-1, 0, 1]) expect(bucketLabel(v)).toMatch(/^[\x20-\x7e]+$/);
  });
});

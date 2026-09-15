import { describe, expect, it } from 'vitest';
import { BUCKET_EDGE, HALF_LIFE_MS, bucket, bucketLabel, clampMood, nudge, read } from '../companion/mood';

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
    const mood = { value: 0.8, touchedAt: 0 };
    expect(read(mood, 0)).toBeCloseTo(0.8, 6);
    expect(read(mood, HALF_LIFE_MS)).toBeCloseTo(0.4, 6);
    expect(read(mood, 2 * HALF_LIFE_MS)).toBeCloseTo(0.2, 6);
    const bad = { value: -0.6, touchedAt: 1000 };
    expect(read(bad, 1000 + HALF_LIFE_MS)).toBeCloseTo(-0.3, 6);
  });

  it('never decays backwards in time', () => {
    const mood = { value: 0.5, touchedAt: 10_000 };
    expect(read(mood, 0)).toBeCloseTo(0.5, 6);
  });

  it('applies decay before the nudge', () => {
    const mood = nudge({ value: 0.8, touchedAt: 0 }, 0.1, HALF_LIFE_MS);
    expect(mood.value).toBeCloseTo(0.5, 6);
    expect(mood.touchedAt).toBe(HALF_LIFE_MS);
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

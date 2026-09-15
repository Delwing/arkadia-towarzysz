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
  restingOf,
  set,
  step,
  type Mood,
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
    expect(held).toEqual({ value: 0.8, touchedAt: 5 * HALF_LIFE_MS, resting: 0 });
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

/**
 * Time at the keyboard, charged the way the plugin charges it. A single read
 * is capped at one `MAX_STEP_MS` step (a gap that wide is a sleeping machine,
 * not a quiet evening), so anything testing a long drift has to tick.
 */
function play(mood: Mood, ms: number): Mood {
  let ticked = mood;
  const end = mood.touchedAt + ms;
  for (let t = mood.touchedAt + MAX_STEP_MS; t < end; t += MAX_STEP_MS) ticked = advance(ticked, t);
  return advance(ticked, end);
}

describe('the resting point', () => {
  it('drifts toward the day it was given, not toward zero', () => {
    // Half the distance still to cover, per half-life - the same shape the
    // drift always had, just aimed somewhere else.
    expect(decay(0.8, HALF_LIFE_MS, -0.4)).toBeCloseTo(0.2, 6);
    expect(decay(-1, HALF_LIFE_MS, 0.5)).toBeCloseTo(-0.25, 6);
    expect(decay(-0.5, 10 * HALF_LIFE_MS, -0.5)).toBeCloseTo(-0.5, 6);
  });

  it('settles there and stays, however long the evening is', () => {
    const mood = play({ value: 1, touchedAt: 0, resting: -0.45 }, 20 * HALF_LIFE_MS);
    expect(mood.value).toBeCloseTo(-0.45, 4);
    // Which is the whole point: a grim day ends up grim on its own.
    expect(bucket(mood.value)).toBe('zle');
  });

  it('carries the resting point through every operation', () => {
    const mood = { value: 0, touchedAt: 0, resting: 0.5 };
    expect(restingOf(mood)).toBe(0.5);
    expect(advance(mood, 1000).resting).toBe(0.5);
    expect(hold(mood, 1000).resting).toBe(0.5);
    expect(nudge(mood, 0.1, 1000).resting).toBe(0.5);
    expect(set(mood, -1, 1000).resting).toBe(0.5);
    // And defaults to level for a mood that has no day.
    expect(restingOf({ value: 0, touchedAt: 0 })).toBe(0);
    expect(restingOf({ value: 0, touchedAt: 0, resting: 5 })).toBe(1);
  });

  it('lets events swing the mood clear of the day it is having', () => {
    // A grim day is not a cage: good news still lifts them out of zle, and the
    // drift is what puts them back.
    const grim = { value: -0.45, touchedAt: 0, resting: -0.45 };
    const lifted = nudge(grim, 0.45, 0);
    expect(bucket(lifted.value)).toBe('spokojnie');
    expect(play(lifted, 3 * HALF_LIFE_MS).value).toBeLessThan(-0.35);
  });

  it('set puts the mood where it is told, wherever it was', () => {
    const bright = { value: 0.9, touchedAt: 0, resting: 0.5 };
    const dead = set(bright, -1, 5_000);
    expect(dead.value).toBe(-1);
    expect(dead.touchedAt).toBe(5_000);
    // ...and the day it was having is what pulls them back out of it - over two
    // half-lives of playing, a quarter of the way is all that is left to go.
    expect(play(dead, 2 * HALF_LIFE_MS).value).toBeCloseTo(0.5 + (-1 - 0.5) * 0.25, 4);
    // A death on a grim day has much further to climb back.
    const grimDeath = set({ value: 0.2, touchedAt: 0, resting: -0.45 }, -1, 0);
    expect(play(grimDeath, 2 * HALF_LIFE_MS).value).toBeLessThan(-0.45);
  });
});

import { describe, expect, it } from 'vitest';
import {
  GAME_EVENT_TYPES,
  GEM_BAD_COPPER,
  GEM_GOOD_COPPER,
  INTENSITY_MAX,
  INTENSITY_MIN,
  MAX_IMPROVE,
  resolve,
  type GameEvent,
} from '../events/bindings';
import { CATEGORIES, PRIMITIVES } from '../companion/types';

const SAMPLES: Record<GameEvent['type'], GameEvent> = {
  kill: { type: 'kill', streak: 1 },
  improve: { type: 'improve', from: 3, to: 4 },
  hurt: { type: 'hurt', levelsLost: 1 },
  death: { type: 'death' },
  loot: { type: 'loot', copper: 240 },
  spend: { type: 'spend' },
  gem: { type: 'gem', copper: GEM_GOOD_COPPER },
  idle: { type: 'idle' },
};

describe('bindings', () => {
  it('every client event maps to a valid primitive and category', () => {
    for (const type of GAME_EVENT_TYPES) {
      const reaction = resolve(SAMPLES[type]);
      expect(reaction, type).not.toBeNull();
      expect(PRIMITIVES).toContain(reaction!.primitive);
      expect(reaction!.primitive).not.toBe('idle');
      expect(CATEGORIES).toContain(reaction!.category);
      expect(reaction!.intensity).toBeGreaterThanOrEqual(INTENSITY_MIN);
      expect(reaction!.intensity).toBeLessThanOrEqual(INTENSITY_MAX);
      expect(Number.isFinite(reaction!.moodDelta)).toBe(true);
    }
  });

  it('kill intensity scales with the streak and caps', () => {
    expect(resolve({ type: 'kill', streak: 1 })!.intensity).toBe(1);
    expect(resolve({ type: 'kill', streak: 5 })!.intensity).toBeCloseTo(1.6);
    expect(resolve({ type: 'kill', streak: 50 })!.intensity).toBe(INTENSITY_MAX);
    // A streak is not a separate event: the nudge stays the same.
    expect(resolve({ type: 'kill', streak: 50 })!.moodDelta).toBe(resolve({ type: 'kill', streak: 1 })!.moodDelta);
  });

  it('improve celebrates climbs only and the top harder', () => {
    expect(resolve({ type: 'improve', from: 5, to: 5 })).toBeNull();
    expect(resolve({ type: 'improve', from: 15, to: 0 })).toBeNull();
    const step = resolve({ type: 'improve', from: 5, to: 6 })!;
    expect(step.category).toBe('improve');
    expect(step.primitive).toBe('cheer');
    const top = resolve({ type: 'improve', from: 14, to: MAX_IMPROVE })!;
    expect(top.category).toBe('improveMax');
    expect(top.intensity).toBe(2.5);
    expect(top.moodDelta).toBeGreaterThan(step.moodDelta);
  });

  it('hurt scales with the drop and ignores non-drops', () => {
    expect(resolve({ type: 'hurt', levelsLost: 0 })).toBeNull();
    const one = resolve({ type: 'hurt', levelsLost: 1 })!;
    const three = resolve({ type: 'hurt', levelsLost: 3 })!;
    expect(three.intensity).toBeGreaterThan(one.intensity);
    expect(three.moodDelta).toBeLessThan(one.moodDelta);
    expect(one.primitive).toBe('flinch');
  });

  it('loot scales with the amount', () => {
    expect(resolve({ type: 'loot', copper: 0 })).toBeNull();
    const small = resolve({ type: 'loot', copper: 3 })!;
    const big = resolve({ type: 'loot', copper: 24_000 })!;
    expect(small.primitive).toBe('gulp');
    expect(big.intensity).toBeGreaterThan(small.intensity);
    expect(big.moodDelta).toBeGreaterThan(small.moodDelta);
    expect(big.moodDelta).toBeCloseTo(0.15);
  });

  it('gems split into good, nothing, bad', () => {
    expect(resolve({ type: 'gem', copper: GEM_GOOD_COPPER })!.category).toBe('gemGood');
    expect(resolve({ type: 'gem', copper: GEM_GOOD_COPPER })!.primitive).toBe('glitter');
    expect(resolve({ type: 'gem', copper: GEM_BAD_COPPER })).toBeNull();
    expect(resolve({ type: 'gem', copper: GEM_BAD_COPPER - 1 })!.category).toBe('gemBad');
  });

  it('death topples, idle dozes, spend slumps', () => {
    expect(resolve({ type: 'death' })!.primitive).toBe('topple');
    expect(resolve({ type: 'death' })!.moodDelta).toBeLessThan(0);
    expect(resolve({ type: 'idle' })!.primitive).toBe('doze');
    expect(resolve({ type: 'spend' })!.primitive).toBe('slump');
    expect(resolve({ type: 'spend' })!.moodDelta).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  GAME_EVENT_TYPES,
  GEM_BAD_COPPER,
  GEM_GOOD_COPPER,
  GEM_PRIORITY_COPPER,
  INTENSITY_MAX,
  INTENSITY_MIN,
  MAX_IMPROVE,
  PRIORITY_CATEGORIES,
  resolve,
  type GameEvent,
} from '../events/bindings';
import { CATEGORIES } from '../companion/types';
import { PRIMITIVES } from '../render/animations';
import { COPPER_PER } from '../text/coins';

const SAMPLES: Record<GameEvent['type'], GameEvent> = {
  kill: { type: 'kill', streak: 1 },
  improve: { type: 'improve', from: 3, to: 4 },
  hurt: { type: 'hurt', levelsLost: 1 },
  death: { type: 'death' },
  loot: { type: 'loot', copper: 240 },
  spend: { type: 'spend' },
  sell: { type: 'sell' },
  gem: { type: 'gem', copper: GEM_GOOD_COPPER },
  intox: { type: 'intox', level: 1 },
  hangover: { type: 'hangover', level: 1 },
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

  it('a good stone starts at a mithryl, a bad one under a gold', () => {
    expect(GEM_GOOD_COPPER).toBe(COPPER_PER.mithryl);
    expect(GEM_BAD_COPPER).toBe(COPPER_PER.gold);
    // Ten gold used to be "good"; it is ordinary now.
    expect(resolve({ type: 'gem', copper: 10 * COPPER_PER.gold })).toBeNull();
    expect(resolve({ type: 'gem', copper: COPPER_PER.mithryl })!.category).toBe('gemGood');
    expect(resolve({ type: 'gem', copper: 2 * COPPER_PER.mithryl })!.category).toBe('gemGood');
  });

  it('only a death, a niebotyczne and a two-mithryl stone are priority', () => {
    expect(resolve({ type: 'death' })!.priority).toBe(true);
    expect(resolve({ type: 'improve', from: 14, to: MAX_IMPROVE })!.priority).toBe(true);
    expect(resolve({ type: 'gem', copper: GEM_PRIORITY_COPPER })!.priority).toBe(true);

    // An ordinary good stone is a good stone, not an announcement.
    expect(GEM_PRIORITY_COPPER).toBe(2 * COPPER_PER.mithryl);
    const ordinary = resolve({ type: 'gem', copper: GEM_PRIORITY_COPPER - 1 })!;
    expect(ordinary.category).toBe('gemGood');
    expect(ordinary.priority).toBe(false);

    for (const type of GAME_EVENT_TYPES) {
      if (type === 'death' || type === 'improve' || type === 'gem') continue;
      expect(resolve(SAMPLES[type])!.priority, type).toBeFalsy();
    }
    expect(resolve({ type: 'improve', from: 5, to: 6 })!.priority).toBeFalsy();
  });

  it('PRIORITY_CATEGORIES covers every category resolve can mark priority', () => {
    const marked = new Set(
      [
        resolve({ type: 'death' }),
        resolve({ type: 'improve', from: 14, to: MAX_IMPROVE }),
        resolve({ type: 'gem', copper: GEM_PRIORITY_COPPER }),
      ].map((reaction) => reaction!.category),
    );
    expect([...marked].sort()).toEqual([...PRIORITY_CATEGORIES].sort());
  });

  it('death topples, idle dozes, spend slumps', () => {
    expect(resolve({ type: 'death' })!.primitive).toBe('topple');
    expect(resolve({ type: 'death' })!.moodDelta).toBeLessThan(0);
    expect(resolve({ type: 'idle' })!.primitive).toBe('doze');
    expect(resolve({ type: 'spend' })!.primitive).toBe('slump');
    expect(resolve({ type: 'spend' })!.moodDelta).toBe(0);
  });

  it('a spend with a price sags harder than a small one', () => {
    const unknown = resolve({ type: 'spend' })!;
    const small = resolve({ type: 'spend', copper: 30 })!;
    const large = resolve({ type: 'spend', copper: 50 * COPPER_PER.gold })!;
    expect(large.intensity).toBeGreaterThan(small.intensity);
    expect(unknown.intensity).toBe(1);
    expect(large.category).toBe('spend');
    // Spending is not a mood event, however much it costs.
    expect(large.moodDelta).toBe(0);
  });

  it('a sale is a quieter gulp than the coins it brings in', () => {
    const sell = resolve({ type: 'sell' })!;
    const loot = resolve({ type: 'loot', copper: 10 * COPPER_PER.gold })!;
    expect(sell.primitive).toBe('gulp');
    expect(sell.category).toBe('sell');
    expect(sell.intensity).toBeLessThan(loot.intensity);
    expect(sell.moodDelta).toBeGreaterThan(0);
    expect(sell.moodDelta).toBeLessThan(loot.moodDelta);
  });
});

describe('drink', () => {
  it('staggers harder the further gone they are', () => {
    const light = resolve({ type: 'intox', level: 1 })!;
    const heavy = resolve({ type: 'intox', level: 3 })!;
    expect(light.primitive).toBe('sway');
    expect(heavy.primitive).toBe('sway');
    expect(heavy.intensity).toBeGreaterThan(light.intensity);
    expect(resolve({ type: 'intox', level: 9 })!.intensity).toBe(resolve({ type: 'intox', level: 3 })!.intensity);
  });

  it('enjoys the first drinks and stops enjoying the last', () => {
    expect(resolve({ type: 'intox', level: 1 })!.moodDelta).toBeGreaterThan(0);
    expect(resolve({ type: 'intox', level: 2 })!.moodDelta).toBeGreaterThan(0);
    expect(resolve({ type: 'intox', level: 3 })!.moodDelta).toBe(0);
  });

  it('takes the morning after harder than a drink was worth', () => {
    const hangover = resolve({ type: 'hangover', level: 1 })!;
    expect(hangover.primitive).toBe('wince');
    expect(hangover.category).toBe('hangover');
    expect(hangover.moodDelta).toBeLessThan(-resolve({ type: 'intox', level: 1 })!.moodDelta);
  });
  it('winces harder at a worse head', () => {
    const dull = resolve({ type: 'hangover', level: 1 })!;
    const awful = resolve({ type: 'hangover', level: 3 })!;
    expect(awful.intensity).toBeGreaterThan(dull.intensity);
    expect(awful.moodDelta).toBeLessThan(dull.moodDelta);
  });
});

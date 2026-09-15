import { describe, expect, it } from 'vitest';
import { CATEGORY_RULES, Speaker, linesFor } from '../voice/speak';
import { VOICES, VOICE_IDS } from '../voice/catalog';
import { CATEGORIES } from '../companion/types';
import { seededRng } from '../companion/rng';

const voice = VOICES.weteran;
const noMutes = { global: false, categories: [] as const };
const always = () => 0; // rng returning 0 -> passes every probability check, picks the first line

describe('speak', () => {
  it('produces a line when nothing holds it back', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 45_000 });
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, 0)).toBe('Mowilem, zeby uciekac. Za kazdym razem.');
  });

  it('respects the global cooldown and drops, never queues', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 45_000 });
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, 0)).not.toBeNull();
    expect(speaker.maybe(voice, 'improveMax', 'spokojnie', noMutes, 10_000)).toBeNull();
    expect(speaker.maybe(voice, 'improveMax', 'spokojnie', noMutes, 44_999)).toBeNull();
    expect(speaker.maybe(voice, 'improveMax', 'spokojnie', noMutes, 45_000)).not.toBeNull();
  });

  it('respects per-category cooldowns', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 0 });
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, 0)).not.toBeNull();
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, 5_000)).toBeNull();
    // Another category is free to speak in the meantime.
    expect(speaker.maybe(voice, 'improveMax', 'spokojnie', noMutes, 5_000)).not.toBeNull();
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, CATEGORY_RULES.death.cooldownMs)).not.toBeNull();
  });

  it('respects the global mute and per-category mutes', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 0 });
    expect(speaker.maybe(voice, 'death', 'spokojnie', { global: true, categories: [] }, 0)).toBeNull();
    expect(speaker.maybe(voice, 'death', 'spokojnie', { global: false, categories: ['death'] }, 0)).toBeNull();
    expect(speaker.maybe(voice, 'kill', 'spokojnie', { global: false, categories: ['death'] }, 0)).not.toBeNull();
  });

  it('honours the probability with a seeded rng', () => {
    const speaker = new Speaker({ rng: seededRng(42), globalCooldownMs: 0, rules: { kill: { probability: 0.08, cooldownMs: 0 } } });
    let spoken = 0;
    const trials = 5000;
    for (let i = 0; i < trials; i++) {
      if (speaker.maybe(voice, 'kill', 'spokojnie', noMutes, i * 1000)) spoken++;
    }
    const rate = spoken / trials;
    expect(rate).toBeGreaterThan(0.06);
    expect(rate).toBeLessThan(0.1);
  });

  it('a declined request does not start the cooldowns', () => {
    let calls = 0;
    // First call fails the probability check, second passes.
    const rng = () => (calls++ === 0 ? 0.99 : 0);
    const speaker = new Speaker({ rng, globalCooldownMs: 45_000 });
    expect(speaker.maybe(voice, 'kill', 'spokojnie', noMutes, 0)).toBeNull();
    expect(speaker.maybe(voice, 'kill', 'spokojnie', noMutes, 1)).not.toBeNull();
  });

  it('returns null for a missing category or voice', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 0 });
    expect(speaker.maybe({ name: 'x', lines: {} }, 'kill', 'spokojnie', noMutes, 0)).toBeNull();
    expect(speaker.maybe(undefined, 'kill', 'spokojnie', noMutes, 0)).toBeNull();
  });

  it('falls back to spokojnie when a bucket is missing', () => {
    const lines = { kill: { spokojnie: ['a'] } };
    expect(linesFor(lines, 'kill', 'zle')).toEqual(['a']);
    expect(linesFor(lines, 'kill', 'dobrze')).toEqual(['a']);
    expect(linesFor(lines, 'death', 'zle')).toEqual([]);
  });

  it('does not repeat the same line twice in a row when it has a choice', () => {
    const speaker = new Speaker({ rng: seededRng(7), globalCooldownMs: 0, rules: { kill: { probability: 1, cooldownMs: 0 } } });
    let previous: string | null = null;
    for (let i = 0; i < 200; i++) {
      const line = speaker.maybe(voice, 'kill', 'spokojnie', noMutes, i);
      expect(line).not.toBeNull();
      expect(line).not.toBe(previous);
      previous = line;
    }
  });

  it('every voice pack is ASCII-folded and has a spokojnie line for every category', () => {
    for (const id of VOICE_IDS) {
      const pack = VOICES[id];
      expect(pack, id).toBeDefined();
      for (const category of CATEGORIES) {
        const lines = linesFor(pack!.lines, category, 'spokojnie');
        expect(lines.length, `${id}/${category}`).toBeGreaterThan(0);
        for (const bucketLines of Object.values(pack!.lines[category] ?? {})) {
          for (const line of bucketLines ?? []) expect(line, `${id}/${category}`).toMatch(/^[\x20-\x7e]+$/);
        }
      }
    }
  });
});

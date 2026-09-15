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
    expect(speaker.maybe(voice, 'loot', 'spokojnie', noMutes, 0)).not.toBeNull();
    expect(speaker.maybe(voice, 'improve', 'spokojnie', noMutes, 10_000)).toBeNull();
    expect(speaker.maybe(voice, 'improve', 'spokojnie', noMutes, 44_999)).toBeNull();
    expect(speaker.maybe(voice, 'improve', 'spokojnie', noMutes, 45_000)).not.toBeNull();
  });

  it('lets a priority request speak through the global cooldown', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 45_000 });
    // The ordinary chatter a death arrives on the heels of.
    expect(speaker.maybe(voice, 'hurt', 'spokojnie', noMutes, 0)).not.toBeNull();
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, 1_000)).toBeNull();
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, 1_000, { priority: true })).not.toBeNull();
  });

  it('holds a priority request to its own cooldown and to the mutes', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 0 });
    const priority = { priority: true };
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, 0, priority)).not.toBeNull();
    // The same death reported twice - one line, not two.
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, 1, priority)).toBeNull();
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, CATEGORY_RULES.death.cooldownMs, priority)).not.toBeNull();

    const muted = new Speaker({ rng: always, globalCooldownMs: 0 });
    expect(muted.maybe(voice, 'death', 'spokojnie', { global: true, categories: [] }, 0, priority)).toBeNull();
    expect(muted.maybe(voice, 'death', 'spokojnie', { global: false, categories: ['death'] }, 0, priority)).toBeNull();
  });

  it('a priority line still holds the ordinary ones back afterwards', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 45_000 });
    expect(speaker.maybe(voice, 'death', 'spokojnie', noMutes, 0, { priority: true })).not.toBeNull();
    expect(speaker.maybe(voice, 'loot', 'spokojnie', noMutes, 1_000)).toBeNull();
    expect(speaker.maybe(voice, 'loot', 'spokojnie', noMutes, 45_000)).not.toBeNull();
  });

  it('spends the priority window once, then goes back to the global cooldown', () => {
    const window = CATEGORY_RULES.gemGood.priorityWindowMs!;
    // A player who asked for a five-minute pause. Without the window, gemGood's
    // own 60 s cooldown would be the only limit and the pause would be a lie.
    const speaker = new Speaker({ rng: always, globalCooldownMs: 300_000 });
    const priority = { priority: true };
    expect(speaker.maybe(voice, 'loot', 'spokojnie', noMutes, 0)).not.toBeNull();
    // First big stone of the bag: speaks through the pause.
    expect(speaker.maybe(voice, 'gemGood', 'spokojnie', noMutes, 1_000, priority)).not.toBeNull();
    // A second one a minute later, past its own cooldown but inside the window:
    // demoted, so the pause that is still running holds it back.
    expect(speaker.maybe(voice, 'gemGood', 'spokojnie', noMutes, 62_000, priority)).toBeNull();
    // Past the window the exemption is available again.
    expect(speaker.maybe(voice, 'loot', 'spokojnie', noMutes, window + 1_000)).not.toBeNull();
    expect(speaker.maybe(voice, 'gemGood', 'spokojnie', noMutes, window + 2_000, priority)).not.toBeNull();
  });

  it('a demoted priority request still speaks when the global cooldown is clear', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 45_000 });
    const priority = { priority: true };
    expect(speaker.maybe(voice, 'loot', 'spokojnie', noMutes, 0)).not.toBeNull();
    expect(speaker.maybe(voice, 'gemGood', 'spokojnie', noMutes, 1_000, priority)).not.toBeNull();
    // Inside the window, so no exemption - but nothing needs one by now either.
    expect(speaker.maybe(voice, 'gemGood', 'spokojnie', noMutes, 90_000, priority)).not.toBeNull();
  });

  it('does not spend the window when the global cooldown was clear anyway', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 45_000 });
    const priority = { priority: true };
    // Nothing is holding the cooldown, so priority changes nothing here.
    expect(speaker.maybe(voice, 'gemGood', 'spokojnie', noMutes, 0, priority)).not.toBeNull();
    expect(speaker.maybe(voice, 'loot', 'spokojnie', noMutes, 60_000)).not.toBeNull();
    // The exemption was never used, so it is there for the next stone.
    expect(speaker.maybe(voice, 'gemGood', 'spokojnie', noMutes, 61_000, priority)).not.toBeNull();
  });

  it('forgets the priority window on reset', () => {
    const speaker = new Speaker({ rng: always, globalCooldownMs: 45_000 });
    const priority = { priority: true };
    expect(speaker.maybe(voice, 'loot', 'spokojnie', noMutes, 0)).not.toBeNull();
    expect(speaker.maybe(voice, 'gemGood', 'spokojnie', noMutes, 1_000, priority)).not.toBeNull();
    speaker.reset();
    expect(speaker.maybe(voice, 'loot', 'spokojnie', noMutes, 2_000)).not.toBeNull();
    expect(speaker.maybe(voice, 'gemGood', 'spokojnie', noMutes, 3_000, priority)).not.toBeNull();
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

  it('takes a per-event probability over the category default', () => {
    const half = () => 0.5;
    const speaker = new Speaker({ rng: half, globalCooldownMs: 0 });
    // The category rule would decline at 0.5; the event says it is likelier.
    expect(CATEGORY_RULES.clear.probability).toBeLessThan(0.5);
    expect(speaker.maybe(voice, 'clear', 'spokojnie', noMutes, 0)).toBeNull();
    expect(speaker.maybe(voice, 'clear', 'spokojnie', noMutes, 0, { probability: 0.9 })).not.toBeNull();
    // ...and an event that says it is less likely is declined.
    const later = CATEGORY_RULES.clear.cooldownMs;
    expect(speaker.maybe(voice, 'clear', 'spokojnie', noMutes, later, { probability: 0.1 })).toBeNull();
    // A nonsense override is ignored rather than trusted.
    expect(speaker.maybe(voice, 'improve', 'spokojnie', noMutes, 0, { probability: -1 })).not.toBeNull();
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

import { describe, expect, it } from 'vitest';
import {
  CLEAR_MIN_KILLS,
  CLEAR_PROBABILITY_FULL,
  CLEAR_PROBABILITY_MAX,
  CLEAR_PROBABILITY_MIN,
  clearProbability,
  GAME_EVENT_TYPES,
  SILENT_EVENT_TYPES,
  GEM_BAD_COPPER,
  GEM_GOOD_COPPER,
  GEM_PRIORITY_COPPER,
  INTENSITY_MAX,
  INTENSITY_MIN,
  MAX_IMPROVE,
  guardFor,
  POSTURE_ONLY_EVENT_TYPES,
  POSTURE_ORDER,
  PRIORITY_CATEGORIES,
  resolve,
  STANCES,
  stanceFor,
  type GameEvent,
} from '../events/bindings';
import { ARCHETYPES, CATEGORIES, type CompanionSpec, type Primitive } from '../companion/types';
import { MOOD_MIN } from '../companion/mood';
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
  fatigue: { type: 'fatigue' },
  knowledge: { type: 'knowledge' },
  clear: { type: 'clear', count: CLEAR_MIN_KILLS },
  stun: { type: 'stun', on: true },
  panic: { type: 'panic', level: 1 },
  combat: { type: 'combat', on: true },
  apocalypse: { type: 'apocalypse', on: true },
  pipe: { type: 'pipe', on: true },
  mail: { type: 'mail' },
  fishing: { type: 'fishing', state: 'bite' },
  travel: { type: 'travel' },
  transform: { type: 'transform' },
  idle: { type: 'idle' },
  bored: { type: 'bored' },
  temper: { type: 'temper' },
};

/**
 * Every event the client can actually produce, and that is meant to produce a
 * reaction: all of them bar the plugin's own and the ones that are nothing but
 * a posture.
 */
const CLIENT_EVENT_TYPES = GAME_EVENT_TYPES.filter(
  (type) => !SILENT_EVENT_TYPES.includes(type) && !POSTURE_ONLY_EVENT_TYPES.includes(type),
);

describe('bindings', () => {
  it('every client event maps to a valid primitive and category', () => {
    for (const type of CLIENT_EVENT_TYPES) {
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

  it('only a death, a niebotyczne, a two-mithryl stone, a przeobrazenie and the Apocalypse are priority', () => {
    expect(resolve({ type: 'death' })!.priority).toBe(true);
    expect(resolve({ type: 'improve', from: 14, to: MAX_IMPROVE })!.priority).toBe(true);
    expect(resolve({ type: 'gem', copper: GEM_PRIORITY_COPPER })!.priority).toBe(true);
    expect(resolve({ type: 'transform' })!.priority).toBe(true);
    expect(resolve({ type: 'apocalypse', on: true })!.priority).toBe(true);

    // An ordinary good stone is a good stone, not an announcement.
    expect(GEM_PRIORITY_COPPER).toBe(2 * COPPER_PER.mithryl);
    const ordinary = resolve({ type: 'gem', copper: GEM_PRIORITY_COPPER - 1 })!;
    expect(ordinary.category).toBe('gemGood');
    expect(ordinary.priority).toBe(false);

    for (const type of CLIENT_EVENT_TYPES) {
      if (type === 'death' || type === 'improve' || type === 'gem' || type === 'transform' || type === 'apocalypse') {
        continue;
      }
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
        resolve({ type: 'transform' }),
        resolve({ type: 'apocalypse', on: true }),
      ].map((reaction) => reaction!.category),
    );
    expect([...marked].sort()).toEqual([...PRIORITY_CATEGORIES].sort());
  });

  it('declines the events that the plugin raises itself', () => {
    // The greeting has lines and a category but no reaction: nothing in the
    // game happened, so there is nothing to react to.
    for (const type of SILENT_EVENT_TYPES) expect(resolve(SAMPLES[type]), type).toBeNull();
    expect(SILENT_EVENT_TYPES.length).toBeGreaterThan(0);
  });

  it('puts the mood on the floor for a death instead of nudging it', () => {
    const death = resolve({ type: 'death' })!;
    // Not a delta: whatever kind of day it was, a death ends it.
    expect(death.moodDelta).toBe(0);
    expect(death.moodSet).toBe(MOOD_MIN);
    // And nothing else works that way.
    for (const type of CLIENT_EVENT_TYPES) {
      if (type === 'death') continue;
      expect(resolve(SAMPLES[type])?.moodSet, type).toBeUndefined();
    }
  });

  it('death topples, idle dozes, spend slumps', () => {
    expect(resolve({ type: 'death' })!.primitive).toBe('topple');
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

describe('a cleared room', () => {
  it('says nothing about a room that was one wandering rat', () => {
    expect(resolve({ type: 'clear', count: 0 })).toBeNull();
    expect(resolve({ type: 'clear', count: CLEAR_MIN_KILLS - 1 })).toBeNull();
  });

  it('is likelier to be worth a word the bigger the group was', () => {
    const pair = resolve({ type: 'clear', count: 2 })!;
    const few = resolve({ type: 'clear', count: 5 })!;
    const many = resolve({ type: 'clear', count: CLEAR_PROBABILITY_FULL })!;
    expect(pair.probability).toBe(CLEAR_PROBABILITY_MIN);
    expect(many.probability).toBe(CLEAR_PROBABILITY_MAX);
    expect(few.probability!).toBeGreaterThan(pair.probability!);
    expect(few.probability!).toBeLessThan(many.probability!);
    // And it tops out rather than climbing past certainty.
    expect(resolve({ type: 'clear', count: 40 })!.probability).toBe(CLEAR_PROBABILITY_MAX);
    expect(clearProbability(1)).toBe(CLEAR_PROBABILITY_MIN);
  });

  it('scales the cheer and what it was worth along with it', () => {
    const pair = resolve({ type: 'clear', count: 2 })!;
    const many = resolve({ type: 'clear', count: CLEAR_PROBABILITY_FULL })!;
    expect(many.intensity).toBeGreaterThan(pair.intensity);
    expect(many.moodDelta).toBeGreaterThan(pair.moodDelta);
    expect(pair.moodDelta).toBeGreaterThan(0);
  });

  it('is the only thing that carries its own probability', () => {
    for (const type of CLIENT_EVENT_TYPES) {
      if (type === 'clear') continue;
      expect(resolve(SAMPLES[type])?.probability, type).toBeUndefined();
    }
  });
});

describe('fatigue', () => {
  it('sags and complains, and costs a little', () => {
    const spent = resolve({ type: 'fatigue' })!;
    expect(spent.primitive).toBe('slump');
    expect(spent.category).toBe('fatigue');
    expect(spent.moodDelta).toBeLessThan(0);
    // Tiredness is a grumble, not an injury: it costs less than being hit.
    expect(spent.moodDelta).toBeGreaterThan(resolve({ type: 'hurt', levelsLost: 1 })!.moodDelta);
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

  it('says nothing about clearing a room of one', () => {
    // The client calls the room clear whenever the last enemy dies, which after
    // a lone rat is every kill; the kill already had its reaction.
    expect(resolve({ type: 'clear', count: 1 })).toBeNull();
    expect(resolve({ type: 'clear', count: 0 })).toBeNull();
    const group = resolve({ type: 'clear', count: CLEAR_MIN_KILLS })!;
    expect(group.primitive).toBe('cheer');
    expect(group.category).toBe('clear');
    expect(resolve({ type: 'clear', count: 6 })!.intensity).toBeGreaterThan(group.intensity);
  });

  it('brightens at a tick of knowledge', () => {
    const tick = resolve({ type: 'knowledge' })!;
    expect(tick.primitive).toBe('glitter');
    expect(tick.moodDelta).toBeGreaterThan(0);
  });

  it('reacts to being stunned but not to coming round', () => {
    const stunned = resolve({ type: 'stun', on: true })!;
    expect(stunned.primitive).toBe('stun');
    expect(stunned.moodDelta).toBeLessThan(0);
    expect(resolve({ type: 'stun', on: false })).toBeNull();
  });

  it('keeps its reactions to the two moments of fishing worth one', () => {
    expect(resolve({ type: 'fishing', state: 'waiting' })).toBeNull();
    expect(resolve({ type: 'fishing', state: 'done' })).toBeNull();
    expect(resolve({ type: 'fishing', state: 'bite' })!.category).toBe('fishBite');
    const caught = resolve({ type: 'fishing', state: 'catch' })!;
    expect(caught.category).toBe('fishCatch');
    expect(caught.moodDelta).toBeGreaterThan(resolve({ type: 'fishing', state: 'bite' })!.moodDelta);
  });

  it('sways on a deck and warps through a przeobrazenie', () => {
    expect(resolve({ type: 'travel' })!.primitive).toBe('sway');
    expect(resolve({ type: 'transform' })!.primitive).toBe('shift');
  });
});

describe('stances', () => {
  it('sits the companion down for a cast and stands them up afterwards', () => {
    expect(stanceFor({ type: 'fishing', state: 'waiting' })).toEqual({ key: 'fishing', primitive: 'watch' });
    // The bite happens sitting down, so it leaves the sitting alone.
    expect(stanceFor({ type: 'fishing', state: 'bite' })).toBeUndefined();
    expect(stanceFor({ type: 'fishing', state: 'catch' })).toEqual({ key: 'fishing', primitive: null });
    expect(stanceFor({ type: 'fishing', state: 'done' })).toEqual({ key: 'fishing', primitive: null });
  });

  it('holds a stun for as long as the client says it lasts', () => {
    expect(stanceFor({ type: 'stun', on: true })).toEqual({ key: 'stun', primitive: 'stun' });
    expect(stanceFor({ type: 'stun', on: false })).toEqual({ key: 'stun', primitive: null });
  });

  it('draws a weapon for a fight and puts it away afterwards, and says nothing either way', () => {
    expect(stanceFor({ type: 'combat', on: true })).toEqual({ key: 'combat', primitive: 'guard' });
    expect(stanceFor({ type: 'combat', on: false })).toEqual({ key: 'combat', primitive: null });
    expect(resolve({ type: 'combat', on: true })).toBeNull();
    expect(resolve({ type: 'combat', on: false })).toBeNull();
  });

  it('hides for the Apocalypse until it stops counting', () => {
    expect(stanceFor({ type: 'apocalypse', on: true })).toEqual({ key: 'apocalypse', primitive: 'hide' });
    expect(stanceFor({ type: 'apocalypse', on: false })).toEqual({ key: 'apocalypse', primitive: null });
  });

  it('marks a pipe rather than sitting it out, because a lit pipe travels', () => {
    expect(stanceFor({ type: 'pipe', on: true })).toBeUndefined();
    expect(stanceFor({ type: 'pipe', on: false })).toBeUndefined();
    expect(resolve({ type: 'pipe', on: true })!.primitive).toBe('smoke');
    expect(resolve({ type: 'pipe', on: false })).toBeNull();
  });

  it('ranks the postures so the more urgent state wins', () => {
    // One key per state, every state named, and a stun above all of them: a
    // companion who cannot stand up is not holding a sword.
    expect([...POSTURE_ORDER].sort()).toEqual(['apocalypse', 'combat', 'fishing', 'stun']);
    expect(POSTURE_ORDER[0]).toBe('stun');
    expect(POSTURE_ORDER.indexOf('apocalypse')).toBeLessThan(POSTURE_ORDER.indexOf('combat'));
    expect(POSTURE_ORDER.indexOf('combat')).toBeLessThan(POSTURE_ORDER.indexOf('fishing'));
  });

  it('arms every companion, and the robed ones with a staff', () => {
    const spec = (archetype: CompanionSpec['archetype'], hasWeapon: boolean): CompanionSpec => ({
      archetype,
      name: 'Test',
      voiceId: 'giermek',
      palette: { skin: '#000000', hair: '#000000', armour: '#000000', belt: '#000000', legs: '#000000', weapon: null },
      parts: { hairLong: false, hasWeapon },
    });
    expect(guardFor(spec('wizard', true))).toBe('guardStaff');
    expect(guardFor(spec('magician', false))).toBe('guardStaff');
    expect(guardFor(spec('goblin', true))).toBe('guard');
    // The roll's own `hasWeapon` does not decide this any more: everybody has
    // something to draw.
    expect(guardFor(spec('ogre', false))).toBe('guard');
    for (const archetype of ARCHETYPES) expect(STANCES).toContain(guardFor(spec(archetype, true)));
  });

  it('ends whatever posture a death interrupted', () => {
    expect(stanceFor({ type: 'death' })).toBeNull();
  });

  it('leaves the posture alone for everything else', () => {
    const postural = ['fishing', 'stun', 'death', 'combat', 'apocalypse'];
    for (const type of GAME_EVENT_TYPES) {
      if (postural.includes(type)) continue;
      expect(stanceFor(SAMPLES[type]), type).toBeUndefined();
    }
  });

  it('only ever names an animation that exists, and never the idle', () => {
    for (const stance of STANCES) {
      expect(PRIMITIVES).toContain(stance);
      expect(stance).not.toBe('idle');
    }
  });

  it('STANCES covers every posture stanceFor and guardFor can ask for', () => {
    const asked = new Set<Primitive>();
    const every: GameEvent[] = [
      ...GAME_EVENT_TYPES.map((type) => SAMPLES[type]),
      { type: 'fishing', state: 'waiting' },
      { type: 'fishing', state: 'catch' },
      { type: 'fishing', state: 'done' },
      { type: 'stun', on: true },
      { type: 'stun', on: false },
      { type: 'combat', on: false },
      { type: 'apocalypse', on: false },
    ];
    for (const event of every) {
      const posture = stanceFor(event);
      if (posture && posture.primitive) asked.add(posture.primitive);
    }
    // The generic `guard` is swapped for the companion's own weapon on the way
    // to the animator, so every weapon it can name is a posture too.
    for (const archetype of ARCHETYPES) {
      asked.add(
        guardFor({
          archetype,
          name: 'Test',
          voiceId: 'giermek',
          palette: { skin: '#000000', hair: '#000000', armour: '#000000', belt: '#000000', legs: '#000000', weapon: null },
          parts: { hairLong: false, hasWeapon: true },
        }),
      );
    }
    expect([...asked].sort()).toEqual([...STANCES].sort());
  });

  it('GAME_EVENT_TYPES names every event there is', () => {
    expect([...GAME_EVENT_TYPES].sort()).toEqual(Object.keys(SAMPLES).sort());
  });
});

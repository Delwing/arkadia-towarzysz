/**
 * Client event -> reaction. Pure: takes a normalised description of what
 * happened and returns { primitive, intensity, category, moodDelta }.
 *
 * Intensity scaling is what lets one small set of animations cover a hundred
 * scripted actions: a small coin and a huge haul are the same `gulp` at
 * different amplitudes. The mood nudges are indicative and meant to be tuned.
 *
 * A few of the client's events are states rather than moments - a stun that
 * lasts, a float on the water - and those leave the companion in a posture
 * afterwards. That is `stanceFor`, at the bottom of this file.
 */

import type { Category, Primitive } from '../companion/types';
import { COPPER_PER } from '../text/coins';

export const MAX_IMPROVE = 15;

export type GameEvent =
  | { type: 'kill'; streak: number }
  | { type: 'improve'; from: number; to: number }
  | { type: 'hurt'; levelsLost: number }
  | { type: 'death' }
  | { type: 'loot'; copper: number }
  /** `copper` when the line said how much changed hands, otherwise unknown. */
  | { type: 'spend'; copper?: number }
  /** Goods sold. The payment, if the game prints it, arrives separately as `loot`. */
  | { type: 'sell' }
  | { type: 'gem'; copper: number }
  /**
   * The drink landing. `level` is the stage of `Char.State.intox` just crossed:
   * 1 a first warmth, 2 properly drunk, 3 barely upright. Stages, not the number
   * itself - see `events/sources.ts`, which only reports a crossing upward.
   */
  | { type: 'intox'; level: number }
  /** The head the next morning, in the same three stages, off `Char.State.headache`. */
  | { type: 'hangover'; level: number }
  /** The game said a field of knowledge grew. One tick, whichever field it was. */
  | { type: 'knowledge' }
  /**
   * The room ran out of enemies. `count` is how many went down clearing it, so
   * that finishing off one wandering rat is not mistaken for winning a battle.
   */
  | { type: 'clear'; count: number }
  /** Stunned, and later not. A state, not a moment: see `stanceFor`. */
  | { type: 'stun'; on: boolean }
  /**
   * Fishing, as the client's own tracker sees it. `waiting` is the float on the
   * water, `bite` the line going tight, `catch` the fish landed and `done` the
   * rod out of the water with nothing to show for it.
   */
  | { type: 'fishing'; state: 'waiting' | 'bite' | 'catch' | 'done' }
  /** Aboard a ship or a coach. */
  | { type: 'travel' }
  /** The character is wearing a different body: przeobrazenie, or it wearing off. */
  | { type: 'transform' }
  | { type: 'idle' };

export type GameEventType = GameEvent['type'];

export const GAME_EVENT_TYPES: readonly GameEventType[] = [
  'kill',
  'improve',
  'hurt',
  'death',
  'loot',
  'spend',
  'sell',
  'gem',
  'intox',
  'hangover',
  'knowledge',
  'clear',
  'stun',
  'fishing',
  'travel',
  'transform',
  'idle',
];

export interface Reaction {
  primitive: Primitive;
  intensity: number;
  category: Category;
  moodDelta: number;
  /**
   * Big enough to speak through the global cooldown (`voice/speak.ts`). The
   * judgement is per event, not per category: the same `gemGood` is priority
   * at two mithryls and an ordinary remark at one.
   */
  priority?: boolean;
}

/**
 * Every category `resolve` can mark priority. The settings panel lists these
 * so the exemption is not invisible; a test keeps the list honest.
 */
export const PRIORITY_CATEGORIES: readonly Category[] = ['death', 'improveMax', 'gemGood', 'transform'];

export const MOOD = {
  kill: 0.04,
  loot: 0.15,
  improve: 0.25,
  improveMax: 0.45,
  gemGood: 0.1,
  gemBad: -0.02,
  hurt: -0.05,
  death: -0.35,
  spend: 0,
  sell: 0.05,
  intox: 0.06,
  hangover: -0.1,
  knowledge: 0.12,
  clear: 0.12,
  stun: -0.08,
  fishBite: 0.03,
  fishCatch: 0.12,
  travel: 0.04,
  transform: 0.02,
  idle: 0,
} as const;

/**
 * How many of a room's enemies have to go down before clearing it is worth a
 * reaction. The client fires `allEnemiesKilled` whenever the last one dies, so
 * every single kill ends with a cleared room; two is where it starts being a
 * fight you won rather than a thing you did.
 */
export const CLEAR_MIN_KILLS = 2;

/**
 * Copper worth of a gem read-out that counts as "high" / "low"; between the
 * two, no reaction. A stone worth getting excited about starts at a mithryl -
 * gold-priced stones are common enough to be noise.
 */
export const GEM_GOOD_COPPER = COPPER_PER.mithryl;
export const GEM_BAD_COPPER = COPPER_PER.gold;
/**
 * A stone worth speaking through the global cooldown for. One mithryl is a
 * good find and gets the ordinary `gemGood` treatment; two is the one you tell
 * someone about. Unlike a death, these arrive in bags, so the exemption is
 * rationed by `gemGood`'s `priorityWindowMs`.
 */
export const GEM_PRIORITY_COPPER = 2 * COPPER_PER.mithryl;
/** Loot at or above this is a full-size haul (intensity and mood both max out). */
export const LOOT_FULL_COPPER = 2_400;

export const INTENSITY_MIN = 0.4;
export const INTENSITY_MAX = 2.5;

export function clampIntensity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, value));
}

/** Resolve a game event. Returns null when it does not deserve a reaction. */
export function resolve(event: GameEvent): Reaction | null {
  switch (event.type) {
    case 'kill': {
      const streak = Math.max(1, Math.floor(event.streak));
      return {
        primitive: 'lunge',
        intensity: clampIntensity(1 + (streak - 1) * 0.15),
        category: 'kill',
        // A streak multiplies the same nudge; it is not a separate event.
        moodDelta: MOOD.kill,
      };
    }
    case 'improve': {
      if (event.to <= event.from) return null;
      if (event.to >= MAX_IMPROVE) {
        return { primitive: 'cheer', intensity: 2.5, category: 'improveMax', moodDelta: MOOD.improveMax, priority: true };
      }
      return { primitive: 'cheer', intensity: 1, category: 'improve', moodDelta: MOOD.improve };
    }
    case 'hurt': {
      const lost = Math.floor(event.levelsLost);
      if (lost <= 0) return null;
      return {
        primitive: 'flinch',
        intensity: clampIntensity(0.8 + lost * 0.5),
        category: 'hurt',
        moodDelta: MOOD.hurt * Math.min(lost, 3),
      };
    }
    case 'death':
      return { primitive: 'topple', intensity: 1, category: 'death', moodDelta: MOOD.death, priority: true };
    case 'loot': {
      if (!(event.copper > 0)) return null;
      const share = Math.min(1, event.copper / LOOT_FULL_COPPER);
      return {
        primitive: 'gulp',
        // log-ish ramp: a handful of copper is a twitch, a purse of gold a proper gulp
        intensity: clampIntensity(0.5 + Math.log10(1 + event.copper) / 2),
        category: 'loot',
        moodDelta: MOOD.loot * Math.max(0.1, share),
      };
    }
    case 'spend': {
      const copper = event.copper;
      return {
        primitive: 'slump',
        // A known price scales the sag the same way loot scales the gulp; an
        // unknown one ("Kupujesz chleb.") is an ordinary slump.
        intensity: copper && copper > 0 ? clampIntensity(0.5 + Math.log10(1 + copper) / 2) : 1,
        category: 'spend',
        moodDelta: MOOD.spend,
      };
    }
    case 'sell':
      // Quieter than loot: the coins themselves usually land on the next line
      // and get their own, bigger reaction.
      return { primitive: 'gulp', intensity: 0.8, category: 'sell', moodDelta: MOOD.sell };
    case 'gem': {
      if (event.copper >= GEM_GOOD_COPPER) {
        return {
          primitive: 'glitter',
          intensity: 2.2,
          category: 'gemGood',
          moodDelta: MOOD.gemGood,
          priority: event.copper >= GEM_PRIORITY_COPPER,
        };
      }
      if (event.copper < GEM_BAD_COPPER) {
        return { primitive: 'slump', intensity: 1, category: 'gemBad', moodDelta: MOOD.gemBad };
      }
      return null;
    }
    case 'intox': {
      const level = Math.min(3, Math.max(1, Math.floor(event.level) || 1));
      return {
        primitive: 'sway',
        intensity: clampIntensity(0.8 + (level - 1) * 0.7),
        category: 'intox',
        // Good company, up to a point: the third stage is where the companion
        // stops enjoying it, so the nudge drops away rather than piling up.
        moodDelta: level >= 3 ? 0 : MOOD.intox,
      };
    }
    case 'hangover': {
      const level = Math.min(3, Math.max(1, Math.floor(event.level) || 1));
      return {
        primitive: 'wince',
        intensity: clampIntensity(0.7 + (level - 1) * 0.5),
        category: 'hangover',
        // Even the dull one costs more than the drink that bought it was worth.
        moodDelta: MOOD.hangover * (0.8 + (level - 1) * 0.4),
      };
    }
    case 'knowledge':
      // One tick is one tick: the game does not say how big it was, so neither
      // does the companion.
      return { primitive: 'glitter', intensity: 1.2, category: 'knowledge', moodDelta: MOOD.knowledge };
    case 'clear': {
      const count = Math.floor(event.count);
      if (count < CLEAR_MIN_KILLS) return null;
      return {
        primitive: 'cheer',
        intensity: clampIntensity(0.9 + (count - CLEAR_MIN_KILLS) * 0.25),
        category: 'clear',
        moodDelta: MOOD.clear,
      };
    }
    case 'stun':
      // The end of it is a posture returning to normal, not news.
      if (!event.on) return null;
      return { primitive: 'stun', intensity: 1, category: 'stun', moodDelta: MOOD.stun };
    case 'fishing':
      switch (event.state) {
        case 'bite':
          return { primitive: 'cheer', intensity: 1.6, category: 'fishBite', moodDelta: MOOD.fishBite };
        case 'catch':
          return { primitive: 'glitter', intensity: 1.5, category: 'fishCatch', moodDelta: MOOD.fishCatch };
        // Casting and giving up are postures; `stanceFor` has them.
        default:
          return null;
      }
    case 'travel':
      return { primitive: 'sway', intensity: 0.9, category: 'travel', moodDelta: MOOD.travel };
    case 'transform':
      // Rare enough - twice per spell, and not every evening has one - that
      // silence would read as the companion not looking at you.
      return { primitive: 'shift', intensity: 1, category: 'transform', moodDelta: MOOD.transform, priority: true };
    case 'idle':
      return { primitive: 'doze', intensity: 1, category: 'idle', moodDelta: MOOD.idle };
  }
}

/**
 * The posture an event leaves the companion in: a primitive to hold, `null` to
 * stand them up again, `undefined` to leave them as they are.
 *
 * Separate from `resolve` because a posture is not a reaction. Sitting down by
 * the water is not news and says nothing; the stun that is over is only the end
 * of one. What they do about an event and what they are left doing afterwards
 * are two questions, and a stance outlives the animation that announced it.
 */
/**
 * Every posture `stanceFor` can put the companion in. The showcase lists these
 * so a stance can be looked at for as long as it takes to judge one; a test
 * keeps the list honest against `stanceFor`.
 */
export const STANCES: readonly Primitive[] = ['watch', 'stun'];

export function stanceFor(event: GameEvent): Primitive | null | undefined {
  switch (event.type) {
    case 'stun':
      return event.on ? 'stun' : null;
    case 'fishing':
      // The bite happens sitting down, so it leaves the sitting alone.
      return event.state === 'waiting' ? 'watch' : event.state === 'bite' ? undefined : null;
    // Whatever they were in the middle of, they are not in the middle of it now.
    case 'death':
      return null;
    default:
      return undefined;
  }
}

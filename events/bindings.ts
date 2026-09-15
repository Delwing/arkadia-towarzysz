/**
 * Client event -> reaction. Pure: takes a normalised description of what
 * happened and returns { primitive, intensity, category, moodDelta }.
 *
 * Intensity scaling is what lets one small set of animations cover a hundred
 * scripted actions: a small coin and a huge haul are the same `gulp` at
 * different amplitudes. The mood nudges are indicative and meant to be tuned.
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
export const PRIORITY_CATEGORIES: readonly Category[] = ['death', 'improveMax', 'gemGood'];

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
  idle: 0,
} as const;

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
    case 'idle':
      return { primitive: 'doze', intensity: 1, category: 'idle', moodDelta: MOOD.idle };
  }
}

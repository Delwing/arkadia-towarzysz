/**
 * Client event -> reaction. Pure: takes a normalised description of what
 * happened and returns { primitive, intensity, category, moodDelta }.
 *
 * Intensity scaling is what lets one small set of animations cover a hundred
 * scripted actions: a small coin and a huge haul are the same `gulp` at
 * different amplitudes. The mood nudges are indicative and meant to be tuned.
 */

import type { Category, Primitive } from '../companion/types';

export const MAX_IMPROVE = 15;

export type GameEvent =
  | { type: 'kill'; streak: number }
  | { type: 'improve'; from: number; to: number }
  | { type: 'hurt'; levelsLost: number }
  | { type: 'death' }
  | { type: 'loot'; copper: number }
  | { type: 'spend' }
  | { type: 'gem'; copper: number }
  | { type: 'idle' };

export type GameEventType = GameEvent['type'];

export const GAME_EVENT_TYPES: readonly GameEventType[] = ['kill', 'improve', 'hurt', 'death', 'loot', 'spend', 'gem', 'idle'];

export interface Reaction {
  primitive: Primitive;
  intensity: number;
  category: Category;
  moodDelta: number;
}

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
  idle: 0,
} as const;

/** Copper worth of a gem read-out that counts as "high" / "low". Between: no reaction. */
export const GEM_GOOD_COPPER = 2_400;
export const GEM_BAD_COPPER = 240;
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
        return { primitive: 'cheer', intensity: 2.5, category: 'improveMax', moodDelta: MOOD.improveMax };
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
      return { primitive: 'topple', intensity: 1, category: 'death', moodDelta: MOOD.death };
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
    case 'spend':
      return { primitive: 'slump', intensity: 1, category: 'spend', moodDelta: MOOD.spend };
    case 'gem': {
      if (event.copper >= GEM_GOOD_COPPER) {
        return { primitive: 'glitter', intensity: 2.2, category: 'gemGood', moodDelta: MOOD.gemGood };
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

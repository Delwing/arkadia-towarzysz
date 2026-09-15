/**
 * Shared data model for the companion. Pure types, no runtime code, so every
 * module can import it without pulling anything else in.
 */

import type { Temper } from './temper';

export type { Temper } from './temper';

export type Archetype =
  | 'magician'
  | 'wizard'
  | 'villager' // human-ish, faces visible
  | 'monster'
  | 'ogre'
  | 'orc'
  | 'goblin'; // not human, faces very visible

export const ARCHETYPES: readonly Archetype[] = [
  'magician',
  'wizard',
  'villager',
  'monster',
  'ogre',
  'orc',
  'goblin',
];

export interface Palette {
  skin: string;
  hair: string;
  armour: string;
  belt: string;
  legs: string;
  weapon: string | null;
}

export interface CompanionSpec {
  archetype: Archetype;
  /** From that archetype's name pool. */
  name: string;
  /** Key into voices.json. */
  voiceId: string;
  /** Applied to the sprite sheet at load. */
  palette: Palette;
  parts: { hasWeapon: boolean };
}

/** Speech categories. One per reaction kind; the voice packs are keyed by them. */
export type Category =
  | 'kill'
  | 'improve'
  | 'improveMax'
  | 'hurt'
  | 'death'
  | 'loot'
  | 'spend'
  | 'sell'
  | 'gemGood'
  | 'gemBad'
  /** The drink going to their head. */
  | 'intox'
  /** The morning after it. */
  | 'hangover'
  /** Something learned - the game's own "czujesz, ze twoja wiedza ... wzrosla". */
  | 'knowledge'
  /** The last of a group down, and the room quiet again. */
  | 'clear'
  /** Ogluszenie: the character cannot act, and the companion can see it. */
  | 'stun'
  /** Panika: the game's own fear meter, climbing. */
  | 'panic'
  /** The Apocalypse: the client is counting the minutes to the world ending. */
  | 'apocalypse'
  /** A pipe lit, and a companion who sits down for it. */
  | 'pipe'
  /** Somebody wrote to you. */
  | 'mail'
  /** A fish on the line. */
  | 'fishBite'
  /** And the fish out of the water. */
  | 'fishCatch'
  /** A deck under your feet. */
  | 'travel'
  /** Przeobrazenie: you are wearing somebody else. */
  | 'transform'
  | 'idle'
  /** Awake, at the keyboard, and nothing has happened for a good while. */
  | 'bored'
  /** Zmeczenie at the bottom of the bar: the character cannot keep this up. */
  | 'fatigue'
  /** How they woke up: the day's first line. See `companion/temper.ts`. */
  | 'temper';

export const CATEGORIES: readonly Category[] = [
  'kill',
  'improve',
  'improveMax',
  'hurt',
  'death',
  'loot',
  'spend',
  'sell',
  'gemGood',
  'gemBad',
  'intox',
  'hangover',
  'knowledge',
  'clear',
  'stun',
  'panic',
  'apocalypse',
  'pipe',
  'mail',
  'fishBite',
  'fishCatch',
  'travel',
  'transform',
  'idle',
  'bored',
  'fatigue',
  'temper',
];

/** Mood buckets used for line selection. */
export type MoodBucket = 'zle' | 'spokojnie' | 'dobrze';

/**
 * Animation primitives. `idle` is always running underneath.
 *
 * The names are not listed here: they come from the animation table in
 * `render/animations.ts`, which is the one place an animation is described.
 * This is a type-only re-export, so the data model still pulls in no runtime
 * code of the renderer's.
 */
export type { Primitive } from '../render/animations';

/** How often the companion does something of their own accord. */
export type AmbientLevel = 'off' | 'rare' | 'normal' | 'often';

export const AMBIENT_LEVELS: readonly AmbientLevel[] = ['off', 'rare', 'normal', 'often'];

export interface PersistedState {
  version: 1;
  spec: CompanionSpec;
  /** Max 1. */
  rerollsUsed: number;
  /** -1..+1 */
  mood: number;
  /** Epoch ms of the last nudge or drift step. A load re-bases it to now. */
  moodTouchedAt: number;
  /**
   * The day's temper: where the mood settles. Rolled once a session rather
   * than once per companion - see `companion/temper.ts`.
   */
  temper: Temper;
  /** Epoch ms of the first meeting; the card shows it. Older saves get their load time. */
  metAt: number;
  mutes: { global: boolean; categories: Category[] };
  stats: { kills: number; deaths: number; sessions: number };
  /**
   * User settings that live with the companion. Not in the original spec's
   * state shape; added because the settings panel needs somewhere persistent
   * for the voice override and the cooldown.
   */
  settings: {
    /** null = the rolled voice. */
    voiceOverride: string | null;
    globalCooldownMs: number;
    idleMinutes: number;
    /** How busy the companion is when left alone; see companion/ambient.ts. */
    ambientLevel: AmbientLevel;
  };
}

export const STATE_VERSION = 1 as const;

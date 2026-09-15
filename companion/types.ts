/**
 * Shared data model for the companion. Pure types, no runtime code, so every
 * module can import it without pulling anything else in.
 */

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
  parts: { hairLong: boolean; hasWeapon: boolean };
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
  | 'gemGood'
  | 'gemBad'
  | 'idle';

export const CATEGORIES: readonly Category[] = [
  'kill',
  'improve',
  'improveMax',
  'hurt',
  'death',
  'loot',
  'spend',
  'gemGood',
  'gemBad',
  'idle',
];

/** Mood buckets used for line selection. */
export type MoodBucket = 'zle' | 'spokojnie' | 'dobrze';

/** Animation primitives. `idle` is always running underneath. */
export type Primitive =
  | 'lunge'
  | 'cheer'
  | 'gulp'
  | 'slump'
  | 'glitter'
  | 'flinch'
  | 'topple'
  | 'doze'
  | 'idle';

export const PRIMITIVES: readonly Primitive[] = [
  'lunge',
  'cheer',
  'gulp',
  'slump',
  'glitter',
  'flinch',
  'topple',
  'doze',
  'idle',
];

export interface PersistedState {
  version: 1;
  spec: CompanionSpec;
  /** Max 1. */
  rerollsUsed: number;
  /** -1..+1 */
  mood: number;
  /** Epoch ms, for decay on load. */
  moodTouchedAt: number;
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
  };
}

export const STATE_VERSION = 1 as const;

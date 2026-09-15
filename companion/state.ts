/**
 * Persisted state, per character.
 *
 * Storage key: `plugin:towarzysz:<characterName>` in localStorage, matching the
 * `plugin:konfetti:settings` convention. Anything that fails - storage
 * unavailable, JSON broken, unknown version - falls back to a fresh roll from
 * the deterministic seed, so the companion comes back identical.
 */

import { AMBIENT_LEVELS, CATEGORIES, STATE_VERSION, type AmbientLevel, type Category, type PersistedState } from './types';
import { isValidSpec, roll } from './roll';
import { VOICE_IDS } from '../voice/catalog';

export const STORAGE_PREFIX = 'plugin:towarzysz:';
export const MAX_REROLLS = 1;

export const DEFAULT_GLOBAL_COOLDOWN_MS = 45_000;
export const DEFAULT_IDLE_MINUTES = 5;
export const DEFAULT_AMBIENT_LEVEL: AmbientLevel = 'normal';

/** The subset of the Storage interface that is actually used. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function storageKey(characterName: string): string {
  return `${STORAGE_PREFIX}${characterName}`;
}

/** An in-memory stand-in used when localStorage is unavailable or throwing. */
export class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** localStorage if it works, otherwise memory. Probed once, because it can throw on access. */
export function pickStorage(): KeyValueStorage {
  try {
    const probe = '__towarzysz_probe__';
    const storage = globalThis.localStorage;
    if (!storage) return new MemoryStorage();
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return new MemoryStorage();
  }
}

export function freshState(characterName: string, rerollsUsed = 0, now = Date.now()): PersistedState {
  return {
    version: STATE_VERSION,
    spec: roll(characterName, rerollsUsed),
    rerollsUsed,
    mood: 0,
    moodTouchedAt: now,
    mutes: { global: false, categories: [] },
    stats: { kills: 0, deaths: 0, sessions: 0 },
    settings: {
      voiceOverride: null,
      globalCooldownMs: DEFAULT_GLOBAL_COOLDOWN_MS,
      idleMinutes: DEFAULT_IDLE_MINUTES,
      ambientLevel: DEFAULT_AMBIENT_LEVEL,
    },
  };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Validate and normalise a parsed value. Returns null when it cannot be trusted
 * at all (wrong version, spec broken) - the caller then rerolls. Missing or
 * odd secondary fields are repaired rather than rejected, so a small schema
 * drift does not throw away mood and stats.
 */
export function normalizeState(raw: unknown, characterName: string, now = Date.now()): PersistedState | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== STATE_VERSION) return null;

  const rerollsUsed = Math.min(MAX_REROLLS, Math.max(0, Math.floor(finite(value.rerollsUsed, 0))));

  // A stored spec is kept as long as it holds together structurally - it is not
  // checked against the seed. That is deliberate: the companion you have met is
  // the companion you keep, even after the roll changes underneath it. A name
  // retired from its pool survives here, and so does a colour we no longer roll.
  // Only a spec that is broken - hand-edited storage, an archetype or voice that
  // no longer exists - falls back to the seed, which is the one thing that can
  // always be recomputed.
  const expected = roll(characterName, rerollsUsed);
  const spec = isValidSpec(value.spec) ? value.spec : expected;

  const mutesRaw = (value.mutes ?? {}) as Record<string, unknown>;
  const categories = Array.isArray(mutesRaw.categories)
    ? (mutesRaw.categories.filter((c): c is Category => CATEGORIES.includes(c as Category)) as Category[])
    : [];

  const statsRaw = (value.stats ?? {}) as Record<string, unknown>;
  const settingsRaw = (value.settings ?? {}) as Record<string, unknown>;
  const voiceOverride =
    typeof settingsRaw.voiceOverride === 'string' && VOICE_IDS.includes(settingsRaw.voiceOverride)
      ? settingsRaw.voiceOverride
      : null;
  const ambientLevel = AMBIENT_LEVELS.includes(settingsRaw.ambientLevel as AmbientLevel)
    ? (settingsRaw.ambientLevel as AmbientLevel)
    : DEFAULT_AMBIENT_LEVEL;

  return {
    version: STATE_VERSION,
    spec,
    rerollsUsed,
    mood: Math.min(1, Math.max(-1, finite(value.mood, 0))),
    moodTouchedAt: Math.min(now, finite(value.moodTouchedAt, now)),
    mutes: { global: mutesRaw.global === true, categories: Array.from(new Set(categories)) },
    stats: {
      kills: Math.max(0, Math.floor(finite(statsRaw.kills, 0))),
      deaths: Math.max(0, Math.floor(finite(statsRaw.deaths, 0))),
      sessions: Math.max(0, Math.floor(finite(statsRaw.sessions, 0))),
    },
    settings: {
      voiceOverride,
      globalCooldownMs: Math.min(600_000, Math.max(5_000, finite(settingsRaw.globalCooldownMs, DEFAULT_GLOBAL_COOLDOWN_MS))),
      idleMinutes: Math.min(120, Math.max(1, finite(settingsRaw.idleMinutes, DEFAULT_IDLE_MINUTES))),
      ambientLevel,
    },
  };
}

/** Load the character's state, or roll a fresh one. Never throws. */
export function load(characterName: string, storage: KeyValueStorage, now = Date.now()): PersistedState {
  try {
    const raw = storage.getItem(storageKey(characterName));
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const state = normalizeState(parsed, characterName, now);
      if (state) return state;
    }
  } catch {
    // Broken JSON or a throwing storage: fall through to a fresh roll.
  }
  return freshState(characterName, 0, now);
}

/** Save; a failure is silent because the in-memory state keeps working. */
export function save(characterName: string, state: PersistedState, storage: KeyValueStorage): boolean {
  try {
    storage.setItem(storageKey(characterName), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** The one-time reroll. Returns null when it has already been used. */
export function reroll(characterName: string, state: PersistedState, now = Date.now()): PersistedState | null {
  if (state.rerollsUsed >= MAX_REROLLS) return null;
  const rerollsUsed = state.rerollsUsed + 1;
  return {
    ...state,
    spec: roll(characterName, rerollsUsed),
    rerollsUsed,
    // A new companion starts fresh; the mutes and settings are the player's, so they stay.
    mood: 0,
    moodTouchedAt: now,
    stats: { ...state.stats },
  };
}

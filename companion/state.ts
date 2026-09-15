/**
 * Persisted state, per character.
 *
 * Storage key: `plugin:towarzysz:<characterName>` in localStorage, matching the
 * `plugin:konfetti:settings` convention. Anything that fails - storage
 * unavailable, JSON broken, unknown version - falls back to a fresh roll from
 * the deterministic seed, so the companion comes back identical.
 */

import {
  AMBIENT_LEVELS,
  CATEGORIES,
  STATE_VERSION,
  type AmbientLevel,
  type Category,
  type CompanionSpec,
  type PersistedState,
} from './types';
import { isValidSpec, roll } from './roll';
import { isValidTemper, NO_TEMPER, type Temper } from './temper';
import { VOICE_IDS } from '../voice/catalog';

export const STORAGE_PREFIX = 'plugin:towarzysz:';
/**
 * There is no way to reroll any more - you get the companion you get. The
 * number survives as part of the seed and of the stored shape, so anyone who
 * spent their one reroll while it existed keeps the companion it gave them.
 */
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
    // Stale by definition, so the plugin rolls the day's real one on load and
    // there is one code path for a new companion and a returning one alike.
    temper: { ...NO_TEMPER },
    metAt: now,
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
  const stored = isValidSpec(value.spec) ? value.spec : expected;
  // Heads did not always vary, so a spec saved before they did carries no
  // `parts.head`. The seed's own head is the right one to give it: it is what
  // the same character would be drawn with after losing localStorage, and those
  // two must not disagree.
  const spec: CompanionSpec =
    typeof stored.parts.head === 'number' && Number.isFinite(stored.parts.head)
      ? stored
      : { ...stored, parts: { ...stored.parts, head: expected.parts.head } };

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
    // The stored timestamp is deliberately not kept: the mood drifts on time
    // spent playing, not on time the client was shut (see companion/mood.ts),
    // so a load starts the drift clock here rather than backdating it to
    // whenever the save was written.
    moodTouchedAt: now,
    // A temper survives a relog inside the same evening and is rerolled after
    // it; a save from before tempers existed loads the stale placeholder,
    // which is the same thing the next morning looks like.
    temper: isValidTemper(value.temper) ? (value.temper as Temper) : { ...NO_TEMPER },
    // A save from before the card existed records no first meeting; the first
    // load after the upgrade is the closest honest answer.
    metAt: Math.min(now, finite(value.metAt, now)),
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


import { describe, expect, it } from 'vitest';
import { MemoryStorage, freshState, load, normalizeState, save, storageKey } from '../companion/state';
import { roll } from '../companion/roll';

describe('state', () => {
  it('uses the documented storage key', () => {
    expect(storageKey('Dargoth')).toBe('plugin:towarzysz:Dargoth');
  });

  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    const state = freshState('Dargoth', 0, 1000);
    state.stats.kills = 7;
    state.mutes.categories = ['kill'];
    expect(save('Dargoth', state, storage)).toBe(true);
    const loaded = load('Dargoth', storage, 2000);
    // Everything comes back as it went in, bar the drift clock: a load re-bases
    // it, because the time in between was not time spent playing.
    expect(loaded).toEqual({ ...state, moodTouchedAt: 2000 });
  });

  it('a fresh roll comes back for missing, broken or foreign-version storage', () => {
    const storage = new MemoryStorage();
    const fresh = load('Dargoth', storage, 5);
    expect(fresh.spec).toEqual(roll('Dargoth', 0));

    storage.setItem(storageKey('Dargoth'), '{not json');
    expect(load('Dargoth', storage, 5).spec).toEqual(roll('Dargoth', 0));

    storage.setItem(storageKey('Dargoth'), JSON.stringify({ version: 2, spec: roll('Dargoth', 0) }));
    expect(load('Dargoth', storage, 5).spec).toEqual(roll('Dargoth', 0));
  });

  it('trusts the seed over a tampered spec, and keeps a spent reroll', () => {
    const state = freshState('Dargoth', 1, 0);
    const tampered = { ...state, spec: { ...state.spec, archetype: 'knight' } };
    const normalized = normalizeState(tampered, 'Dargoth', 0);
    expect(normalized).not.toBeNull();
    expect(normalized!.rerollsUsed).toBe(1);
    expect(normalized!.spec).toEqual(roll('Dargoth', 1));
  });

  it('repairs odd secondary fields instead of rerolling', () => {
    const state = freshState('Dargoth', 0, 0);
    const odd = { ...state, mood: 9, mutes: { global: 'yes', categories: ['kill', 'bogus'] }, settings: { globalCooldownMs: -5 } };
    const normalized = normalizeState(odd, 'Dargoth', 0)!;
    expect(normalized.mood).toBe(1);
    expect(normalized.mutes).toEqual({ global: false, categories: ['kill'] });
    expect(normalized.settings.globalCooldownMs).toBe(5_000);
    expect(normalized.settings.voiceOverride).toBeNull();
  });

  it('brings the mood back where it was left, however long the client was shut', () => {
    const state = freshState('Dargoth', 0, 1000);
    state.mood = 0.9;
    const night = 1000 + 8 * 60 * 60 * 1000;
    const loaded = normalizeState(state, 'Dargoth', night)!;
    expect(loaded.mood).toBe(0.9);
    expect(loaded.moodTouchedAt).toBe(night);
  });

  it('dates a save that predates the card from the load that found it', () => {
    const state = freshState('Dargoth', 0, 1000);
    const old = { ...state } as Record<string, unknown>;
    delete old.metAt;
    expect(normalizeState(old, 'Dargoth', 7000)!.metAt).toBe(7000);
    // A recorded meeting is kept, and one from the future is not believed.
    expect(normalizeState(state, 'Dargoth', 7000)!.metAt).toBe(1000);
    expect(normalizeState({ ...state, metAt: 9000 }, 'Dargoth', 7000)!.metAt).toBe(7000);
  });

  it('a throwing storage is survivable', () => {
    const broken = {
      getItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('nope');
      },
      removeItem: () => undefined,
    };
    const state = load('Dargoth', broken);
    expect(state.spec).toEqual(roll('Dargoth', 0));
    expect(save('Dargoth', state, broken)).toBe(false);
  });
});

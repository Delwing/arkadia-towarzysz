import { describe, expect, it } from 'vitest';
import { MemoryStorage, freshState, load, normalizeState, reroll, save, storageKey } from '../companion/state';
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
    expect(loaded).toEqual(state);
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

  it('trusts the seed over a tampered spec, and keeps the reroll', () => {
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

  it('allows exactly one reroll', () => {
    const state = freshState('Dargoth', 0, 0);
    const once = reroll('Dargoth', state, 10);
    expect(once).not.toBeNull();
    expect(once!.rerollsUsed).toBe(1);
    expect(once!.spec).toEqual(roll('Dargoth', 1));
    expect(once!.mood).toBe(0);
    expect(reroll('Dargoth', once!, 20)).toBeNull();
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

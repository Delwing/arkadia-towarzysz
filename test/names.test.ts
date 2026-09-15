import { describe, expect, it } from 'vitest';
import { NAME_POOLS, namePoolFor } from '../companion/names';
import { ARCHETYPES } from '../companion/types';

const POOLS = Object.entries(NAME_POOLS);

describe('name pools', () => {
  it('every archetype has a pool with room to roll', () => {
    for (const archetype of ARCHETYPES) {
      expect(namePoolFor(archetype).length).toBeGreaterThanOrEqual(50);
    }
  });

  it('every name is ASCII-folded, capitalised and plain', () => {
    for (const [pool, names] of POOLS) {
      for (const name of names) {
        expect(name, `${pool}: ${name}`).toMatch(/^[A-Z][a-z]+$/);
      }
    }
  });

  it('no name repeats, inside a pool or across pools', () => {
    const seen = new Map<string, string>();
    const counted = new Set<readonly string[]>();
    for (const [pool, names] of POOLS) {
      // magician and wizard share one pool object; count it once.
      if (counted.has(names)) continue;
      counted.add(names);
      for (const name of names) {
        expect(seen.get(name), `${name} is in both ${seen.get(name)} and ${pool}`).toBeUndefined();
        seen.set(name, pool);
      }
    }
  });
});

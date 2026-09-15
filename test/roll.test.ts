import { describe, expect, it } from 'vitest';
import { isValidSpec, roll, seedFor, SEED_GENERATION } from '../companion/roll';
import { hash } from '../companion/rng';
import { ARCHETYPES } from '../companion/types';
import { namePoolFor } from '../companion/names';
import { VOICE_IDS } from '../voice/catalog';
import { headVariants } from '../render/mixer';

const NAMES = ['Dargoth', 'Vesna', 'Zbrozek', 'aBc', 'x', 'Bardzo Dlugie Imie Postaci', 'Zażółć'];

describe('roll', () => {
  it('is deterministic: same seed gives the same spec', () => {
    for (const name of NAMES) {
      expect(roll(name, 0)).toEqual(roll(name, 0));
      expect(roll(name, 1)).toEqual(roll(name, 1));
    }
  });

  it('a different rerollsUsed gives a different companion', () => {
    let differences = 0;
    for (const name of NAMES) {
      const a = roll(name, 0);
      const b = roll(name, 1);
      if (JSON.stringify(a) !== JSON.stringify(b)) differences++;
    }
    expect(differences).toBe(NAMES.length);
  });

  it('different characters get different companions (in aggregate)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(JSON.stringify(roll(`Postac${i}`, 0)));
    expect(seen.size).toBeGreaterThan(190);
  });

  it('every generated spec is valid', () => {
    for (let i = 0; i < 500; i++) {
      for (const rerolls of [0, 1]) {
        const spec = roll(`Gracz${i}`, rerolls);
        expect(isValidSpec(spec)).toBe(true);
        expect(ARCHETYPES).toContain(spec.archetype);
        expect(namePoolFor(spec.archetype)).toContain(spec.name);
        expect(VOICE_IDS).toContain(spec.voiceId);
        expect(spec.parts.hasWeapon).toBe(spec.palette.weapon !== null);
        expect(Number.isInteger(spec.parts.head)).toBe(true);
        expect(spec.parts.head).toBeGreaterThanOrEqual(0);
        expect(spec.parts.head).toBeLessThan(headVariants(spec.archetype));
      }
    }
  });

  it('rolls every head the art carries for an archetype', () => {
    const worn = new Map<string, Set<number>>();
    for (let i = 0; i < 2000; i++) {
      const spec = roll(`Gracz${i}`, 0);
      const seen = worn.get(spec.archetype) ?? new Set<number>();
      seen.add(spec.parts.head);
      worn.set(spec.archetype, seen);
    }
    for (const archetype of ARCHETYPES) {
      expect(worn.get(archetype)?.size).toBe(headVariants(archetype));
    }
  });

  it('covers every archetype and every voice over many rolls', () => {
    const archetypes = new Set<string>();
    const voices = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const spec = roll(`Gracz${i}`, 0);
      archetypes.add(spec.archetype);
      voices.add(spec.voiceId);
    }
    expect(archetypes.size).toBe(ARCHETYPES.length);
    expect(voices.size).toBe(VOICE_IDS.length);
  });

  it('seeds follow the documented formula', () => {
    expect(seedFor('Dargoth', 0)).not.toBe(seedFor('Dargoth', 1));
    expect(seedFor('Dargoth', 0)).toBe(seedFor('Dargoth', 0));
    expect(seedFor('Dargoth', 0)).toBe(hash(`Dargoth:0:${SEED_GENERATION}`));
  });

  it('a generation is a whole new set of companions', () => {
    // What a bump does, spelled out: the same name and the same reroll count
    // against another generation is a different seed, and so a different
    // companion. Nobody with a save loses theirs - the save wins over the seed.
    expect(hash(`Dargoth:0:${SEED_GENERATION}`)).not.toBe(hash('Dargoth:0:1'));
  });

  it('rejects broken specs', () => {
    const good = roll('Dargoth', 0);
    expect(isValidSpec({ ...good, archetype: 'nieistniejacy' })).toBe(false);
    expect(isValidSpec({ ...good, voiceId: 'nope' })).toBe(false);
    expect(isValidSpec({ ...good, palette: { ...good.palette, skin: 'red' } })).toBe(false);
    expect(isValidSpec(null)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { applyGender, hasBalancedMarkers, parseGender } from '../voice/gender';
import { VOICES, VOICE_IDS } from '../voice/catalog';

describe('gendered lines', () => {
  it('picks the half the player is addressed by', () => {
    const line = 'Zajecha{les|las} sie. Widac z daleka.';
    expect(applyGender(line, 'male')).toBe('Zajechales sie. Widac z daleka.');
    expect(applyGender(line, 'female')).toBe('Zajechalas sie. Widac z daleka.');
  });

  it('falls back to the form the lines were written in', () => {
    const line = 'Zlowi{les|las}. Gratuluje, {rybaku|rybaczko}.';
    // An unknown gender is the client's own default, not an error.
    expect(applyGender(line, null)).toBe('Zlowiles. Gratuluje, rybaku.');
    expect(applyGender(line, undefined)).toBe('Zlowiles. Gratuluje, rybaku.');
  });

  it('resolves every marker in a line, not just the first', () => {
    expect(applyGender('{a|b} i {c|d} i {e|f}', 'female')).toBe('b i d i f');
  });

  it('leaves a line with nothing to decide exactly as it was', () => {
    for (const line of ['Czysta robota.', 'Nuda.', '...', 'Sto dwanascie.']) {
      expect(applyGender(line, 'female')).toBe(line);
      expect(applyGender(line, 'male')).toBe(line);
    }
  });

  it('lets an empty half stand for a suffix one gender does not take', () => {
    expect(applyGender('Gotow{|a}?', 'male')).toBe('Gotow?');
    expect(applyGender('Gotow{|a}?', 'female')).toBe('Gotowa?');
  });

  it('leaves a brace that is not a marker alone rather than eating it', () => {
    for (const odd of ['{ nieparzysty', 'a | b', '{a|b|c}', '{{a|b}']) {
      expect(() => applyGender(odd, 'female')).not.toThrow();
    }
    expect(applyGender('{ nieparzysty', 'female')).toBe('{ nieparzysty');
    expect(hasBalancedMarkers('{ nieparzysty')).toBe(false);
    expect(hasBalancedMarkers('Zajecha{les|las} sie.')).toBe(true);
    expect(hasBalancedMarkers('Czysta robota.')).toBe(true);
  });

  it('reads the client gender and nothing else', () => {
    expect(parseGender('male')).toBe('male');
    expect(parseGender('female')).toBe('female');
    for (const junk of [undefined, null, '', 'M', 'kobieta', 3, {}]) expect(parseGender(junk)).toBeNull();
  });

  it('every marker in every pack is well formed and both halves are ASCII', () => {
    let marked = 0;
    for (const id of VOICE_IDS) {
      const pack = VOICES[id];
      expect(pack, id).toBeDefined();
      for (const [category, byBucket] of Object.entries(pack!.lines)) {
        for (const lines of Object.values(byBucket ?? {})) {
          for (const line of lines ?? []) {
            expect(hasBalancedMarkers(line), `${id}/${category}: ${line}`).toBe(true);
            if (line.includes('{')) marked++;
            // Both forms have to survive the fold, not just the written one.
            for (const gender of ['male', 'female'] as const) {
              expect(applyGender(line, gender), `${id}/${category}`).toMatch(/^[\x20-\x7e]+$/);
              expect(applyGender(line, gender)).not.toContain('{');
            }
          }
        }
      }
    }
    // The packs do carry some: a green suite here would otherwise prove nothing.
    expect(marked).toBeGreaterThan(0);
  });
});

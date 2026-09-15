import { describe, expect, it } from 'vitest';
import { parsePolishNumber } from '../text/polishNumbers';
import { coinsToCopper, formatCopper } from '../text/coins';
import { properName } from '../text/properName';

describe('polish numbers', () => {
  it('parses units, tens, hundreds and thousands', () => {
    expect(parsePolishNumber('jeden')).toBe(1);
    expect(parsePolishNumber('jedna')).toBe(1);
    expect(parsePolishNumber('dwie')).toBe(2);
    expect(parsePolishNumber('dziewietnascie')).toBe(19);
    expect(parsePolishNumber('dwadziescia trzy')).toBe(23);
    expect(parsePolishNumber('sto piecdziesiat dwa')).toBe(152);
    expect(parsePolishNumber('tysiac')).toBe(1000);
    expect(parsePolishNumber('dwa tysiace trzysta')).toBe(2300);
    expect(parsePolishNumber('piec tysiecy siedem')).toBe(5007);
    expect(parsePolishNumber('42')).toBe(42);
  });

  it('returns null with no number present', () => {
    expect(parsePolishNumber('zlote monety')).toBeNull();
    expect(parsePolishNumber('')).toBeNull();
  });
});

describe('coins', () => {
  it('values coin phrases in copper', () => {
    expect(coinsToCopper('Bierzesz dwadziescia trzy zlote monety z ciala szczura.')).toBe(23 * 240);
    expect(coinsToCopper('Bierzesz jedna srebrna monete.')).toBe(12);
    expect(coinsToCopper('Bierzesz zlota monete.')).toBe(240);
    expect(coinsToCopper('Bierzesz dwie mithrylowe monety, trzy zlote monety i piec miedzianych monet z sakwy.')).toBe(
      2 * 24_000 + 3 * 240 + 5,
    );
    expect(coinsToCopper('Bierzesz zardzewialy miecz z ciala szczura.')).toBe(0);
    expect(coinsToCopper('Bierzesz monety.')).toBe(0);
  });

  it('values a list that names the coins once, at the end', () => {
    // The shopkeeper taking payment: one "monet" for two metals.
    expect(coinsToCopper('Usmiechniety dojrzaly mezczyzna drapieznym ruchem zgarnia 9 srebrnych i 30 miedzianych monet.')).toBe(
      9 * 12 + 30,
    );
    expect(coinsToCopper('Bierzesz dwie zlote i trzy srebrne monety.')).toBe(2 * 240 + 3 * 12);
    expect(coinsToCopper('Bierzesz zlote oraz srebrne monety.')).toBe(240 + 12);
  });

  it('ignores metal words that are not about money', () => {
    // A metal adjective only counts when the phrase it opens ends in coins.
    expect(coinsToCopper('Sprzedajesz dwie surowe czerwonozlote ryby.')).toBe(0);
    expect(coinsToCopper('Bierzesz zlote ryby.')).toBe(0);
    expect(coinsToCopper('Bierzesz zlote ryby i trzy srebrne monety.')).toBe(3 * 12);
  });

  it('formats copper', () => {
    expect(formatCopper(0)).toBe('0 mied');
    expect(formatCopper(253)).toBe('1 zl 1 sr 1 mied');
    expect(formatCopper(480)).toBe('2 zl');
  });
});

describe('proper name', () => {
  it('raises the first letter of a name that came in lower case', () => {
    expect(properName('delwing')).toBe('Delwing');
  });

  it('leaves a name that is already right alone', () => {
    expect(properName('Delwing')).toBe('Delwing');
  });

  it('raises every part of a name that has more than one', () => {
    expect(properName('anna-maria')).toBe('Anna-Maria');
    expect(properName("o'brien")).toBe("O'Brien");
    expect(properName('stary wilk')).toBe('Stary Wilk');
  });

  it('survives what a name can never be', () => {
    expect(properName('')).toBe('');
    expect(properName('7')).toBe('7');
  });
});

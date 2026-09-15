/**
 * Polish number words -> integers, for lines like
 * "Bierzesz dwadziescia trzy zlote monety z ciala szczura."
 * Arkadia prints amounts as ASCII-folded words; digits are accepted too.
 */

const UNITS: Record<string, number> = {
  zero: 0,
  jeden: 1,
  jedna: 1,
  jedno: 1,
  dwa: 2,
  dwie: 2,
  trzy: 3,
  cztery: 4,
  piec: 5,
  szesc: 6,
  siedem: 7,
  osiem: 8,
  dziewiec: 9,
  dziesiec: 10,
  jedenascie: 11,
  dwanascie: 12,
  trzynascie: 13,
  czternascie: 14,
  pietnascie: 15,
  szesnascie: 16,
  siedemnascie: 17,
  osiemnascie: 18,
  dziewietnascie: 19,
};

const TENS: Record<string, number> = {
  dwadziescia: 20,
  trzydziesci: 30,
  czterdziesci: 40,
  piecdziesiat: 50,
  szescdziesiat: 60,
  siedemdziesiat: 70,
  osiemdziesiat: 80,
  dziewiecdziesiat: 90,
};

const HUNDREDS: Record<string, number> = {
  sto: 100,
  dwiescie: 200,
  trzysta: 300,
  czterysta: 400,
  piecset: 500,
  szescset: 600,
  siedemset: 700,
  osiemset: 800,
  dziewiecset: 900,
};

const THOUSANDS = new Set(['tysiac', 'tysiace', 'tysiecy']);

const NUMBER_WORDS = new Set([...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(HUNDREDS), ...THOUSANDS]);

export function isNumberWord(word: string): boolean {
  return NUMBER_WORDS.has(word.toLowerCase()) || /^\d+$/.test(word);
}

/**
 * Parse a run of number words (or digits). Returns null when nothing numeric
 * is there. "tysiac" multiplies whatever came before it (or 1), so
 * "dwa tysiace trzysta" = 2300 and "tysiac piec" = 1005.
 */
export function parsePolishNumber(text: string): number | null {
  const words = text
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((w) => w.length > 0);
  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (const word of words) {
    if (/^\d+$/.test(word)) {
      current += parseInt(word, 10);
      sawNumber = true;
    } else if (word in UNITS) {
      current += UNITS[word] as number;
      sawNumber = true;
    } else if (word in TENS) {
      current += TENS[word] as number;
      sawNumber = true;
    } else if (word in HUNDREDS) {
      current += HUNDREDS[word] as number;
      sawNumber = true;
    } else if (THOUSANDS.has(word)) {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      sawNumber = true;
    } else {
      return sawNumber ? total + current : null;
    }
  }
  return sawNumber ? total + current : null;
}

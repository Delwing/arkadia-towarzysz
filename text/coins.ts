/**
 * Coin phrases -> copper value. Exchange rates as the client's deposit counter
 * uses them: 1 mithryl = 24000 copper, 1 gold = 240, 1 silver = 12.
 */

import { isNumberWord, parsePolishNumber } from './polishNumbers';

export const COPPER_PER = {
  mithryl: 24_000,
  gold: 240,
  silver: 12,
  copper: 1,
} as const;

type Metal = keyof typeof COPPER_PER;

const METAL_PATTERNS: Array<[RegExp, Metal]> = [
  [/^mithrylow\w*$/i, 'mithryl'],
  [/^zlot\w*$/i, 'gold'],
  [/^srebrn\w*$/i, 'silver'],
  [/^miedzian\w*$/i, 'copper'],
];

function metalOf(word: string): Metal | null {
  for (const [pattern, metal] of METAL_PATTERNS) {
    if (pattern.test(word)) return metal;
  }
  return null;
}

const COIN_NOUN = /^monet\w*$/i;
/** Words that may sit between two metals of one coin phrase. */
const CONNECTORS = new Set(['i', 'oraz', 'a']);

/**
 * Does the metal adjective at `i` belong to a coin phrase? The noun is often
 * far away and written once for the whole list, as in "9 srebrnych i 30
 * miedzianych monet", so walk forward over the things that can legitimately
 * separate them - connectors, amounts, further metals - and require "monet..."
 * at the end of that run. Anything else means this was not money at all
 * ("zlote ryby"), which is the case this guards.
 */
function leadsToCoins(words: string[], i: number): boolean {
  for (let j = i + 1; j < words.length; j++) {
    const word = words[j] as string;
    if (COIN_NOUN.test(word)) return true;
    if (CONNECTORS.has(word.toLowerCase()) || isNumberWord(word) || metalOf(word)) continue;
    return false;
  }
  return false;
}

/**
 * Total copper value of every "<amount> <metal> monet(a|y)" phrase in the text,
 * including lists that name the noun once ("9 srebrnych i 30 miedzianych
 * monet"). A metal with no amount ("zlota monete") counts as one. Returns 0
 * when there are no coins at all.
 */
export function coinsToCopper(text: string): number {
  const words = text
    .replace(/[.,;!?]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  let total = 0;
  for (let i = 0; i < words.length; i++) {
    const metal = metalOf(words[i] as string);
    if (!metal || !leadsToCoins(words, i)) continue;
    // Walk back over the number words in front of the metal adjective.
    let start = i;
    while (start - 1 >= 0 && isNumberWord(words[start - 1] as string)) start--;
    const amount = start < i ? parsePolishNumber(words.slice(start, i).join(' ')) : null;
    total += (amount ?? 1) * COPPER_PER[metal];
  }
  return total;
}

/** ASCII-folded, short, for the settings panel and logs. */
export function formatCopper(copper: number): string {
  const gold = Math.floor(copper / COPPER_PER.gold);
  const rest = copper % COPPER_PER.gold;
  const silver = Math.floor(rest / COPPER_PER.silver);
  const copperLeft = rest % COPPER_PER.silver;
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold} zl`);
  if (silver > 0) parts.push(`${silver} sr`);
  if (copperLeft > 0 || parts.length === 0) parts.push(`${copperLeft} mied`);
  return parts.join(' ');
}

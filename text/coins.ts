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

/**
 * Total copper value of every "<amount> <metal> monet(a|y)" phrase in the text.
 * "monete" without an amount ("jedna zlota monete" or just "zlota monete")
 * counts as one. Returns 0 when there are no coins at all.
 */
export function coinsToCopper(text: string): number {
  const words = text
    .replace(/[.,;!?]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  let total = 0;
  for (let i = 0; i < words.length; i++) {
    if (!/^monet\w*$/i.test(words[i] as string)) continue;
    const metal = i > 0 ? metalOf(words[i - 1] as string) : null;
    if (!metal) continue;
    // Walk back over the number words before the metal adjective.
    let start = i - 1;
    while (start - 1 >= 0 && isNumberWord(words[start - 1] as string)) start--;
    const amount = start < i - 1 ? parsePolishNumber(words.slice(start, i - 1).join(' ')) : null;
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

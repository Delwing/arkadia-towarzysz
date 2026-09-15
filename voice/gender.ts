/**
 * Gendered voice lines.
 *
 * Polish will not let a companion address the player without knowing who they
 * are talking to: "Zajechales sie" and "Zajechalas sie" are the same remark and
 * only one of them is addressed to the player in front of us. The client knows
 * - `Char.Info.gender` is 'male' or 'female' - so the lines carry both forms
 * and the right one is picked when the bubble goes up.
 *
 * The markup is inline, `{male|female}`, and usually swallows a suffix rather
 * than a whole word:
 *
 *   "Zajecha{les|las} sie. Widac z daleka."
 *   "Zlowi{les|las}. Gratuluje, {rybaku|rybaczko}."
 *
 * A form per line would have doubled a file in which the overwhelming majority
 * of lines need nothing: the companion mostly talks about themselves, about the
 * world, or in the present tense, and none of that is gendered.
 *
 * Male is the fallback, for an unknown gender and for a malformed marker. That
 * matches the client, which shows knowledge entries in the male form until it
 * is told otherwise, and it is the form the lines were written in.
 */

/**
 * As `Char.Info.gender` gives it. The player's, always - the companion is
 * male by design and their own first person never varies (see
 * `companion/names.ts`).
 */
export type PlayerGender = 'male' | 'female';

/**
 * `{a|b}`, with neither half allowed to contain the delimiters. Anything else
 * that happens to contain a brace is left exactly as it was written.
 */
const MARKER = /\{([^{}|]*)\|([^{}|]*)\}/g;

/** Every marker resolved for `gender`; a line with no markers is returned unchanged. */
export function applyGender(line: string, gender: PlayerGender | null | undefined): string {
  if (!line.includes('{')) return line;
  return line.replace(MARKER, (_whole, male: string, female: string) => (gender === 'female' ? female : male));
}

/** Whether every brace in the line belongs to a well-formed marker. A test asks. */
export function hasBalancedMarkers(line: string): boolean {
  return !line.replace(MARKER, '').includes('{') && !line.replace(MARKER, '').includes('}');
}

/** 'male' | 'female' from whatever the client handed us, or null. */
export function parseGender(value: unknown): PlayerGender | null {
  return value === 'male' || value === 'female' ? value : null;
}

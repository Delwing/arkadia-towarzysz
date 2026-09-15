/**
 * A character's name the way it is read rather than the way it arrives.
 *
 * GMCP hands `char.info.name` over in lower case - "delwing" - and that exact
 * string is load-bearing: it seeds the roll (`companion/roll.ts`) and keys
 * localStorage (`companion/state.ts`), so touching it there would hand every
 * character a different companion and lose the saved one. Nothing upstream
 * changes, then; only the strings a player reads come through here.
 */

/**
 * Upper-case the first letter of every part of a name, leaving the rest as it
 * came. Parts are split on the things that can sit inside a name - a space, a
 * hyphen, an apostrophe - so "anna-maria" and "o'brien" get both halves.
 */
export function properName(name: string): string {
  return name.replace(/(^|[\s'-])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toUpperCase());
}

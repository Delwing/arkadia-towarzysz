import type { Archetype } from './types';

/** One pool per archetype family, so the name matches what you were dealt. ASCII-folded. */
export const HUMAN_NAMES: readonly string[] = [
  'Vesna',
  'Milena',
  'Radost',
  'Zbrozek',
  'Dobrawa',
  'Jarogniew',
  'Wysza',
  'Lutobor',
  'Swietlana',
  'Chwalibog',
  'Niegoslaw',
  'Ratmir',
  'Bozena',
  'Sulislaw',
  'Dziwisz',
  'Rada',
];

export const MONSTER_NAMES: readonly string[] = [
  'Zgrzyt',
  'Grzmot',
  'Brzyd',
  'Klak',
  'Wyrko',
  'Szczerb',
  'Mlask',
  'Kudl',
  'Chrup',
  'Bulgot',
  'Zgaga',
  'Truchlo',
];

export function namePoolFor(archetype: Archetype): readonly string[] {
  switch (archetype) {
    case 'villager':
    case 'magician':
    case 'wizard':
      return HUMAN_NAMES;
    case 'orc':
    case 'goblin':
    case 'ogre':
    case 'monster':
      return MONSTER_NAMES;
  }
}

export function isHumanish(archetype: Archetype): boolean {
  return archetype === 'villager' || archetype === 'magician' || archetype === 'wizard';
}

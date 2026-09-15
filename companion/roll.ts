/**
 * seed -> CompanionSpec, deterministically.
 *
 * The roll picks, in order: archetype, then a name from that archetype's pool,
 * then a voice, then the palette and parts. The order matters: it is what makes
 * the same seed give the same companion after any later change to a later step.
 * Voice is drawn independently of archetype on purpose - a goblin who speaks as
 * the Ponury wieszcz is exactly the kind of pairing that makes rolling worth it.
 */

import { ARCHETYPES, type Archetype, type CompanionSpec, type Palette } from './types';
import { hash, pick, seededRng, type Rng } from './rng';
import { isHumanish, namePoolFor } from './names';
import { VOICE_IDS } from '../voice/catalog';
import { headVariants } from '../render/mixer';

/** `hash(characterName + ":" + rerollsUsed)`, as the design fixes it. */
export function seedFor(characterName: string, rerollsUsed: number): number {
  return hash(`${characterName}:${rerollsUsed}`);
}

const HUMAN_SKIN = ['#f1c9a5', '#e0ac7e', '#c68e63', '#a26a45', '#7a4a2e', '#f6d7bf'];
const ORC_SKIN = ['#5f8f3e', '#4c7a35', '#6f9a4a', '#3f6b2f', '#86a35a'];
const GOBLIN_SKIN = ['#7bb04a', '#9ac04f', '#5d9a3f', '#b7c85a', '#6c8f2f'];
const OGRE_SKIN = ['#8c7b6a', '#a08a70', '#6f6a5f', '#b39a7c', '#7c6a56'];
const MONSTER_SKIN = ['#6f5aa8', '#4f6fb0', '#8a4f9a', '#3f7f8a', '#a04f6f', '#5a5a8a'];

const HAIR = ['#2b1b10', '#4a2c17', '#7a4a1e', '#c58b3a', '#e8d38a', '#a53a2a', '#8a8a8a', '#e6e6e6', '#111111'];
const MONSTER_HAIR = ['#111111', '#2b1b10', '#3a3a3a', '#6b2f2f', '#1f3a1f'];
const ARMOUR = ['#6b4a2a', '#8a5a3a', '#4a5a7a', '#5a3a5a', '#3a5a4a', '#7a3a3a', '#5a5a5a', '#8a7a4a', '#2f4a6a'];
const ROBES = ['#3a2f6a', '#5a2f6a', '#2f4a6a', '#6a2f2f', '#2f5a4a', '#4a3a2a', '#1f1f3a'];
const BELT = ['#3a2a1a', '#5a3a1a', '#8a6a2a', '#2a2a2a', '#6a4a2a'];
const LEGS = ['#3a2f2a', '#4a3a3a', '#2a2f3a', '#5a4a3a', '#2f2f2f', '#4a4a5a'];
const WEAPON = ['#b0b8c0', '#8a6a3a', '#d0d0d8', '#6a5a4a', '#c8a850'];

/** How often each archetype has something to draw in a fight. */
const WEAPON_CHANCE: Partial<Record<Archetype, number>> = {
  knight: 0.95,
  archer: 0.9,
  wizard: 0.75,
  magician: 0.75,
  ogre: 0.3,
};

function skinPool(archetype: Archetype): readonly string[] {
  switch (archetype) {
    case 'orc':
      return ORC_SKIN;
    case 'goblin':
      return GOBLIN_SKIN;
    case 'ogre':
      return OGRE_SKIN;
    case 'monster':
      return MONSTER_SKIN;
    default:
      return HUMAN_SKIN;
  }
}

function rollPalette(rng: Rng, archetype: Archetype, hasWeapon: boolean): Palette {
  const humanish = isHumanish(archetype);
  const robed = archetype === 'magician' || archetype === 'wizard';
  return {
    skin: pick(rng, skinPool(archetype)),
    hair: pick(rng, humanish ? HAIR : MONSTER_HAIR),
    armour: pick(rng, robed ? ROBES : ARMOUR),
    belt: pick(rng, BELT),
    legs: pick(rng, LEGS),
    weapon: hasWeapon ? pick(rng, WEAPON) : null,
  };
}

/**
 * Roll a companion for a character. Same inputs, same companion, always - even
 * with `localStorage` wiped. `rerollsUsed` is the only thing that changes it.
 */
export function roll(characterName: string, rerollsUsed: number): CompanionSpec {
  const rng = seededRng(seedFor(characterName, rerollsUsed));

  const archetype = pick(rng, ARCHETYPES);
  const name = pick(rng, namePoolFor(archetype));
  const voiceId = pick(rng, VOICE_IDS);

  // Parts before the palette: the weapon colour only exists when there is one.
  // The first draw used to decide `hairLong`, which the art never showed; it now
  // picks which of the archetype's heads they wear, which it does. Same draw in
  // the same place on purpose: one moved or added here would hand every existing
  // companion a different name, voice and palette.
  const variants = headVariants(archetype);
  const head = Math.floor(rng() * Math.max(1, variants));
  // A knight is nothing without one and an archer carries the bow they are
  // named for; wizards and fortune tellers lean on a staff more often than
  // not; ogres rarely bother.
  const weaponChance = WEAPON_CHANCE[archetype] ?? 0.55;
  const hasWeapon = rng() < weaponChance;

  const palette = rollPalette(rng, archetype, hasWeapon);

  return { archetype, name, voiceId, palette, parts: { hasWeapon, head } };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Structural check for a spec coming out of storage. */
export function isValidSpec(value: unknown): value is CompanionSpec {
  if (!value || typeof value !== 'object') return false;
  const spec = value as Record<string, unknown>;
  if (!ARCHETYPES.includes(spec.archetype as Archetype)) return false;
  if (typeof spec.name !== 'string' || spec.name.length === 0) return false;
  if (typeof spec.voiceId !== 'string' || !VOICE_IDS.includes(spec.voiceId)) return false;
  const palette = spec.palette as Record<string, unknown> | undefined;
  if (!palette || typeof palette !== 'object') return false;
  for (const key of ['skin', 'hair', 'armour', 'belt', 'legs'] as const) {
    if (typeof palette[key] !== 'string' || !HEX.test(palette[key] as string)) return false;
  }
  if (palette.weapon !== null && (typeof palette.weapon !== 'string' || !HEX.test(palette.weapon))) return false;
  const parts = spec.parts as Record<string, unknown> | undefined;
  // `head` is deliberately not required here. A spec saved before heads varied
  // has none, and rejecting it would throw a companion away over a field that
  // can be recomputed from the seed; `companion/state.ts` fills it in.
  if (!parts || typeof parts.hasWeapon !== 'boolean') return false;
  return true;
}

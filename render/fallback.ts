/**
 * The procedural pixel figure: what is drawn when there is no sprite sheet for
 * the archetype, or the sheet failed to load. The plugin must never render
 * nothing, so this has to stand on its own - a readable face, arms, a weapon,
 * and enough archetype flavour that a goblin and a wizard look different.
 *
 * Coordinates are logical sprite pixels on a FIGURE_W x FIGURE_H grid with the
 * feet on the last row. The caller sets up the canvas transform.
 */

import type { Archetype, CompanionSpec } from '../companion/types';
import type { Pose } from './animator';

export const FIGURE_W = 12;
export const FIGURE_H = 16;

type Px = (x: number, y: number, color: string) => void;

export function shade(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const to = (s: string) =>
    Math.max(0, Math.min(255, Math.round(parseInt(s, 16) * factor)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(m[1] as string)}${to(m[2] as string)}${to(m[3] as string)}`;
}

function row(px: Px, y: number, x0: number, x1: number, color: string): void {
  for (let x = x0; x <= x1; x++) px(x, y, color);
}

function col(px: Px, x: number, y0: number, y1: number, color: string): void {
  for (let y = y0; y <= y1; y++) px(x, y, color);
}

function eyeColor(archetype: Archetype): string {
  return archetype === 'monster' ? '#ffe15a' : '#141414';
}

function drawHead(px: Px, spec: CompanionSpec, pose: Pose): void {
  const { archetype, palette, parts } = spec;
  const skin = palette.skin;
  const dark = shade(skin, 0.72);

  // Face block, rows 2..7, x 3..8.
  for (let y = 2; y <= 7; y++) row(px, y, 3, 8, skin);
  // Rounded corners.
  px(3, 2, 'transparent');
  px(8, 2, 'transparent');
  row(px, 7, 3, 8, dark);
  row(px, 7, 4, 7, skin);

  // Hair / hat / horns.
  switch (archetype) {
    case 'magician':
    case 'wizard': {
      const hat = palette.armour;
      const hatDark = shade(hat, 0.7);
      row(px, 0, 5, 6, hatDark);
      row(px, 1, 4, 7, hat);
      row(px, 2, 3, 8, hat);
      row(px, 3, 2, 9, hatDark); // brim
      if (archetype === 'wizard') {
        // Beard.
        row(px, 6, 4, 7, palette.hair);
        row(px, 7, 4, 7, palette.hair);
        row(px, 8, 5, 6, shade(palette.hair, 0.8));
      }
      break;
    }
    case 'villager': {
      row(px, 0, 4, 7, palette.hair);
      row(px, 1, 3, 8, palette.hair);
      px(3, 2, palette.hair);
      px(8, 2, palette.hair);
      if (parts.hairLong) {
        col(px, 2, 2, 8, palette.hair);
        col(px, 9, 2, 8, palette.hair);
      }
      break;
    }
    case 'orc': {
      row(px, 0, 5, 6, palette.hair); // mohawk
      row(px, 1, 5, 6, palette.hair);
      px(2, 4, skin);
      px(9, 4, skin); // ears
      px(4, 6, '#f4f0e0');
      px(7, 6, '#f4f0e0'); // tusks
      if (parts.hairLong) {
        col(px, 2, 5, 8, palette.hair);
        col(px, 9, 5, 8, palette.hair);
      }
      break;
    }
    case 'goblin': {
      row(px, 1, 4, 7, shade(palette.hair, 0.9));
      row(px, 3, 1, 2, skin);
      row(px, 3, 9, 10, skin); // big ears
      px(1, 2, skin);
      px(10, 2, skin);
      px(3, 2, 'transparent');
      px(8, 2, 'transparent');
      break;
    }
    case 'ogre': {
      row(px, 1, 5, 6, palette.hair); // tuft
      row(px, 3, 3, 8, dark); // heavy brow
      px(5, 6, '#f4f0e0'); // one tooth
      break;
    }
    case 'monster': {
      px(2, 0, palette.hair);
      px(3, 1, palette.hair);
      px(9, 0, palette.hair);
      px(8, 1, palette.hair); // horns
      row(px, 1, 4, 7, shade(skin, 0.85));
      break;
    }
  }

  // Eyes at row 4 (row 4 is under the brow for the ogre; still visible).
  const eye = eyeColor(archetype);
  const eyeY = 4;
  if (pose.eyes === 'open') {
    px(4, eyeY, eye);
    px(7, eyeY, eye);
  } else if (pose.eyes === 'half') {
    px(4, eyeY, shade(eye === '#141414' ? '#5a5a5a' : eye, 0.8));
    px(7, eyeY, shade(eye === '#141414' ? '#5a5a5a' : eye, 0.8));
  } else {
    px(4, eyeY, dark);
    px(7, eyeY, dark);
  }

  // Mouth at row 6 (wizard beard covers it - that is fine, beards do that).
  const mouthY = 6;
  const mouth = shade(skin, 0.5);
  switch (pose.mouth) {
    case 'flat':
      row(px, mouthY, 5, 6, mouth);
      break;
    case 'smile':
      row(px, mouthY, 5, 6, mouth);
      px(4, mouthY - 1, mouth);
      px(7, mouthY - 1, mouth);
      break;
    case 'open':
      row(px, mouthY, 5, 6, '#2a0f0f');
      row(px, mouthY + 1, 5, 6, '#2a0f0f');
      break;
    case 'frown':
      row(px, mouthY, 5, 6, mouth);
      px(4, mouthY + 1, mouth);
      px(7, mouthY + 1, mouth);
      break;
  }
}

function drawBody(px: Px, spec: CompanionSpec, pose: Pose): void {
  const { archetype, palette } = spec;
  const wide = archetype === 'ogre';
  const x0 = wide ? 2 : 3;
  const x1 = wide ? 9 : 8;
  const armour = palette.armour;
  const armourDark = shade(armour, 0.75);

  for (let y = 8; y <= 11; y++) row(px, y, x0, x1, armour);
  row(px, 9, x0, x1, armourDark);
  row(px, 9, x0 + 1, x1 - 1, armour);
  // Belt.
  row(px, 12, x0, x1, palette.belt);
  px(x0 + (x1 - x0 >> 1), 12, shade(palette.belt, 1.6)); // buckle

  // Arms: down beside the body, or raised.
  const armL = x0 - 1;
  const armR = x1 + 1;
  if (pose.armsUp) {
    col(px, armL, 5, 8, armour);
    col(px, armR, 5, 8, armour);
    px(armL, 4, palette.skin);
    px(armR, 4, palette.skin);
  } else {
    col(px, armL, 8, 10, armour);
    col(px, armR, 8, 10, armour);
    px(armL, 11, palette.skin);
    px(armR, 11, palette.skin);
  }

  // Legs.
  const legs = palette.legs;
  const legsDark = shade(legs, 0.7);
  col(px, x0 + 1, 13, 15, legs);
  col(px, x0 + 2, 13, 15, legs);
  col(px, x1 - 2, 13, 15, legs);
  col(px, x1 - 1, 13, 15, legs);
  px(x0 + 1, 15, legsDark);
  px(x0 + 2, 15, legsDark);
  px(x1 - 2, 15, legsDark);
  px(x1 - 1, 15, legsDark);
  if (wide) {
    col(px, x0 + 3, 13, 14, legs);
    col(px, x1 - 3, 13, 14, legs);
  }
}

function drawWeapon(px: Px, spec: CompanionSpec, pose: Pose): void {
  const weapon = spec.palette.weapon;
  if (!spec.parts.hasWeapon || !weapon) return;
  const x = spec.archetype === 'ogre' ? 11 : 10;
  const handY = pose.armsUp ? 4 : 11;
  if (spec.archetype === 'wizard' || spec.archetype === 'magician') {
    // Staff: a tall stick with a bright tip.
    col(px, x, handY - 8, handY + 3, weapon);
    px(x, handY - 9, '#fff3a0');
  } else if (spec.archetype === 'ogre') {
    // Club.
    col(px, x, handY - 5, handY + 1, weapon);
    px(x - 1, handY - 5, shade(weapon, 0.8));
    px(x - 1, handY - 4, shade(weapon, 0.8));
  } else {
    // Short blade with a belt-coloured hilt.
    col(px, x, handY - 5, handY - 1, weapon);
    px(x, handY, spec.palette.belt);
    px(x, handY + 1, shade(weapon, 0.6));
  }
}

/**
 * Draw the figure with its feet at the origin of the current transform and
 * its centre on x = 0. `unit` is how many canvas units one sprite pixel takes.
 */
export function drawFigure(ctx: CanvasRenderingContext2D, spec: CompanionSpec, pose: Pose, unit: number): void {
  const px: Px = (x, y, color) => {
    if (color === 'transparent') {
      ctx.clearRect((x - FIGURE_W / 2) * unit, (y - FIGURE_H) * unit, unit, unit);
      return;
    }
    ctx.fillStyle = color;
    ctx.fillRect((x - FIGURE_W / 2) * unit, (y - FIGURE_H) * unit, unit, unit);
  };
  drawBody(px, spec, pose);
  drawHead(px, spec, pose);
  drawWeapon(px, spec, pose);
}

/** A neutral grey figure shown before the roll (character name unknown). */
export function placeholderSpec(): CompanionSpec {
  return {
    archetype: 'villager',
    name: '?',
    voiceId: 'maloomowny',
    palette: { skin: '#9a9a9a', hair: '#6a6a6a', armour: '#5a5a5a', belt: '#4a4a4a', legs: '#4a4a4a', weapon: null },
    parts: { hairLong: false, hasWeapon: false },
  };
}

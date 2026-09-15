/**
 * The sprite art: draws a companion's whole sheet, in their own colours, as a
 * plain pixel buffer. Pure - no DOM, no canvas, no PNG - so all of it is unit
 * tested; `render/sheet.ts` is the only part that needs a canvas.
 *
 * Why the art is code and not a bundled image: it is generated per companion
 * rather than shipped per archetype. A sheet can therefore depend on the whole
 * spec - the rolled palette, the weapon, the long hair - instead of only the
 * archetype, which is what a shipped sheet would have to be keyed by. Nothing
 * is recoloured after the fact and nothing is erased: a companion without a
 * weapon simply never has one drawn.
 *
 * Geometry: one frame is FRAME_W x FRAME_H sprite pixels with the feet on the
 * last row. The chip draws a frame bottom-centred on the feet point, scaled so
 * the frame's height matches the fallback figure's FIGURE_H (16) - so keeping
 * FRAME_H at 16 means one sheet pixel is exactly one screen sprite pixel and
 * nothing blurs.
 *
 * Motion is split between here and the animator: the animator owns the whole
 * figure (position, rotation, squash, the fall in `topple`), the frames own
 * the parts it cannot move - limbs, eyes, mouth. That is why nothing here is
 * pre-rotated and the jumps are not drawn.
 */

import type { Archetype, CompanionSpec, Primitive } from '../companion/types';
import { hexToRgb, shadeRgb, type Rgb } from './colour';

export const FRAME_W = 16;
export const FRAME_H = 16;

export interface SheetAnimation {
  /** Row index in the grid. */
  row: number;
  frames: number;
}

/**
 * Row order on the sheet, and how many frames each animation carries. The
 * frame counts must match `PRIMITIVE_DEFS[...].frames` in render/animator.ts;
 * test/sprites.test.ts fails if they drift apart.
 */
export const ANIMATIONS: Record<Primitive, SheetAnimation> = {
  idle: { row: 0, frames: 2 },
  lunge: { row: 1, frames: 4 },
  cheer: { row: 2, frames: 4 },
  gulp: { row: 3, frames: 3 },
  slump: { row: 4, frames: 2 },
  glitter: { row: 5, frames: 3 },
  flinch: { row: 6, frames: 3 },
  topple: { row: 7, frames: 4 },
  doze: { row: 8, frames: 2 },
};

const ROWS = Object.values(ANIMATIONS).length;
const COLUMNS = Math.max(...Object.values(ANIMATIONS).map((a) => a.frames));

export const SHEET_W = COLUMNS * FRAME_W;
export const SHEET_H = ROWS * FRAME_H;

export interface SheetPixels {
  width: number;
  height: number;
  /** RGBA, row-major. Fully opaque or fully transparent, never in between. */
  data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------
// Ink: every colour one companion's sheet uses
// ---------------------------------------------------------------------------

/**
 * Shades are derived from the rolled palette rather than listed, so a companion
 * is one palette plus these factors. Colours that are the same for everyone -
 * eyes, teeth, the inside of a mouth, a gem - are fixed here.
 */
interface Ink {
  skin: Rgb;
  skinDark: Rgb;
  skinLight: Rgb;
  hair: Rgb;
  hairDark: Rgb;
  armour: Rgb;
  armourDark: Rgb;
  belt: Rgb;
  buckle: Rgb;
  legs: Rgb;
  legsDark: Rgb;
  weapon: Rgb | null;
  weaponDark: Rgb;
  weaponTip: Rgb;
  eye: Rgb;
  tooth: Rgb;
  mouth: Rgb;
  lid: Rgb;
  gem: Rgb;
  star: Rgb;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };

function rgb(hex: string): Rgb {
  return hexToRgb(hex) ?? BLACK;
}

function inkFor(spec: CompanionSpec): Ink {
  const { palette, archetype } = spec;
  const weapon = spec.parts.hasWeapon ? palette.weapon : null;
  return {
    skin: rgb(palette.skin),
    skinDark: shadeRgb(palette.skin, 0.82),
    skinLight: shadeRgb(palette.skin, 1.12),
    hair: rgb(palette.hair),
    hairDark: shadeRgb(palette.hair, 0.7),
    armour: rgb(palette.armour),
    armourDark: shadeRgb(palette.armour, 0.75),
    belt: rgb(palette.belt),
    buckle: shadeRgb(palette.belt, 1.6),
    legs: rgb(palette.legs),
    legsDark: shadeRgb(palette.legs, 0.7),
    weapon: weapon ? rgb(weapon) : null,
    weaponDark: weapon ? shadeRgb(weapon, 0.7) : BLACK,
    weaponTip: weapon ? shadeRgb(weapon, 1.35) : BLACK,
    eye: rgb(archetype === 'monster' ? '#ffe15a' : '#141414'),
    tooth: rgb('#f4f0e0'),
    mouth: rgb('#2a0f0f'),
    lid: rgb('#4a4a4a'),
    gem: rgb('#9fe8ff'),
    star: rgb('#ffe9a8'),
  };
}

// ---------------------------------------------------------------------------
// Painter
// ---------------------------------------------------------------------------

interface Painter {
  (x: number, y: number, colour: Rgb | null): void;
  row(y: number, x0: number, x1: number, colour: Rgb | null): void;
  col(x: number, y0: number, y1: number, colour: Rgb | null): void;
  box(x0: number, y0: number, x1: number, y1: number, colour: Rgb | null): void;
}

/** A painter bound to one frame's origin on the sheet; anything outside the frame is dropped. */
function painter(sheet: SheetPixels, originX: number, originY: number): Painter {
  const put = ((x: number, y: number, colour: Rgb | null): void => {
    if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) return;
    const i = ((originY + y) * sheet.width + (originX + x)) * 4;
    if (!colour) {
      sheet.data[i + 3] = 0;
      return;
    }
    sheet.data[i] = colour.r;
    sheet.data[i + 1] = colour.g;
    sheet.data[i + 2] = colour.b;
    sheet.data[i + 3] = 255;
  }) as Painter;
  put.row = (y, x0, x1, colour) => {
    for (let x = x0; x <= x1; x++) put(x, y, colour);
  };
  put.col = (x, y0, y1, colour) => {
    for (let y = y0; y <= y1; y++) put(x, y, colour);
  };
  put.box = (x0, y0, x1, y1, colour) => {
    for (let y = y0; y <= y1; y++) put.row(y, x0, x1, colour);
  };
  return put;
}

// ---------------------------------------------------------------------------
// Figure
// ---------------------------------------------------------------------------

type Arms = 'down' | 'droop' | 'up' | 'upHigh' | 'forward' | 'guard' | 'feed';
type Eyes = 'open' | 'half' | 'closed';
type Mouth = 'flat' | 'smile' | 'open' | 'frown';

interface FramePose {
  eyes: Eyes;
  mouth: Mouth;
  arms: Arms;
  /** Sideways shift of everything above the legs. */
  lean?: number;
  /** Downward shift of everything above the legs. */
  torsoDy?: number;
  /** Further downward shift of the head alone. */
  headDy?: number;
  /** Cheeks full. */
  puff?: boolean;
  /** Holding a gem up. */
  gem?: boolean;
}

/**
 * Per-archetype build: how wide the body is and where the arms hang. The face
 * box is the same for everyone so the eyes land on the same row every time.
 */
interface Build {
  wide: boolean;
  bodyX0: number;
  bodyX1: number;
  armL: number;
  armR: number;
  faceX0: number;
  faceX1: number;
  /** Archetypes whose look includes hair long enough to fall past the jaw. */
  canHaveLongHair: boolean;
  robed: boolean;
}

function build(archetype: Archetype): Build {
  const wide = archetype === 'ogre';
  return {
    wide,
    bodyX0: wide ? 4 : 5,
    bodyX1: wide ? 11 : 10,
    armL: wide ? 3 : 4,
    armR: wide ? 12 : 11,
    faceX0: 5,
    faceX1: 10,
    canHaveLongHair:
      archetype === 'villager' || archetype === 'magician' || archetype === 'wizard' || archetype === 'orc',
    robed: archetype === 'magician' || archetype === 'wizard',
  };
}

/** Where the weapon hand sits, per arm pose. */
function handRight(b: Build, arms: Arms): { x: number; y: number } {
  switch (arms) {
    case 'up':
      return { x: b.armR, y: 4 };
    case 'upHigh':
      return { x: b.armR, y: 3 };
    case 'forward':
      return { x: b.armR + 2, y: 9 };
    case 'guard':
      return { x: b.armR, y: 5 };
    case 'droop':
      return { x: b.armR, y: 12 };
    default:
      return { x: b.armR, y: 11 };
  }
}

function drawLegs(px: Painter, b: Build, ink: Ink): void {
  px.box(5, 13, 6, 14, ink.legs);
  px.box(9, 13, 10, 14, ink.legs);
  px.row(15, 5, 6, ink.legsDark);
  px.row(15, 9, 10, ink.legsDark);
  if (b.wide) {
    px.col(4, 13, 14, ink.legs);
    px.col(11, 13, 14, ink.legs);
    px(4, 15, ink.legsDark);
    px(11, 15, ink.legsDark);
  }
  if (b.robed) {
    // A robe hem instead of a gap between the legs.
    px.row(13, 7, 8, ink.armour);
    px.row(14, 7, 8, ink.armourDark);
  }
}

function drawTorso(px: Painter, b: Build, ink: Ink, dx: number, dy: number): void {
  const x0 = b.bodyX0 + dx;
  const x1 = b.bodyX1 + dx;
  px.box(x0, 8 + dy, x1, 11 + dy, ink.armour);
  px.col(x1, 8 + dy, 11 + dy, ink.armourDark);
  px.row(11 + dy, x0, x1, ink.armourDark);
  px.row(12 + dy, x0, x1, ink.belt);
  px(x0 + Math.floor((x1 - x0) / 2), 12 + dy, ink.buckle);
}

function drawArms(px: Painter, b: Build, ink: Ink, arms: Arms, dx: number, dy: number): void {
  const l = b.armL + dx;
  const r = b.armR + dx;
  const sleeve = ink.armour;
  const hand = ink.skin;
  switch (arms) {
    case 'up':
      px.col(l, 5 + dy, 8 + dy, sleeve);
      px.col(r, 5 + dy, 8 + dy, sleeve);
      px(l, 4 + dy, hand);
      px(r, 4 + dy, hand);
      break;
    case 'upHigh':
      px.col(l, 4 + dy, 8 + dy, sleeve);
      px.col(r, 4 + dy, 8 + dy, sleeve);
      px(l, 3 + dy, hand);
      px(r, 3 + dy, hand);
      break;
    case 'forward':
      px.col(l, 8 + dy, 10 + dy, sleeve);
      px(l, 11 + dy, hand);
      px.row(9 + dy, r, r + 1, sleeve);
      px(r + 2, 9 + dy, hand);
      break;
    case 'guard':
      px.col(l, 6 + dy, 8 + dy, sleeve);
      px.col(r, 6 + dy, 8 + dy, sleeve);
      px(l, 5 + dy, hand);
      px(r, 5 + dy, hand);
      break;
    case 'droop':
      px.col(l, 9 + dy, 11 + dy, sleeve);
      px.col(r, 9 + dy, 11 + dy, sleeve);
      px(l, 12 + dy, hand);
      px(r, 12 + dy, hand);
      break;
    case 'feed':
      // One hand at the mouth, the other down.
      px.col(l, 8 + dy, 10 + dy, sleeve);
      px(l, 11 + dy, hand);
      px.col(r, 8 + dy, 10 + dy, sleeve);
      px(r, 7 + dy, hand);
      px(r - 1, 6 + dy, hand);
      break;
    default:
      px.col(l, 8 + dy, 10 + dy, sleeve);
      px.col(r, 8 + dy, 10 + dy, sleeve);
      px(l, 11 + dy, hand);
      px(r, 11 + dy, hand);
      break;
  }
}

function drawLongHair(px: Painter, archetype: Archetype, b: Build, ink: Ink, dx: number, dy: number): void {
  const left = b.faceX0 - 1 + dx;
  const right = b.faceX1 + 1 + dx;
  const top = archetype === 'orc' ? 5 : 2;
  px.col(left, top + dy, 7 + dy, ink.hair);
  px.col(right, top + dy, 7 + dy, ink.hair);
  px(left, 8 + dy, ink.hairDark);
  px(right, 8 + dy, ink.hairDark);
}

function drawFace(px: Painter, b: Build, ink: Ink, dx: number, dy: number): void {
  const x0 = b.faceX0 + dx;
  const x1 = b.faceX1 + dx;
  px.box(x0, 2 + dy, x1, 7 + dy, ink.skin);
  // Rounded top corners, a shaded right side and a jaw line.
  px(x0, 2 + dy, null);
  px(x1, 2 + dy, null);
  px.col(x1, 3 + dy, 6 + dy, ink.skinDark);
  px.row(7 + dy, x0, x1, ink.skinDark);
  px.row(7 + dy, x0 + 1, x1 - 1, ink.skin);
  px(x0, 3 + dy, ink.skinLight);
}

function drawHead(px: Painter, archetype: Archetype, b: Build, ink: Ink, dx: number, dy: number): void {
  const x0 = b.faceX0 + dx;
  const x1 = b.faceX1 + dx;

  if (archetype === 'goblin') {
    // Ears before the face, so the face rounds over them.
    px(x0 - 1, 3 + dy, ink.skin);
    px(x0 - 2, 4 + dy, ink.skin);
    px(x0 - 1, 4 + dy, ink.skin);
    px(x1 + 1, 3 + dy, ink.skin);
    px(x1 + 2, 4 + dy, ink.skinDark);
    px(x1 + 1, 4 + dy, ink.skinDark);
  }

  drawFace(px, b, ink, dx, dy);

  switch (archetype) {
    case 'magician':
    case 'wizard': {
      px(x0 + 3, 0 + dy, ink.armourDark);
      px.row(1 + dy, x0 + 2, x0 + 3, ink.armour);
      px.row(2 + dy, x0 + 1, x0 + 4, ink.armour);
      px.row(3 + dy, x0 - 1, x1 + 1, ink.armourDark); // brim, clear of the eyes
      if (archetype === 'magician') px(x0 + 4, 1 + dy, ink.star);
      break;
    }
    case 'villager': {
      px.row(0 + dy, x0 + 1, x1 - 1, ink.hair);
      px.row(1 + dy, x0, x1, ink.hair);
      px.row(2 + dy, x0, x1, ink.hairDark);
      px(x0, 3 + dy, ink.hair);
      px(x1, 3 + dy, ink.hairDark);
      break;
    }
    case 'orc': {
      px.col(x0 + 2, 0 + dy, 2 + dy, ink.hair); // mohawk
      px.col(x0 + 3, 0 + dy, 2 + dy, ink.hairDark);
      px(x0 - 1, 4 + dy, ink.skin); // ears
      px(x1 + 1, 4 + dy, ink.skinDark);
      break;
    }
    case 'goblin': {
      px.row(1 + dy, x0 + 1, x1 - 1, ink.hairDark); // a scruffy tuft
      px(x0 + 2, 0 + dy, ink.hairDark);
      break;
    }
    case 'ogre': {
      px.row(1 + dy, x0 + 2, x0 + 3, ink.hair); // one tuft
      px.row(3 + dy, x0, x1, ink.skinDark); // heavy brow
      break;
    }
    case 'monster': {
      px(x0 - 1, 0 + dy, ink.hair); // horns
      px(x0, 1 + dy, ink.hair);
      px(x1 + 1, 0 + dy, ink.hairDark);
      px(x1, 1 + dy, ink.hairDark);
      px.row(2 + dy, x0 + 1, x1 - 1, ink.skinDark);
      break;
    }
  }
}

function drawEyes(px: Painter, b: Build, ink: Ink, eyes: Eyes, dx: number, dy: number): void {
  const y = 4 + dy;
  const lx = b.faceX0 + 1 + dx;
  const rx = b.faceX1 - 1 + dx;
  const colour = eyes === 'open' ? ink.eye : eyes === 'half' ? ink.lid : ink.skinDark;
  px(lx, y, colour);
  px(rx, y, colour);
}

function drawMouth(
  px: Painter,
  archetype: Archetype,
  b: Build,
  ink: Ink,
  mouth: Mouth,
  puff: boolean,
  dx: number,
  dy: number,
): void {
  const y = 6 + dy;
  const lx = b.faceX0 + 2 + dx;
  const rx = b.faceX1 - 2 + dx;
  const line = ink.skinDark;
  if (puff) {
    px(b.faceX0 + dx, y, ink.skinLight);
    px(b.faceX1 + dx, y, ink.skinLight);
  }
  switch (mouth) {
    case 'smile':
      px.row(y, lx, rx, line);
      px(lx - 1, y - 1, line);
      px(rx + 1, y - 1, line);
      break;
    case 'open':
      px.row(y, lx, rx, ink.mouth);
      px.row(y + 1, lx, rx, ink.mouth);
      break;
    case 'frown':
      px.row(y, lx, rx, line);
      px(lx - 1, y + 1, line);
      px(rx + 1, y + 1, line);
      break;
    default:
      px.row(y, lx, rx, line);
      break;
  }

  // Teeth sit over the mouth, so they read on an open one too.
  if (archetype === 'orc') {
    px(lx, y + 1, ink.tooth);
    px(rx, y + 1, ink.tooth);
  } else if (archetype === 'ogre') {
    px(lx, y + 1, ink.tooth);
  } else if (archetype === 'goblin') {
    px(rx, y + 1, ink.tooth);
  }

  if (archetype === 'wizard') {
    // Beard: moustache beside the mouth, then down over the chest.
    px(b.faceX0 + dx, y, ink.hair);
    px(b.faceX1 + dx, y, ink.hair);
    px.row(y + 1, b.faceX0 + dx, b.faceX1 + dx, ink.hair);
    px.row(y + 2, b.faceX0 + 1 + dx, b.faceX1 - 1 + dx, ink.hair);
    px.row(y + 3, b.faceX0 + 2 + dx, b.faceX1 - 2 + dx, ink.hairDark);
  }
}

function drawWeapon(px: Painter, archetype: Archetype, b: Build, ink: Ink, arms: Arms, dx: number, dy: number): void {
  if (!ink.weapon) return;
  const hand = handRight(b, arms);
  const hx = hand.x + dx + 1;
  const hy = hand.y + dy;

  if (b.robed) {
    // A staff, taller than the figure, with a lit tip.
    const top = Math.max(0, hy - 9);
    px.col(hx, top + 1, Math.min(FRAME_H - 1, hy + 2), ink.weapon);
    px(hx, top, ink.weaponTip);
    px(hx, hy, ink.weaponDark); // the grip
    return;
  }
  if (archetype === 'ogre') {
    // A club: a shaft with a heavier head.
    px.col(hx, hy - 5, hy + 1, ink.weapon);
    px(hx - 1, hy - 5, ink.weaponDark);
    px(hx - 1, hy - 4, ink.weaponDark);
    px(hx, hy, ink.weaponDark);
    return;
  }
  if (arms === 'forward') {
    // A thrust reads far better with the blade level.
    px.row(hy, hx, hx + 1, ink.weapon);
    px(hx - 1, hy, ink.weaponDark);
    return;
  }
  // A short blade held point-up.
  px.col(hx, Math.max(0, hy - 5), hy - 1, ink.weapon);
  px(hx, hy, ink.weaponDark);
  px(hx - 1, hy - 1, ink.weaponDark); // crossguard
}

function drawFrame(sheet: SheetPixels, originX: number, originY: number, spec: CompanionSpec, ink: Ink, pose: FramePose): void {
  const px = painter(sheet, originX, originY);
  const archetype = spec.archetype;
  const b = build(archetype);
  const dx = pose.lean ?? 0;
  const dy = pose.torsoDy ?? 0;
  const hdy = dy + (pose.headDy ?? 0);

  drawLegs(px, b, ink);
  if (spec.parts.hairLong && b.canHaveLongHair) drawLongHair(px, archetype, b, ink, dx, hdy);
  drawTorso(px, b, ink, dx, dy);
  drawArms(px, b, ink, pose.arms, dx, dy);
  drawWeapon(px, archetype, b, ink, pose.arms, dx, dy);
  drawHead(px, archetype, b, ink, dx, hdy);
  drawEyes(px, b, ink, pose.eyes, dx, hdy);
  drawMouth(px, archetype, b, ink, pose.mouth, pose.puff === true, dx, hdy);
  if (pose.gem) {
    const hand = handRight(b, pose.arms);
    px(hand.x + dx, hand.y - 1 + dy, ink.gem);
  }
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/**
 * The poses, animation by animation. Read these next to `PRIMITIVE_DEFS` in
 * render/animator.ts: whatever the animator already does to the whole figure
 * is deliberately absent here.
 */
const POSES: Record<Primitive, FramePose[]> = {
  idle: [
    // The animator bobs the whole figure between these two, so the difference
    // here is only the arms - together it reads as breathing, not bouncing.
    { eyes: 'open', mouth: 'flat', arms: 'down' },
    { eyes: 'open', mouth: 'flat', arms: 'droop' },
  ],
  lunge: [
    { eyes: 'open', mouth: 'flat', arms: 'down', lean: -1 },
    { eyes: 'open', mouth: 'open', arms: 'forward' },
    { eyes: 'open', mouth: 'open', arms: 'forward', lean: 1 },
    { eyes: 'open', mouth: 'smile', arms: 'down' },
  ],
  cheer: [
    { eyes: 'open', mouth: 'smile', arms: 'up', torsoDy: 1 },
    { eyes: 'open', mouth: 'open', arms: 'up' },
    { eyes: 'open', mouth: 'open', arms: 'upHigh' },
    { eyes: 'open', mouth: 'smile', arms: 'up' },
  ],
  gulp: [
    { eyes: 'open', mouth: 'open', arms: 'feed' },
    { eyes: 'half', mouth: 'flat', arms: 'down', puff: true },
    { eyes: 'open', mouth: 'smile', arms: 'down' },
  ],
  slump: [
    { eyes: 'half', mouth: 'frown', arms: 'droop', torsoDy: 1 },
    { eyes: 'half', mouth: 'frown', arms: 'droop', torsoDy: 1, headDy: 1 },
  ],
  glitter: [
    { eyes: 'open', mouth: 'smile', arms: 'upHigh', gem: true },
    { eyes: 'half', mouth: 'open', arms: 'upHigh', gem: true },
    { eyes: 'open', mouth: 'smile', arms: 'up', gem: true },
  ],
  flinch: [
    { eyes: 'closed', mouth: 'open', arms: 'guard', lean: -1 },
    { eyes: 'closed', mouth: 'open', arms: 'guard', lean: -1, headDy: 1 },
    { eyes: 'half', mouth: 'frown', arms: 'down' },
  ],
  topple: [
    { eyes: 'closed', mouth: 'open', arms: 'up' },
    { eyes: 'closed', mouth: 'open', arms: 'droop', headDy: 1 },
    { eyes: 'closed', mouth: 'flat', arms: 'droop', torsoDy: 1 },
    { eyes: 'half', mouth: 'frown', arms: 'droop', torsoDy: 1, headDy: 1 },
  ],
  doze: [
    { eyes: 'closed', mouth: 'flat', arms: 'droop', torsoDy: 1 },
    { eyes: 'closed', mouth: 'flat', arms: 'droop', torsoDy: 1, headDy: 1 },
  ],
};

/**
 * Draw one companion's whole sheet. Deterministic: the same spec always gives
 * the same pixels, which is what makes it safe to build on every load instead
 * of shipping the result.
 */
export function drawSheetPixels(spec: CompanionSpec): SheetPixels {
  const sheet: SheetPixels = { width: SHEET_W, height: SHEET_H, data: new Uint8ClampedArray(SHEET_W * SHEET_H * 4) };
  const ink = inkFor(spec);
  for (const [name, animation] of Object.entries(ANIMATIONS) as [Primitive, SheetAnimation][]) {
    const poses = POSES[name];
    for (let column = 0; column < animation.frames; column++) {
      const pose = poses[column] ?? (poses[0] as FramePose);
      drawFrame(sheet, column * FRAME_W, animation.row * FRAME_H, spec, ink, pose);
    }
  }
  return sheet;
}

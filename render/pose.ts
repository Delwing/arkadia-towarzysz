/**
 * The vocabulary the two halves of the art share.
 *
 * `Pose` is what the chip draws this frame: which frame of which animation,
 * where the whole figure is, how it is squashed and turned, how solid it is,
 * and what light of our own is on it.
 *
 * Nothing here draws anything or knows a single animation by name.
 */


export interface Pose {
  /** Sprite-pixel offsets. */
  dx: number;
  dy: number;
  /** Scale around the feet. A negative `sx` faces the other way. */
  sx: number;
  sy: number;
  /** Radians around the feet; positive falls to the right. */
  rot: number;
  /** 0..1, how much glitter to sprinkle around the figure. */
  sparkle: number;
  /** 0..1, sleep marks. */
  zz: number;
  /** 0..1, pipe smoke drifting off the companion. */
  puff: number;
  /** 0..1, hurt flash. */
  flash: number;
  /** 0..1 opacity of the whole figure; a warp fades out through it. */
  alpha: number;
  /** 0..1, a column of warp light at the figure's feet. */
  beam: number;
  /**
   * Which frame of the animation to draw, as a phase in [0, 1) rather than an
   * index: the drawn sheet has four walk frames and the Mixer's has six, and
   * the animator should not have to know which sheet is loaded. Whoever holds
   * the frames resolves it.
   */
  frame: { animation: string; phase: number };
}

export function basePose(): Pose {
  return {
    dx: 0,
    dy: 0,
    sx: 1,
    sy: 1,
    rot: 0,
    sparkle: 0,
    zz: 0,
    puff: 0,
    flash: 0,
    alpha: 1,
    beam: 0,
    frame: { animation: 'idle', phase: 0 },
  };
}

export const PI = Math.PI;

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** A straight walk through the frames over the animation's own time. */
export function framePhase(animation: string, t: number): Pose['frame'] {
  return { animation, phase: Math.min(ALMOST_ONE, Math.max(0, t)) };
}

/**
 * For an animation whose frames do not advance with the clock - a walk cycle
 * that steps, a warp that goes back and forth. `count` is how many frames the
 * animation was written against; a sheet with a different number stretches it.
 */
export function framePick(animation: string, index: number, count: number): Pose['frame'] {
  const clamped = Math.min(count - 1, Math.max(0, Math.floor(index)));
  return { animation, phase: clamped / count };
}

/** Phase is a half-open range: 1 would round past the last frame. */
const ALMOST_ONE = 0.999999;

/** Resolve a phase against however many frames a sheet actually carries. */
export function frameIndex(phase: number, frames: number): number {
  if (!(frames > 0)) return 0;
  return Math.min(frames - 1, Math.max(0, Math.floor(phase * frames)));
}

/** 0 before `from`, 1 after `to`, linear in between. The phases of a long animation. */
export function span(t: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (t - from) / (to - from)));
}

/**
 * Every animation, in one place: how long it runs, what can interrupt it, how
 * the whole figure moves, and whether the companion ever plays it of their own
 * accord. Adding an animation is adding an entry here - the primitive's name,
 * the animator's table, the idle-life draw and the showcase's buttons are all
 * derived from this object.
 *
 * The art is not here. The frames come from the Sprite Mixer, named per
 * animation in `tools/mixer/manifest.json` and baked by `yarn mixer`; an entry
 * in this file and a line in that manifest are the two halves of an animation.
 * So `pose` should only do what a frame cannot: put the companion somewhere
 * else, or lay an effect of our own over the top. Where their frames already
 * carry a motion - the death falls, the warp fades - this file stays out of it.
 *
 * Worth adding next, from their catalogue: jog, rush and dash for a hurried
 * walk; jump and double jump; spawn; fly and float; charge and casting for the
 * two robed archetypes; heal; land; drop; hardhit; poof; smoke; spark;
 * explode; melt; freeze; drown; sink; trap.
 */

import type { Rng } from '../companion/rng';
import { MIXER_CLIPS, MIXER_FRAME_MS, MIXER_VARIANTS } from './mixer-art';
import { easeOut, framePhase, framePick, PI, span, type Pose } from './pose';

/**
 * How long the art takes to play once, at the speed it was drawn: its own frame
 * delay times its own frame count. An animation that leaves `durationMs` out
 * runs for exactly this, so the companion moves at the pace the artist chose
 * rather than one we invented for a sheet that no longer exists.
 */
export function sourceMs(name: string): number {
  const clip = MIXER_CLIPS[name];
  return clip ? MIXER_FRAME_MS * clip.frames.length : 0;
}

/**
 * The phase of a clip looping at its own speed inside an animation that lasts
 * longer - a jog under a walk that has somewhere to get to, a sleeper under a
 * doze that runs until they are woken.
 */
function looped(name: string, t: number, durationMs: number): number {
  const source = sourceMs(name) || durationMs;
  return (t * (durationMs / source)) % 1;
}

/** The walk is as long as it takes to stroll out and back, not as long as one jog. */
const WALK_MS = 3400;
/** Long enough to be a rest rather than a stumble. */
const REST_MS = 9000;

/** How long one turn of the idle takes; the animator breathes on this clock. */
export const IDLE_PERIOD_MS = sourceMs('idle') || 1400;

/**
 * The rows an animation may be drawn with. Most have one; a death has four, and
 * the animator picks between them so that dying twice does not look the same
 * twice.
 */
export function variantsOf(name: string): readonly string[] {
  return MIXER_VARIANTS[name] ?? [name];
}

/**
 * What a held animation should settle on, when its own last frame would keep a
 * couple of stray pixels on screen for ever - the tail of a soul that has
 * otherwise left. A death settles into the plain body on the floor.
 *
 * Endings that are *meant* to persist - the skull, the melt, the shrunken
 * remains - are not remnants and are left alone.
 */
export function restingFrame(variant: string): string | null {
  return MIXER_CLIPS[variant]?.endsWithRemnant ? 'die' : null;
}

/**
 * A death lies still for this share of itself before whatever carries the
 * companion off - the soul, the skull, the melt - begins. Their `die` frame is
 * the body on the floor and nothing else, which makes it exactly the beat the
 * game's own "Umierasz." wants before "Oddalasz sie.".
 */
const DEATH_STILL = 0.25;

/** How the companion may play an animation of their own accord; see companion/ambient.ts. */
export interface AmbientSpec {
  /** Relative to the other ambient animations. */
  weight: number;
  /** `walk` and `warp` read the sign of this as the direction to go. */
  intensity(rng: Rng): number;
}

export interface AnimationSpec {
  /** Absent: play the art once, at the speed it was drawn. */
  durationMs?: number;
  /** Keeps playing until `wake()`; the doze. */
  sustained?: boolean;
  /**
   * Plays once and then holds its last frame until `revive()`. The death: a
   * companion who has died stays dead until the client says they respawned,
   * rather than getting up again because a timer ran out.
   */
  holds?: boolean;
  /** Multiplies the chosen clip's own length, for an animation that adds a beat of its own. */
  durationScale?: number;
  /** Higher wins when one is already playing; the idle life is 0. */
  priority: number;
  /** Absent means the companion never starts it themselves. */
  ambient?: AmbientSpec;
  /**
   * The whole-figure motion. `base` arrives with this animation's own frame
   * already chosen for `t`, so an entry only sets `frame` when it wants
   * something other than a straight walk through its frames.
   */
  pose(t: number, k: number, base: Pose): Pose;
}

/** The sign of an ambient intensity: which way the companion goes. */
function heading(k: number): number {
  return k < 0 ? -1 : 1;
}

function direction(rng: Rng): number {
  return rng() < 0.5 ? -1 : 1;
}

/** Which `warp` frame belongs to which phase of the round trip. */
function warpFrame(t: number): number {
  if (t < 0.14) return 0; // gathering, at home
  if (t < 0.34) return 1; // going up in the light
  if (t < 0.44) return 2; // forming over there
  if (t < 0.60) return 3; // standing over there
  if (t < 0.78) return 1; // going up again
  if (t < 0.88) return 2; // forming back home
  return 3;
}

const SPECS = {
  idle: {
    durationMs: 1,
    priority: 0,
    pose: (_t, _k, base) => base,
  },
  lunge: {
    priority: 2,
    pose(t, k, base) {
      const out = t < 0.35 ? t / 0.35 : (1 - t) / 0.65;
      return {
        ...base,
        dx: base.dx + 6 * k * easeOut(out),
        sy: 1 - 0.08 * Math.min(k, 2) * Math.sin(PI * t),
        sx: 1 + 0.06 * Math.min(k, 2) * Math.sin(PI * t),
      };
    },
  },
  cheer: {
    priority: 3,
    pose(t, k, base) {
      // One jump; a big intensity adds a second, smaller hop.
      const first = t < 0.6 ? Math.sin((PI * t) / 0.6) : 0;
      const second = k > 1.5 && t >= 0.6 ? Math.sin((PI * (t - 0.6)) / 0.4) * 0.5 : 0;
      const lift = Math.max(first, second);
      // The canvas has two rows of headroom above the figure, so the jump is
      // small in pixels and the intensity goes mostly into the stretch.
      return {
        ...base,
        dy: base.dy - Math.round((1 + Math.min(k, 2.5) / 2.5) * lift),
        sy: 1 + 0.05 * Math.min(k, 2) * lift,
        sx: 1 - 0.04 * lift,
        sparkle: k >= 2 ? 0.6 * lift : 0,
      };
    },
  },
  gulp: {
    priority: 1,
    pose(t, k, base) {
      const squash = t < 0.5 ? Math.sin(PI * (t / 0.5)) : 0;
      const stretch = t >= 0.5 ? Math.sin(PI * ((t - 0.5) / 0.5)) : 0;
      return {
        ...base,
        sy: 1 - 0.18 * Math.min(k, 2) * 0.5 * squash + 0.08 * Math.min(k, 2) * 0.5 * stretch,
        sx: 1 + 0.08 * Math.min(k, 2) * 0.5 * squash,
      };
    },
  },
  slump: {
    priority: 1,
    pose(t, k, base) {
      const down = t < 0.7 ? easeOut(t / 0.7) : 1 - (t - 0.7) / 0.3;
      return {
        ...base,
        dy: base.dy + Math.round(2 * Math.min(k, 2) * down),
        sy: 1 - 0.08 * Math.min(k, 2) * down,
      };
    },
  },
  glitter: {
    priority: 2,
    pose(t, k, base) {
      const pulse = Math.sin(4 * PI * t) * Math.sin(PI * t);
      return {
        ...base,
        sx: 1 + 0.05 * pulse,
        sy: 1 + 0.05 * pulse,
        sparkle: Math.min(1, (k / 2.2) * Math.sin(PI * t)),
      };
    },
  },
  flinch: {
    priority: 3,
    pose(t, k, base) {
      const shake = Math.sin(t * PI * 5) * (1 - t);
      return {
        ...base,
        dx: base.dx - Math.round(4 * Math.min(k, 2.5) * 0.5 * shake),
        rot: -0.08 * Math.min(k, 2) * shake,
        flash: Math.max(0, 1 - t * 1.5),
      };
    },
  },
  topple: {
    priority: 5,
    // The companion does not get up because a timer ran out: they lie there
    // until the client says the character respawned. Nothing persists it, so a
    // relog finds them on their feet.
    holds: true,
    // The chosen end, plus the beat of lying still that comes before it.
    durationScale: 1 / (1 - DEATH_STILL),
    pose(t, _k, base) {
      // Their `die` frame is the body on the floor; whichever of the deaths was
      // drawn - soul, skull, melt, shrink - takes it from there, and the
      // animator has already picked which. Nothing here rotates: the body is
      // drawn lying down, and a quarter turn would stand the corpse up.
      if (t < DEATH_STILL) {
        const drop = span(t, 0, 0.5 * DEATH_STILL);
        return { ...base, dy: base.dy + Math.round(2 * drop), sy: 1 - 0.08 * drop, frame: framePhase('die', 0) };
      }
      return { ...base, dy: base.dy + 2, frame: framePhase('topple', span(t, DEATH_STILL, 1)) };
    },
  },
  doze: {
    durationMs: sourceMs('doze') || 3000,
    sustained: true,
    priority: 1,
    pose(t, _k, base) {
      return {
        ...base,
        dy: base.dy + 1,
        sy: 0.97 + 0.02 * Math.sin(2 * PI * t),
        zz: 1,
      };
    },
  },
// The idle life. Priority 0, so any reaction cuts straight through one, and
    // `companion/ambient.ts` is the only thing that plays them.
  walk: {
    durationMs: WALK_MS,
    priority: 0,
    ambient: { weight: 8, intensity: (rng) => direction(rng) * (0.7 + rng() * 0.8) },
    pose(t, k, base) {
      const dir = heading(k);
      // Three of the chip's spare columns; the fourth is the figure's own width.
      const reach = 2 + Math.round(Math.min(Math.abs(k), 1.5));
      const out = span(t, 0.05, 0.38);
      const back = span(t, 0.62, 0.95);
      const moving = (t > 0.05 && t < 0.38) || (t > 0.62 && t < 0.95);
      // The jog steps and bobs on its own, so the travel is all this adds to
      // it: the clip loops underneath at the speed it was drawn, however many
      // times that takes, and stands on its first frame at the far end.
      //
      // It does mirror the figure, though. The jog is drawn as a front view, so
      // in theory it faces nobody and a flip is meaningless - but a companion
      // walking left without one reads as walking backwards, so the sprite
      // turns to face the way it is going and turns back at the far end.
      const facing = t < 0.5 ? dir : t < 0.95 ? -dir : 1;
      return {
        ...base,
        dx: base.dx + dir * reach * (out - back),
        sx: facing,
        frame: moving ? framePhase('walk', looped('walk', t, WALK_MS)) : framePhase('walk', 0),
      };
    },
  },
  warp: {
    // Out, a beat of nothing, and back in. The way in runs at the speed it was
    // drawn; the way out is quicker, because vanishing should be.
    durationMs: Math.round(sourceMs('warp') * 1.8) || 2400,
    priority: 0,
    ambient: { weight: 2, intensity: () => 1 },
    pose(t, _k, base) {
      // Their clip is an arrival: it opens on four empty frames, the companion
      // appears high and small, and it settles into a stand. So the way out is
      // the same frames backwards, and the empty end of it is the beat where
      // they are gone. Nothing here fades or stretches them - the frames do it,
      // and an alpha of ours on top only muddied them.
      const phase = t < 0.3 ? 1 - span(t, 0, 0.3) : t < 0.46 ? 0 : span(t, 0.46, 1);
      return { ...base, frame: framePhase('warp', phase) };
    },
  },
  flicker: {
    priority: 0,
    ambient: { weight: 4, intensity: (rng) => 0.7 + rng() * 0.8 },
    pose(t, _k, base) {
      // Their flash is three frames and does its own flickering; picking one of
      // two, as this did while we drew our own, could only ever reach the first
      // two of them.
      return { ...base, frame: framePhase('flicker', t) };
    },
  },
  rest: {
    durationMs: REST_MS,
    priority: 0,
    ambient: { weight: 5, intensity: () => 1 },
    pose(t, _k, base) {
      // The sitting pose is in the frames themselves, feet still on the floor
      // row - so this must not also push the figure down, or it would drop
      // through the bottom of the chip. The knees are the squash on the way
      // down and the stretch on the way back up.
      const down = span(t, 0, 0.12) - span(t, 0.88, 1);
      const sitting = t >= 0.12 && t < 0.88;
      return {
        ...base,
        dy: base.dy,
        sy: 1 - 0.09 * down,
        sx: 1 + 0.05 * down,
        // The sit loops at its own speed for as long as the rest lasts.
        frame: framePhase('rest', looped('rest', t, REST_MS)),
      };
    },
  },
} satisfies Record<string, AnimationSpec>;

/** Every animation's name. The union comes from the table above, so it cannot drift from it. */
export type Primitive = keyof typeof SPECS;

/** Declaration order, which is also the sheet's row order. */
export const PRIMITIVES = Object.keys(SPECS) as Primitive[];

export const ANIMATION_SPECS: Record<Primitive, AnimationSpec> = SPECS;

export interface PrimitiveDef {
  durationMs: number;
  sustained?: boolean;
  /** Plays once and then stays on its last frame until something releases it. */
  holds?: boolean;
  /** Multiplies the chosen clip's own length. */
  durationScale?: number;
  /**
   * The duration came from the art, so a playback that picks a different row
   * should take that row's length instead. An animation with a duration of its
   * own - a walk that has somewhere to get to - keeps it whatever it plays.
   */
  fromSource?: boolean;
  priority: number;
  pose(t: number, k: number, base: Pose): Pose;
}

/** What the animator plays: the spec with its own frame pre-chosen for `t`. */
export const ANIMATION_DEFS = Object.fromEntries(
  PRIMITIVES.map((name) => {
    const spec = SPECS[name] as AnimationSpec;
    const def: PrimitiveDef = {
      // No duration of its own means the art's: one turn at the drawn speed.
      durationMs: spec.durationMs ?? sourceMs(name) ?? 0,
      priority: spec.priority,
      pose: (t, k, base) => spec.pose(t, k, { ...base, frame: framePhase(name, t) }),
    };
    if (spec.durationMs === undefined) def.fromSource = true;
    if (spec.sustained === true) def.sustained = true;
    if (spec.holds === true) def.holds = true;
    if (spec.durationScale !== undefined) def.durationScale = spec.durationScale;
    return [name, def];
  }),
) as Record<Primitive, PrimitiveDef>;

export interface SheetAnimation {
  /** Row index in the sheet grid. */
  row: number;
  /** How many frames that row carries - the sheet's answer, not ours. */
  frames: number;
}

export interface AmbientChoice extends AmbientSpec {
  primitive: Primitive;
}

/** The animations the companion plays when left alone, in declaration order. */
export const AMBIENT_CHOICES: readonly AmbientChoice[] = PRIMITIVES.flatMap((primitive) => {
  const ambient = (SPECS[primitive] as AnimationSpec).ambient;
  return ambient ? [{ primitive, ...ambient }] : [];
});

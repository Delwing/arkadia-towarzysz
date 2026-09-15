import { describe, expect, it } from 'vitest';
import { Animator, PRIMITIVE_DEFS, basePose } from '../render/animator';
import { frameIndex } from '../render/pose';
import { PRIMITIVES } from '../render/animations';

describe('animator', () => {
  it('every primitive has a definition, a positive duration and frames', () => {
    for (const primitive of PRIMITIVES) {
      const def = PRIMITIVE_DEFS[primitive];
      expect(def.durationMs).toBeGreaterThan(0);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const pose = def.pose(t, 1, basePose());
        for (const key of ['dx', 'dy', 'sx', 'sy', 'rot', 'sparkle', 'zz', 'flash', 'alpha', 'beam'] as const) {
          expect(Number.isFinite(pose[key]), `${primitive} ${key} at ${t}`).toBe(true);
        }
      }
    }
  });

  it('idles when nothing is playing and returns to idle when a primitive ends', () => {
    const animator = new Animator(0);
    expect(animator.current(0)).toBe('idle');
    animator.play('lunge', 1, 1000);
    expect(animator.current(1100)).toBe('lunge');
    expect(animator.pose(1100).dx).not.toBe(0);
    expect(animator.current(1000 + PRIMITIVE_DEFS.lunge.durationMs)).toBe('idle');
    expect(animator.pose(5000).dx).toBe(0);
  });

  it('a topple lies down, and a lower-priority primitive cannot interrupt it', () => {
    const animator = new Animator(0);
    animator.play('topple', 1, 0);
    const lying = animator.pose(PRIMITIVE_DEFS.topple.durationMs * 0.5);
    // The frames are drawn lying down, so nothing here rotates; the drop onto
    // the floor is all the animator adds.
    expect(lying.rot).toBe(0);
    expect(lying.dy).toBeGreaterThan(0);
    expect(animator.play('lunge', 1, 100)).toBe(false);
    expect(animator.current(100)).toBe('topple');
    expect(animator.play('cheer', 2.5, 100)).toBe(false);
  });

  it('intensity scales the amplitude', () => {
    const small = PRIMITIVE_DEFS.lunge.pose(0.3, 0.5, basePose()).dx;
    const big = PRIMITIVE_DEFS.lunge.pose(0.3, 2.5, basePose()).dx;
    expect(big).toBeGreaterThan(small);
    expect(PRIMITIVE_DEFS.glitter.pose(0.5, 2.2, basePose()).sparkle).toBeGreaterThan(
      PRIMITIVE_DEFS.glitter.pose(0.5, 0.5, basePose()).sparkle,
    );
  });

  it('plays each animation for as long as its entry says', () => {
    // The bug this is here for: taking the length from the clip meant a walk
    // that should stroll for 3.4 s finished in the 520 ms of one jog.
    for (const primitive of PRIMITIVES) {
      if (primitive === 'idle') continue;
      const def = PRIMITIVE_DEFS[primitive];
      if (def.sustained || def.holds) continue;
      const animator = new Animator(0);
      animator.play(primitive, 1, 0);
      const expected = def.durationMs * (def.durationScale ?? 1);
      expect(animator.current(expected - 10), primitive).toBe(primitive);
      expect(animator.current(expected + 10), primitive).toBe('idle');
    }
  });

  it('holds a death until something revives it, and never on a timer', () => {
    const animator = new Animator(0);
    animator.play('topple', 1, 0);
    expect(animator.current(60_000)).toBe('topple');
    expect(animator.isHeld(60_000)).toBe(true);
    // Being busy elsewhere does not help: only a respawn does.
    animator.wake();
    expect(animator.current(60_000)).toBe('topple');
    animator.revive();
    expect(animator.current(60_001)).toBe('idle');
  });

  it('does not always die the same way', () => {
    const variants = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const animator = new Animator(seed);
      animator.play('topple', 1, 0);
      // Partway in: past the beat of lying still, before the shortest ends.
      variants.add(animator.pose(500).frame.animation);
    }
    expect(variants.size).toBeGreaterThan(1);
    for (const name of variants) expect(name.startsWith('topple'), name).toBe(true);
  });

  it('settles a death that ends on a wisp, and leaves the rest as they are', () => {
    const settled = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const animator = new Animator(seed);
      animator.play('topple', 1, 0);
      settled.add(animator.pose(60_000).frame.animation);
    }
    // The soul's last frame keeps two pixels of it, so that one settles onto
    // the plain body; a skull or a melt is an ending and stays put.
    expect(settled.has('die')).toBe(true);
    for (const name of settled) expect(name === 'die' || name.startsWith('topple'), name).toBe(true);
  });

  it('the doze is sustained until woken', () => {
    const animator = new Animator(0);
    animator.play('doze', 1, 0);
    expect(animator.current(60_000)).toBe('doze');
    expect(animator.pose(60_000).zz).toBe(1);
    animator.wake();
    expect(animator.current(60_001)).toBe('idle');
  });

  it('sweeps the whole idle clip, not two frames of it', () => {
    const animator = new Animator(0);
    const seen = new Set<number>();
    for (let t = 0; t < 4000; t += 10) seen.add(frameIndex(animator.pose(t).frame.phase, 4));
    // Alternating two poses used to land on phases 0 and 0.5, which on a
    // four-frame idle showed frames 0 and 2 and never 1 or 3.
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });
});

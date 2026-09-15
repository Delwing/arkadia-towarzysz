import { describe, expect, it } from 'vitest';
import { Animator, PRIMITIVE_DEFS, basePose } from '../render/animator';
import { PRIMITIVES } from '../companion/types';

describe('animator', () => {
  it('every primitive has a definition, a positive duration and frames', () => {
    for (const primitive of PRIMITIVES) {
      const def = PRIMITIVE_DEFS[primitive];
      expect(def.durationMs).toBeGreaterThan(0);
      expect(def.frames).toBeGreaterThan(0);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const pose = def.pose(t, 1, basePose());
        for (const key of ['dx', 'dy', 'sx', 'sy', 'rot', 'sparkle', 'zz', 'flash'] as const) {
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
    expect(lying.rot).toBeCloseTo(Math.PI / 2);
    expect(lying.eyes).toBe('closed');
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

  it('the doze is sustained until woken', () => {
    const animator = new Animator(0);
    animator.play('doze', 1, 0);
    expect(animator.current(60_000)).toBe('doze');
    expect(animator.pose(60_000).zz).toBe(1);
    expect(animator.pose(60_000).eyes).toBe('closed');
    animator.wake();
    expect(animator.current(60_001)).toBe('idle');
  });

  it('blinks periodically while idle', () => {
    const animator = new Animator(0);
    let closed = 0;
    for (let t = 0; t < 20_000; t += 10) if (animator.pose(t).eyes === 'closed') closed++;
    expect(closed).toBeGreaterThan(0);
    expect(closed).toBeLessThan(2000 * 0.1);
  });
});

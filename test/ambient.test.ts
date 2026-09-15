import { describe, expect, it } from 'vitest';
import {
  Ambient,
  AMBIENT_CHOICES,
  AMBIENT_MAX_GAP_MS,
  AMBIENT_MIN_GAP_MS,
  AMBIENT_SETTLE_MS,
  LEVEL_SCALE,
  pickAmbient,
} from '../companion/ambient';
import { seededRng } from '../companion/rng';
import { AMBIENT_LEVELS, type Primitive } from '../companion/types';
import { PRIMITIVES } from '../render/animations';
import { Animator, PRIMITIVE_DEFS, basePose as base } from '../render/animator';
import { frameIndex } from '../render/pose';

/** The companion's own idle life, as opposed to a reaction. */
const AMBIENT_PRIMITIVES = ['walk', 'warp', 'flicker', 'rest'] as const;

/** Run an animator forward, collecting whatever it starts on its own. */
function observe(animator: Animator, untilMs: number, stepMs = 100): Primitive[] {
  const seen: Primitive[] = [];
  for (let t = 0; t <= untilMs; t += stepMs) {
    animator.pose(t);
    const current = animator.current(t);
    if (current !== 'idle' && seen[seen.length - 1] !== current) seen.push(current);
  }
  return seen;
}

describe('pickAmbient', () => {
  it('only ever picks primitives the animator can play', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 500; i++) {
      const action = pickAmbient(rng);
      expect(PRIMITIVES).toContain(action.primitive);
      expect(Number.isFinite(action.intensity)).toBe(true);
    }
  });

  it('reaches every choice, and reaches the rarest least often', () => {
    const rng = seededRng(3);
    const counts = new Map<Primitive, number>();
    for (let i = 0; i < 2000; i++) {
      const { primitive } = pickAmbient(rng);
      counts.set(primitive, (counts.get(primitive) ?? 0) + 1);
    }
    for (const choice of AMBIENT_CHOICES) expect(counts.get(choice.primitive) ?? 0).toBeGreaterThan(0);
    const rarest = [...AMBIENT_CHOICES].sort((a, b) => a.weight - b.weight)[0];
    const commonest = [...AMBIENT_CHOICES].sort((a, b) => b.weight - a.weight)[0];
    expect(counts.get(rarest?.primitive as Primitive)).toBeLessThan(counts.get(commonest?.primitive as Primitive) as number);
  });

  it('sends the companion both ways', () => {
    const rng = seededRng(11);
    const signs = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const { primitive, intensity } = pickAmbient(rng);
      if (primitive === 'walk') signs.add(Math.sign(intensity));
    }
    expect(signs).toEqual(new Set([-1, 1]));
  });
});

describe('Ambient', () => {
  it('stays quiet at level off, however long it is polled', () => {
    const ambient = new Ambient(1, 'off');
    for (let t = 0; t < 600_000; t += 1000) expect(ambient.poll(t)).toBeNull();
  });

  it('never fires on the first poll - the clock starts wherever it starts', () => {
    const ambient = new Ambient(1, 'normal');
    expect(ambient.poll(1_234_567)).toBeNull();
  });

  it('fires within the declared gap, and then waits again', () => {
    const ambient = new Ambient(2, 'normal');
    ambient.poll(0);
    let first: number | null = null;
    for (let t = 0; t <= AMBIENT_MAX_GAP_MS; t += 100) {
      if (ambient.poll(t)) {
        first = t;
        break;
      }
    }
    expect(first).not.toBeNull();
    expect(first as number).toBeGreaterThanOrEqual(AMBIENT_MIN_GAP_MS);
    // And the next one is a fresh wait, not a backlog firing on every frame.
    expect(ambient.poll((first as number) + 100)).toBeNull();
  });

  it('a busy companion never fires the moment they are free', () => {
    const ambient = new Ambient(4, 'often');
    ambient.poll(0);
    let last = 0;
    for (let t = 0; t < 300_000; t += 100) {
      ambient.defer(t);
      last = t;
    }
    // The settle time runs from the last busy frame, not from the poll.
    expect(ambient.poll(300_000)).toBeNull();
    expect(ambient.poll(last + AMBIENT_SETTLE_MS - 1)).toBeNull();
    expect(ambient.poll(last + AMBIENT_SETTLE_MS)).not.toBeNull();
  });

  it('a level change reschedules rather than firing at once', () => {
    const ambient = new Ambient(5, 'rare');
    ambient.poll(0);
    ambient.setLevel('often');
    expect(ambient.poll(0)).toBeNull();
  });

  it('scales the gap with the level', () => {
    const gaps = new Map<string, number>();
    for (const level of AMBIENT_LEVELS) {
      if (level === 'off') continue;
      const ambient = new Ambient(9, level);
      ambient.poll(0);
      let fired = Infinity;
      for (let t = 0; t <= 400_000; t += 100) {
        if (ambient.poll(t)) {
          fired = t;
          break;
        }
      }
      gaps.set(level, fired);
    }
    expect(gaps.get('often') as number).toBeLessThan(gaps.get('normal') as number);
    expect(gaps.get('normal') as number).toBeLessThan(gaps.get('rare') as number);
    expect(LEVEL_SCALE.off).toBe(0);
  });

  it('forces one on demand whatever the level', () => {
    const ambient = new Ambient(6, 'off');
    expect(PRIMITIVES).toContain(ambient.force(0).primitive);
  });
});

describe('the animator living its own life', () => {
  it('does nothing of its own accord until a level is set', () => {
    const animator = new Animator(1);
    expect(observe(animator, 600_000)).toEqual([]);
  });

  it('reaches every one of its own actions when left alone', () => {
    const animator = new Animator(1);
    animator.setAmbientLevel('often');
    const seen = new Set(observe(animator, 1_800_000));
    expect(seen).toEqual(new Set(AMBIENT_PRIMITIVES));
  });

  it('a reaction cuts straight through whatever they were doing', () => {
    const animator = new Animator(1);
    animator.setAmbientLevel('often');
    let started: number | null = null;
    for (let t = 0; t <= 300_000; t += 100) {
      animator.pose(t);
      if (animator.current(t) === 'walk') {
        started = t;
        break;
      }
    }
    expect(started).not.toBeNull();
    expect(animator.play('flinch', 1, (started as number) + 100)).toBe(true);
    expect(animator.current((started as number) + 100)).toBe('flinch');
  });

  it('never wanders off while dozing, or while a reaction is playing', () => {
    const animator = new Animator(1);
    animator.setAmbientLevel('often');
    animator.play('doze', 1, 0);
    for (let t = 0; t <= 600_000; t += 100) {
      animator.pose(t);
      expect(animator.current(t)).toBe('doze');
    }
    animator.wake();
    // And the calm after the doze is the settle time, not zero.
    expect(animator.current(600_100)).toBe('idle');
    animator.pose(600_100);
    expect(animator.current(600_100 + AMBIENT_SETTLE_MS - 200)).toBe('idle');
  });

  it('plays one on demand, over anything else', () => {
    const animator = new Animator(1);
    animator.play('doze', 1, 0);
    animator.playAmbient(1000);
    expect(animator.current(1000)).not.toBe('doze');
    expect(animator.current(1000)).not.toBe('idle');
  });
});

describe('the idle-life primitives', () => {
  it('start and end where the companion was standing', () => {
    for (const primitive of AMBIENT_PRIMITIVES) {
      const def = PRIMITIVE_DEFS[primitive];
      for (const k of [-1.5, -1, 1, 1.5]) {
        expect(def.pose(0, k, base()).dx, `${primitive} at 0`).toBe(0);
        expect(def.pose(1, k, base()).dx, `${primitive} at 1`).toBe(0);
        expect(def.pose(1, k, base()).alpha, `${primitive} alpha at 1`).toBe(1);
      }
    }
  });

  it('stay inside the chip, and keep the figure solid except in a warp', () => {
    for (const primitive of AMBIENT_PRIMITIVES) {
      const def = PRIMITIVE_DEFS[primitive];
      for (let t = 0; t <= 1; t += 0.01) {
        const pose = def.pose(t, 1.5, base());
        expect(Math.abs(pose.dx), `${primitive} dx at ${t}`).toBeLessThanOrEqual(5);
        expect(pose.alpha, `${primitive} alpha at ${t}`).toBeGreaterThanOrEqual(0);
        expect(pose.alpha).toBeLessThanOrEqual(1);
        expect(pose.beam).toBeGreaterThanOrEqual(0);
        expect(pose.frame.animation).toBe(primitive);
        // A phase, not an index: it has to land inside the animation whatever
        // sheet ends up resolving it.
        expect(pose.frame.phase, `${primitive} phase at ${t}`).toBeGreaterThanOrEqual(0);
        expect(pose.frame.phase).toBeLessThan(1);
        // However many frames the loaded sheet turns out to have.
        for (const frames of [2, 4, 11]) expect(frameIndex(pose.frame.phase, frames)).toBeLessThan(frames);
      }
    }
  });

  it('a walk goes the way its intensity points, faces it, and comes back', () => {
    expect(PRIMITIVE_DEFS.walk.pose(0.3, 1, base()).dx).toBeGreaterThan(0);
    expect(PRIMITIVE_DEFS.walk.pose(0.3, -1, base()).dx).toBeLessThan(0);
    // Out by the middle, home again by the end.
    expect(PRIMITIVE_DEFS.walk.pose(0.5, 1, base()).dx).toBeGreaterThan(0);
    expect(PRIMITIVE_DEFS.walk.pose(1, 1, base()).dx).toBe(0);
    // And faces the way it is going, or it reads as walking backwards.
    expect(PRIMITIVE_DEFS.walk.pose(0.3, 1, base()).sx).toBe(1);
    expect(PRIMITIVE_DEFS.walk.pose(0.3, -1, base()).sx).toBe(-1);
    // Coming home is the other way round, and they turn to face it.
    expect(PRIMITIVE_DEFS.walk.pose(0.75, 1, base()).sx).toBe(-1);
    expect(PRIMITIVE_DEFS.walk.pose(0.75, -1, base()).sx).toBe(1);
    // Facing front again once they are back.
    expect(PRIMITIVE_DEFS.walk.pose(1, 1, base()).sx).toBe(1);
  });

  it('a warp goes out, waits, and comes back in', () => {
    const phaseAt = (t: number) => PRIMITIVE_DEFS.warp.pose(t, 1, base()).frame.phase;
    // Their clip is an arrival, so leaving is it backwards: the phase runs down
    // to the empty frames, rests there, then runs back up to standing.
    expect(phaseAt(0.2)).toBeLessThan(phaseAt(0));
    expect(phaseAt(0.38)).toBe(0);
    expect(phaseAt(0.8)).toBeGreaterThan(phaseAt(0.5));
    expect(phaseAt(0.99)).toBeGreaterThan(0.9);
    // It stays put: the trick is the disappearing, not the travelling.
    for (const t of [0, 0.3, 0.5, 1]) expect(PRIMITIVE_DEFS.warp.pose(t, 1, base()).dx).toBe(0);
  });

  it('a flicker plays its frames on the spot, and adds nothing of its own', () => {
    let last = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const pose = PRIMITIVE_DEFS.flicker.pose(t, 1, base());
      expect(pose.dx).toBe(0);
      expect(pose.alpha).toBe(1);
      expect(pose.beam).toBe(0);
      // Straight through the clip, so every frame of it is reached.
      expect(pose.frame.phase).toBeGreaterThanOrEqual(last);
      last = pose.frame.phase;
    }
  });

  it('never interrupts a reaction: they are the lowest priority there is', () => {
    for (const primitive of AMBIENT_PRIMITIVES) {
      for (const reaction of ['lunge', 'cheer', 'gulp', 'slump', 'glitter', 'flinch', 'topple', 'doze'] as const) {
        expect(PRIMITIVE_DEFS[primitive].priority, primitive).toBeLessThan(PRIMITIVE_DEFS[reaction].priority);
      }
    }
  });
});


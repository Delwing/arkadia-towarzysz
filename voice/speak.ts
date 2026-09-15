/**
 * Line selection plus restraint. Restraint is a core requirement, not polish:
 * a companion who comments on everything is noise within an hour and muted
 * forever. So every request to speak goes through, in order, the mutes, the
 * global cooldown, the per-category cooldown and the per-category probability.
 * `maybe()` returning null is the common case and is not an error.
 *
 * A line that would violate a cooldown is dropped, never queued.
 */

import type { Category, MoodBucket } from '../companion/types';
import type { Rng } from '../companion/rng';
import type { VoiceLines, VoicePack } from './catalog';

export interface CategoryRule {
  /** 0..1 chance that an allowed request actually produces a line. */
  probability: number;
  /** Per-category cooldown; longer for common events. */
  cooldownMs: number;
}

/**
 * Rare events approach 100 %, common events sit low: they should stay quiet
 * through twenty kills and say something about the twenty-first.
 */
export const CATEGORY_RULES: Record<Category, CategoryRule> = {
  kill: { probability: 0.08, cooldownMs: 120_000 },
  improve: { probability: 0.6, cooldownMs: 60_000 },
  improveMax: { probability: 1, cooldownMs: 30_000 },
  hurt: { probability: 0.15, cooldownMs: 90_000 },
  death: { probability: 1, cooldownMs: 10_000 },
  loot: { probability: 0.3, cooldownMs: 90_000 },
  spend: { probability: 0.25, cooldownMs: 120_000 },
  gemGood: { probability: 0.7, cooldownMs: 60_000 },
  gemBad: { probability: 0.3, cooldownMs: 120_000 },
  idle: { probability: 0.5, cooldownMs: 600_000 },
};

export interface Mutes {
  global: boolean;
  categories: readonly Category[];
}

export interface SpeakerOptions {
  globalCooldownMs?: number;
  rules?: Partial<Record<Category, CategoryRule>>;
  rng?: Rng;
}

/** The lines a pack has for a category in a bucket; a missing bucket falls back to `spokojnie`. */
export function linesFor(lines: VoiceLines | undefined, category: Category, bucket: MoodBucket): string[] {
  const byBucket = lines?.[category];
  if (!byBucket) return [];
  const exact = byBucket[bucket];
  if (exact && exact.length > 0) return exact;
  const fallback = byBucket.spokojnie;
  return fallback && fallback.length > 0 ? fallback : [];
}

export class Speaker {
  private globalCooldownMs: number;
  private readonly rules: Record<Category, CategoryRule>;
  private readonly rng: Rng;
  private lastSpokenAt = -Infinity;
  private readonly lastByCategory = new Map<Category, number>();
  private readonly lastLineByCategory = new Map<Category, string>();

  constructor(options: SpeakerOptions = {}) {
    this.globalCooldownMs = options.globalCooldownMs ?? 45_000;
    this.rules = { ...CATEGORY_RULES, ...(options.rules ?? {}) } as Record<Category, CategoryRule>;
    this.rng = options.rng ?? Math.random;
  }

  setGlobalCooldown(ms: number): void {
    this.globalCooldownMs = Math.max(0, ms);
  }

  getGlobalCooldown(): number {
    return this.globalCooldownMs;
  }

  /** Forget all cooldowns, e.g. on a character switch. */
  reset(): void {
    this.lastSpokenAt = -Infinity;
    this.lastByCategory.clear();
    this.lastLineByCategory.clear();
  }

  /**
   * Ask for a line. Returns null far more often than not.
   * Only a line actually produced starts the cooldowns; a declined request
   * leaves them untouched.
   */
  maybe(voice: VoicePack | undefined, category: Category, bucket: MoodBucket, mutes: Mutes, now: number): string | null {
    if (mutes.global || mutes.categories.includes(category)) return null;
    const rule = this.rules[category];
    if (!rule) return null;

    const candidates = linesFor(voice?.lines, category, bucket);
    if (candidates.length === 0) return null;

    if (now - this.lastSpokenAt < this.globalCooldownMs) return null;
    const lastForCategory = this.lastByCategory.get(category) ?? -Infinity;
    if (now - lastForCategory < rule.cooldownMs) return null;

    if (this.rng() >= rule.probability) return null;

    const line = this.pickLine(candidates, category);
    this.lastSpokenAt = now;
    this.lastByCategory.set(category, now);
    return line;
  }

  /** A line with no restraint at all - for the settings panel's "say something" test. */
  force(voice: VoicePack | undefined, category: Category, bucket: MoodBucket): string | null {
    const candidates = linesFor(voice?.lines, category, bucket);
    if (candidates.length === 0) return null;
    return this.pickLine(candidates, category);
  }

  private pickLine(candidates: string[], category: Category): string {
    let pool = candidates;
    const last = this.lastLineByCategory.get(category);
    if (last !== undefined && candidates.length > 1) {
      pool = candidates.filter((line) => line !== last);
    }
    const line = pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))] as string;
    this.lastLineByCategory.set(category, line);
    return line;
  }
}

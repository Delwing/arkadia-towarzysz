/**
 * Line selection plus restraint. Restraint is a core requirement, not polish:
 * a companion who comments on everything is noise within an hour and muted
 * forever. So every request to speak goes through, in order, the mutes, the
 * global cooldown, the per-category cooldown and the per-category probability.
 * `maybe()` returning null is the common case and is not an error.
 *
 * A line that would violate a cooldown is dropped, never queued.
 *
 * The one exception is priority: some moments are rare and loud enough that
 * silence would read as a bug, and the caller says so per event (see
 * `events/bindings.ts`). They speak through the global cooldown - through that
 * one only; mutes, the category cooldown and the probability all still apply.
 * How often a category may use the exemption is `priorityWindowMs`.
 */

import type { Category, MoodBucket } from '../companion/types';
import type { Rng } from '../companion/rng';
import type { VoiceLines, VoicePack } from './catalog';

export interface CategoryRule {
  /** 0..1 chance that an allowed request actually produces a line. */
  probability: number;
  /** Per-category cooldown; longer for common events. */
  cooldownMs: number;
  /**
   * How long this category must wait between two uses of the priority
   * exemption. 0 (the default) means no limit beyond `cooldownMs` - right for
   * an event that is rare by nature, like dying. A priority request inside the
   * window is not dropped: it is demoted to an ordinary one and takes its
   * chances with the global cooldown like everything else.
   */
  priorityWindowMs?: number;
}

/**
 * Rare events approach 100 %, common events sit low: they should stay quiet
 * through twenty kills and say something about the twenty-first.
 *
 * Only `gemGood` needs a priority window. Deaths and niebotyczne postepy are
 * rare because the game makes them rare, so their own cooldown is limit
 * enough; valuable stones are rare per stone but arrive in bags, and appraising
 * one would otherwise let the companion speak every 60 s no matter what pause
 * the player set. Ten minutes is long enough that the second big stone in a
 * sitting goes back to obeying the global cooldown.
 */
export const CATEGORY_RULES: Record<Category, CategoryRule> = {
  kill: { probability: 0.08, cooldownMs: 120_000 },
  improve: { probability: 0.6, cooldownMs: 60_000 },
  improveMax: { probability: 1, cooldownMs: 30_000 },
  hurt: { probability: 0.15, cooldownMs: 90_000 },
  death: { probability: 1, cooldownMs: 10_000 },
  loot: { probability: 0.3, cooldownMs: 90_000 },
  spend: { probability: 0.25, cooldownMs: 120_000 },
  sell: { probability: 0.2, cooldownMs: 150_000 },
  gemGood: { probability: 0.7, cooldownMs: 60_000, priorityWindowMs: 600_000 },
  gemBad: { probability: 0.3, cooldownMs: 120_000 },
  // The sources ration these by the bout, not by the line, so the cooldown here
  // only has to stop a second remark inside one evening's drinking.
  intox: { probability: 0.7, cooldownMs: 300_000 },
  hangover: { probability: 0.8, cooldownMs: 600_000 },
  // A tick of knowledge is rare - rarer than a postep - so nearly every one is
  // worth a word. The cooldown is only there for the odd cluster.
  knowledge: { probability: 0.7, cooldownMs: 90_000 },
  clear: { probability: 0.2, cooldownMs: 180_000 },
  // Being stunned is not the moment for a speech, and it repeats inside one
  // fight; the animation carries it and the line is the rare aside.
  stun: { probability: 0.15, cooldownMs: 240_000 },
  // Fishing is long and quiet, so the companion may talk through more of it
  // than they would through a fight - but a bite is every few minutes and the
  // fish itself is the event worth a word.
  fishBite: { probability: 0.25, cooldownMs: 180_000 },
  fishCatch: { probability: 0.5, cooldownMs: 120_000 },
  travel: { probability: 0.5, cooldownMs: 300_000 },
  // Wearing somebody else's body is the rarest thing on this list, and it comes
  // in pairs - the spell, and the spell wearing off twenty minutes later. A
  // companion who missed it would read as a companion who is not looking, so it
  // always speaks, and speaks through the global cooldown; the short cooldown
  // only stops one przeobrazenie getting two lines out of the client.
  transform: { probability: 1, cooldownMs: 20_000 },
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

export interface SpeakRequest {
  /**
   * The caller judged this particular event big enough to speak through the
   * global cooldown. Per event, not per category: the same `gemGood` is
   * priority at two mithryls and ordinary at one.
   */
  priority?: boolean;
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
  /** When each category last *used* the priority exemption, not when it last spoke. */
  private readonly lastBypassByCategory = new Map<Category, number>();

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
    this.lastBypassByCategory.clear();
  }

  /**
   * Ask for a line. Returns null far more often than not.
   * Only a line actually produced starts the cooldowns; a declined request
   * leaves them untouched.
   */
  maybe(
    voice: VoicePack | undefined,
    category: Category,
    bucket: MoodBucket,
    mutes: Mutes,
    now: number,
    request: SpeakRequest = {},
  ): string | null {
    if (mutes.global || mutes.categories.includes(category)) return null;
    const rule = this.rules[category];
    if (!rule) return null;

    const candidates = linesFor(voice?.lines, category, bucket);
    if (candidates.length === 0) return null;

    const heldBack = now - this.lastSpokenAt < this.globalCooldownMs;
    // Priority skips the global cooldown, and only that one - and only as often
    // as the category's window allows. Past that, it is an ordinary request
    // again rather than a dropped one.
    const lastBypass = this.lastBypassByCategory.get(category) ?? -Infinity;
    const mayBypass = request.priority === true && now - lastBypass >= (rule.priorityWindowMs ?? 0);
    if (heldBack && !mayBypass) return null;

    // Its own cooldown always applies: a trigger that fires twice for one death
    // still gets only one line out of it.
    const lastForCategory = this.lastByCategory.get(category) ?? -Infinity;
    if (now - lastForCategory < rule.cooldownMs) return null;

    if (this.rng() >= rule.probability) return null;

    const line = this.pickLine(candidates, category);
    // A priority line still holds the rest back afterwards: shouting about a
    // death and then chattering about the next copper coin is the same noise.
    this.lastSpokenAt = now;
    this.lastByCategory.set(category, now);
    // The window counts uses of the exemption, not priority events: when the
    // global cooldown was clear anyway, priority changed nothing and is unspent.
    if (heldBack) this.lastBypassByCategory.set(category, now);
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

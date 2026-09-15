/**
 * The day's temper: how the companion woke up, rolled once a session.
 *
 * The mood on its own could not really go bad. Almost everything the game
 * reports is good news and most of it is frequent - kills, coins, postepy -
 * while the bad news is rare (a death) or small (a few hit points), and the
 * drift pulled everything back to the same neutral 0 either way. So an evening
 * looked like every other evening: `spokojnie` most of the time, `dobrze`
 * whenever anything went right, and `zle` for the twenty minutes after a death.
 *
 * The temper is the fix. It is not a starting value - a starting value is
 * erased by twenty minutes of drift and the session goes back to looking the
 * same. It is the value the drift pulls *toward*: the mood's resting point for
 * the day (see `companion/mood.ts`). Roll a grim one and the companion sits in
 * `zle` and has to be cheered out of it, and slides back when nothing is
 * happening; roll a bright one and a death knocks them down and they come back
 * up. Events still swing the mood either way - that part is unchanged - they
 * just swing it around somewhere other than the middle.
 *
 * It is rolled with `Math.random`, not the companion's seed: the companion is
 * fixed for ever and the day is not.
 */

import type { Rng } from './rng';

export interface Temper {
  /** Where the mood settles when nothing is happening. -1..+1. */
  resting: number;
  /**
   * Epoch ms of the roll. A session that starts within `TEMPER_LIFE_MS` of it
   * keeps the temper it finds rather than rolling a new one.
   */
  rolledAt: number;
}

/**
 * How long a temper lasts. Long enough that a disconnect and a relog are the
 * same evening - a companion who is grim at nine should not be delighted at
 * five past, because the router blinked - and short enough that tomorrow is a
 * new day. Sleeping on it is the thing that changes a mood.
 */
export const TEMPER_LIFE_MS = 6 * 60 * 60 * 1000;

export type TemperBand = 'grim' | 'even' | 'bright';

export const TEMPER_BANDS: readonly TemperBand[] = ['grim', 'even', 'bright'];

/**
 * What each kind of day rests at. The outer two sit clear of the bucket edge
 * (0.35), so a grim day really is `zle` and a bright one really is `dobrze` -
 * and clear enough that rounding cannot land one in the wrong bucket. `even` is
 * narrow and straddles the middle: most days are ordinary days.
 */
export const TEMPER_RANGES: Record<TemperBand, readonly [number, number]> = {
  grim: [-0.55, -0.4],
  even: [-0.2, 0.2],
  bright: [0.4, 0.55],
};

/** The default mix of days, for a voice with nothing to say about it. */
export const TEMPER_WEIGHTS: Record<TemperBand, number> = { grim: 0.3, even: 0.4, bright: 0.3 };

/**
 * ...and the mix each voice actually gets. The packs already have a
 * temperament in their writing, and a Ponury wieszcz who wakes up delighted
 * three days in ten is a Ponury wieszcz in name only. This is the one place
 * the rolled voice reaches past the words it puts in their mouth.
 */
export const TEMPER_WEIGHTS_BY_VOICE: Record<string, Record<TemperBand, number>> = {
  giermek: { grim: 0.15, even: 0.4, bright: 0.45 },
  weteran: { grim: 0.35, even: 0.45, bright: 0.2 },
  wieszcz: { grim: 0.45, even: 0.4, bright: 0.15 },
  maloomowny: { grim: 0.3, even: 0.4, bright: 0.3 },
};

export function weightsFor(voiceId: string | undefined): Record<TemperBand, number> {
  return (voiceId !== undefined && TEMPER_WEIGHTS_BY_VOICE[voiceId]) || TEMPER_WEIGHTS;
}

/** Which kind of day a resting point is. Only the label and the tests ask. */
export function bandOf(resting: number): TemperBand {
  if (!Number.isFinite(resting)) return 'even';
  if (resting <= TEMPER_RANGES.grim[1]) return 'grim';
  if (resting >= TEMPER_RANGES.bright[0]) return 'bright';
  return 'even';
}

/** User-facing, ASCII-folded and gender-neutral: it describes the day, not them. */
export function temperLabel(resting: number): string {
  switch (bandOf(resting)) {
    case 'grim':
      return 'kiepski dzien';
    case 'bright':
      return 'dobry dzien';
    default:
      return 'zwykly dzien';
  }
}

/**
 * The placeholder a save with no temper in it loads as. `rolledAt: 0` is the
 * sentinel for "never rolled" - no session happened at the epoch - and
 * `isStale` reads it as stale outright, so the plugin rolls a real one on the
 * next load and there is one code path rather than two.
 */
export const NO_TEMPER: Temper = { resting: 0, rolledAt: 0 };

export function isValidTemper(value: unknown): value is Temper {
  if (!value || typeof value !== 'object') return false;
  const temper = value as Record<string, unknown>;
  return (
    typeof temper.resting === 'number' &&
    Number.isFinite(temper.resting) &&
    Math.abs(temper.resting) <= 1 &&
    typeof temper.rolledAt === 'number' &&
    Number.isFinite(temper.rolledAt)
  );
}

/**
 * Whether it is time for a new day. A `rolledAt` in the future - a clock that
 * went backwards, a hand-edited save - counts as stale rather than locking the
 * companion into one temper for ever.
 */
export function isStale(temper: Temper | undefined, now: number): boolean {
  if (!temper || !isValidTemper(temper)) return true;
  // Never rolled: the placeholder, and anything else claiming a session before
  // the epoch. Not left to the arithmetic below, which would call it fresh for
  // any `now` inside the first six hours of 1970 - true only in a test, but the
  // sentinel should say what it means rather than rely on the clock.
  if (temper.rolledAt <= 0) return true;
  const age = now - temper.rolledAt;
  return !(age >= 0 && age < TEMPER_LIFE_MS);
}

export function rollTemper(rng: Rng, voiceId: string | undefined, now: number): Temper {
  const weights = weightsFor(voiceId);
  const total = TEMPER_BANDS.reduce((sum, band) => sum + weights[band], 0);
  let roll = rng() * total;
  let chosen: TemperBand = 'even';
  for (const band of TEMPER_BANDS) {
    roll -= weights[band];
    if (roll < 0) {
      chosen = band;
      break;
    }
  }
  const [from, to] = TEMPER_RANGES[chosen];
  return { resting: from + rng() * (to - from), rolledAt: now };
}

import { describe, expect, it } from 'vitest';
import {
  bandOf,
  isStale,
  isValidTemper,
  NO_TEMPER,
  rollTemper,
  TEMPER_BANDS,
  TEMPER_LIFE_MS,
  TEMPER_RANGES,
  TEMPER_WEIGHTS_BY_VOICE,
  temperLabel,
  weightsFor,
  type TemperBand,
} from '../companion/temper';
import { bucket, BUCKET_EDGE } from '../companion/mood';
import { seededRng } from '../companion/rng';
import { VOICE_IDS } from '../voice/catalog';

const NOW = 1_700_000_000_000;

describe('the day s temper', () => {
  it('rolls inside one of the bands, whatever the rng does', () => {
    for (const seed of [0, 1, 7, 99, 12345]) {
      const rng = seededRng(seed);
      for (let i = 0; i < 200; i++) {
        const temper = rollTemper(rng, 'weteran', NOW);
        const [from, to] = TEMPER_RANGES[bandOf(temper.resting)];
        expect(temper.resting).toBeGreaterThanOrEqual(from);
        expect(temper.resting).toBeLessThanOrEqual(to);
        expect(temper.rolledAt).toBe(NOW);
      }
    }
  });

  it('puts the outer bands clear of the bucket they are meant to read as', () => {
    // A grim day has to actually be zle and a bright one dobrze, or the
    // greeting says one thing and every line afterwards says another.
    expect(TEMPER_RANGES.grim[1]).toBeLessThan(-BUCKET_EDGE);
    expect(TEMPER_RANGES.bright[0]).toBeGreaterThan(BUCKET_EDGE);
    for (const [from, to] of [TEMPER_RANGES.grim, TEMPER_RANGES.bright, TEMPER_RANGES.even]) {
      expect(from).toBeLessThan(to);
      expect(Math.abs(from)).toBeLessThanOrEqual(1);
      expect(Math.abs(to)).toBeLessThanOrEqual(1);
    }
    expect(bucket(TEMPER_RANGES.grim[0])).toBe('zle');
    expect(bucket(TEMPER_RANGES.grim[1])).toBe('zle');
    expect(bucket(TEMPER_RANGES.bright[0])).toBe('dobrze');
    expect(bucket(TEMPER_RANGES.even[0])).toBe('spokojnie');
    expect(bucket(TEMPER_RANGES.even[1])).toBe('spokojnie');
  });

  it('gives every voice every kind of day, in its own proportions', () => {
    const seen: Record<string, Record<TemperBand, number>> = {};
    for (const id of VOICE_IDS) {
      const rng = seededRng(4242);
      const counts: Record<TemperBand, number> = { grim: 0, even: 0, bright: 0 };
      for (let i = 0; i < 2000; i++) counts[bandOf(rollTemper(rng, id, NOW).resting)]++;
      seen[id] = counts;
      // Nobody is locked out of a kind of day, however sunny or grim they are.
      for (const band of TEMPER_BANDS) expect(counts[band], `${id}/${band}`).toBeGreaterThan(0);
    }
    // ...but the gloomy one really is gloomier than the eager one.
    expect(seen.wieszcz!.grim).toBeGreaterThan(seen.giermek!.grim);
    expect(seen.giermek!.bright).toBeGreaterThan(seen.wieszcz!.bright);
  });

  it('has weights for every voice, and a default for anything else', () => {
    for (const id of VOICE_IDS) expect(TEMPER_WEIGHTS_BY_VOICE[id], id).toBeDefined();
    for (const id of [...VOICE_IDS, undefined, 'nieznany']) {
      const weights = weightsFor(id);
      for (const band of TEMPER_BANDS) expect(weights[band], String(id)).toBeGreaterThan(0);
    }
  });

  it('keeps the temper through an evening and rerolls after a night', () => {
    const temper = { resting: -0.5, rolledAt: NOW };
    expect(isStale(temper, NOW)).toBe(false);
    expect(isStale(temper, NOW + TEMPER_LIFE_MS - 1)).toBe(false);
    expect(isStale(temper, NOW + TEMPER_LIFE_MS)).toBe(true);
    // A relog five minutes later is the same evening, not a new mood.
    expect(isStale(temper, NOW + 5 * 60_000)).toBe(false);
  });

  it('treats a placeholder, a missing one and a clock that went backwards as stale', () => {
    expect(isStale(NO_TEMPER, NOW)).toBe(true);
    expect(isStale(undefined, NOW)).toBe(true);
    // A save written in the future would otherwise pin the companion to one day.
    expect(isStale({ resting: 0.5, rolledAt: NOW + 60_000 }, NOW)).toBe(true);
  });

  it('validates what came out of storage', () => {
    expect(isValidTemper({ resting: 0.4, rolledAt: NOW })).toBe(true);
    expect(isValidTemper(NO_TEMPER)).toBe(true);
    for (const junk of [
      null,
      undefined,
      'grim',
      {},
      { resting: 0.4 },
      { rolledAt: NOW },
      { resting: 2, rolledAt: NOW },
      { resting: Number.NaN, rolledAt: NOW },
      { resting: 0.4, rolledAt: Number.POSITIVE_INFINITY },
    ])
      expect(isValidTemper(junk), JSON.stringify(junk)).toBe(false);
  });

  it('labels every band, in ASCII', () => {
    const labels = new Set<string>();
    for (const band of TEMPER_BANDS) {
      const label = temperLabel(TEMPER_RANGES[band][0]);
      expect(label).toMatch(/^[\x20-\x7e]+$/);
      labels.add(label);
    }
    // Three days, three things to call them.
    expect(labels.size).toBe(TEMPER_BANDS.length);
    expect(bandOf(Number.NaN)).toBe('even');
  });
});

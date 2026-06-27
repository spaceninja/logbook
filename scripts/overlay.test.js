import { describe, expect, it } from 'vitest';
import {
  buildOverlay,
  completionYearFor,
  deriveState,
  deriveYears,
  makeRng,
  randomDateInYear,
  TODAY,
} from './overlay.js';

const draft = (over = {}) => ({
  type: 'movie',
  release_date: '2014-08-01',
  metadata: {},
  ...over,
});

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng('movie-tmdb-1');
    const b = makeRng('movie-tmdb-1');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('differs across seeds', () => {
    expect(makeRng('a')()).not.toEqual(makeRng('b')());
  });
});

describe('randomDateInYear', () => {
  it('stays within the year', () => {
    const rng = makeRng('x');
    for (let i = 0; i < 50; i++) {
      const d = randomDateInYear(rng, 2025);
      expect(d >= '2025-01-01' && d <= '2025-12-31').toBe(true);
    }
  });
  it('clamps to maxDate (today) for the current year', () => {
    const rng = makeRng('y');
    for (let i = 0; i < 50; i++) {
      expect(randomDateInYear(rng, 2026, { maxDate: TODAY }) <= TODAY).toBe(
        true,
      );
    }
  });
  it('respects minDate (release date)', () => {
    const rng = makeRng('z');
    for (let i = 0; i < 50; i++) {
      expect(
        randomDateInYear(rng, 2024, { minDate: '2024-07-15' }) >= '2024-07-15',
      ).toBe(true);
    }
  });
});

describe('completionYearFor', () => {
  it('dates 2024/2025 releases to their release year', () => {
    const rng = makeRng('a');
    expect(completionYearFor(2024, rng)).toBe(2024);
    expect(completionYearFor(2025, rng)).toBe(2025);
  });
  it('maps catalog releases to a recent year (mostly)', () => {
    const rng = makeRng('catalog');
    for (let i = 0; i < 30; i++) {
      const y = completionYearFor(2010, rng);
      expect(y === 2010 || [2024, 2025, 2026].includes(y)).toBe(true);
    }
  });
});

describe('deriveState', () => {
  it('is backlog for unreleased/2026 and complete otherwise', () => {
    expect(deriveState(undefined)).toBe('backlog');
    expect(deriveState(2026)).toBe('backlog');
    expect(deriveState(2025)).toBe('complete');
  });
});

describe('buildOverlay', () => {
  it('completes a released item with a rating and consistent years', () => {
    const o = buildOverlay(draft(), { state: 'complete' }, makeRng('m1'));
    expect(o.status).toBe('complete');
    expect(o.completed_dates.length).toBeGreaterThan(0);
    expect([8, 9, 10]).toContain(o.my_rating);
    expect(o.completed_years).toEqual(deriveYears(o.completed_dates));
    expect(o.is_prioritized).toBe(false); // not meaningful once done
  });

  it('gives a DNF a stopped date and no rating', () => {
    const o = buildOverlay(draft(), { state: 'dnf' }, makeRng('m2'));
    expect(o.status).toBe('dnf');
    expect(o.completed_dates).toHaveLength(1);
    expect(o.my_rating).toBeUndefined();
  });

  it('puts a repeat in both views (dated + backlog/in_progress)', () => {
    const o = buildOverlay(draft(), { state: 'repeat' }, makeRng('m3'));
    expect(o.completed_dates.length).toBeGreaterThan(0);
    expect(['backlog', 'in_progress']).toContain(o.status);
  });

  it('leaves a backlog item undated', () => {
    const o = buildOverlay(
      draft({ release_date: '2027-01-01' }),
      {},
      makeRng('m4'),
    );
    expect(o.status).toBe('backlog');
    expect(o.completed_dates).toEqual([]);
  });

  it('applies manifest series metadata', () => {
    const o = buildOverlay(
      draft(),
      { state: 'complete', series: 'Fast & Furious', series_number: 5 },
      makeRng('m5'),
    );
    expect(o.metadata.series).toBe('Fast & Furious');
    expect(o.metadata.series_number).toBe(5);
  });

  it('never dates completion after today', () => {
    for (let i = 0; i < 40; i++) {
      const o = buildOverlay(
        draft({ release_date: '2009-01-01' }),
        { state: 'complete' },
        makeRng(`seed-${i}`),
      );
      for (const d of o.completed_dates) expect(d <= TODAY).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { deriveCompletedYears } from './completedYears';

describe('deriveCompletedYears', () => {
  it('returns an empty array for no completions', () => {
    expect(deriveCompletedYears([])).toStrictEqual([]);
  });

  it('extracts the year from a single completion', () => {
    expect(deriveCompletedYears(['2025-03-12'])).toStrictEqual([2025]);
  });

  it('de-duplicates multiple completions in the same year', () => {
    expect(deriveCompletedYears(['2024-01-02', '2024-12-31'])).toStrictEqual([
      2024,
    ]);
  });

  it('returns distinct years sorted ascending', () => {
    expect(
      deriveCompletedYears(['2026-02-14', '2024-01-02', '2024-12-31']),
    ).toStrictEqual([2024, 2026]);
  });

  it('ignores unparseable dates', () => {
    expect(deriveCompletedYears(['not-a-date', '2025-01-01'])).toStrictEqual([
      2025,
    ]);
  });
});

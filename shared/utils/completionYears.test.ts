import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { deriveCompletionYearsByType } from './completionYears';

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: overrides.id ?? 'id',
    type: 'book',
    title: 'Untitled',
    status: 'backlog',
    is_purchased: false,
    is_prioritized: false,
    completed_dates: [],
    completed_years: [],
    tags: [],
    metadata: {},
    ...overrides,
  };
}

describe('deriveCompletionYearsByType', () => {
  it('returns an empty map for no items', () => {
    expect(deriveCompletionYearsByType([])).toStrictEqual({});
  });

  it('omits types with no completion dates', () => {
    expect(
      deriveCompletionYearsByType([
        makeItem({ id: 'a', type: 'book' }),
        makeItem({ id: 'b', type: 'movie' }),
      ]),
    ).toStrictEqual({});
  });

  it('groups distinct years per type, sorted ascending', () => {
    const items = [
      makeItem({
        id: 'a',
        type: 'book',
        completed_dates: ['2026-02-14', '2024-01-02'],
      }),
      makeItem({ id: 'b', type: 'book', completed_dates: ['2024-12-31'] }),
      makeItem({ id: 'c', type: 'game', completed_dates: ['2025-07-01'] }),
    ];
    expect(deriveCompletionYearsByType(items)).toStrictEqual({
      book: [2024, 2026],
      game: [2025],
    });
  });

  it('does not leak one type’s years into another', () => {
    const items = [
      makeItem({ id: 'a', type: 'movie', completed_dates: ['2025-05-05'] }),
      makeItem({ id: 'b', type: 'show', completed_dates: ['2023-03-03'] }),
    ];
    expect(deriveCompletionYearsByType(items)).toStrictEqual({
      movie: [2025],
      show: [2023],
    });
  });

  it('ignores unparseable dates', () => {
    const items = [
      makeItem({
        id: 'a',
        type: 'game',
        completed_dates: ['not-a-date', '2023-05-05'],
      }),
    ];
    expect(deriveCompletionYearsByType(items)).toStrictEqual({ game: [2023] });
  });
});

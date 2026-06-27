import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { deriveCompletionYears } from './completionYears';

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

describe('deriveCompletionYears', () => {
  it('returns an empty array for no items', () => {
    expect(deriveCompletionYears([])).toStrictEqual([]);
  });

  it('returns an empty array when no item has a completion date', () => {
    expect(
      deriveCompletionYears([makeItem({ id: 'a' }), makeItem({ id: 'b' })]),
    ).toStrictEqual([]);
  });

  it('collects distinct years across items, sorted ascending', () => {
    const items = [
      makeItem({ id: 'a', completed_dates: ['2026-02-14', '2024-01-02'] }),
      makeItem({ id: 'b', completed_dates: ['2025-07-01'] }),
      makeItem({ id: 'c', completed_dates: ['2024-12-31'] }),
    ];
    expect(deriveCompletionYears(items)).toStrictEqual([2024, 2025, 2026]);
  });

  it('ignores unparseable dates', () => {
    const items = [
      makeItem({ id: 'a', completed_dates: ['not-a-date', '2023-05-05'] }),
    ];
    expect(deriveCompletionYears(items)).toStrictEqual([2023]);
  });
});

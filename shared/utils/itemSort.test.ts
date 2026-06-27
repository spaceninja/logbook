import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { latestCompletedDate, makeItemComparator } from './itemSort';

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

/** Sorts a set with the comparator and returns the resulting ids. */
function sortedIds(
  items: Item[],
  ...args: Parameters<typeof makeItemComparator>
): string[] {
  return [...items].sort(makeItemComparator(...args)).map((i) => i.id);
}

describe('latestCompletedDate', () => {
  it('returns the most recent date overall when no year is given', () => {
    const item = makeItem({
      completed_dates: ['2024-01-01', '2026-05-05', '2025-02-02'],
    });
    expect(latestCompletedDate(item)).toBe('2026-05-05');
  });

  it('restricts to the requested year', () => {
    const item = makeItem({
      completed_dates: ['2025-03-01', '2025-09-09', '2026-01-01'],
    });
    expect(latestCompletedDate(item, 2025)).toBe('2025-09-09');
  });

  it('returns undefined when nothing matches', () => {
    expect(
      latestCompletedDate(makeItem({ completed_dates: [] })),
    ).toBeUndefined();
    expect(
      latestCompletedDate(makeItem({ completed_dates: ['2025-01-01'] }), 2024),
    ).toBeUndefined();
  });
});

describe('makeItemComparator', () => {
  const ctx = { ratingField: 'community_rating' as const };

  it('sorts by rating descending, title breaking ties', () => {
    const a = makeItem({ id: 'a', title: 'Banana', community_rating: 9 });
    const b = makeItem({ id: 'b', title: 'Apple', community_rating: 7 });
    const c = makeItem({ id: 'c', title: 'Avocado', community_rating: 9 });
    expect(sortedIds([a, b, c], 'rating', false, ctx)).toEqual(['c', 'a', 'b']);
  });

  it('sorts by title A–Z', () => {
    const a = makeItem({ id: 'a', title: 'Zoo' });
    const b = makeItem({ id: 'b', title: 'apple' });
    expect(sortedIds([a, b], 'title', false, ctx)).toEqual(['b', 'a']);
  });

  it('ignores a leading article in the title sort', () => {
    // "The Bear" files under B, between "Andor" and "Cars".
    const andor = makeItem({ id: 'andor', title: 'Andor' });
    const bear = makeItem({ id: 'bear', title: 'The Bear' });
    const cars = makeItem({ id: 'cars', title: 'Cars' });
    expect(sortedIds([cars, bear, andor], 'title', false, ctx)).toEqual([
      'andor',
      'bear',
      'cars',
    ]);
  });

  it('orders the series number numerically, not lexically (2, 2.5, 10)', () => {
    const ten = makeItem({
      id: 'ten',
      metadata: { series: 'Example', series_number: 10 },
    });
    const two = makeItem({
      id: 'two',
      metadata: { series: 'Example', series_number: 2 },
    });
    const twoHalf = makeItem({
      id: 'twoHalf',
      metadata: { series: 'Example', series_number: 2.5 },
    });
    expect(sortedIds([ten, two, twoHalf], 'series', false, ctx)).toEqual([
      'two',
      'twoHalf',
      'ten',
    ]);
  });

  it('sorts shows by show name then season number numerically', () => {
    const season = (id: string, title: string, n: number) =>
      makeItem({
        id,
        type: 'show',
        title,
        metadata: {
          show_tmdb_id: 1,
          season_number: n,
          episode_count: 1,
          episode_runtime: 1,
        },
      });
    const s10 = season('s10', 'Silo', 10);
    const s2 = season('s2', 'Silo', 2);
    const andor = season('andor', 'Andor', 1);
    expect(sortedIds([s10, s2, andor], 'series', false, ctx)).toEqual([
      'andor',
      's2',
      's10',
    ]);
  });

  it('strips a leading article from the series name', () => {
    const show = (id: string, title: string) =>
      makeItem({
        id,
        type: 'show',
        title,
        metadata: {
          show_tmdb_id: 1,
          season_number: 1,
          episode_count: 1,
          episode_runtime: 1,
        },
      });
    const bear = show('bear', 'The Bear');
    const cars = show('cars', 'Cars');
    const andor = show('andor', 'Andor');
    expect(sortedIds([cars, bear, andor], 'series', false, ctx)).toEqual([
      'andor',
      'bear',
      'cars',
    ]);
  });

  it('sorts movie/game series by the series sort too', () => {
    const a = makeItem({
      id: 'a',
      type: 'game',
      metadata: { series: 'Zelda', series_number: 2 },
    });
    const b = makeItem({
      id: 'b',
      type: 'game',
      metadata: { series: 'Zelda', series_number: 1 },
    });
    const c = makeItem({ id: 'c', type: 'game', metadata: {} });
    expect(sortedIds([a, c, b], 'series', false, ctx)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by creator using creator_sort, case-insensitively', () => {
    const a = makeItem({ id: 'a', creator_sort: 'Weir Andy' });
    const b = makeItem({ id: 'b', creator_sort: 'martin george' });
    expect(sortedIds([a, b], 'creator', false, ctx)).toEqual(['b', 'a']);
  });

  it('falls back to a derived creator key when creator_sort is absent', () => {
    const a = makeItem({ id: 'a', creator: 'Andy Weir' });
    const b = makeItem({ id: 'b', creator: 'George Martin' });
    expect(sortedIds([a, b], 'creator', false, ctx)).toEqual(['b', 'a']);
  });

  it('sorts by series name then series number, non-series last', () => {
    const a = makeItem({
      id: 'a',
      metadata: { series: 'Dune', series_number: 2 },
    });
    const b = makeItem({
      id: 'b',
      metadata: { series: 'Dune', series_number: 1 },
    });
    const c = makeItem({ id: 'c', metadata: {} });
    expect(sortedIds([a, c, b], 'series', false, ctx)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by length short to long', () => {
    const a = makeItem({ id: 'a', length: 500 });
    const b = makeItem({ id: 'b', length: 100 });
    expect(sortedIds([a, b], 'length', false, ctx)).toEqual(['b', 'a']);
  });

  it('sorts by release date oldest first', () => {
    const a = makeItem({ id: 'a', release_date: '2020-01-01' });
    const b = makeItem({ id: 'b', release_date: '2010-01-01' });
    expect(sortedIds([a, b], 'release_date', false, ctx)).toEqual(['b', 'a']);
  });

  it('reverse flips the primary key but keeps the secondary', () => {
    const a = makeItem({ id: 'a', title: 'Banana', community_rating: 9 });
    const b = makeItem({ id: 'b', title: 'Apple', community_rating: 7 });
    const c = makeItem({ id: 'c', title: 'Avocado', community_rating: 9 });
    // Primary (rating) reversed → 7 first; ties (9) still title A–Z (c before a).
    expect(sortedIds([a, b, c], 'rating', true, ctx)).toEqual(['b', 'c', 'a']);
  });

  it('keeps undefined primary values last in both directions', () => {
    const a = makeItem({ id: 'a', length: 100 });
    const b = makeItem({ id: 'b' }); // no length
    const c = makeItem({ id: 'c', length: 200 });
    expect(sortedIds([b, c, a], 'length', false, ctx)).toEqual(['a', 'c', 'b']);
    expect(sortedIds([b, c, a], 'length', true, ctx)).toEqual(['c', 'a', 'b']);
  });

  it('resolves the rating field per context (community vs my)', () => {
    const a = makeItem({ id: 'a', community_rating: 9, my_rating: 2 });
    const b = makeItem({ id: 'b', community_rating: 4, my_rating: 8 });
    expect(
      sortedIds([a, b], 'rating', false, { ratingField: 'community_rating' }),
    ).toEqual(['a', 'b']);
    expect(
      sortedIds([a, b], 'rating', false, { ratingField: 'my_rating' }),
    ).toEqual(['b', 'a']);
  });

  it('sorts by completion date within the year, newest first', () => {
    const a = makeItem({ id: 'a', completed_dates: ['2025-02-01'] });
    const b = makeItem({
      id: 'b',
      completed_dates: ['2025-11-01', '2026-01-01'],
    });
    const ctxYear = { ratingField: 'my_rating' as const, year: 2025 };
    expect(sortedIds([a, b], 'completion_date', false, ctxYear)).toEqual([
      'b',
      'a',
    ]);
  });
});

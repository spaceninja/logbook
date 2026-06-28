import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import {
  itemDisplayTitle,
  formatCreator,
  formatSeries,
  formatCompletedDate,
} from './itemDisplay';

function makeShow(overrides: Partial<Item> = {}): Item {
  return {
    id: 'show-1',
    type: 'show',
    title: 'Avatar: The Last Airbender',
    status: 'backlog',
    is_purchased: false,
    is_prioritized: false,
    completed_dates: [],
    completed_years: [],
    tags: [],
    metadata: {
      show_tmdb_id: 1,
      season_number: 1,
      episode_count: 20,
      episode_runtime: 23,
    },
    ...overrides,
  };
}

describe('itemDisplayTitle', () => {
  it('composes show + season for a season without its own title', () => {
    expect(itemDisplayTitle(makeShow())).toBe(
      'Avatar: The Last Airbender — Season 1',
    );
  });

  it('keeps the title clean when a season has its own title (shown separately)', () => {
    const show = makeShow({
      metadata: {
        show_tmdb_id: 1,
        season_number: 1,
        episode_count: 20,
        episode_runtime: 23,
        season_title: 'Book One: Water',
      },
    });
    expect(itemDisplayTitle(show)).toBe(
      'Avatar: The Last Airbender — Season 1',
    );
  });

  it('uses the title verbatim for non-shows', () => {
    const book = makeShow({ type: 'book', title: 'Dune', metadata: {} });
    expect(itemDisplayTitle(book)).toBe('Dune');
  });
});

describe('formatCreator', () => {
  it('joins an array of creators', () => {
    expect(formatCreator(['Joel Coen', 'Ethan Coen'])).toBe(
      'Joel Coen, Ethan Coen',
    );
  });

  it('returns a single creator as-is and empty for none', () => {
    expect(formatCreator('Andy Weir')).toBe('Andy Weir');
    expect(formatCreator(undefined)).toBe('');
  });
});

describe('formatSeries', () => {
  const book = (meta: object) =>
    makeShow({ type: 'book', title: 'X', metadata: meta });

  it('formats series name and number', () => {
    expect(formatSeries(book({ series: 'Dune', series_number: 2 }))).toBe(
      'Dune #2',
    );
  });

  it('omits the number when absent', () => {
    expect(formatSeries(book({ series: 'Discworld' }))).toBe('Discworld');
  });

  it('is empty when there is no series', () => {
    expect(formatSeries(book({}))).toBe('');
  });

  it('is empty for shows (the season is in the title)', () => {
    expect(formatSeries(makeShow())).toBe('');
  });
});

describe('formatCompletedDate', () => {
  it('formats an ISO date as a short "Mon D" label', () => {
    expect(formatCompletedDate('2026-01-30')).toBe('Jan 30');
  });

  it('keeps the calendar day stable regardless of viewer timezone', () => {
    expect(formatCompletedDate('2026-12-01')).toBe('Dec 1');
  });

  it('tolerates a full ISO timestamp', () => {
    expect(formatCompletedDate('2026-07-04T13:45:00Z')).toBe('Jul 4');
  });
});

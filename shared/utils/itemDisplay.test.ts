import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { itemDisplayTitle, formatCreator } from './itemDisplay';

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

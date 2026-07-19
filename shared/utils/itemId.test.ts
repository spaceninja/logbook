import { describe, expect, it } from 'vitest';
import {
	makeBookId,
	makeGameId,
	makeManualId,
	makeMovieId,
	makeShowId,
	tmdbIdForItem,
} from './itemId';
import type { Item } from '../types/item';

describe('item id helpers', () => {
	it('builds a book id from provider and source id', () => {
		expect(makeBookId('goodreads', 20518872)).toBe('book-goodreads-20518872');
	});

	it('builds a movie id from provider and source id', () => {
		expect(makeMovieId('tmdb', 27205)).toBe('movie-tmdb-27205');
	});

	it('builds a game id from provider and source id', () => {
		expect(makeGameId('igdb', 119133)).toBe('game-igdb-119133');
	});

	it('encodes show id and season number into a show id', () => {
		expect(makeShowId('tmdb', 95396, 1)).toBe('show-tmdb-95396-s1');
	});

	it('builds a manual id with the type prefix and a uuid', () => {
		expect(makeManualId('movie')).toMatch(
			/^movie-manual-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it('builds a unique manual id on each call', () => {
		expect(makeManualId('book')).not.toBe(makeManualId('book'));
	});
});

describe('tmdbIdForItem', () => {
	function item(overrides: Partial<Item>): Item {
		return {
			id: 'movie-tmdb-27205',
			type: 'movie',
			title: 'Inception',
			provider: 'tmdb',
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

	it('reads a TMDB movie id out of the item id', () => {
		expect(tmdbIdForItem(item({}))).toBe('27205');
	});

	it('returns the parent show id for a season, not the season-scoped id', () => {
		const season = item({
			id: 'show-tmdb-95396-s1',
			type: 'show',
			metadata: {
				show_tmdb_id: 95396,
				season_number: 1,
				episode_count: 10,
				episode_runtime: 30,
			},
		});
		expect(tmdbIdForItem(season)).toBe('95396');
	});

	it('returns undefined for a movie sourced from another provider', () => {
		const film = item({ id: 'movie-letterboxd-abc', provider: 'letterboxd' });
		expect(tmdbIdForItem(film)).toBeUndefined();
	});

	it('returns undefined for books and games', () => {
		const book = item({ id: 'book-goodreads-123', type: 'book' });
		expect(tmdbIdForItem(book)).toBeUndefined();
	});
});

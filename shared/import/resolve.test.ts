import { describe, expect, it } from 'vitest';
import { resolveDirectId } from './resolve';

describe('resolveDirectId', () => {
	it('builds a movie id from a TMDB id', () => {
		expect(resolveDirectId({ kind: 'tmdb-movie', tmdbId: '1542' })).toBe(
			'movie-tmdb-1542',
		);
	});

	it('builds a season id from a show id and season number', () => {
		expect(
			resolveDirectId({ kind: 'tmdb-season', showTmdbId: '101359', season: 7 }),
		).toBe('show-tmdb-101359-s7');
	});

	it('builds a game id from an IGDB id', () => {
		expect(resolveDirectId({ kind: 'igdb', igdbId: '2539' })).toBe(
			'game-igdb-2539',
		);
	});

	it('builds a book id from the Goodreads Book Id', () => {
		expect(
			resolveDirectId({ kind: 'goodreads-book', bookId: '75319056' }),
		).toBe('book-goodreads-75319056');
	});

	it('returns null for a movie that needs a title+year search', () => {
		expect(resolveDirectId({ kind: 'tmdb-movie-search' })).toBeNull();
	});
});

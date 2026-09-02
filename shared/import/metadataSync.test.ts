import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { mergeSyncedItem } from './metadataSync';

/** A stored movie with hand-curated fields the sync must not disturb. */
function storedMovie(overrides: Partial<Item> = {}): Item {
	return {
		id: 'movie-tmdb-693134',
		type: 'movie',
		title: 'Dune: Part Two',
		creator: 'Denis Villeneuve',
		creator_sort: 'Villeneuve, Denis',
		cover: 'https://image.tmdb.org/t/p/w780/stored.jpg',
		release_date: '2024-02-27',
		description: 'Stored description.',
		community_rating: 8.2,
		provider: 'tmdb',
		status: 'backlog',
		is_purchased: false,
		is_prioritized: false,
		completed_dates: [],
		completed_years: [],
		tags: ['comfort-watch'],
		metadata: {},
		...overrides,
	};
}

/** A fresh provider draft, shaped like `mapTmdbMovieDraft` output. */
function freshMovie(overrides: Partial<Item> = {}): Item {
	return {
		id: 'movie-tmdb-693134',
		type: 'movie',
		title: 'Dune: Part Two',
		creator: 'Denis Villeneuve',
		cover: 'https://image.tmdb.org/t/p/w780/fresh.jpg',
		release_date: '2024-02-27',
		description: 'Fresh description.',
		community_rating: 8.3,
		provider: 'tmdb',
		status: 'backlog',
		is_purchased: false,
		is_prioritized: false,
		completed_dates: [],
		completed_years: [],
		tags: ['drama', 'sci-fi'],
		metadata: {},
		...overrides,
	};
}

describe('mergeSyncedItem', () => {
	it('keeps curated tags when the draft carries provider genres', () => {
		const merged = mergeSyncedItem(storedMovie(), freshMovie());
		expect(merged.tags).toEqual(['comfort-watch']);
	});

	it('takes the draft tags when the item has none', () => {
		const merged = mergeSyncedItem(storedMovie({ tags: [] }), freshMovie());
		expect(merged.tags).toEqual(['drama', 'sci-fi']);
	});

	it('keeps a game platform the draft has no field for', () => {
		const existing = storedMovie({
			id: 'game-igdb-1020',
			type: 'game',
			title: 'Hades',
			provider: 'igdb',
			metadata: { platform: 'Switch', series: 'Hades', series_number: 1 },
		});
		const fresh = freshMovie({
			id: 'game-igdb-1020',
			type: 'game',
			title: 'Hades',
			provider: 'igdb',
			metadata: {},
		});
		const merged = mergeSyncedItem(existing, fresh);
		expect(merged.metadata).toEqual({
			platform: 'Switch',
			series: 'Hades',
			series_number: 1,
		});
	});

	it('keeps a movie series the draft has no field for', () => {
		const existing = storedMovie({
			metadata: { series: 'Dune', series_number: 2 },
		});
		const merged = mergeSyncedItem(existing, freshMovie());
		expect(merged.metadata).toEqual({ series: 'Dune', series_number: 2 });
	});

	it('takes refreshed season fields for a show', () => {
		const existing = storedMovie({
			id: 'show-tmdb-1396-2',
			type: 'show',
			title: 'Breaking Bad: Season 2',
			metadata: {
				show_tmdb_id: 1396,
				season_number: 2,
				episode_count: 8,
				episode_runtime: 47,
			},
		});
		const fresh = freshMovie({
			id: 'show-tmdb-1396-2',
			type: 'show',
			title: 'Breaking Bad: Season 2',
			metadata: {
				show_tmdb_id: 1396,
				season_number: 2,
				episode_count: 10,
				episode_runtime: 47,
				end_date: '2026-05-31',
			},
		});
		const merged = mergeSyncedItem(existing, fresh);
		expect(merged.metadata).toEqual({
			show_tmdb_id: 1396,
			season_number: 2,
			episode_count: 10,
			episode_runtime: 47,
			end_date: '2026-05-31',
		});
	});

	it('never touches owner-controlled fields', () => {
		const existing = storedMovie({
			status: 'in_progress',
			my_rating: 9,
			notes: 'Watch the IMAX cut.',
			recommended_by: 'Ben',
			is_purchased: true,
			is_prioritized: true,
			completed_dates: ['2024-03-10'],
			completed_years: [2024],
		});
		const merged = mergeSyncedItem(existing, freshMovie());
		expect(merged.status).toBe('in_progress');
		expect(merged.my_rating).toBe(9);
		expect(merged.notes).toBe('Watch the IMAX cut.');
		expect(merged.recommended_by).toBe('Ben');
		expect(merged.is_purchased).toBe(true);
		expect(merged.is_prioritized).toBe(true);
		expect(merged.completed_dates).toEqual(['2024-03-10']);
		expect(merged.completed_years).toEqual([2024]);
	});

	it('keeps the stored cover when the draft has none', () => {
		const fresh = freshMovie();
		delete fresh.cover;
		const merged = mergeSyncedItem(storedMovie(), fresh);
		expect(merged.cover).toBe('https://image.tmdb.org/t/p/w780/stored.jpg');
	});

	it('deletes the stored community rating when the draft has none', () => {
		const fresh = freshMovie();
		delete fresh.community_rating;
		const merged = mergeSyncedItem(storedMovie(), fresh);
		expect('community_rating' in merged).toBe(false);
	});

	it('keeps a hand-fixed creator_sort when the creator refreshes', () => {
		const existing = storedMovie({
			creator: 'Ursula K. Le Guin',
			creator_sort: 'Le Guin, Ursula K.',
		});
		const merged = mergeSyncedItem(
			existing,
			freshMovie({ creator: 'Ursula Le Guin' }),
		);
		expect(merged.creator).toBe('Ursula Le Guin');
		expect(merged.creator_sort).toBe('Le Guin, Ursula K.');
	});
});

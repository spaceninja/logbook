import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { applyContribution, ratingAuthorityFor, toContribution } from './merge';
import type { ImportContribution, ImportRecord } from './types';

/** A minimal item to merge onto; overrides tailor each case. */
function makeItem(overrides: Partial<Item> = {}): Item {
	return {
		id: 'movie-tmdb-1542',
		type: 'movie',
		title: 'Office Space',
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

function makeContribution(
	overrides: Partial<ImportContribution> = {},
): ImportContribution {
	return {
		status: 'complete',
		completedDates: [],
		ratingAuthority: 'overwrite',
		...overrides,
	};
}

describe('ratingAuthorityFor', () => {
	it('lets Trakt only fill movie ratings (Letterboxd is canonical)', () => {
		expect(ratingAuthorityFor('trakt', 'movie')).toBe('fill');
	});

	it('lets Trakt overwrite show ratings', () => {
		expect(ratingAuthorityFor('trakt', 'show')).toBe('overwrite');
	});

	it('lets Letterboxd overwrite movie ratings', () => {
		expect(ratingAuthorityFor('letterboxd', 'movie')).toBe('overwrite');
	});

	it('defaults single-source types to overwrite', () => {
		expect(ratingAuthorityFor('goodreads', 'book')).toBe('overwrite');
		expect(ratingAuthorityFor('infinite-backlog', 'game')).toBe('overwrite');
	});
});

describe('toContribution', () => {
	it('extracts the merge-relevant fields from a record', () => {
		const record: ImportRecord = {
			source: 'letterboxd',
			section: 'history',
			type: 'movie',
			resolve: { kind: 'tmdb-movie', tmdbId: '1542' },
			status: 'complete',
			completedDates: ['1999-05-01'],
			myRating: 8,
			isPurchased: true,
			ratingAuthority: 'overwrite',
			title: 'Office Space',
			year: '1999',
		};
		expect(toContribution(record)).toStrictEqual({
			status: 'complete',
			completedDates: ['1999-05-01'],
			myRating: 8,
			isPurchased: true,
			ratingAuthority: 'overwrite',
		});
	});
});

describe('applyContribution — completed_dates', () => {
	it('unions dates across runs and re-derives years', () => {
		const merged = applyContribution(
			makeItem({ completed_dates: ['2024-01-02'], completed_years: [2024] }),
			makeContribution({ completedDates: ['2026-03-04'] }),
		);
		expect(merged.completed_dates).toStrictEqual(['2024-01-02', '2026-03-04']);
		expect(merged.completed_years).toStrictEqual([2024, 2026]);
	});

	it('dedupes by day, normalizing datetimes (Trakt) to a date', () => {
		const merged = applyContribution(
			makeItem({ completed_dates: ['2026-07-01'] }),
			makeContribution({ completedDates: ['2026-07-01T07:13:00.000Z'] }),
		);
		expect(merged.completed_dates).toStrictEqual(['2026-07-01']);
	});

	it('never drops an existing date on a backlog re-import', () => {
		const merged = applyContribution(
			makeItem({ completed_dates: ['2020-05-06'], completed_years: [2020] }),
			makeContribution({ status: 'backlog', completedDates: [] }),
		);
		expect(merged.completed_dates).toStrictEqual(['2020-05-06']);
	});
});

describe('applyContribution — my_rating', () => {
	it('overwrites an existing rating when authoritative', () => {
		const merged = applyContribution(
			makeItem({ my_rating: 6 }),
			makeContribution({ myRating: 9, ratingAuthority: 'overwrite' }),
		);
		expect(merged.my_rating).toBe(9);
	});

	it('fill-only keeps an existing rating', () => {
		const merged = applyContribution(
			makeItem({ my_rating: 6 }),
			makeContribution({ myRating: 9, ratingAuthority: 'fill' }),
		);
		expect(merged.my_rating).toBe(6);
	});

	it('fill-only sets the rating when none exists yet', () => {
		const merged = applyContribution(
			makeItem(),
			makeContribution({ myRating: 9, ratingAuthority: 'fill' }),
		);
		expect(merged.my_rating).toBe(9);
	});

	it('leaves the rating untouched when the record has none', () => {
		const merged = applyContribution(
			makeItem({ my_rating: 6 }),
			makeContribution({ myRating: undefined }),
		);
		expect(merged.my_rating).toBe(6);
	});
});

describe('applyContribution — status', () => {
	it('a history record sets a completed status', () => {
		const merged = applyContribution(
			makeItem({ status: 'backlog' }),
			makeContribution({ status: 'complete', completedDates: ['2020-01-01'] }),
		);
		expect(merged.status).toBe('complete');
	});

	it('a backlog record does not demote an already-completed item', () => {
		const merged = applyContribution(
			makeItem({
				status: 'complete',
				completed_dates: ['2020-01-01'],
				completed_years: [2020],
			}),
			makeContribution({ status: 'backlog', completedDates: [] }),
		);
		expect(merged.status).toBe('complete');
	});

	it('a backlog record sets status on an item with no completions', () => {
		const merged = applyContribution(
			makeItem({ status: 'complete' }),
			makeContribution({ status: 'backlog', completedDates: [] }),
		);
		expect(merged.status).toBe('backlog');
	});
});

describe('applyContribution — is_purchased & protected fields', () => {
	it('is sticky once purchased', () => {
		const merged = applyContribution(
			makeItem({ is_purchased: true }),
			makeContribution({ isPurchased: false }),
		);
		expect(merged.is_purchased).toBe(true);
	});

	it('sets is_purchased when the export signals ownership', () => {
		const merged = applyContribution(
			makeItem({ is_purchased: false }),
			makeContribution({ isPurchased: true }),
		);
		expect(merged.is_purchased).toBe(true);
	});

	it('never touches user-owned fields or enrichment', () => {
		const merged = applyContribution(
			makeItem({
				notes: 'my note',
				tags: ['favorite'],
				recommended_by: 'a friend',
				is_prioritized: true,
				description: 'enriched',
			}),
			makeContribution({ status: 'complete', completedDates: ['2020-01-01'] }),
		);
		expect(merged.notes).toBe('my note');
		expect(merged.tags).toStrictEqual(['favorite']);
		expect(merged.recommended_by).toBe('a friend');
		expect(merged.is_prioritized).toBe(true);
		expect(merged.description).toBe('enriched');
	});
});

describe('applyContribution — fallback dates', () => {
	it('backfills the fallback date when the item has no completion', () => {
		const merged = applyContribution(
			makeItem(),
			makeContribution({
				status: 'complete',
				completedDates: [],
				fallbackDate: '2025-01-03',
				replaceableDays: ['2024-06-15', '2025-01-03', '2010-05-27'],
			}),
		);
		expect(merged.completed_dates).toStrictEqual(['2025-01-03']);
		expect(merged.status).toBe('complete');
	});

	it('replaces a prior fallback date instead of stacking a second one', () => {
		// The item already holds a last-updated fallback; re-importing with the
		// release-date choice should swap it, not add a second completion.
		const merged = applyContribution(
			makeItem({
				status: 'complete',
				completed_dates: ['2025-01-03'],
				completed_years: [2025],
			}),
			makeContribution({
				status: 'complete',
				completedDates: [],
				fallbackDate: '2010-05-27',
				replaceableDays: ['2024-06-15', '2025-01-03', '2010-05-27'],
			}),
		);
		expect(merged.completed_dates).toStrictEqual(['2010-05-27']);
	});

	it('keeps a real completion date and drops the stale fallback', () => {
		const merged = applyContribution(
			makeItem({
				status: 'complete',
				completed_dates: ['2025-01-03'],
				completed_years: [2025],
			}),
			makeContribution({
				status: 'complete',
				completedDates: ['2022-07-30'],
				replaceableDays: ['2024-06-15', '2025-01-03', '2010-05-27'],
			}),
		);
		expect(merged.completed_dates).toStrictEqual(['2022-07-30']);
	});

	it('does not backfill when a real date already survives the strip', () => {
		const merged = applyContribution(
			makeItem({
				status: 'complete',
				completed_dates: ['2021-05-05'],
				completed_years: [2021],
			}),
			makeContribution({
				status: 'complete',
				completedDates: [],
				fallbackDate: '2010-05-27',
				replaceableDays: ['2024-06-15', '2025-01-03', '2010-05-27'],
			}),
		);
		expect(merged.completed_dates).toStrictEqual(['2021-05-05']);
	});
});

describe('applyContribution — idempotency', () => {
	it('is stable when the same contribution is applied twice', () => {
		const contribution = makeContribution({
			status: 'complete',
			completedDates: ['2026-02-23'],
			myRating: 10,
		});
		const once = applyContribution(makeItem(), contribution);
		const twice = applyContribution(once, contribution);
		expect(twice).toStrictEqual(once);
	});
});

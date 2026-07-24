import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import {
	applyHardcoverEnrichment,
	enrichmentsByIsbn,
	hardcoverGenreTags,
	hardcoverRating,
	mapHardcoverBook,
	type HardcoverEdition,
} from './hardcover';

function book(overrides: Partial<Item> = {}): Item {
	return {
		id: 'book-goodreads-1',
		type: 'book',
		title: 'A Book',
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

describe('hardcoverGenreTags', () => {
	it('sorts by count desc, lowercases, and de-duplicates', () => {
		expect(
			hardcoverGenreTags({
				Genre: [
					{ tag: 'Fantasy', count: 29 },
					{ tag: 'LitRPG', count: 23 },
					{ tag: 'fantasy', count: 3 },
				],
			}),
		).toEqual(['fantasy', 'litrpg']);
	});

	it('drops junk: numeric timestamps and format/status shelves', () => {
		expect(
			hardcoverGenreTags({
				Genre: [
					{ tag: 'cozy fantasy', count: 6 },
					{ tag: '1735854369098', count: 1 },
					{ tag: 'Audible', count: 2 },
					{ tag: 'to-read', count: 4 },
					{ tag: 'Calibre Import', count: 1 },
				],
			}),
		).toEqual(['cozy fantasy']);
	});

	it('returns empty for missing/empty genres', () => {
		expect(hardcoverGenreTags(null)).toEqual([]);
		expect(hardcoverGenreTags({})).toEqual([]);
	});
});

describe('hardcoverRating', () => {
	it('scales 0–5 to 0–10', () => {
		expect(hardcoverRating(4.34)).toBe(8.68);
	});
	it('treats null/0 as unrated', () => {
		expect(hardcoverRating(null)).toBeUndefined();
		expect(hardcoverRating(0)).toBeUndefined();
	});
});

describe('mapHardcoverBook', () => {
	it('uses canonical_id when the node is a duplicate', () => {
		expect(
			mapHardcoverBook({ id: 1969101, canonical_id: 446681, rating: null }),
		).toMatchObject({ hardcoverId: '446681', tags: [] });
	});
	it('uses the node id when canonical (canonical_id null)', () => {
		const e = mapHardcoverBook({
			id: 446681,
			canonical_id: null,
			rating: 4.34,
			ratings_count: 3144,
			cached_tags: { Genre: [{ tag: 'Fantasy', count: 29 }] },
		});
		expect(e).toEqual({
			hardcoverId: '446681',
			tags: ['fantasy'],
			communityRating: 8.68,
			ratingsCount: 3144,
		});
	});
	it('returns undefined without an id', () => {
		expect(mapHardcoverBook(null)).toBeUndefined();
		expect(mapHardcoverBook({ id: 0 } as never)).toBeUndefined();
	});
});

describe('enrichmentsByIsbn', () => {
	it('keys the enrichment under both isbn_13 and isbn_10', () => {
		const editions: HardcoverEdition[] = [
			{
				isbn_13: '9780593820285',
				isbn_10: '0593820282',
				book: { id: 446681, canonical_id: null, rating: 4.3 },
			},
		];
		const map = enrichmentsByIsbn(editions);
		expect(map.get('9780593820285')?.hardcoverId).toBe('446681');
		expect(map.get('0593820282')?.hardcoverId).toBe('446681');
	});

	it('skips editions with no usable book', () => {
		expect(enrichmentsByIsbn([{ isbn_13: '123', book: null }]).size).toBe(0);
	});
});

describe('applyHardcoverEnrichment', () => {
	it('prefers Hardcover tags and stamps the id', () => {
		const result = applyHardcoverEnrichment(book({ tags: ['fiction'] }), {
			hardcoverId: '446681',
			tags: ['litrpg', 'science fiction'],
		});
		expect(result.tags).toEqual(['litrpg', 'science fiction']);
		expect((result.metadata as { hardcover_id?: string }).hardcover_id).toBe(
			'446681',
		);
	});

	it('keeps existing tags when Hardcover has none', () => {
		const result = applyHardcoverEnrichment(book({ tags: ['fiction'] }), {
			hardcoverId: '1',
			tags: [],
		});
		expect(result.tags).toEqual(['fiction']);
	});

	it('fills community_rating only when absent (never overrides Goodreads)', () => {
		const filled = applyHardcoverEnrichment(book(), {
			hardcoverId: '1',
			tags: [],
			communityRating: 8.68,
		});
		expect(filled.community_rating).toBe(8.68);

		const kept = applyHardcoverEnrichment(book({ community_rating: 9.2 }), {
			hardcoverId: '1',
			tags: [],
			communityRating: 8.68,
		});
		expect(kept.community_rating).toBe(9.2);
	});

	it('does not mutate the input item', () => {
		const input = book({ tags: ['fiction'] });
		applyHardcoverEnrichment(input, { hardcoverId: '1', tags: ['litrpg'] });
		expect(input.tags).toEqual(['fiction']);
		expect(
			(input.metadata as { hardcover_id?: string }).hardcover_id,
		).toBeUndefined();
	});
});

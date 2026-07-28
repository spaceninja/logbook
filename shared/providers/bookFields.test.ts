import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { preferGoodreadsFields } from './bookFields';

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

describe('preferGoodreadsFields', () => {
	it("takes Goodreads' original year over a Google reprint date", () => {
		// Neuromancer: Google resolves the 2000 Penguin reissue.
		const merged = preferGoodreadsFields(
			book({ release_date: '2000-07-01' }),
			book({ release_date: '1984' }),
		);
		expect(merged.release_date).toBe('1984');
	});

	it("takes Goodreads' page count over a Google ebook count", () => {
		// System Collapse: Google's ebook volume reports 189 against a real 248.
		const merged = preferGoodreadsFields(
			book({ length: 189, length_unit: 'pages' }),
			book({ length: 248, length_unit: 'pages' }),
		);
		expect(merged).toMatchObject({ length: 248, length_unit: 'pages' });
	});

	it("keeps Google's values for fields Goodreads has nothing for", () => {
		const merged = preferGoodreadsFields(
			book({ release_date: '2020-05-05', length: 314, length_unit: 'pages' }),
			book(),
		);
		expect(merged).toMatchObject({ release_date: '2020-05-05', length: 314 });
	});

	it('leaves every other field on the Google draft', () => {
		const google = book({
			title: 'Wool',
			cover: 'https://books.google.com/cover',
			description: 'Blurb.',
			tags: ['fiction'],
			metadata: { google_books_id: 'abc' },
		});
		const merged = preferGoodreadsFields(
			google,
			book({ release_date: '2011' }),
		);
		expect(merged.title).toBe('Wool');
		expect(merged.cover).toBe('https://books.google.com/cover');
		expect(merged.description).toBe('Blurb.');
		expect(merged.tags).toEqual(['fiction']);
		expect(merged.metadata).toEqual({ google_books_id: 'abc' });
	});

	it('passes the Google draft through when there is no Goodreads draft', () => {
		const google = book({ release_date: '2000-07-01', length: 337 });
		expect(preferGoodreadsFields(google, undefined)).toEqual(google);
	});

	it('does not mutate either input', () => {
		const google = book({ release_date: '2000-07-01' });
		const goodreads = book({ release_date: '1984' });
		preferGoodreadsFields(google, goodreads);
		expect(google.release_date).toBe('2000-07-01');
		expect(goodreads.release_date).toBe('1984');
	});

	it("defaults the unit to pages when Goodreads' count carries none", () => {
		const merged = preferGoodreadsFields(
			book({ length: 12, length_unit: 'min' }),
			book({ length: 248 }),
		);
		expect(merged).toMatchObject({ length: 248, length_unit: 'pages' });
	});
});

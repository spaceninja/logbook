import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../types/item';
import {
	isReleaseDateDowngrade,
	preferGoodreadsFields,
	preferGoogleReleaseDate,
} from './bookFields';

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

	describe('recent-book carve-out (#97)', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		function atYear(year: number) {
			vi.useFakeTimers();
			vi.setSystemTime(new Date(`${year}-08-11T00:00:00Z`));
		}

		it("takes Google's day-level date for a book published this year", () => {
			atYear(2026);
			// Radiant Star: no reprint can exist yet, so Google's edition is the one.
			const merged = preferGoodreadsFields(
				book({ release_date: '2026-05-12' }),
				book({ release_date: '2026' }),
			);
			expect(merged.release_date).toBe('2026-05-12');
		});

		it("keeps Goodreads' year once the book is old enough to be reprinted", () => {
			atYear(2026);
			const merged = preferGoodreadsFields(
				book({ release_date: '2022-06-07' }),
				book({ release_date: '2022' }),
			);
			expect(merged.release_date).toBe('2022');
		});
	});
});

describe('preferGoogleReleaseDate', () => {
	/** Fixed "today" so the three-year window doesn't drift with the calendar. */
	const now = new Date('2026-08-11T00:00:00Z');

	it('accepts a full date for the current year', () => {
		expect(preferGoogleReleaseDate('2026', '2026-05-12', now)).toBe(true);
	});

	it('accepts a full date at the far edge of the window', () => {
		expect(preferGoogleReleaseDate('2024', '2024-03-19', now)).toBe(true);
	});

	it('rejects the year just outside the window', () => {
		expect(preferGoogleReleaseDate('2023', '2023-11-14', now)).toBe(false);
	});

	it('accepts a full date for a book that has not been released yet', () => {
		expect(preferGoogleReleaseDate('2027', '2027-02-02', now)).toBe(true);
	});

	it('rejects a date whose year disagrees, however recent', () => {
		// A reprint Google resolved instead of the edition Goodreads shelved.
		expect(preferGoogleReleaseDate('2025', '2026-06-25', now)).toBe(false);
	});

	it('rejects a year-only answer, which refines nothing', () => {
		expect(preferGoogleReleaseDate('2025', '2025', now)).toBe(false);
	});

	it('rejects a month-precision answer', () => {
		expect(preferGoogleReleaseDate('2026', '2026-03', now)).toBe(false);
	});

	it('leaves a stored date that is already full alone', () => {
		expect(preferGoogleReleaseDate('2026-05-12', '2026-05-05', now)).toBe(
			false,
		);
	});
});

describe('isReleaseDateDowngrade', () => {
	it('flags a bare year replacing a full date of that year', () => {
		expect(isReleaseDateDowngrade('2026-05-12', '2026')).toBe(true);
	});

	it('flags a bare year replacing a month-precision date of that year', () => {
		expect(isReleaseDateDowngrade('2026-05', '2026')).toBe(true);
	});

	it('has no recency window — a hand-typed 1984 date is protected too', () => {
		expect(isReleaseDateDowngrade('1984-07-01', '1984')).toBe(true);
	});

	it('allows a bare year that corrects the year outright', () => {
		expect(isReleaseDateDowngrade('2000-07-01', '1984')).toBe(false);
	});

	it('allows a full date to replace a bare year', () => {
		expect(isReleaseDateDowngrade('2026', '2026-05-12')).toBe(false);
	});

	it('allows a year onto a book that has no date at all', () => {
		expect(isReleaseDateDowngrade(undefined, '2026')).toBe(false);
	});

	it('is not fooled by a year that is a prefix of a longer number', () => {
		expect(isReleaseDateDowngrade('20260', '2026')).toBe(false);
	});
});

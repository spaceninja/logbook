import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import {
	inferReadDates,
	mergeSyncedBook,
	newBookSkeleton,
	readDayFor,
	syncedStatus,
	type SyncedBook,
} from './goodreadsSync';

const COVER =
	'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1731705848l/217582924._SX640_.jpg';

/** A shelf entry as the widget parser produces it. */
function shelfBook(overrides: Partial<SyncedBook> = {}): SyncedBook {
	return {
		bookId: '217582924',
		title: 'Automatic Noodle',
		author: 'Annalee Newitz',
		coverLarge: COVER,
		coverSmall: COVER.replace('_SX640_', '_SX180_'),
		myRating: 8,
		shelf: 'read',
		...overrides,
	};
}

/** A stored doc with owner-customized fields, keyed by the Goodreads id. */
function existingDoc(overrides: Partial<Item> = {}): Item {
	return {
		id: 'book-goodreads-217582924',
		type: 'book',
		title: 'Automatic Noodle',
		provider: 'goodreads',
		status: 'backlog',
		is_purchased: true,
		is_prioritized: true,
		completed_dates: [],
		completed_years: [],
		tags: ['sci-fi'],
		notes: 'my notes',
		recommended_by: 'a friend',
		community_rating: 7.0,
		metadata: { isbn: '1250357470', google_books_id: 'abc123' },
		...overrides,
	};
}

/** A stored, already-finished book. */
function finished(id: string, dates: string[] = ['2026-07-21']): Item {
	return existingDoc({
		id: `book-goodreads-${id}`,
		status: 'complete',
		completed_dates: dates,
	});
}

describe('syncedStatus', () => {
	it('marks a book on read complete', () => {
		expect(syncedStatus(existingDoc(), 'read')).toBe('complete');
	});

	it('marks a book on currently-reading in progress', () => {
		expect(syncedStatus(undefined, 'currently-reading')).toBe('in_progress');
	});

	it('moves a finished book back to in progress when a reread starts', () => {
		expect(syncedStatus(finished('1'), 'currently-reading')).toBe(
			'in_progress',
		);
	});

	it('files an unread book on to-read in the backlog', () => {
		expect(syncedStatus(existingDoc(), 'to-read')).toBe('backlog');
	});

	it('keeps a finished book complete when it is shelved to-read again', () => {
		expect(syncedStatus(finished('1'), 'to-read')).toBe('complete');
	});

	it('returns an abandoned reread to complete when it goes back to to-read', () => {
		const rereading = existingDoc({
			status: 'in_progress',
			completed_dates: ['2020-01-01'],
		});
		expect(syncedStatus(rereading, 'to-read')).toBe('complete');
	});

	it('never changes a book the owner marked did-not-finish', () => {
		expect(
			syncedStatus(existingDoc({ status: 'dnf' }), 'currently-reading'),
		).toBe('dnf');
	});
});

describe('readDayFor', () => {
	it('dates a morning run to the previous Pacific day', () => {
		// 12:17 UTC is 04:17 Pacific (PST) on Nov 19.
		expect(readDayFor(new Date('2026-11-19T12:17:00Z'))).toBe('2026-11-18');
	});

	it('uses the Pacific date, not UTC, near midnight', () => {
		// 03:00 UTC Nov 19 is still 19:00 Pacific on Nov 18.
		expect(readDayFor(new Date('2026-11-19T03:00:00Z'))).toBe('2026-11-17');
	});

	it('crosses a month boundary', () => {
		expect(readDayFor(new Date('2026-03-01T12:17:00Z'))).toBe('2026-02-28');
	});
});

describe('inferReadDates', () => {
	const DAY = '2026-11-18';

	it('dates a book newly moved from in progress to read', () => {
		const stored = new Map([
			['book-goodreads-1', existingDoc({ status: 'in_progress' })],
		]);
		expect(
			inferReadDates([shelfBook({ bookId: '1' })], stored, DAY).get(
				'book-goodreads-1',
			),
		).toBe(DAY);
	});

	it('dates a book that went straight from the backlog to read', () => {
		const stored = new Map([['book-goodreads-1', existingDoc()]]);
		expect(
			inferReadDates([shelfBook({ bookId: '1' })], stored, DAY).get(
				'book-goodreads-1',
			),
		).toBe(DAY);
	});

	it('dates a book the app has never seen', () => {
		expect(
			inferReadDates([shelfBook({ bookId: '1' })], new Map(), DAY).get(
				'book-goodreads-1',
			),
		).toBe(DAY);
	});

	it('dates a finished reread, which sits in progress until it returns to read', () => {
		const rereading = existingDoc({
			status: 'in_progress',
			completed_dates: ['2020-08-12'],
		});
		const stored = new Map([['book-goodreads-1', rereading]]);
		expect(
			inferReadDates([shelfBook({ bookId: '1' })], stored, DAY).get(
				'book-goodreads-1',
			),
		).toBe(DAY);
	});

	it('leaves an already-complete book out entirely', () => {
		const stored = new Map([['book-goodreads-1', finished('1')]]);
		expect(
			inferReadDates([shelfBook({ bookId: '1' })], stored, DAY).has(
				'book-goodreads-1',
			),
		).toBe(false);
	});

	it('leaves a did-not-finish book out entirely', () => {
		const stored = new Map([
			['book-goodreads-1', existingDoc({ status: 'dnf' })],
		]);
		expect(
			inferReadDates([shelfBook({ bookId: '1' })], stored, DAY).has(
				'book-goodreads-1',
			),
		).toBe(false);
	});

	it('marks an old read logged late, below a dated finished book, as undated', () => {
		const stored = new Map([['book-goodreads-1', finished('1')]]);
		const shelf = [shelfBook({ bookId: '1' }), shelfBook({ bookId: '2' })];
		const dates = inferReadDates(shelf, stored, DAY);
		expect([
			dates.has('book-goodreads-2'),
			dates.get('book-goodreads-2'),
		]).toEqual([true, undefined]);
	});

	it('still dates a new read above the most recent finished book', () => {
		const stored = new Map([['book-goodreads-1', finished('1')]]);
		const shelf = [shelfBook({ bookId: '2' }), shelfBook({ bookId: '1' })];
		expect(inferReadDates(shelf, stored, DAY).get('book-goodreads-2')).toBe(
			DAY,
		);
	});

	it('does not treat an undated finished book as a bound on newer reads', () => {
		const stored = new Map([['book-goodreads-1', finished('1', [])]]);
		const shelf = [shelfBook({ bookId: '1' }), shelfBook({ bookId: '2' })];
		expect(inferReadDates(shelf, stored, DAY).get('book-goodreads-2')).toBe(
			DAY,
		);
	});
});

describe('newBookSkeleton', () => {
	it('builds a book item under a Goodreads id, filed by its shelf', () => {
		expect(newBookSkeleton(shelfBook({ shelf: 'to-read' }))).toMatchObject({
			id: 'book-goodreads-217582924',
			type: 'book',
			provider: 'goodreads',
			status: 'backlog',
			creator: 'Annalee Newitz',
			cover: COVER,
			my_rating: 8,
			completed_dates: [],
			metadata: { goodreads_cover: COVER },
		});
	});
});

describe('mergeSyncedBook', () => {
	it('creates a brand-new read book with its inferred date', () => {
		const merged = mergeSyncedBook(undefined, shelfBook(), {
			completion: { day: '2026-11-18' },
		});
		expect([
			merged.status,
			merged.completed_dates,
			merged.completed_years,
		]).toEqual(['complete', ['2026-11-18'], [2026]]);
	});

	it('marks an old read complete without inventing a date', () => {
		const merged = mergeSyncedBook(existingDoc(), shelfBook(), {
			completion: { day: undefined },
		});
		expect([merged.status, merged.completed_dates]).toEqual(['complete', []]);
	});

	it('adds no date to a book that was not newly read', () => {
		const merged = mergeSyncedBook(finished('217582924'), shelfBook());
		expect(merged.completed_dates).toEqual(['2026-07-21']);
	});

	it('adds a reread date alongside the earlier ones', () => {
		const rereading = existingDoc({
			status: 'in_progress',
			completed_dates: ['2020-08-12'],
		});
		const merged = mergeSyncedBook(rereading, shelfBook(), {
			completion: { day: '2026-11-18' },
		});
		expect(merged.completed_dates).toEqual(['2020-08-12', '2026-11-18']);
	});

	it('moves a finished book to in progress, keeping its dates, when a reread starts', () => {
		const merged = mergeSyncedBook(
			finished('217582924'),
			shelfBook({ shelf: 'currently-reading' }),
		);
		expect([merged.status, merged.completed_dates]).toEqual([
			'in_progress',
			['2026-07-21'],
		]);
	});

	it('preserves user-owned fields and the purchased flag', () => {
		const merged = mergeSyncedBook(existingDoc(), shelfBook());
		expect(merged).toMatchObject({
			notes: 'my notes',
			tags: ['sci-fi'],
			is_prioritized: true,
			recommended_by: 'a friend',
			is_purchased: true,
		});
	});

	it('keeps the fields the widget does not carry', () => {
		const stored = existingDoc({
			description: 'From RSS.',
			release_date: '2025',
			length: 168,
			length_unit: 'pages',
			community_rating: 7.9,
		});
		expect(mergeSyncedBook(stored, shelfBook())).toMatchObject({
			description: 'From RSS.',
			release_date: '2025',
			length: 168,
			length_unit: 'pages',
			community_rating: 7.9,
		});
	});

	it('keeps prior enrichment handles in metadata', () => {
		const merged = mergeSyncedBook(existingDoc(), shelfBook());
		expect(
			(merged.metadata as { google_books_id?: string }).google_books_id,
		).toBe('abc123');
	});

	it('refreshes the rating from Goodreads', () => {
		const merged = mergeSyncedBook(
			existingDoc({ my_rating: 4 }),
			shelfBook({ myRating: 10 }),
		);
		expect(merged.my_rating).toBe(10);
	});

	it('keeps a stored rating when the widget shows the book unrated', () => {
		const merged = mergeSyncedBook(
			existingDoc({ my_rating: 6 }),
			shelfBook({ myRating: undefined }),
		);
		expect(merged.my_rating).toBe(6);
	});

	describe('cover precedence', () => {
		const GOOGLE_COVER =
			'https://books.google.com/books/content?id=abc123&fife=w640';

		it("takes Goodreads' cover when it measures at least 640px wide", () => {
			const merged = mergeSyncedBook(
				existingDoc({ cover: GOOGLE_COVER }),
				shelfBook(),
				{ coverWidth: 1125 },
			);
			expect(merged.cover).toBe(COVER);
		});

		it("keeps a Google cover when Goodreads' art is too small", () => {
			const merged = mergeSyncedBook(
				existingDoc({ cover: GOOGLE_COVER }),
				shelfBook(),
				{ coverWidth: 313 },
			);
			expect(merged.cover).toBe(GOOGLE_COVER);
		});

		it('keeps a Google cover when the width could not be measured', () => {
			const merged = mergeSyncedBook(
				existingDoc({ cover: GOOGLE_COVER }),
				shelfBook(),
			);
			expect(merged.cover).toBe(GOOGLE_COVER);
		});

		it("takes Goodreads' small cover over a non-Google one", () => {
			const merged = mergeSyncedBook(
				existingDoc({ cover: 'https://i.gr-assets.com/old.jpg' }),
				shelfBook(),
				{ coverWidth: 313 },
			);
			expect(merged.cover).toBe(COVER);
		});

		it('records the evaluated URL so the next run skips measuring', () => {
			const merged = mergeSyncedBook(
				existingDoc({ cover: GOOGLE_COVER }),
				shelfBook(),
				{ coverWidth: 313 },
			);
			expect(
				(merged.metadata as { goodreads_cover?: string }).goodreads_cover,
			).toBe(COVER);
		});

		it('leaves the stored cover untouched when Goodreads has no cover', () => {
			const merged = mergeSyncedBook(
				existingDoc({ cover: GOOGLE_COVER }),
				shelfBook({ coverLarge: undefined, coverSmall: undefined }),
			);
			expect(merged.cover).toBe(GOOGLE_COVER);
		});
	});
});

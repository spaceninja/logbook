import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import {
	mergeSyncedBook,
	newBookSkeleton,
	parseFeed,
	rfc822ToDay,
	type RssBook,
} from './goodreadsRss';

/** Wrap `<item>` bodies in the minimal RSS envelope the parser reads. */
function feed(...items: string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?><rss><channel>${items.join('')}</channel></rss>`;
}

/** A realistic `read`-shelf item (fields the parser actually reads). */
const READ_ITEM = `
	<item>
		<title>Automatic Noodle</title>
		<book_id>217582924</book_id>
		<book_large_image_url><![CDATA[https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1731705848l/217582924._SY475_.jpg]]></book_large_image_url>
		<book_description><![CDATA[<b>A cozy near-future novella</b> about robots &amp; noodles.<br />Second line.]]></book_description>
		<book id="217582924"><num_pages>168</num_pages></book>
		<author_name>Annalee Newitz</author_name>
		<isbn>1250357470</isbn>
		<user_rating>4</user_rating>
		<user_read_at><![CDATA[Tue, 21 Jul 2026 00:00:00 +0000]]></user_read_at>
		<user_date_added><![CDATA[Sun, 26 Jan 2025 08:30:42 -0700]]></user_date_added>
		<average_rating>3.95</average_rating>
		<book_published>2025</book_published>
	</item>`;

/** A `to-read` item: unrated, no read date, series suffix in the title. */
const TO_READ_ITEM = `
	<item>
		<title>Radiant Star (Imperial Radch, #4)</title>
		<book_id>111</book_id>
		<book_large_image_url><![CDATA[https://i.gr-assets.com/images/S/x/222._SX98_.jpg]]></book_large_image_url>
		<author_name>Ann Leckie</author_name>
		<user_rating>0</user_rating>
		<user_read_at></user_read_at>
		<average_rating>4.29</average_rating>
		<book_published>2026</book_published>
	</item>`;

/**
 * An item the feed carries almost nothing for: Goodreads ships an empty
 * `book_published` and no `num_pages` for a few titles (Dracula Daily, Locke
 * Lamora and the Bottled Serpent).
 */
const SPARSE_ITEM = `
	<item>
		<title>Dracula Daily</title>
		<book_id>444</book_id>
		<book_large_image_url><![CDATA[https://i.gr-assets.com/images/S/x/444._SY475_.jpg]]></book_large_image_url>
		<author_name>Bram Stoker</author_name>
		<user_rating>0</user_rating>
		<average_rating>4.1</average_rating>
		<book_published></book_published>
	</item>`;

/** An item whose cover is the Goodreads `nophoto` placeholder. */
const NOPHOTO_ITEM = `
	<item>
		<title>Obscure Book</title>
		<book_id>333</book_id>
		<book_large_image_url><![CDATA[https://s.gr-assets.com/assets/nophoto/book/111x148-bcc042a9c91a29c1d680899eff700a03.png]]></book_large_image_url>
		<author_name>Nobody</author_name>
		<user_rating>0</user_rating>
		<average_rating>0.0</average_rating>
	</item>`;

describe('parseFeed', () => {
	it('maps a read-shelf item to a complete, rated, dated book', () => {
		const [book] = parseFeed(feed(READ_ITEM), 'read');
		expect(book).toMatchObject<Partial<RssBook>>({
			bookId: '217582924',
			title: 'Automatic Noodle',
			author: 'Annalee Newitz',
			year: '2025',
			pages: 168,
			isbn: '1250357470',
			status: 'complete',
			readAt: '2026-07-21',
			dateAdded: '2025-01-26',
		});
		// Goodreads 0–5 ratings are doubled to the app's 0–10 scale.
		expect(book!.communityRating).toBeCloseTo(7.9);
		expect(book!.myRating).toBe(8);
	});

	it('upgrades the RSS thumbnail to a full-res cover via the resize directive', () => {
		const [book] = parseFeed(feed(READ_ITEM), 'read');
		expect(book!.coverLarge).toContain('217582924._SX640_.jpg');
		expect(book!.coverSmall).toContain('217582924._SX180_.jpg');
		expect(book!.coverLarge).not.toContain('_SY475_');
	});

	it('strips the series suffix and leaves an unrated book without a rating', () => {
		const [book] = parseFeed(feed(TO_READ_ITEM), 'to-read');
		expect(book!.title).toBe('Radiant Star');
		expect(book!.series).toBe('Imperial Radch');
		expect(book!.seriesNumber).toBe(4);
		expect(book!.status).toBe('backlog');
		expect(book!.myRating).toBeUndefined();
		expect(book!.readAt).toBeUndefined();
	});

	it('drops a nophoto placeholder rather than storing it', () => {
		const [book] = parseFeed(feed(NOPHOTO_ITEM), 'to-read');
		expect(book!.coverLarge).toBeUndefined();
		expect(book!.coverSmall).toBeUndefined();
	});

	it('reads a single-item feed (parser returns an object, not an array)', () => {
		expect(parseFeed(feed(TO_READ_ITEM), 'to-read')).toHaveLength(1);
	});

	it('skips entries without a book id', () => {
		expect(
			parseFeed(feed('<item><title>Header</title></item>'), 'read'),
		).toEqual([]);
	});
});

describe('rfc822ToDay', () => {
	it('reads the calendar day directly, ignoring the timezone offset', () => {
		// Midnight in a negative offset must not roll back to the previous UTC day.
		expect(rfc822ToDay('Tue, 21 Jul 2026 00:00:00 -0700')).toBe('2026-07-21');
	});
	it('returns undefined for an empty or malformed value', () => {
		expect(rfc822ToDay('')).toBeUndefined();
		expect(rfc822ToDay(undefined)).toBeUndefined();
	});
});

describe('newBookSkeleton', () => {
	it('builds a complete book item under a Goodreads id', () => {
		const [rss] = parseFeed(feed(READ_ITEM), 'read');
		const item = newBookSkeleton(rss!);
		expect(item).toMatchObject({
			id: 'book-goodreads-217582924',
			type: 'book',
			provider: 'goodreads',
			status: 'complete',
			is_purchased: false,
			is_prioritized: false,
			completed_dates: ['2026-07-21'],
			completed_years: [2026],
			length: 168,
			length_unit: 'pages',
			my_rating: 8,
		});
		// HTML description is converted to markdown, not stored raw.
		expect(item.description).toBe(
			'**A cozy near-future novella** about robots & noodles.\nSecond line.',
		);
	});
});

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

describe('mergeSyncedBook', () => {
	it('creates a brand-new book from the feed alone', () => {
		const [rss] = parseFeed(feed(READ_ITEM), 'read');
		expect(mergeSyncedBook(undefined, rss!).id).toBe(
			'book-goodreads-217582924',
		);
	});

	it('refreshes rating/status/dates while preserving user-owned fields', () => {
		const [rss] = parseFeed(feed(READ_ITEM), 'read');
		const merged = mergeSyncedBook(existingDoc(), rss!);
		// Provider fields refreshed from Goodreads:
		expect(merged.community_rating).toBeCloseTo(7.9);
		expect(merged.my_rating).toBe(8);
		expect(merged.status).toBe('complete');
		expect(merged.completed_dates).toEqual(['2026-07-21']);
		expect(merged.completed_years).toEqual([2026]);
		// User-owned fields untouched; is_purchased stays sticky:
		expect(merged.notes).toBe('my notes');
		expect(merged.tags).toEqual(['sci-fi']);
		expect(merged.is_prioritized).toBe(true);
		expect(merged.recommended_by).toBe('a friend');
		expect(merged.is_purchased).toBe(true);
		// A prior enrichment handle is preserved even though RSS never carries it:
		expect(
			(merged.metadata as { google_books_id?: string }).google_books_id,
		).toBe('abc123');
	});

	it('keeps an owner-picked cover when Goodreads has only a nophoto', () => {
		const [rss] = parseFeed(feed(NOPHOTO_ITEM), 'to-read');
		const merged = mergeSyncedBook(
			existingDoc({
				id: 'book-goodreads-333',
				cover: 'https://example/mine.jpg',
			}),
			rss!,
		);
		expect(merged.cover).toBe('https://example/mine.jpg');
	});

	it('keeps imported date/length/description when the feed omits them', () => {
		const [rss] = parseFeed(feed(SPARSE_ITEM), 'to-read');
		const merged = mergeSyncedBook(
			existingDoc({
				id: 'book-goodreads-444',
				release_date: '1897',
				length: 418,
				length_unit: 'pages',
				description: 'From the import.',
			}),
			rss!,
		);
		expect(merged).toMatchObject({
			release_date: '1897',
			length: 418,
			length_unit: 'pages',
			description: 'From the import.',
		});
	});

	describe('cover precedence', () => {
		const GOOGLE_COVER =
			'https://books.google.com/books/content?id=abc123&fife=w640';
		const FEED_COVER =
			'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1731705848l/217582924._SX640_.jpg';

		it("takes Goodreads' cover when it measures at least 640px wide", () => {
			const [rss] = parseFeed(feed(READ_ITEM), 'read');
			const merged = mergeSyncedBook(
				existingDoc({ cover: GOOGLE_COVER }),
				rss!,
				1125,
			);
			expect(merged.cover).toBe(FEED_COVER);
		});

		it("keeps a Google cover when Goodreads' art is too small", () => {
			const [rss] = parseFeed(feed(READ_ITEM), 'read');
			const merged = mergeSyncedBook(
				existingDoc({ cover: GOOGLE_COVER }),
				rss!,
				313,
			);
			expect(merged.cover).toBe(GOOGLE_COVER);
		});

		it('keeps a Google cover when the width could not be measured', () => {
			const [rss] = parseFeed(feed(READ_ITEM), 'read');
			const merged = mergeSyncedBook(
				existingDoc({ cover: GOOGLE_COVER }),
				rss!,
				undefined,
			);
			expect(merged.cover).toBe(GOOGLE_COVER);
		});

		it("takes Goodreads' small cover over a non-Google one", () => {
			const [rss] = parseFeed(feed(READ_ITEM), 'read');
			const merged = mergeSyncedBook(
				existingDoc({ cover: 'https://i.gr-assets.com/old.jpg' }),
				rss!,
				313,
			);
			expect(merged.cover).toBe(FEED_COVER);
		});

		it('takes a small Goodreads cover when the book has none at all', () => {
			const [rss] = parseFeed(feed(READ_ITEM), 'read');
			const merged = mergeSyncedBook(
				existingDoc({ cover: undefined }),
				rss!,
				313,
			);
			expect(merged.cover).toBe(FEED_COVER);
		});

		it('records the evaluated URL so the next run skips measuring', () => {
			const [rss] = parseFeed(feed(READ_ITEM), 'read');
			const merged = mergeSyncedBook(
				existingDoc({ cover: GOOGLE_COVER }),
				rss!,
				313,
			);
			expect(
				(merged.metadata as { goodreads_cover?: string }).goodreads_cover,
			).toBe(FEED_COVER);
		});

		it('leaves the stored cover untouched for a nophoto placeholder', () => {
			const [rss] = parseFeed(feed(NOPHOTO_ITEM), 'to-read');
			const merged = mergeSyncedBook(
				existingDoc({ id: 'book-goodreads-333', cover: GOOGLE_COVER }),
				rss!,
			);
			expect(merged.cover).toBe(GOOGLE_COVER);
			expect(
				(merged.metadata as { goodreads_cover?: string }).goodreads_cover,
			).toBeUndefined();
		});
	});

	it('does not demote a completed book when it reappears on to-read', () => {
		const [rss] = parseFeed(feed(TO_READ_ITEM), 'to-read');
		const merged = mergeSyncedBook(
			existingDoc({
				id: 'book-goodreads-111',
				status: 'complete',
				completed_dates: ['2025-05-01'],
				completed_years: [2025],
			}),
			rss!,
		);
		expect(merged.status).toBe('complete');
		expect(merged.completed_dates).toEqual(['2025-05-01']);
	});
});

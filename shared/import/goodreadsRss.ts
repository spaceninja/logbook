import { XMLParser } from 'fast-xml-parser';
import { draftDefaults, toCreator } from '../providers/helpers';
import type { Item, ItemStatus } from '../types/item';
import { deriveCompletedYears } from '../utils/completedYears';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';
import { makeBookId } from '../utils/itemId';
import { applyContribution } from './merge';
import { parseSeriesSuffix } from './series';

/**
 * Goodreads shelf-RSS parser for the daily sync (issue #17). Unlike the CSV
 * importer (`goodreads.ts`), this builds a complete `Item` straight from the feed
 * with no Google Books enrichment: the RSS is the sole source, since it carries
 * the community rating (`average_rating`) the CSV export lacks and its covers are
 * high-res once the resize directive is stripped. The stable id is the Goodreads
 * book id (`book-goodreads-<id>`), so a synced book de-duplicates against the same
 * book imported from CSV.
 */

/** A Goodreads shelf mapped to the status a book on it takes. */
export const SHELF_STATUS = {
	'to-read': 'backlog',
	'currently-reading': 'in_progress',
	read: 'complete',
} as const satisfies Record<string, ItemStatus>;

export type SyncShelf = keyof typeof SHELF_STATUS;

/** One feed entry, normalized to the fields the sync maps onto an `Item`. */
export interface RssBook {
	bookId: string;
	title: string;
	series?: string;
	seriesNumber?: number;
	author?: string;
	/** Full-res cover (resize directive stripped); undefined for a `nophoto`. */
	coverLarge?: string;
	coverSmall?: string;
	descriptionHtml?: string;
	/** Publication year (`book_published`); the feed carries no full date. */
	year?: string;
	pages?: number;
	isbn?: string;
	/** Community rating, normalized to 0–10. */
	communityRating?: number;
	/** The owner's rating, normalized to 0–10; undefined when unrated (0). */
	myRating?: number;
	/** Completion day (`YYYY-MM-DD`) from `user_read_at`. */
	readAt?: string;
	/** `user_date_added` day — the fallback completion date for a dated-less read. */
	dateAdded?: string;
	status: ItemStatus;
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false, // keep ISBNs/ids/years as strings; convert explicitly
	processEntities: true,
});

/** A trimmed string for a feed value, or undefined when empty/absent. */
function str(value: unknown): string | undefined {
	if (value == null) return undefined;
	const text = String(value).trim();
	return text.length > 0 ? text : undefined;
}

/** A cover URL at the given width, or undefined for a `nophoto` placeholder. */
function coverUrl(raw: string | undefined, width: number): string | undefined {
	if (!raw || raw.includes('nophoto')) return undefined;
	// Swap Amazon's resize directive (`._SY475_`, `._SX98_`, …) for our width.
	return raw.replace(/\._S[XY]\d+_(\.\w+)(?=$|\?)/i, `._SX${width}_$1`);
}

/** Goodreads ratings are 0–5 (0 = unrated); normalize to the 0–10 scale. */
function ratingOf(value: string | undefined): number | undefined {
	const rating = Number.parseFloat((value ?? '').trim());
	return Number.isFinite(rating) && rating > 0 ? rating * 2 : undefined;
}

/** A positive integer (page count), else undefined. */
function positiveInt(value: string | undefined): number | undefined {
	const n = Number.parseInt((value ?? '').trim(), 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

function yearOf(value: string | undefined): string | undefined {
	const year = (value ?? '').trim().slice(0, 4);
	return /^\d{4}$/.test(year) ? year : undefined;
}

/** A 10- or 13-char ISBN from a feed cell, else undefined. */
function isbnOf(value: string | undefined): string | undefined {
	const digits = (value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
	return digits.length === 10 || digits.length === 13 ? digits : undefined;
}

const MONTHS: Record<string, string> = {
	jan: '01',
	feb: '02',
	mar: '03',
	apr: '04',
	may: '05',
	jun: '06',
	jul: '07',
	aug: '08',
	sep: '09',
	oct: '10',
	nov: '11',
	dec: '12',
};

/**
 * An RFC-822 date (`Tue, 21 Jul 2026 00:00:00 +0000`) to a `YYYY-MM-DD` day.
 * Reads the day/month/year tokens directly rather than going through `Date`,
 * whose UTC conversion could shift the calendar day across a timezone offset.
 */
export function rfc822ToDay(value: string | undefined): string | undefined {
	const match = (value ?? '').match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
	if (!match) return undefined;
	const month = MONTHS[match[2]!.toLowerCase()];
	if (!month) return undefined;
	return `${match[3]}-${month}-${match[1]!.padStart(2, '0')}`;
}

/** Parse one shelf feed's XML into normalized `RssBook`s. */
export function parseFeed(xml: string, shelf: SyncShelf): RssBook[] {
	const parsed = parser.parse(xml) as {
		rss?: { channel?: { item?: unknown } };
	};
	const raw = parsed?.rss?.channel?.item;
	const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const status = SHELF_STATUS[shelf];

	const books: RssBook[] = [];
	for (const entry of items as Record<string, unknown>[]) {
		const bookId = str(entry.book_id);
		if (!bookId) continue; // a channel header row or malformed entry

		const { title, series, seriesNumber } = parseSeriesSuffix(
			str(entry.title) ?? '',
		);
		const large = str(entry.book_large_image_url);
		const nested = entry.book as { num_pages?: unknown } | undefined;

		books.push({
			bookId,
			title,
			...(series ? { series } : {}),
			...(seriesNumber !== undefined ? { seriesNumber } : {}),
			author: str(entry.author_name),
			coverLarge: coverUrl(large, 640),
			coverSmall: coverUrl(large, 180),
			descriptionHtml: str(entry.book_description),
			year: yearOf(str(entry.book_published)),
			pages: positiveInt(str(nested?.num_pages)),
			isbn: isbnOf(str(entry.isbn)),
			communityRating: ratingOf(str(entry.average_rating)),
			myRating: ratingOf(str(entry.user_rating)),
			readAt: rfc822ToDay(str(entry.user_read_at)),
			dateAdded: rfc822ToDay(str(entry.user_date_added)),
			status,
		});
	}
	return books;
}

/** A complete `Item` built from an `RssBook` alone (a brand-new synced book). */
export function newBookSkeleton(rss: RssBook): Item {
	const item: Item = {
		id: makeBookId('goodreads', rss.bookId),
		type: 'book',
		title: rss.title || '(untitled)',
		provider: 'goodreads',
		...draftDefaults(),
		status: rss.status,
		completed_dates: rss.readAt ? [rss.readAt] : [],
		metadata: {
			...(rss.series ? { series: rss.series } : {}),
			...(rss.seriesNumber !== undefined
				? { series_number: rss.seriesNumber }
				: {}),
			...(rss.isbn ? { isbn: rss.isbn } : {}),
		},
	};
	const creator = toCreator([rss.author]);
	if (creator !== undefined) item.creator = creator;
	if (rss.coverLarge) item.cover = rss.coverLarge;
	if (rss.coverSmall) item.thumbnail = rss.coverSmall;
	if (rss.descriptionHtml)
		item.description = htmlToMarkdown(rss.descriptionHtml);
	if (rss.year) item.release_date = rss.year;
	if (rss.pages) {
		item.length = rss.pages;
		item.length_unit = 'pages';
	}
	if (rss.communityRating !== undefined)
		item.community_rating = rss.communityRating;
	if (rss.myRating !== undefined) item.my_rating = rss.myRating;
	item.completed_years = deriveCompletedYears(item.completed_dates);
	return item;
}

/** Set a provider field from the fresh draft, deleting it when RSS omits it. */
function overwrite<K extends keyof Item>(
	target: Item,
	key: K,
	value: Item[K] | undefined,
): void {
	if (value === undefined) delete target[key];
	else target[key] = value;
}

/**
 * Merge one feed entry onto the existing Firestore doc (or create it). RSS is the
 * authoritative source, so every provider field is refreshed each run; user-owned
 * fields (`notes`, `tags`, `recommended_by`, `is_prioritized`) and `is_purchased`
 * are left untouched, and completion dates/status/rating go through the shared
 * merge engine so the result is idempotent and never demotes a completed book.
 */
export function mergeSyncedBook(
	existing: Item | undefined,
	rss: RssBook,
): Item {
	const fresh = newBookSkeleton(rss);
	if (!existing) return fresh;

	const merged: Item = {
		...existing,
		title: fresh.title,
		provider: 'goodreads',
		// Keep any prior enrichment handle (e.g. google_books_id); refresh the rest.
		metadata: { ...existing.metadata, ...fresh.metadata },
	};
	overwrite(merged, 'creator', fresh.creator);
	overwrite(merged, 'description', fresh.description);
	overwrite(merged, 'release_date', fresh.release_date);
	overwrite(merged, 'length', fresh.length);
	overwrite(merged, 'length_unit', fresh.length_unit);
	overwrite(merged, 'community_rating', fresh.community_rating);
	// Cover only when Goodreads has a real one — a `nophoto` must not clobber a
	// cover the owner picked from Google Books.
	if (fresh.cover) {
		merged.cover = fresh.cover;
		if (fresh.thumbnail) merged.thumbnail = fresh.thumbnail;
	}

	return applyContribution(merged, {
		status: rss.status,
		completedDates: rss.readAt ? [rss.readAt] : [],
		myRating: rss.myRating,
		ratingAuthority: 'overwrite',
		...(rss.status === 'complete' && !rss.readAt && rss.dateAdded
			? { fallbackDate: rss.dateAdded }
			: {}),
	});
}

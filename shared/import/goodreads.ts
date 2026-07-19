import { draftDefaults, toCreator } from '../providers/helpers';
import type { Item } from '../types/item';
import { makeBookId } from '../utils/itemId';
import { parseCsvRecords } from './csv';
import { ratingAuthorityFor } from './merge';
import { parseSeriesSuffix } from './series';
import type { ImportFileMap, ImportRecord, ParseResult } from './types';

/**
 * Parser for Goodreads exports (books). One loose CSV,
 * `goodreads_library_export.csv`, detected by its `Exclusive Shelf` column so a
 * renamed file still works.
 *
 * The stable id is the Goodreads `Book Id` (`book-goodreads-<id>`) — Goodreads
 * killed its API, so metadata is enriched from Google Books at import time by
 * ISBN (then a title/author search). About a third of books — Kindle editions —
 * carry no ISBN, so each record also ships a `fallbackDraft` built from the
 * export's own fields (title, author, pages, year) for when enrichment finds
 * nothing. (issue #20)
 */

/** Goodreads' single exclusive shelf → how we file the book. */
const SHELVES: Record<
	string,
	Pick<ImportRecord, 'section' | 'status'> | undefined
> = {
	read: { section: 'history', status: 'complete' },
	'currently-reading': { section: 'backlog', status: 'in_progress' },
	'to-read': { section: 'backlog', status: 'backlog' },
};

/** The Goodreads library CSV among the uploaded files (by its unique header column). */
function findLibraryCsv(files: ImportFileMap): string | undefined {
	for (const text of files.values()) {
		const header = text.split('\n', 1)[0] ?? '';
		if (/exclusive shelf/i.test(header)) return text;
	}
	return undefined;
}

/** Goodreads dates are `YYYY/MM/DD`; normalize to an ISO `YYYY-MM-DD` day. */
function isoDay(value: string | undefined): string | undefined {
	const day = (value ?? '').trim().replace(/\//g, '-').slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

function yearOf(value: string | undefined): string | undefined {
	const year = (value ?? '').trim().slice(0, 4);
	return /^\d{4}$/.test(year) ? year : undefined;
}

/**
 * A usable ISBN from a Goodreads cell. The export wraps them as `="9780441172719"`
 * (an Excel string-literal guard) and leaves empties as `=""`; strip everything
 * but digits and a trailing check `X` and keep only 10- or 13-char results.
 */
function isbnOf(value: string | undefined): string | undefined {
	const digits = (value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
	return digits.length === 10 || digits.length === 13 ? digits : undefined;
}

/** Goodreads ratings are 0–5 (0 = unrated); normalize to the 0–10 scale. */
function ratingOf(value: string | undefined): number | undefined {
	const rating = Number.parseFloat((value ?? '').trim());
	return Number.isFinite(rating) && rating > 0 ? rating * 2 : undefined;
}

/** A positive integer from a cell (page count, owned copies), else undefined. */
function positiveInt(value: string | undefined): number | undefined {
	const n = Number.parseInt((value ?? '').trim(), 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * A base item built from the export alone, used when Google Books enrichment
 * finds nothing. Carries the deterministic Goodreads id/provider so the merge
 * engine treats it like any enriched base; an ISBN (when present) is kept so the
 * edit screen can still look the book up later.
 */
function fallbackDraft(row: Record<string, string>, isbn?: string): Item {
	const bookId = (row['Book Id'] ?? '').trim();
	const { title, series, seriesNumber } = parseSeriesSuffix(row['Title'] ?? '');
	const item: Item = {
		id: makeBookId('goodreads', bookId),
		type: 'book',
		title: title || '(untitled)',
		provider: 'goodreads',
		...draftDefaults(),
		metadata: {
			...(isbn ? { isbn } : {}),
			...(series ? { series } : {}),
			...(seriesNumber !== undefined ? { series_number: seriesNumber } : {}),
		},
	};
	// "Additional Authors" is dropped: Goodreads strips role labels from the
	// export, so the column mixes co-writers in with illustrators, translators,
	// colorists, letterers, and author pseudonyms with no way to tell them apart.
	// "Author" alone is the primary-writer credit we want.
	const creator = toCreator([row['Author']]);
	if (creator !== undefined) item.creator = creator;
	const year =
		yearOf(row['Original Publication Year']) ?? yearOf(row['Year Published']);
	if (year) item.release_date = year;
	const pages = positiveInt(row['Number of Pages']);
	if (pages) {
		item.length = pages;
		item.length_unit = 'pages';
	}
	return item;
}

function bookRecord(
	row: Record<string, string>,
): ImportRecord | { skip: string } | null {
	const bookId = (row['Book Id'] ?? '').trim();
	if (!bookId) return { skip: 'No Goodreads Book Id' };

	const shelf = SHELVES[(row['Exclusive Shelf'] ?? '').trim()];
	if (!shelf) return null; // an unknown/custom exclusive shelf — not imported

	const isbn13 = isbnOf(row['ISBN13']);
	const isbn = isbnOf(row['ISBN']);
	const preferredIsbn = isbn13 ?? isbn;

	const record: ImportRecord = {
		source: 'goodreads',
		section: shelf.section,
		type: 'book',
		resolve: {
			kind: 'goodreads-book',
			bookId,
			...(isbn13 ? { isbn13 } : {}),
			...(isbn ? { isbn } : {}),
		},
		status: shelf.status,
		completedDates:
			shelf.section === 'history'
				? [isoDay(row['Date Read'])].filter((day): day is string => !!day)
				: [],
		ratingAuthority: ratingAuthorityFor('goodreads', 'book'),
		// Without the series suffix, so the Google Books lookup gets a real title.
		title: parseSeriesSuffix(row['Title'] ?? '').title,
		year:
			yearOf(row['Original Publication Year']) ?? yearOf(row['Year Published']),
		myRating: ratingOf(row['My Rating']),
		isPurchased: positiveInt(row['Owned Copies']) !== undefined,
		fallbackDraft: fallbackDraft(row, preferredIsbn),
	};
	// Date-added lets an undated "read" book be dated by the user's fallback choice.
	if (shelf.section === 'history') record.addedDate = isoDay(row['Date Added']);
	return record;
}

export function parseGoodreads(files: ImportFileMap): ParseResult {
	const text = findLibraryCsv(files);
	if (!text) return { records: [], skipped: [] };

	const records: ImportRecord[] = [];
	const skipped: ParseResult['skipped'] = [];
	for (const row of parseCsvRecords(text)) {
		const result = bookRecord(row);
		if (result === null) continue;
		if ('skip' in result) {
			skipped.push({ title: row['Title'] ?? '', reason: result.skip });
			continue;
		}
		records.push(result);
	}
	return { records, skipped };
}

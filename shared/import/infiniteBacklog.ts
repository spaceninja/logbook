import { parseCsvRecords } from './csv';
import { ratingAuthorityFor } from './merge';
import type { ImportFileMap, ImportRecord, ParseResult } from './types';

/**
 * Parser for Infinite Backlog exports (games). Two loose CSVs:
 * `..._GameCollection_*.csv` (owned/played games) and `..._Wishlist_*.csv`.
 *
 * History comes from the collection's finished rows; backlog from the wishlist
 * plus in-progress collection rows. Owned-but-unplayed games are intentionally
 * not imported (issue #20). Every row carries an `IGDB ID`, so ids resolve
 * directly — no matching needed.
 */

/** `Completion` values we treat as history, mapped to an item status. */
const FINISHED: Record<string, 'complete' | 'dnf'> = {
	Completed: 'complete',
	Beaten: 'complete',
	Dropped: 'dnf',
};

function findFile(files: ImportFileMap, pattern: RegExp): string | undefined {
	for (const [name, text] of files) {
		if (pattern.test(name)) return text;
	}
	return undefined;
}

/** Trim an export date/datetime to a `YYYY-MM-DD` day, or undefined if invalid. */
function isoDay(value: string | undefined): string | undefined {
	const day = (value ?? '').trim().slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

function yearOf(value: string | undefined): string | undefined {
	const year = (value ?? '').trim().slice(0, 4);
	return /^\d{4}$/.test(year) ? year : undefined;
}

/** IB ratings are already on a 0–10 scale; keep only positive numbers. */
function parseRating(value: string | undefined): number | undefined {
	const rating = Number.parseFloat((value ?? '').trim());
	return Number.isFinite(rating) && rating > 0 ? rating : undefined;
}

function collectionRecord(
	row: Record<string, string>,
): ImportRecord | { skip: string } | null {
	const completion = (row['Completion'] ?? '').trim();
	const status = (row['Status'] ?? '').trim();
	const finished = FINISHED[completion];
	const inProgress = completion === 'Continuous' || status === 'Playing';

	// Everything else (owned-unplayed, "Unfinished", no-status) is not imported.
	if (!finished && !inProgress) return null;

	const igdbId = (row['IGDB ID'] ?? '').trim();
	if (!igdbId) return { skip: 'No IGDB id' };

	const shared = {
		source: 'infinite-backlog' as const,
		type: 'game' as const,
		resolve: { kind: 'igdb' as const, igdbId },
		ratingAuthority: ratingAuthorityFor('infinite-backlog', 'game'),
		title: row['Game name'] ?? '',
		year: yearOf(row['Game release date']),
		isPurchased: (row['Ownership'] ?? '').trim() === 'Owned',
		myRating: parseRating(row['Rating (Score)']),
	};

	if (finished) {
		// Most finished games lack a completion date; fall back to Last updated.
		const day = isoDay(row['Completion date']) ?? isoDay(row['Last updated']);
		return {
			...shared,
			section: 'history',
			status: finished,
			completedDates: day ? [day] : [],
		};
	}
	return {
		...shared,
		section: 'backlog',
		status: 'in_progress',
		completedDates: [],
	};
}

function parseCollection(text: string): ParseResult {
	const records: ImportRecord[] = [];
	const skipped: ParseResult['skipped'] = [];
	for (const row of parseCsvRecords(text)) {
		const result = collectionRecord(row);
		if (result === null) continue;
		if ('skip' in result) {
			skipped.push({ title: row['Game name'] ?? '', reason: result.skip });
			continue;
		}
		records.push(result);
	}
	return { records, skipped };
}

function parseWishlist(text: string): ParseResult {
	const records: ImportRecord[] = [];
	const skipped: ParseResult['skipped'] = [];
	for (const row of parseCsvRecords(text)) {
		const igdbId = (row['IGDB ID'] ?? '').trim();
		if (!igdbId) {
			skipped.push({ title: row['Game name'] ?? '', reason: 'No IGDB id' });
			continue;
		}
		records.push({
			source: 'infinite-backlog',
			section: 'backlog',
			type: 'game',
			resolve: { kind: 'igdb', igdbId },
			status: 'backlog',
			completedDates: [],
			ratingAuthority: ratingAuthorityFor('infinite-backlog', 'game'),
			title: row['Game name'] ?? '',
			year: yearOf(row['Game release date']),
		});
	}
	return { records, skipped };
}

export function parseInfiniteBacklog(files: ImportFileMap): ParseResult {
	const results: ParseResult[] = [];
	const collection = findFile(files, /gamecollection/i);
	const wishlist = findFile(files, /wishlist/i);
	if (collection) results.push(parseCollection(collection));
	if (wishlist) results.push(parseWishlist(wishlist));
	return {
		records: results.flatMap((result) => result.records),
		skipped: results.flatMap((result) => result.skipped),
	};
}

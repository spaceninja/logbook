import { draftDefaults, normalizeTitle } from '../providers/helpers';
import type { Item } from '../types/item';
import { makeMovieId } from '../utils/itemId';
import { parseCsvRecords } from './csv';
import { ratingAuthorityFor } from './merge';
import type { ImportFileMap, ImportRecord, ParseResult } from './types';

/**
 * Parser for Letterboxd exports (movies). A zip of CSVs, of which five matter:
 *
 * - `watched.csv`    — every film watched. The universe: a rated or diaried film
 *                      is always here too, so history is built from this list.
 * - `diary.csv`      — the films that were *logged*, with real watch dates. One
 *                      row per viewing, so a rewatch is several rows.
 * - `ratings.csv`    — the film's current rating, ½–5 stars.
 * - `watchlist.csv`  — the backlog.
 * - `reviews.csv`    — the owner's own review text, kept as the item's notes.
 *
 * The files can only be joined on title+year: a diary row's `Letterboxd URI` is
 * the *entry's* permalink, not the film's, so it shares no key with `watched.csv`
 * (verified against a real export — zero URI overlap). That same title+year is
 * what the pipeline then matches against TMDB, since no Letterboxd file carries a
 * TMDB id.
 *
 * Most watched films were never diaried, so they arrive as completed-but-undated
 * and are dated by the user's date-fallback choice (`release` by default: a
 * Letterboxd account usually starts with one big backfill, so "date added" would
 * pile thousands of films onto a single day). (issue #20)
 */

/**
 * The export nests copies of `diary.csv`/`reviews.csv` under `deleted/` (entries
 * the owner removed) and `orphaned/` (entries whose film left Letterboxd), plus
 * unrelated `likes/`/`lists/` CSVs. None are part of the library, and a basename
 * match would let them shadow the real file — so only top-level files count.
 */
function findFile(files: ImportFileMap, name: string): string | undefined {
	for (const [path, text] of files) {
		if (path.includes('/')) continue;
		if (path.toLowerCase() === name) return text;
	}
	return undefined;
}

/** Rows of a top-level export CSV, or none when the user didn't upload it. */
function rowsOf(files: ImportFileMap, name: string): Record<string, string>[] {
	const text = findFile(files, name);
	return text ? parseCsvRecords(text) : [];
}

/** The cross-file join key for a film: its normalized title and year. */
function filmKey(row: Record<string, string>): string {
	return `${normalizeTitle(row['Name'] ?? '')}|${(row['Year'] ?? '').trim()}`;
}

/** Letterboxd ratings are ½–5 stars in half steps; normalize to the 0–10 scale. */
function ratingOf(value: string | undefined): number | undefined {
	const rating = Number.parseFloat((value ?? '').trim());
	return Number.isFinite(rating) && rating > 0 ? rating * 2 : undefined;
}

function isoDay(value: string | undefined): string | undefined {
	const day = (value ?? '').trim().slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

function yearOf(value: string | undefined): string | undefined {
	const year = (value ?? '').trim().slice(0, 4);
	return /^\d{4}$/.test(year) ? year : undefined;
}

/**
 * Letterboxd's own film id, from a film-level `Letterboxd URI`
 * (`https://boxd.it/16Sk` → `16Sk`). Only `watched`/`watchlist`/`ratings` rows
 * carry one — a diary row's URI points at the entry, not the film — so a film
 * known solely from the diary falls back to a title+year slug. Either way the id
 * is stable across exports, which is what a re-import needs.
 */
function letterboxdId(
	uri: string | undefined,
	title: string,
	year: string | undefined,
): string {
	const match = /boxd\.it\/([A-Za-z0-9]+)/.exec(uri ?? '');
	if (match) return match[1]!;
	const slug = normalizeTitle(title).replace(/ /g, '-') || 'untitled';
	return year ? `${slug}-${year}` : slug;
}

/**
 * A base item from the export's own fields, used when TMDB has no match for the
 * film (about 3% of a real export — miniseries and web series that Letterboxd
 * files as films). Carries a Letterboxd id so the film still de-duplicates on
 * re-import; it has no cover or description, so the importer flags it for the
 * owner to re-source by hand.
 */
function fallbackDraft(
	title: string,
	year: string | undefined,
	uri: string | undefined,
): Item {
	const item: Item = {
		id: makeMovieId('letterboxd', letterboxdId(uri, title, year)),
		type: 'movie',
		title: title || '(untitled)',
		provider: 'letterboxd',
		...draftDefaults(),
		metadata: {},
	};
	if (year) item.release_date = year;
	return item;
}

/** The film-level data gathered from every file, keyed by `filmKey`. */
interface FilmIndex {
	/** Real watch dates, one per diary entry — several for a rewatched film. */
	dates: Map<string, string[]>;
	ratings: Map<string, number>;
	reviews: Map<string, string>;
	/** Film-level `boxd.it` URIs, which the diary can't supply. */
	uris: Map<string, string>;
}

function buildIndex(files: ImportFileMap): FilmIndex {
	const index: FilmIndex = {
		dates: new Map(),
		ratings: new Map(),
		reviews: new Map(),
		uris: new Map(),
	};

	for (const row of rowsOf(files, 'diary.csv')) {
		const day = isoDay(row['Watched Date']);
		if (!day) continue;
		const key = filmKey(row);
		const dates = index.dates.get(key);
		if (dates) dates.push(day);
		else index.dates.set(key, [day]);
	}

	// The rating on a diary row is the one given *at the time* of that entry;
	// ratings.csv holds the film's current rating, which is the one that counts.
	// (A real export disagreed on 33 films — all of them rewatches re-rated later.)
	for (const row of rowsOf(files, 'ratings.csv')) {
		const rating = ratingOf(row['Rating']);
		if (rating !== undefined) index.ratings.set(filmKey(row), rating);
	}

	for (const row of rowsOf(files, 'reviews.csv')) {
		const review = (row['Review'] ?? '').trim();
		if (!review) continue;
		const key = filmKey(row);
		// A film reviewed more than once (a rewatch) keeps every review.
		const existing = index.reviews.get(key);
		index.reviews.set(key, existing ? `${existing}\n\n${review}` : review);
	}

	for (const name of ['watched.csv', 'watchlist.csv', 'ratings.csv']) {
		for (const row of rowsOf(files, name)) {
			const key = filmKey(row);
			const uri = (row['Letterboxd URI'] ?? '').trim();
			if (uri && !index.uris.has(key)) index.uris.set(key, uri);
		}
	}

	return index;
}

/** Fields every record shares, whether it came from `watched` or `watchlist`. */
function baseRecord(
	row: Record<string, string>,
	index: FilmIndex,
): Omit<ImportRecord, 'section' | 'status' | 'completedDates'> {
	const title = (row['Name'] ?? '').trim();
	const year = yearOf(row['Year']);
	return {
		source: 'letterboxd',
		type: 'movie',
		// No Letterboxd file carries a TMDB id, so the id comes from a title+year
		// search at import time; `fallbackDraft` covers a film TMDB doesn't have.
		resolve: { kind: 'tmdb-movie-search' },
		ratingAuthority: ratingAuthorityFor('letterboxd', 'movie'),
		title,
		year,
		// Date added to Letterboxd — the fallback for a film watched but never logged.
		addedDate: isoDay(row['Date']),
		fallbackDraft: fallbackDraft(title, year, index.uris.get(filmKey(row))),
	};
}

/**
 * The films to file as watched. Normally that's `watched.csv` outright, since
 * Letterboxd marks a diaried film watched — but the owner may have uploaded
 * `diary.csv` on its own, so a film only the diary knows about counts too (once,
 * however many times it was rewatched).
 */
function watchedFilms(files: ImportFileMap): Record<string, string>[] {
	const watched = rowsOf(files, 'watched.csv');
	const seen = new Set(watched.map(filmKey));
	const films = [...watched];
	for (const row of rowsOf(files, 'diary.csv')) {
		const key = filmKey(row);
		if (seen.has(key)) continue;
		seen.add(key);
		films.push(row);
	}
	return films;
}

export function parseLetterboxd(files: ImportFileMap): ParseResult {
	const index = buildIndex(files);
	const records: ImportRecord[] = [];
	const skipped: ParseResult['skipped'] = [];

	for (const row of watchedFilms(files)) {
		const key = filmKey(row);
		if (!(row['Name'] ?? '').trim()) {
			skipped.push({ title: '', reason: 'No film title' });
			continue;
		}
		const rating = index.ratings.get(key);
		const review = index.reviews.get(key);
		records.push({
			...baseRecord(row, index),
			section: 'history',
			status: 'complete',
			// Undated films (never diaried) get the user's date fallback downstream.
			completedDates: index.dates.get(key) ?? [],
			...(rating !== undefined ? { myRating: rating } : {}),
			// Only applied when the import creates the item — notes are the owner's field.
			...(review ? { notes: review } : {}),
		});
	}

	// A watchlisted film is unwatched, so it carries no rating or review of its own.
	for (const row of rowsOf(files, 'watchlist.csv')) {
		if (!(row['Name'] ?? '').trim()) {
			skipped.push({ title: '', reason: 'No film title' });
			continue;
		}
		records.push({
			...baseRecord(row, index),
			section: 'backlog',
			status: 'backlog',
			completedDates: [],
		});
	}

	return { records, skipped };
}

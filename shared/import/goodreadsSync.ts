import { draftDefaults, toCreator } from '../providers/helpers';
import type { Item, ItemStatus } from '../types/item';
import { makeBookId } from '../utils/itemId';
import { applyContribution } from './merge';

/**
 * The merge rules for the daily Goodreads sync (issue #17). Goodreads retired its
 * shelf RSS feeds in October 2026 (#205), so the sync now reads the public shelf
 * widget (`goodreadsWidget.ts`), which carries far less: title, author, cover and
 * the owner's rating, with no dates of any kind. Everything here is shaped by that
 * gap — the book's status comes from which shelf it's on, and a completion date is
 * *inferred* from the day a book first shows up on `read` (`inferReadDates`).
 *
 * The stable id is still the Goodreads book id (`book-goodreads-<id>`), so a synced
 * book de-duplicates against the same book imported from CSV or synced over RSS.
 */

/** The Goodreads shelves the sync reads, each an exclusive shelf. */
export const SYNC_SHELVES = ['to-read', 'currently-reading', 'read'] as const;

export type SyncShelf = (typeof SYNC_SHELVES)[number];

/** One shelf entry, normalized to the fields the sync maps onto an `Item`. */
export interface SyncedBook {
	bookId: string;
	title: string;
	series?: string;
	seriesNumber?: number;
	author?: string;
	/** Full-res cover (resize directive swapped); undefined for a `nophoto`. */
	coverLarge?: string;
	coverSmall?: string;
	/** The owner's rating, normalized to 0–10; undefined when unrated. */
	myRating?: number;
	shelf: SyncShelf;
}

/**
 * The status a synced book takes, given what's stored for it and the shelf it's on.
 * Goodreads is the source of truth for status, with two exceptions:
 *
 * - `dnf` is never touched. Goodreads has no shelf for it, so a book abandoned in
 *   the app usually just stays on `currently-reading` there — taking the shelf at
 *   its word would flip it back to in progress every morning.
 * - A book with completions on `to-read` stays (or returns to) `complete`. Shelving
 *   a finished book to read again isn't un-reading it, and a reread abandoned back
 *   to `to-read` should drop its in-progress status rather than strand it there.
 *
 * `currently-reading` is otherwise authoritative even over `complete`: that's how a
 * reread shows up, and leaving it `complete` would mean its finish never registers
 * as a new completion (see `inferReadDates`).
 */
export function syncedStatus(
	existing: Item | undefined,
	shelf: SyncShelf,
): ItemStatus {
	if (existing?.status === 'dnf') return 'dnf';
	if (shelf === 'read') return 'complete';
	if (shelf === 'currently-reading') return 'in_progress';
	return (existing?.completed_dates.length ?? 0) > 0 ? 'complete' : 'backlog';
}

/**
 * The owner's timezone, which decides which calendar day "yesterday" is. The sync
 * runs in the early hours Pacific, so a book finished late the previous evening is
 * still dated to the evening it was finished.
 */
export const OWNER_TIMEZONE = 'America/Los_Angeles';

/**
 * The completion day the sync assigns a book newly found on `read`: the day before
 * the run, in the owner's timezone. A daily run sees each change within a day of it
 * happening, and runs early in the morning, so "yesterday" is right far more often
 * than the run's own date. A run that follows days of failures dates everything it
 * catches up on to yesterday — an accepted inaccuracy, since nothing better exists.
 */
export function readDayFor(now: Date): string {
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: OWNER_TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(now); // en-CA formats as YYYY-MM-DD
	const day = new Date(`${today}T00:00:00Z`);
	day.setUTCDate(day.getUTCDate() - 1);
	return day.toISOString().slice(0, 10);
}

/**
 * Completion dates for the `read`-shelf books that became read since the last run,
 * keyed by item id. A book counts as newly read when it's on `read` but what's
 * stored for it isn't `complete` (or `dnf`, which the sync never touches) — missing,
 * on the backlog, in progress, or mid-reread (`syncedStatus` moved it back to in
 * progress when it reappeared on `currently-reading`). Nothing else is in the map,
 * so an already-complete book's dates are never touched.
 *
 * `readShelf` must be in Goodreads' date-read order, newest first. The widget shows
 * no dates, but that order still bounds them: a newly read book sitting *below* a
 * book already stored as complete with a date was read no later than that book, so
 * it's an old read logged late, not something finished yesterday. Those map to
 * `undefined` — marked complete, but left undated rather than given a wrong date.
 * Only dated, already-complete books count as that bound; an undated one says
 * nothing about where Goodreads sorts it.
 *
 * `stored` is whatever the app already holds for each id — including an absorbed
 * app-created twin (#105), whose own completion would otherwise be dated twice.
 */
export function inferReadDates(
	readShelf: SyncedBook[],
	stored: Map<string, Item>,
	readDay: string,
): Map<string, string | undefined> {
	const dates = new Map<string, string | undefined>();
	let belowKnownRead = false;
	for (const book of readShelf) {
		const id = makeBookId('goodreads', book.bookId);
		const prev = stored.get(id);
		if (prev?.status === 'complete') {
			if (prev.completed_dates.length > 0) belowKnownRead = true;
			continue;
		}
		if (prev?.status === 'dnf') continue;
		dates.set(id, belowKnownRead ? undefined : readDay);
	}
	return dates;
}

/** A complete `Item` built from a `SyncedBook` alone (a brand-new synced book). */
export function newBookSkeleton(book: SyncedBook): Item {
	const item: Item = {
		id: makeBookId('goodreads', book.bookId),
		type: 'book',
		title: book.title || '(untitled)',
		provider: 'goodreads',
		...draftDefaults(),
		status: syncedStatus(undefined, book.shelf),
		metadata: {
			...(book.series ? { series: book.series } : {}),
			...(book.seriesNumber !== undefined
				? { series_number: book.seriesNumber }
				: {}),
			// A brand-new book takes the shelf's cover unconditionally (something
			// beats nothing), so record it as evaluated — no measurement needed.
			...(book.coverLarge ? { goodreads_cover: book.coverLarge } : {}),
		},
	};
	const creator = toCreator([book.author]);
	if (creator !== undefined) item.creator = creator;
	if (book.coverLarge) item.cover = book.coverLarge;
	if (book.coverSmall) item.thumbnail = book.coverSmall;
	if (book.myRating !== undefined) item.my_rating = book.myRating;
	return item;
}

/**
 * Below this width, Goodreads' cover loses to whatever the import already stored.
 * Matches `COVER_WIDTH` in `providers/googleBooks.ts` — the width we ask both
 * providers for.
 */
export const MIN_COVER_WIDTH = 640;

/** Whether a stored cover came from Google Books (the fallback worth keeping). */
function isGoogleCover(url: string | undefined): boolean {
	return !!url && url.startsWith('https://books.google.com/');
}

export interface SyncMergeOptions {
	/**
	 * Set only for a book `inferReadDates` found newly read: the completion day to
	 * add, or `undefined` for an old read that should be complete but undated.
	 * Absent entirely, no completion is added.
	 */
	completion?: { day: string | undefined };
	/**
	 * Measured pixel width of `book.coverLarge` (see `scripts/lib/coverSize.ts`),
	 * used to decide whether Goodreads' art beats the cover already stored. The
	 * caller measures, so this stays a pure function; when it's undefined the
	 * shelf's cover is treated as unverified and only used to fill a gap. (#69)
	 */
	coverWidth?: number;
}

/**
 * Merge one shelf entry onto the existing Firestore doc (or create it). Title,
 * series, author and rating are refreshed each run. Everything the widget doesn't
 * carry — description, release date, length, community rating — is left as stored:
 * those come from the old RSS sync, the CSV import, or the post-merge Google Books
 * and Hardcover enrichment. User-owned fields (`notes`, `tags`, `recommended_by`,
 * `is_prioritized`) and `is_purchased` are left untouched.
 */
export function mergeSyncedBook(
	existing: Item | undefined,
	book: SyncedBook,
	options: SyncMergeOptions = {},
): Item {
	const fresh = newBookSkeleton(book);
	const base: Item = existing
		? {
				...existing,
				title: fresh.title,
				provider: 'goodreads',
				// Keep any prior enrichment handle (e.g. google_books_id); refresh the rest.
				metadata: { ...existing.metadata, ...fresh.metadata },
			}
		: fresh;

	if (existing) {
		if (fresh.creator === undefined) delete base.creator;
		else base.creator = fresh.creator;
		applyCover(base, fresh, options.coverWidth);
	}

	const day = options.completion?.day;
	const merged = applyContribution(base, {
		status: syncedStatus(existing, book.shelf),
		completedDates: day ? [day] : [],
		myRating: book.myRating,
		ratingAuthority: 'overwrite',
	});
	// The shared merge never demotes a book with completions — right for a file
	// import, wrong for a reread in progress. The shelf rule above is the authority.
	merged.status = syncedStatus(existing, book.shelf);
	return merged;
}

/**
 * Cover only when Goodreads has a real one — a `nophoto` must not clobber a cover
 * the owner picked from Google Books. Goodreads' art is the exact edition shelved,
 * so it wins when it's genuinely high-res; but it's served off a CDN that only
 * scales *down*, and over half the library's originals are narrower than we ask
 * for, so a small one yields to a Google cover already in place.
 */
function applyCover(
	target: Item,
	fresh: Item,
	goodreadsCoverWidth: number | undefined,
): void {
	if (!fresh.cover) return;
	const bigEnough =
		goodreadsCoverWidth !== undefined && goodreadsCoverWidth >= MIN_COVER_WIDTH;
	if (bigEnough || !isGoogleCover(target.cover)) {
		target.cover = fresh.cover;
		if (fresh.thumbnail) target.thumbnail = fresh.thumbnail;
	}
	// `fresh.metadata` already carries `goodreads_cover`, spread in by the caller,
	// so the URL just evaluated is recorded whichever branch won.
}

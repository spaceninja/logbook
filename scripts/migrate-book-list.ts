import 'dotenv/config';
import {
	applyRecovered,
	entryAuthor,
	isbn13,
	matchEntries,
	type BookListEntry,
	type BookListMatch,
	type RecoveredField,
} from './lib/bookList';
import { itemsEqual, readBooks, writeItems } from './lib/firestore-admin';
import {
	mapGoogleBooksDraft,
	rankGoogleBooksVolumes,
	type GoogleBooksVolume,
} from '../shared/providers/googleBooks';
import { titlesMatch, toCreator } from '../shared/providers/helpers';
import type { Item } from '../shared/types/item';
import { makeManualId } from '../shared/utils/itemId';

/**
 * One-time migration from Book List, the predecessor reading-list app (a Vue +
 * Realtime Database project at `spaceninja-book-list`). It recovers the four
 * hand-curated fields Logbook never received — `is_purchased`, `is_prioritized`,
 * `recommended_by` (Book List's `source`), and `notes` (its `note`) — and folds
 * them onto the matching Logbook books, leaving every other field alone.
 *
 * Book List entries with no Logbook counterpart are created as new backlog books,
 * drafted from Google Books by ISBN so they arrive with real cover art and
 * metadata rather than the old app's cached copy.
 *
 * This is expected to be run once and then never again; it is kept in the repo as
 * the record of where those fields came from. It is safe to re-run — matched
 * fields are only ever filled when empty — but a second run would re-create any
 * of the drafted books that were since deleted.
 *
 * Run:      npm run migrate:book-list
 * Preview:  npm run migrate:book-list -- --dry-run
 *
 * Requires FIREBASE_SERVICE_ACCOUNT. NUXT_GOOGLE_BOOKS_API_KEY is optional —
 * Google Books answers unkeyed requests, just at a lower rate limit.
 */

/** The Book List database, and the only account in it. Reads need no credential. */
const BOOK_LIST_URL =
	'https://spaceninja-book-list.firebaseio.com/books/HaYgJZnSdeeCfXFS9ffINbJPIU13.json';

/** Fetch the old reading list; throws so a bad response never reaches a write. */
async function fetchBookList(): Promise<BookListEntry[]> {
	const response = await fetch(BOOK_LIST_URL);
	if (!response.ok) {
		throw new Error(`Book List: HTTP ${response.status}`);
	}
	const data = (await response.json()) as Record<string, BookListEntry> | null;
	if (!data || typeof data !== 'object') {
		throw new Error('Book List: no records returned');
	}
	// Stored as an object keyed by ISBN; the key is repeated in the record.
	return Object.values(data);
}

/** Google Books' minimum spacing, mirroring `server/utils/googleBooks.ts`. */
const GOOGLE_BOOKS_INTERVAL_MS = 350;
const MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET a Google Books URL, retrying rate limits and server errors with backoff.
 * Worth the retries here because the fallback isn't "try again in a minute" but
 * "permanently create this book without a provider" — a real 503 mid-run
 * (observed on the first dev pass) would otherwise cost that book its metadata.
 */
async function googleBooksGet(url: string): Promise<Response | undefined> {
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(url).catch(() => undefined);
		if (response?.ok) return response;
		const retryable =
			!response || response.status === 429 || response.status >= 500;
		if (!retryable || attempt >= MAX_RETRIES) return response;
		await sleep(GOOGLE_BOOKS_INTERVAL_MS * 2 ** attempt);
	}
}

/** Volumes matching a Google Books query, in Google's own order. */
async function searchVolumes(query: string): Promise<GoogleBooksVolume[]> {
	const key = process.env.NUXT_GOOGLE_BOOKS_API_KEY;
	const params = new URLSearchParams({ q: query, country: 'US' });
	if (key) params.set('key', key);

	const response = await googleBooksGet(
		`https://www.googleapis.com/books/v1/volumes?${params}`,
	);
	if (!response?.ok) {
		console.warn(
			`  Google Books: ${response ? `HTTP ${response.status}` : 'request failed'} for ${query}`,
		);
		return [];
	}
	const body = (await response.json()) as { items?: GoogleBooksVolume[] };
	return body.items ?? [];
}

/**
 * A fresh Item drafted from Google Books, or `undefined` when Google can't
 * resolve the book at all. Reuses the app's own `mapGoogleBooksDraft` so a
 * drafted book is shaped exactly like one added through the UI; only the
 * transport is reimplemented, because `server/utils/googleBooks.ts` reaches for
 * `useRuntimeConfig()` and so can't be imported outside Nitro.
 *
 * ISBN is tried first, then title+author. The fallback isn't just for the
 * ASIN-keyed records: Google's ISBN index is genuinely inconsistent — the lookup
 * for Inferno Squad returned a volume on one run and an empty result on the next,
 * minutes apart — so a single miss is not good evidence the book is absent. The
 * title path carries the same `titlesMatch` guard as `googleBooksByTitle`,
 * because a wrong book here is worse than no book.
 */
async function draftFromGoogleBooks(
	entry: BookListEntry,
): Promise<Item | undefined> {
	const byIsbn = await searchVolumes(`isbn:${entry.isbn}`);
	if (byIsbn[0]) return mapGoogleBooksDraft(byIsbn[0]);

	await sleep(GOOGLE_BOOKS_INTERVAL_MS);
	const bare = (value: string) => value.replace(/"/g, '');
	const author = entryAuthor(entry);
	const byTitle = await searchVolumes(
		`intitle:"${bare(entry.title)}"` +
			(author ? ` inauthor:"${bare(author)}"` : ''),
	);
	const [best] = rankGoogleBooksVolumes(byTitle, entry.title).filter((volume) =>
		titlesMatch(volume.volumeInfo?.title ?? '', entry.title),
	);
	return best ? mapGoogleBooksDraft(best) : undefined;
}

/**
 * A minimal Item built from the Book List record alone — the fallback for a book
 * Google Books can't resolve. Everything it carries was already displayed in the
 * old app, so nothing is invented; it just won't have a provider to refresh from.
 */
function draftFromEntry(entry: BookListEntry): Item {
	const item: Item = {
		id: makeManualId('book'),
		type: 'book',
		title: entry.title || '(untitled)',
		provider: 'manual',
		status: 'backlog',
		is_purchased: false,
		is_prioritized: false,
		completed_dates: [],
		completed_years: [],
		tags: [],
		// Recording the ISBN gives a re-run something exact to match on, so this
		// book is filled in rather than created a second time.
		metadata: { ...(isbn13(entry.isbn) ? { isbn: entry.isbn } : {}) },
	};
	const creator = toCreator([entryAuthor(entry)]);
	if (creator !== undefined) item.creator = creator;
	if (entry.blurb) item.description = entry.blurb;
	if (entry.thumbnail) {
		item.thumbnail = entry.thumbnail;
		item.cover = entry.thumbnail;
	}
	if (entry.release_date) item.release_date = entry.release_date;
	const pages = Number.parseInt(entry.length ?? '', 10);
	if (Number.isFinite(pages) && pages > 0) {
		item.length = pages;
		item.length_unit = 'pages';
	}
	return item;
}

/** Draft new backlog books for the entries Logbook has no counterpart for. */
async function createMissing(unmatched: BookListMatch[]): Promise<Item[]> {
	const created: Item[] = [];
	for (const { entry } of unmatched) {
		const drafted = await draftFromGoogleBooks(entry);
		const item = drafted ?? draftFromEntry(entry);
		const { item: filled } = applyRecovered(item, entry);
		created.push(filled);
		console.log(
			`  + ${filled.title} — ${drafted ? filled.id : `${filled.id} (Google Books had no match; built from Book List)`}`,
		);
		await sleep(GOOGLE_BOOKS_INTERVAL_MS);
	}
	return created;
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	// Both sources first: if either read fails the run aborts before any write.
	const entries = await fetchBookList();
	const books = await readBooks();
	console.log(
		`Book List: ${entries.length} books; Logbook: ${books.length} books`,
	);

	const matches = matchEntries(entries, books);
	const byKind = (kind: BookListMatch['kind']) =>
		matches.filter((match) => match.kind === kind);
	console.log(
		`Matched ${matches.filter((m) => m.item).length} — ` +
			`${byKind('isbn').length} by ISBN, ${byKind('title').length} by title, ` +
			`${byKind('override').length} by override`,
	);

	const ambiguous = byKind('ambiguous');
	for (const match of ambiguous) {
		console.warn(
			`  ? ${match.entry.title} — ${match.candidates?.length} candidates, skipped: ` +
				match.candidates?.map((c) => c.id).join(', '),
		);
	}

	// Fold the recovered fields onto the books that matched.
	const toWrite: Item[] = [];
	const fieldCounts = new Map<RecoveredField, number>();
	for (const match of matches) {
		if (!match.item) continue;
		const { item, changed } = applyRecovered(match.item, match.entry);
		if (changed.length === 0 || itemsEqual(match.item, item)) continue;
		toWrite.push(item);
		for (const field of changed) {
			fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
		}
	}
	console.log(
		`Updating ${toWrite.length} books: ` +
			(['is_purchased', 'is_prioritized', 'recommended_by', 'notes'] as const)
				.map((field) => `${field} ${fieldCounts.get(field) ?? 0}`)
				.join(', '),
	);

	// Drafted even on a dry run: the lookups are read-only, and resolving them is
	// the part of this migration most likely to surprise, so a preview that
	// skipped them wouldn't be worth much.
	const unmatched = byKind('none');
	console.log(`Creating ${unmatched.length} books Logbook doesn't have:`);
	const created = await createMissing(unmatched);

	if (dryRun) {
		console.log('--dry-run: no writes.');
		return;
	}
	await writeItems([...toWrite, ...created]);
	console.log(
		`Wrote ${toWrite.length} updates and ${created.length} new books.`,
	);
}

main().catch((error: unknown) => {
	console.error('Book List migration failed:', error);
	process.exit(1);
});

import 'dotenv/config';
import { itemsEqual, readBooks, writeItems } from './lib/firestore-admin';
import { preferGoogleReleaseDate } from '../shared/providers/bookFields';
import {
	rankGoogleBooksVolumes,
	type GoogleBooksVolume,
} from '../shared/providers/googleBooks';
import { titlesMatch } from '../shared/providers/helpers';
import type { Item } from '../shared/types/item';

/**
 * One-time backfill of day-level release dates for recently published books (#97).
 *
 * Books arrive from Goodreads carrying only a bare year (`"2026"`), because that's
 * all the RSS feed's `book_published` holds — so 721 of the library's 738 books
 * store a year where every movie, show, and game stores a `YYYY-MM-DD`. Google
 * Books has the exact date, and for a book published in the last three years its
 * answer is trustworthy: there has been no time for a reprint edition to exist, so
 * the edition it resolves *is* the first one. `preferGoogleReleaseDate` owns that
 * rule; this script just walks the library and applies it to what's already stored,
 * which the daily sync can't do because it never talks to Google Books.
 *
 * Safe to re-run, and worth re-running: the sync keeps adding books with bare years
 * as they're shelved, and `isReleaseDateDowngrade` keeps the dates written here
 * from being flattened back on the next sync. Books already holding a full date are
 * skipped, as are books whose Google year disagrees with the shelved year — a
 * disagreement means Google resolved a different edition, and the Goodreads year is
 * the one to keep.
 *
 * Run:      npm run backfill:book-dates
 * Preview:  npm run backfill:book-dates -- --dry-run
 *
 * Requires FIREBASE_SERVICE_ACCOUNT. NUXT_GOOGLE_BOOKS_API_KEY is optional —
 * Google Books answers unkeyed requests, just at a lower rate limit.
 */

/** Google Books' minimum spacing, mirroring `server/utils/googleBooks.ts`. */
const GOOGLE_BOOKS_INTERVAL_MS = 350;
const MAX_RETRIES = 4;

/** A bare `YYYY` — the only shape this script tries to refine. */
const YEAR_ONLY = /^\d{4}$/;

/**
 * How far back to look, matching `RECENT_YEARS` in `providers/bookFields.ts`. A
 * wider net wouldn't hurt (`preferGoogleReleaseDate` rejects anything older
 * anyway), but every extra year is a few hundred pointless Google Books calls.
 */
const RECENT_YEARS = 2;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET a Google Books URL, retrying rate limits and server errors with backoff. */
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

function withKey(params: URLSearchParams): string {
	const key = process.env.NUXT_GOOGLE_BOOKS_API_KEY;
	if (key) params.set('key', key);
	return params.toString();
}

/** The volume behind a stored `google_books_id`, or undefined if it's gone. */
async function fetchVolume(id: string): Promise<GoogleBooksVolume | undefined> {
	const params = withKey(new URLSearchParams({ country: 'US' }));
	const response = await googleBooksGet(
		`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}?${params}`,
	);
	if (!response?.ok) return undefined;
	return (await response.json()) as GoogleBooksVolume;
}

/** Volumes matching a Google Books query, in Google's own order. */
async function searchVolumes(query: string): Promise<GoogleBooksVolume[]> {
	const params = withKey(new URLSearchParams({ q: query, country: 'US' }));
	const response = await googleBooksGet(
		`https://www.googleapis.com/books/v1/volumes?${params}`,
	);
	if (!response?.ok) return [];
	const body = (await response.json()) as { items?: GoogleBooksVolume[] };
	return body.items ?? [];
}

/** Whichever creator string to search on; the array form takes its first name. */
function firstCreator(creator: Item['creator']): string {
	return (Array.isArray(creator) ? creator[0] : creator) ?? '';
}

/**
 * Google's `publishedDate` for a book, tried by the three handles the library
 * actually holds. The stored `google_books_id` is the most exact — it names the
 * edition the import already chose — but 37 books have none, and Google's ISBN
 * index is inconsistent enough (see `migrate-book-list.ts`) that a miss there
 * isn't evidence of absence. The title path carries the same `titlesMatch` guard
 * as `googleBooksByTitle`, because a date from the wrong book is worse than none.
 */
async function lookupPublishedDate(book: Item): Promise<string | undefined> {
	const metadata = book.metadata as { google_books_id?: string; isbn?: string };

	if (metadata.google_books_id) {
		const volume = await fetchVolume(metadata.google_books_id);
		const date = volume?.volumeInfo?.publishedDate;
		if (date) return date;
		await sleep(GOOGLE_BOOKS_INTERVAL_MS);
	}

	if (metadata.isbn) {
		const [match] = await searchVolumes(`isbn:${metadata.isbn}`);
		const date = match?.volumeInfo?.publishedDate;
		if (date) return date;
		await sleep(GOOGLE_BOOKS_INTERVAL_MS);
	}

	const bare = (value: string) => value.replace(/"/g, '');
	const author = firstCreator(book.creator);
	const byTitle = await searchVolumes(
		`intitle:"${bare(book.title)}"` +
			(author ? ` inauthor:"${bare(author)}"` : ''),
	);
	const [best] = rankGoogleBooksVolumes(byTitle, book.title).filter((volume) =>
		titlesMatch(volume.volumeInfo?.title ?? '', book.title),
	);
	return best?.volumeInfo?.publishedDate;
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	const books = await readBooks();
	const cutoff = new Date().getFullYear() - RECENT_YEARS;
	const candidates = books.filter(
		(book) =>
			YEAR_ONLY.test(book.release_date ?? '') &&
			Number(book.release_date) >= cutoff,
	);
	console.log(
		`${books.length} books; ${candidates.length} published ${cutoff} or later ` +
			`with a year-only date.`,
	);

	const toWrite: Item[] = [];
	let rejected = 0;
	let missing = 0;
	for (const book of candidates) {
		const stored = book.release_date as string;
		const published = await lookupPublishedDate(book);
		await sleep(GOOGLE_BOOKS_INTERVAL_MS);

		if (!published) {
			missing++;
			console.warn(`  ? ${book.title} — Google Books has no match`);
			continue;
		}
		if (!preferGoogleReleaseDate(stored, published)) {
			rejected++;
			console.log(`  - ${book.title} — kept ${stored} (Google: ${published})`);
			continue;
		}
		const updated: Item = { ...book, release_date: published };
		if (itemsEqual(book, updated)) continue;
		toWrite.push(updated);
		console.log(`  + ${book.title} — ${stored} → ${published}`);
	}

	console.log(
		`Refining ${toWrite.length} dates; kept ${rejected} (Google disagreed or ` +
			`gave only a year), ${missing} unmatched.`,
	);

	if (dryRun) {
		console.log('--dry-run: no writes.');
		return;
	}
	await writeItems(toWrite);
	console.log(`Wrote ${toWrite.length} books.`);
}

main().catch((error: unknown) => {
	console.error('Release-date backfill failed:', error);
	process.exit(1);
});

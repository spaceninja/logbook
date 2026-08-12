import {
	volumeMatchesBook,
	type GoogleBooksVolume,
} from '../../shared/providers/googleBooks';
import { preferGoogleReleaseDate } from '../../shared/providers/bookFields';
import type { BookMetadata, Item } from '../../shared/types/item';

/**
 * Node-side (non-Nitro) Google Books lookups for the sync and backfill scripts.
 * Mirrors `server/utils/googleBooks.ts` but reads the key from `process.env` (the
 * scripts source `NUXT_GOOGLE_BOOKS_API_KEY` via dotenv) and uses global `fetch`,
 * because that module reaches for `useRuntimeConfig()` and can't run outside Nitro.
 *
 * The enrichment here is deliberately narrow (#98): it stamps
 * `metadata.google_books_id` and, when `preferGoogleReleaseDate` accepts it, a
 * day-level `release_date`. Nothing else. Cover, description, and length belong to
 * the Goodreads feed and tags to Hardcover — see the precedence table in
 * `shared/providers/bookFields.ts`. The RSS feed is rich enough that Google's only
 * unique contributions are the exact date and the id itself.
 */

/** Google Books' minimum spacing, mirroring `server/utils/googleBooks.ts`. */
export const GOOGLE_BOOKS_INTERVAL_MS = 350;
const MAX_RETRIES = 4;

/**
 * How many books to resolve per run. A book Google has no match for gets nothing
 * stamped on it, so it is re-queried on every future run — the same permanent-retry
 * problem `TITLE_FALLBACK_LIMIT` solves in `scripts/lib/hardcover.ts`. The cap
 * keeps a growing pile of unmatchable placeholders ("Untitled", unannounced
 * sequels) from stretching every sync.
 */
export const LOOKUP_LIMIT = 25;

export interface GoogleBooksSyncResult {
	/** Books that gained a `google_books_id`. */
	matched: number;
	/** Books that additionally gained a day-level `release_date`. */
	dated: number;
	/** Books Google returned nothing for, or nothing that passed the match guard. */
	unmatched: number;
	/** Books left unresolved by a failed request (rate limit / outage). */
	errors: number;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET a Google Books URL, retrying rate limits and server errors with backoff.
 * Returns undefined when the request fails outright, so callers can tell "no
 * match" (an ok response with no items) from "couldn't ask".
 */
async function googleBooksGet(url: string): Promise<Response | undefined> {
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(url).catch(() => undefined);
		if (response?.ok) return response;
		const retryable =
			!response || response.status === 429 || response.status >= 500;
		if (!retryable || attempt >= MAX_RETRIES) return undefined;
		await sleep(GOOGLE_BOOKS_INTERVAL_MS * 2 ** attempt);
	}
}

function params(extra: Record<string, string>): string {
	const search = new URLSearchParams({ country: 'US', ...extra });
	const key = process.env.NUXT_GOOGLE_BOOKS_API_KEY;
	if (key) search.set('key', key);
	return search.toString();
}

/** The volume behind a known id, or undefined when it can't be fetched. */
export async function fetchVolume(
	id: string,
): Promise<GoogleBooksVolume | undefined> {
	const response = await googleBooksGet(
		`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}?${params({})}`,
	);
	if (!response) return undefined;
	return (await response.json()) as GoogleBooksVolume;
}

/** Volumes matching a query, in Google's own order; empty when nothing matches. */
export async function searchVolumes(
	query: string,
): Promise<GoogleBooksVolume[]> {
	const response = await googleBooksGet(
		`https://www.googleapis.com/books/v1/volumes?${params({ q: query })}`,
	);
	if (!response) return [];
	const body = (await response.json()) as { items?: GoogleBooksVolume[] };
	return body.items ?? [];
}

/** First author from a `creator`, for a title+author search. */
function firstAuthor(creator: Item['creator']): string | undefined {
	return Array.isArray(creator) ? creator[0] : creator;
}

/** Whether a book still needs matching against Google Books. */
function needsLookup(item: Item): boolean {
	return (
		item.type === 'book' && !(item.metadata as BookMetadata).google_books_id
	);
}

/**
 * Resolve one book to a Google Books volume, ISBN first and then title+author.
 *
 * The ISBN path identifies an edition outright, so its first hit is taken as-is.
 * The title path can't be trusted that way and goes through `volumeMatchesBook`,
 * which requires the author to corroborate. A miss on ISBN is not evidence the
 * book is absent — Google's ISBN index is genuinely inconsistent (the lookup for
 * Inferno Squad returned a volume on one run and nothing minutes later), which is
 * why the title path runs even for books that have one.
 */
export async function resolveVolume(
	item: Item,
	spacingMs: number = GOOGLE_BOOKS_INTERVAL_MS,
): Promise<GoogleBooksVolume | undefined> {
	const isbn = (item.metadata as BookMetadata).isbn;
	if (isbn) {
		const [hit] = await searchVolumes(`isbn:${isbn}`);
		if (hit) return hit;
		await sleep(spacingMs);
	}

	const bare = (value: string) => value.replace(/"/g, '');
	const author = firstAuthor(item.creator);
	const hits = await searchVolumes(
		`intitle:"${bare(item.title)}"` +
			(author ? ` inauthor:"${bare(author)}"` : ''),
	);
	return hits.find((volume) => volumeMatchesBook(volume, item));
}

/**
 * Apply a resolved volume to a book: always the id, and the release date only when
 * the shared precedence rule accepts it. Returns whether the date was taken, so
 * callers can report it. Mutates, like `applyHardcoverEnrichment`'s caller does.
 */
export function applyVolume(item: Item, volume: GoogleBooksVolume): boolean {
	item.metadata = {
		...(item.metadata as BookMetadata),
		google_books_id: volume.id,
	};
	const published = volume.volumeInfo?.publishedDate;
	const stored = item.release_date;
	if (
		stored !== undefined &&
		published !== undefined &&
		preferGoogleReleaseDate(stored, published)
	) {
		item.release_date = published;
		return true;
	}
	return false;
}

/**
 * Stamp `google_books_id` (and a better `release_date` where warranted) onto the
 * given items in place. Only books with no id are touched, so a matched book is
 * never re-queried. Best-effort throughout, mirroring `enrichBooksWithHardcover`:
 * a Google failure is counted and skipped, never thrown, so one outage can't abort
 * a sync that has already done real work.
 */
export async function enrichBooksWithGoogleBooks(
	items: Item[],
	options: { limit?: number; spacingMs?: number } = {},
): Promise<GoogleBooksSyncResult> {
	const { limit = LOOKUP_LIMIT, spacingMs = GOOGLE_BOOKS_INTERVAL_MS } =
		options;
	const targets = items.filter(needsLookup).slice(0, limit);
	const result: GoogleBooksSyncResult = {
		matched: 0,
		dated: 0,
		unmatched: 0,
		errors: 0,
	};

	for (const item of targets) {
		try {
			const volume = await resolveVolume(item, spacingMs);
			if (!volume) {
				result.unmatched++;
			} else {
				if (applyVolume(item, volume)) result.dated++;
				result.matched++;
			}
		} catch {
			result.errors++;
		}
		await sleep(spacingMs);
	}

	return result;
}

// Plain ofetch $fetch (see tmdb.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';
import {
	mapGoogleBooksDraft,
	mapGoogleBooksSearch,
	type GoogleBooksVolume,
} from '../../shared/providers/googleBooks';

const BASE = 'https://www.googleapis.com/books/v1';

// Google Books rate-limits by IP (keyed or not), and a bulk book import fires one
// or two calls per new book — a burst big enough to get the whole machine 429'd
// for a while, which then breaks unrelated lookups (Add search, Choose edition).
// Mirror the IGDB approach: serialize every call through one chain spaced by a min
// interval, retrying the occasional 429 with backoff. (#20)
const MIN_INTERVAL_MS = 350;
const MAX_RETRIES = 4;

let chain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(error: unknown): boolean {
	const status = error as { status?: number; response?: { status?: number } };
	return status?.status === 429 || status?.response?.status === 429;
}

/** Queue a call onto the Google Books chain so calls never overlap or exceed the rate. */
function schedule<T>(task: () => Promise<T>): Promise<T> {
	const result = chain.then(task, task);
	// Advance the chain after this call settles + the spacing interval, so the
	// next queued call starts no sooner than the interval regardless of outcome.
	const settle = () => sleep(MIN_INTERVAL_MS);
	chain = result.then(settle, settle);
	return result;
}

/** A rate-limited, 429-retrying GET against the Google Books API. */
function googleBooksGet<T>(
	path: string,
	params: Record<string, string | number>,
): Promise<T> {
	const { googleBooksApiKey } = useRuntimeConfig();
	return schedule(async () => {
		for (let attempt = 0; ; attempt++) {
			try {
				return await $fetch<T>(`${BASE}${path}`, {
					params: { country: 'US', key: googleBooksApiKey, ...params },
				});
			} catch (error) {
				if (attempt < MAX_RETRIES && isRateLimited(error)) {
					await sleep(MIN_INTERVAL_MS * 2 ** attempt);
					continue;
				}
				throw error;
			}
		}
	});
}

export async function googleBooksSearch(q: string) {
	const res = await googleBooksGet<{ items?: GoogleBooksVolume[] }>(
		'/volumes',
		{
			q,
			maxResults: 10,
		},
	);
	return mapGoogleBooksSearch(res.items ?? []);
}

export async function googleBooksDraft(id: string) {
	const volume = await googleBooksGet<GoogleBooksVolume>(`/volumes/${id}`, {});
	return mapGoogleBooksDraft(volume);
}

/** First volume matching a query, mapped to a draft — or null if none match. */
async function firstDraft(q: string, preferCover: boolean) {
	const res = await googleBooksGet<{ items?: GoogleBooksVolume[] }>(
		'/volumes',
		{
			q,
			maxResults: 10,
		},
	);
	const volumes = res.items ?? [];
	// Prefer a result that actually has cover art (Google Books' first hit for a
	// title often doesn't), falling back to the top result otherwise.
	const chosen =
		(preferCover && volumes.find((v) => v.volumeInfo?.imageLinks?.thumbnail)) ||
		volumes[0];
	return chosen ? mapGoogleBooksDraft(chosen) : null;
}

/** Draft for a book looked up by ISBN — the exact edition, when Goodreads has one. */
export function googleBooksByIsbn(isbn: string) {
	// The exact-edition match wins outright; no cover-preference reordering.
	return firstDraft(`isbn:${isbn}`, false);
}

/** Draft for a book looked up by title (and author) — the no-ISBN fallback. */
export function googleBooksByTitle(title: string, author?: string) {
	const q = author ? `intitle:${title} inauthor:${author}` : `intitle:${title}`;
	return firstDraft(q, true);
}

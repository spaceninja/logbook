// Plain ofetch $fetch (see tmdb.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';
import {
	mapGoogleBooksDraft,
	mapGoogleBooksSearch,
	type GoogleBooksVolume,
} from '../../shared/providers/googleBooks';
import type { Item } from '../../shared/types/item';

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

// Even when a volume advertises `imageLinks`, the content host may serve a fixed
// "no cover" placeholder rather than a real scan — a gray PNG for unknown volumes
// and the "image not available" JPEG card. These are static assets, so at our
// cover width (fife=w640) each has an exact content-type + byte length. Matching
// them exactly (never by a loose heuristic) lets us treat such books as coverless
// — honestly blank and fixable via "Choose edition" — without ever dropping a real
// cover. Sizes are for w640 (COVER_WIDTH); unknown responses keep their cover. (#20)
const PLACEHOLDER_COVERS = [
	{ type: 'image/png', bytes: 9103 }, // unknown/invalid-volume gray card
	{ type: 'image/jpeg', bytes: 38878 }, // "image not available" card (no scan)
];

/** Whether a cover URL resolves to a Google Books "no cover" placeholder (HEAD only). */
async function coverIsPlaceholder(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { method: 'HEAD' });
		const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
		const bytes = Number(res.headers.get('content-length'));
		return PLACEHOLDER_COVERS.some((p) => p.type === type && p.bytes === bytes);
	} catch {
		return false; // a HEAD hiccup shouldn't wrongly strip a cover
	}
}

/** A draft with its cover/thumbnail removed when the cover is a placeholder. */
async function withoutPlaceholderCover(item: Item): Promise<Item> {
	if (item.cover && (await coverIsPlaceholder(item.cover))) {
		const stripped = { ...item };
		delete stripped.cover;
		delete stripped.thumbnail;
		return stripped;
	}
	return item;
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
	return withoutPlaceholderCover(mapGoogleBooksDraft(volume));
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
	return chosen ? withoutPlaceholderCover(mapGoogleBooksDraft(chosen)) : null;
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

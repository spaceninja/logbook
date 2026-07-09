// Plain ofetch $fetch (see tmdb.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';
import {
	mapGoogleBooksDraft,
	mapGoogleBooksSearch,
	rankGoogleBooksVolumes,
	type GoogleBooksVolume,
} from '../../shared/providers/googleBooks';
import { titlesMatch } from '../../shared/providers/helpers';

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

/** Volumes matching a query, in Google's own order; empty when nothing matches. */
async function searchVolumes(
	q: string,
	maxResults = 10,
): Promise<GoogleBooksVolume[]> {
	const res = await googleBooksGet<{ items?: GoogleBooksVolume[] }>(
		'/volumes',
		{
			q,
			maxResults,
		},
	);
	return res.items ?? [];
}

export async function googleBooksSearch(q: string) {
	// 20 is Google's real ceiling — it silently clamps anything higher — and its
	// `totalItems` is a fabricated round number, so there's nothing to paginate on.
	const volumes = await searchVolumes(q, 20);
	return mapGoogleBooksSearch(rankGoogleBooksVolumes(volumes, q));
}

export async function googleBooksDraft(id: string) {
	const volume = await googleBooksGet<GoogleBooksVolume>(`/volumes/${id}`, {});
	return mapGoogleBooksDraft(volume);
}

/** Draft for a book looked up by ISBN — the exact edition, when Goodreads has one. */
export async function googleBooksByIsbn(isbn: string) {
	// The exact-edition match wins outright; no reordering, no title guard.
	const [volume] = await searchVolumes(`isbn:${isbn}`);
	return volume ? mapGoogleBooksDraft(volume) : null;
}

/**
 * Draft for a book looked up by title (and author) — the no-ISBN fallback.
 * `intitle:` matches tokens rather than phrases, so an unquoted lookup for
 * "Locke Lamora and the Bottled Serpent" returns the Dutch translation of "The
 * Lies of Locke Lamora". Quote the phrase first, retry unquoted only if that
 * finds nothing, and accept a candidate only when its title actually matches —
 * a wrong book is worse than no book, because the importer can fall back to the
 * export's own fields.
 */
export async function googleBooksByTitle(title: string, author?: string) {
	const bare = (s: string) => s.replace(/"/g, '');
	const wanted = bare(title);
	const byAuthor = author ? ` inauthor:"${bare(author)}"` : '';
	const loose = author ? ` inauthor:${bare(author)}` : '';

	let volumes = await searchVolumes(`intitle:"${wanted}"${byAuthor}`);
	if (volumes.length === 0) {
		volumes = await searchVolumes(`intitle:${wanted}${loose}`);
	}

	const ranked = rankGoogleBooksVolumes(volumes, wanted).filter((v) =>
		titlesMatch(v.volumeInfo?.title ?? '', wanted),
	);
	// Google's first hit for a title often has no cover art; prefer one that does.
	const chosen =
		ranked.find((v) => v.volumeInfo?.imageLinks?.thumbnail) ?? ranked[0];
	return chosen ? mapGoogleBooksDraft(chosen) : null;
}

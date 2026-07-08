// Plain ofetch $fetch (see tmdb.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';
import {
	mapGoogleBooksDraft,
	mapGoogleBooksSearch,
	type GoogleBooksVolume,
} from '../../shared/providers/googleBooks';

const BASE = 'https://www.googleapis.com/books/v1';

export async function googleBooksSearch(q: string) {
	const { googleBooksApiKey } = useRuntimeConfig();
	const res = await $fetch<{ items?: GoogleBooksVolume[] }>(`${BASE}/volumes`, {
		params: { q, country: 'US', maxResults: 10, key: googleBooksApiKey },
	});
	return mapGoogleBooksSearch(res.items ?? []);
}

export async function googleBooksDraft(id: string) {
	const { googleBooksApiKey } = useRuntimeConfig();
	const volume = await $fetch<GoogleBooksVolume>(`${BASE}/volumes/${id}`, {
		params: { country: 'US', key: googleBooksApiKey },
	});
	return mapGoogleBooksDraft(volume);
}

/** First volume matching a query, mapped to a draft — or null if none match. */
async function firstDraft(q: string, preferCover: boolean) {
	const { googleBooksApiKey } = useRuntimeConfig();
	const res = await $fetch<{ items?: GoogleBooksVolume[] }>(`${BASE}/volumes`, {
		params: { q, country: 'US', maxResults: 10, key: googleBooksApiKey },
	});
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

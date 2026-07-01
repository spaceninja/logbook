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

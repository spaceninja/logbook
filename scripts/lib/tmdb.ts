import {
	mapTmdbMovieDraft,
	mapTmdbSeasonDraft,
	type TmdbMovieDetails,
	type TmdbSeasonDetails,
	type TmdbShowDetails,
} from '../../shared/providers/tmdb';
import { createSerialQueue } from '../../shared/utils/rateLimit';

/**
 * Node-side (non-Nitro) TMDB client for the metadata sync (#106). Mirrors
 * `server/utils/tmdb.ts` but reads the token from `process.env` (the script
 * sources `NUXT_TMDB_READ_TOKEN` via dotenv) instead of `useRuntimeConfig()`,
 * and uses global `fetch` rather than ofetch. Only the two draft calls the sync
 * needs are mirrored; search and watch-provider lookups stay server-only.
 *
 * The mapping itself is not duplicated — `mapTmdbMovieDraft`/`mapTmdbSeasonDraft`
 * are the same shared functions the API routes call, so a draft built here is
 * byte-identical to one built by the edit form's "Refresh metadata" button.
 */

const BASE = 'https://api.themoviedb.org/3';

/**
 * TMDB's documented limit is ~50 req/s, which a serial script can't approach;
 * 100ms is politeness, not a ceiling — it keeps a 300-item run under a minute
 * while staying well clear of any burst heuristics.
 */
const TMDB_MIN_INTERVAL_MS = 100;

const schedule = createSerialQueue(TMDB_MIN_INTERVAL_MS);

function requireToken(): string {
	const token = process.env.NUXT_TMDB_READ_TOKEN;
	if (!token) throw new Error('NUXT_TMDB_READ_TOKEN is not set');
	return token;
}

async function tmdbFetch<T>(
	path: string,
	params?: Record<string, string>,
): Promise<T> {
	const token = requireToken();
	const url = new URL(`${BASE}${path}`);
	for (const [key, value] of Object.entries(params ?? {})) {
		url.searchParams.set(key, value);
	}
	return schedule(async () => {
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				accept: 'application/json',
			},
		});
		if (!res.ok) throw new Error(`TMDB HTTP ${res.status} for ${path}`);
		return (await res.json()) as T;
	});
}

/**
 * Show records fetched this run, keyed by show id. A season draft needs the
 * parent show as well as the season, and the library's ~78 tracked seasons span
 * far fewer shows — without this, every season of the same show re-fetches an
 * identical `/tv/{id}` record.
 */
const showCache = new Map<string, TmdbShowDetails>();

async function showDetails(showId: string): Promise<TmdbShowDetails> {
	const cached = showCache.get(showId);
	if (cached) return cached;
	const show = await tmdbFetch<TmdbShowDetails>(`/tv/${showId}`);
	showCache.set(showId, show);
	return show;
}

export async function tmdbMovieDraft(id: string) {
	const details = await tmdbFetch<TmdbMovieDetails>(`/movie/${id}`, {
		append_to_response: 'credits',
	});
	return mapTmdbMovieDraft(details);
}

export async function tmdbSeasonDraft(showId: string, season: number) {
	const show = await showDetails(showId);
	const seasonDetails = await tmdbFetch<TmdbSeasonDetails>(
		`/tv/${showId}/season/${season}`,
	);
	return mapTmdbSeasonDraft(show, seasonDetails, season);
}

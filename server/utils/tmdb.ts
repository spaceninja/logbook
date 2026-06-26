// Plain ofetch $fetch (not Nitro's global), so external URLs aren't type-matched
// against internal app routes (which recurses once /api/* routes exist).
import { $fetch } from 'ofetch';
import {
  mapTmdbMovieDraft,
  mapTmdbMovieSearch,
  mapTmdbSeasonDraft,
  mapTmdbSeasons,
  mapTmdbShowSearch,
  type TmdbMovieDetails,
  type TmdbSeasonDetails,
  type TmdbShowDetails,
} from '../../shared/providers/tmdb';

const BASE = 'https://api.themoviedb.org/3';

function tmdbFetch<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const { tmdbReadToken } = useRuntimeConfig();
  return $fetch<T>(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${tmdbReadToken}`,
      accept: 'application/json',
    },
    params,
  });
}

type MovieSearchResults = {
  results?: Parameters<typeof mapTmdbMovieSearch>[0];
};
type ShowSearchResults = { results?: Parameters<typeof mapTmdbShowSearch>[0] };

export async function tmdbSearchMovies(q: string) {
  const res = await tmdbFetch<MovieSearchResults>('/search/movie', {
    query: q,
  });
  return mapTmdbMovieSearch(res.results ?? []);
}

export async function tmdbSearchShows(q: string) {
  const res = await tmdbFetch<ShowSearchResults>('/search/tv', { query: q });
  return mapTmdbShowSearch(res.results ?? []);
}

export async function tmdbMovieDraft(id: string) {
  const details = await tmdbFetch<TmdbMovieDetails>(`/movie/${id}`, {
    append_to_response: 'credits',
  });
  return mapTmdbMovieDraft(details);
}

export async function tmdbShowSeasons(id: string) {
  const show = await tmdbFetch<TmdbShowDetails>(`/tv/${id}`);
  return mapTmdbSeasons(show);
}

export async function tmdbSeasonDraft(showId: string, season: number) {
  const show = await tmdbFetch<TmdbShowDetails>(`/tv/${showId}`);
  const seasonDetails = await tmdbFetch<TmdbSeasonDetails>(
    `/tv/${showId}/season/${season}`,
  );
  return mapTmdbSeasonDraft(show, seasonDetails, season);
}

/** A movie's collection (e.g. "Fast & Furious"), oldest first. Empty if none. */
export async function tmdbMovieSeries(movieId: string) {
  const details = await tmdbFetch<{
    belongs_to_collection?: { id: number } | null;
  }>(`/movie/${movieId}`);
  const collectionId = details.belongs_to_collection?.id;
  if (!collectionId) return [];
  const collection = await tmdbFetch<{
    parts?: Parameters<typeof mapTmdbMovieSearch>[0];
  }>(`/collection/${collectionId}`);
  return mapTmdbMovieSearch(collection.parts ?? []).sort((a, b) =>
    (a.year ?? '').localeCompare(b.year ?? ''),
  );
}

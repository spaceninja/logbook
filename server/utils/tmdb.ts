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
  // Cast away Nitro's TypedInternalResponse wrapper around the generic.
  return $fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${tmdbReadToken}`,
      accept: 'application/json',
    },
    params,
  }) as Promise<T>;
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

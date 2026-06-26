import type { Item } from '../types/item';
import type { SearchResult, SeasonSummary } from '../types/search';
import { makeMovieId, makeShowId } from '../utils/itemId';
import {
  cleanCoverUrl,
  draftDefaults,
  normalizeTags,
  toCreator,
  yearOf,
} from './helpers';

// --- Minimal shapes of the TMDB payloads we read -----------------------------

interface TmdbGenre {
  name: string;
}
interface TmdbMovieSearchItem {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
}
interface TmdbShowSearchItem {
  id: number;
  name: string;
  first_air_date?: string;
  poster_path?: string | null;
}
export interface TmdbMovieDetails {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  runtime?: number;
  vote_average?: number;
  poster_path?: string | null;
  genres?: TmdbGenre[];
  credits?: { crew?: { job: string; name: string }[] };
}
interface TmdbSeasonSummary {
  season_number: number;
  name: string;
  air_date?: string | null;
  episode_count: number;
  poster_path?: string | null;
}
export interface TmdbShowDetails {
  id: number;
  name: string;
  overview?: string;
  vote_average?: number;
  poster_path?: string | null;
  genres?: TmdbGenre[];
  created_by?: { name: string }[];
  seasons?: TmdbSeasonSummary[];
}
export interface TmdbSeasonDetails {
  air_date?: string | null;
  poster_path?: string | null;
  episodes?: { runtime?: number | null }[];
}

// --- Image helper ------------------------------------------------------------

const COVER_SIZE = 'w500';
const THUMB_SIZE = 'w185';

function tmdbImage(
  path: string | null | undefined,
  size: string,
): string | undefined {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

// --- Search ------------------------------------------------------------------

export function mapTmdbMovieSearch(
  items: TmdbMovieSearchItem[],
): SearchResult[] {
  return items.map((m) => ({
    type: 'movie',
    providerId: String(m.id),
    title: m.title,
    year: yearOf(m.release_date),
    thumbnail: tmdbImage(m.poster_path, THUMB_SIZE),
  }));
}

export function mapTmdbShowSearch(items: TmdbShowSearchItem[]): SearchResult[] {
  return items.map((s) => ({
    type: 'show',
    providerId: String(s.id),
    title: s.name,
    year: yearOf(s.first_air_date),
    thumbnail: tmdbImage(s.poster_path, THUMB_SIZE),
  }));
}

// --- Drafts ------------------------------------------------------------------

export function mapTmdbMovieDraft(d: TmdbMovieDetails): Item {
  const directors =
    d.credits?.crew?.filter((c) => c.job === 'Director').map((c) => c.name) ??
    [];
  const item: Item = {
    id: makeMovieId('tmdb', d.id),
    type: 'movie',
    title: d.title,
    provider: 'tmdb',
    ...draftDefaults(),
    tags: normalizeTags(d.genres?.map((g) => g.name) ?? []),
    metadata: {},
  };
  const creator = toCreator(directors);
  if (creator !== undefined) item.creator = creator;
  if (d.release_date) item.release_date = d.release_date;
  if (d.overview) item.description = d.overview;
  if (d.runtime && d.runtime > 0) {
    item.length = d.runtime;
    item.length_unit = 'min';
  }
  if (d.vote_average && d.vote_average > 0)
    item.community_rating = d.vote_average;
  const cover = tmdbImage(d.poster_path, COVER_SIZE);
  const thumbnail = tmdbImage(d.poster_path, THUMB_SIZE);
  if (cover) item.cover = cover;
  if (thumbnail) item.thumbnail = thumbnail;
  return item;
}

/** Seasons for the multi-select. Season 0 (Specials) is included; the UI hides it. */
export function mapTmdbSeasons(show: TmdbShowDetails): SeasonSummary[] {
  return (show.seasons ?? []).map((s) => ({
    season_number: s.season_number,
    name: s.name,
    year: yearOf(s.air_date ?? undefined),
    episode_count: s.episode_count,
  }));
}

export function mapTmdbSeasonDraft(
  show: TmdbShowDetails,
  season: TmdbSeasonDetails,
  seasonNumber: number,
): Item {
  const summary = show.seasons?.find((s) => s.season_number === seasonNumber);
  const runtimes = (season.episodes ?? [])
    .map((e) => e.runtime ?? 0)
    .filter((r) => r > 0);
  const totalRuntime = runtimes.reduce((sum, r) => sum + r, 0);
  const typicalRuntime = runtimes.length
    ? Math.round(totalRuntime / runtimes.length)
    : 0;
  const episodeCount = summary?.episode_count ?? season.episodes?.length ?? 0;

  const item: Item = {
    id: makeShowId('tmdb', show.id, seasonNumber),
    type: 'show',
    title: show.name,
    provider: 'tmdb',
    ...draftDefaults(),
    tags: normalizeTags(show.genres?.map((g) => g.name) ?? []),
    metadata: {
      show_tmdb_id: show.id,
      season_number: seasonNumber,
      episode_count: episodeCount,
      episode_runtime: typicalRuntime,
    },
  };
  const creator = toCreator(show.created_by?.map((c) => c.name) ?? []);
  if (creator !== undefined) item.creator = creator;
  const airDate = season.air_date ?? summary?.air_date ?? undefined;
  if (airDate) item.release_date = airDate;
  if (show.overview) item.description = show.overview;
  if (totalRuntime > 0) {
    item.length = totalRuntime;
    item.length_unit = 'min';
  }
  if (show.vote_average && show.vote_average > 0) {
    item.community_rating = show.vote_average;
  }
  // Season poster preferred; fall back to the show poster.
  const posterPath =
    summary?.poster_path ?? season.poster_path ?? show.poster_path;
  const cover = tmdbImage(posterPath, COVER_SIZE);
  const thumbnail = tmdbImage(posterPath, THUMB_SIZE);
  if (cover) item.cover = cover;
  if (thumbnail) item.thumbnail = thumbnail;
  return item;
}

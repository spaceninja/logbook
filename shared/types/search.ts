import type { MediaType } from './item';

/**
 * A normalized search hit, provider-agnostic. The `/api/search` route maps each
 * provider's response into these so the client never sees provider specifics.
 */
export interface SearchResult {
  type: MediaType;
  /** The provider's native id (TMDB id, IGDB id, Google Books volume id). */
  providerId: string;
  title: string;
  /** Release/air/publish year, for disambiguation. */
  year?: string;
  /** Small cover image. */
  thumbnail?: string;
  /** Creator / platform / etc., for disambiguation. */
  subtitle?: string;
  /** True when this movie/game belongs to a TMDB collection / IGDB franchise. */
  isSeries?: boolean;
  /** The collection/franchise id, when `isSeries`. */
  seriesId?: string;
}

/** A show season, for the multi-select. */
export interface SeasonSummary {
  season_number: number;
  name: string;
  year?: string;
  episode_count: number;
}

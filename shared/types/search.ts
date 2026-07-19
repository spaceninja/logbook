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

/** One streaming service a title is available on. */
export interface WatchProvider {
	/** TMDB's provider id — stable, and the only unique key we get. */
	id: number;
	name: string;
	logo?: string;
}

/**
 * Where a title can be watched in one country. Live/volatile data (TMDB
 * re-serves JustWatch, which refreshes ~daily), so it's fetched per page view
 * and never stored on the item.
 */
export interface WatchAvailability {
	/** Subscription streaming — the primary list. */
	flatrate: WatchProvider[];
	rent: WatchProvider[];
	buy: WatchProvider[];
	/**
	 * TMDB's `/watch` landing page for the title. There are no per-service deep
	 * links available, so this is the only link we can offer.
	 */
	link?: string;
}

/** A show season, for the multi-select. */
export interface SeasonSummary {
	season_number: number;
	name: string;
	year?: string;
	episode_count: number;
}

import type { Item, MediaType, Provider, ShowMetadata } from '../types/item';

/**
 * Item id helpers. The id is also the Firestore document id, so it must be
 * stable and unique per tracked thing. Formats follow the core design §3:
 *
 *   book   →  book-<provider>-<sourceId>          e.g. book-goodreads-12345
 *   movie  →  movie-<provider>-<sourceId>         e.g. movie-tmdb-27205
 *   game   →  game-<provider>-<sourceId>          e.g. game-igdb-1020
 *   show   →  show-<provider>-<showId>-s<season>  e.g. show-tmdb-95396-s1
 *
 * Shows are tracked per-season, so a show id encodes both the parent show id
 * and the season number (core design §3.4).
 */

export function makeBookId(
	provider: Provider,
	sourceId: string | number,
): string {
	return `book-${provider}-${sourceId}`;
}

export function makeMovieId(
	provider: Provider,
	sourceId: string | number,
): string {
	return `movie-${provider}-${sourceId}`;
}

export function makeGameId(
	provider: Provider,
	sourceId: string | number,
): string {
	return `game-${provider}-${sourceId}`;
}

export function makeShowId(
	provider: Provider,
	showId: string | number,
	seasonNumber: number,
): string {
	return `show-${provider}-${showId}-s${seasonNumber}`;
}

/**
 * Id for a manually-entered item, which has no provider source id. The random
 * UUID fills the source-id slot, keeping the id unique and stable across edits
 * (titles change; the id must not). Provider-sourced ids (e.g. movie-tmdb-123)
 * arrive with the future lookup flow; manual items keep this id permanently.
 */
export function makeManualId(type: MediaType): string {
	return `${type}-manual-${crypto.randomUUID()}`;
}

/**
 * The TMDB id to look a movie or show up by, or `undefined` when there isn't
 * one. Movies carry it in their id, but only when TMDB is the provider — the
 * Letterboxd-sourced stragglers have no TMDB record at all. Shows are tracked
 * per season and their id is season-scoped, so the parent show id comes from
 * metadata instead (season-level availability isn't published anyway).
 */
export function tmdbIdForItem(item: Item): string | undefined {
	if (item.type === 'show') {
		const showId = (item.metadata as ShowMetadata).show_tmdb_id;
		return showId ? String(showId) : undefined;
	}
	if (item.type !== 'movie' || item.provider !== 'tmdb') return undefined;
	return item.id.slice('movie-tmdb-'.length) || undefined;
}

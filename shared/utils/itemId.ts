import type { Provider } from '../types/item';

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

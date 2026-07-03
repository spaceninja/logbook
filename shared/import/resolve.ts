import {
	makeBookId,
	makeGameId,
	makeMovieId,
	makeShowId,
} from '../utils/itemId';
import type { ResolveHint } from './types';

/**
 * The deterministic item id for a resolve hint, or `null` when the id can't be
 * known without a network lookup (`tmdb-movie-search` — Letterboxd exports carry
 * no TMDB id, so the id only exists after a title+year search resolves it).
 *
 * Books use the Goodreads `Book Id` as the stable source id so the item id never
 * changes even though metadata is later enriched from Google Books.
 */
export function resolveDirectId(hint: ResolveHint): string | null {
	switch (hint.kind) {
		case 'tmdb-movie':
			return makeMovieId('tmdb', hint.tmdbId);
		case 'tmdb-season':
			return makeShowId('tmdb', hint.showTmdbId, hint.season);
		case 'igdb':
			return makeGameId('igdb', hint.igdbId);
		case 'goodreads-book':
			return makeBookId('goodreads', hint.bookId);
		case 'tmdb-movie-search':
			return null;
	}
}

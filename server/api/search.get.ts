import type { MediaType } from '../../shared/types/item';
import type { SearchResult } from '../../shared/types/search';
import { tmdbSearchMovies, tmdbSearchShows } from '../utils/tmdb';
import { googleBooksSearch } from '../utils/googleBooks';
import { igdbSearch } from '../utils/igdb';

/**
 * GET /api/search?type=&q= — normalized search hits from the right provider.
 * Keys live in server runtimeConfig; the client only ever sees SearchResult[].
 */
export default defineEventHandler(async (event): Promise<SearchResult[]> => {
  const { type, q } = getQuery(event);
  const query = String(q ?? '').trim();
  if (!query) return [];

  try {
    switch (type as MediaType) {
      case 'movie':
        return await tmdbSearchMovies(query);
      case 'show':
        return await tmdbSearchShows(query);
      case 'book':
        return await googleBooksSearch(query);
      case 'game':
        return await igdbSearch(query);
      default:
        throw createError({
          statusCode: 400,
          statusMessage: 'Invalid media type',
        });
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error)
      throw error;
    throw createError({
      statusCode: 502,
      statusMessage: 'Search provider failed',
    });
  }
});

import type { MediaType } from '../../shared/types/item';
import type { SearchResult } from '../../shared/types/search';
import { tmdbMovieSeries } from '../utils/tmdb';
import { igdbGameSeries } from '../utils/igdb';

/**
 * GET /api/series?type=&id= — the members of a movie's TMDB collection or a
 * game's IGDB collection, for the "Add series" multi-select. Empty when the
 * title isn't part of a discoverable series. Books/shows are not supported.
 */
export default defineEventHandler(async (event): Promise<SearchResult[]> => {
	const { type, id } = getQuery(event);
	const providerId = String(id ?? '').trim();
	if (!providerId) {
		throw createError({ statusCode: 400, statusMessage: 'Missing id' });
	}

	try {
		switch (type as MediaType) {
			case 'movie':
				return await tmdbMovieSeries(providerId);
			case 'game':
				return await igdbGameSeries(providerId);
			default:
				throw createError({
					statusCode: 400,
					statusMessage: 'Series is only supported for movies and games',
				});
		}
	} catch (error) {
		if (error && typeof error === 'object' && 'statusCode' in error)
			throw error;
		throw createError({
			statusCode: 502,
			statusMessage: 'Series provider failed',
		});
	}
});

import type { MediaType } from '../../shared/types/item';
import type { WatchAvailability } from '../../shared/types/search';
import { tmdbWatchProviders } from '../utils/tmdb';

/**
 * GET /api/watch?type=&id= — streaming/rent/buy availability for a movie or
 * show, for the detail page. Books and games have no equivalent source.
 *
 * The data is live and volatile (TMDB re-serves JustWatch, refreshed ~daily),
 * so it's fetched per page view and never written to Firestore.
 */
export default defineEventHandler(async (event): Promise<WatchAvailability> => {
	const { type, id } = getQuery(event);
	const providerId = String(id ?? '').trim();
	if (!providerId) {
		throw createError({ statusCode: 400, statusMessage: 'Missing id' });
	}

	const mediaType = type as MediaType;
	if (mediaType !== 'movie' && mediaType !== 'show') {
		throw createError({
			statusCode: 400,
			statusMessage: 'Availability is only supported for movies and shows',
		});
	}

	const { watchProviderCountry } = useRuntimeConfig();

	try {
		return await tmdbWatchProviders(
			mediaType === 'movie' ? 'movie' : 'tv',
			providerId,
			watchProviderCountry,
		);
	} catch (error) {
		if (error && typeof error === 'object' && 'statusCode' in error)
			throw error;
		throw createError({
			statusCode: 502,
			statusMessage: 'Availability provider failed',
		});
	}
});

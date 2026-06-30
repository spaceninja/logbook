import type { Item, MediaType } from '../../shared/types/item';
import { tmdbMovieDraft, tmdbSeasonDraft } from '../utils/tmdb';
import { googleBooksDraft } from '../utils/googleBooks';
import { igdbDraft } from '../utils/igdb';

/**
 * GET /api/draft?type=&id=[&season=] — a prefilled draft Item for a picked
 * result. Provider-sourced fields filled; user fields at defaults. Its `id` is
 * the provider id (e.g. movie-tmdb-27205).
 */
export default defineEventHandler(async (event): Promise<Item> => {
	const { type, id, season } = getQuery(event);
	const providerId = String(id ?? '').trim();
	if (!providerId) {
		throw createError({ statusCode: 400, statusMessage: 'Missing id' });
	}

	try {
		switch (type as MediaType) {
			case 'movie':
				return await tmdbMovieDraft(providerId);
			case 'show': {
				if (season === undefined) {
					throw createError({
						statusCode: 400,
						statusMessage: 'Missing season',
					});
				}
				return await tmdbSeasonDraft(providerId, Number(season));
			}
			case 'book':
				return await googleBooksDraft(providerId);
			case 'game':
				return await igdbDraft(providerId);
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
			statusMessage: 'Metadata provider failed',
		});
	}
});

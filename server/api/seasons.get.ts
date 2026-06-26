import type { SeasonSummary } from '../../shared/types/search';
import { tmdbShowSeasons } from '../utils/tmdb';

/**
 * GET /api/seasons?showId= — a show's seasons for the multi-select (TMDB only).
 * Season 0 / Specials is included; the UI hides it by default.
 */
export default defineEventHandler(async (event): Promise<SeasonSummary[]> => {
  const { showId } = getQuery(event);
  const id = String(showId ?? '').trim();
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing showId' });
  }

  try {
    return await tmdbShowSeasons(id);
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error)
      throw error;
    throw createError({
      statusCode: 502,
      statusMessage: 'Metadata provider failed',
    });
  }
});

import {
  mapIgdbDraft,
  mapIgdbSearch,
  type IgdbGame,
} from '../../shared/providers/igdb';
import { getIgdbToken } from './igdbToken';

const FIELDS =
  'name,first_release_date,summary,rating,cover.image_id,genres.name,themes.name,involved_companies.developer,involved_companies.company.name';

async function igdbQuery(body: string): Promise<IgdbGame[]> {
  const { twitchClientId } = useRuntimeConfig();
  const token = await getIgdbToken();
  return $fetch<IgdbGame[]>('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': twitchClientId,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body,
  });
}

export async function igdbSearch(q: string) {
  // Strip quotes to keep the APICalypse search literal well-formed.
  const safe = q.replace(/"/g, '');
  const games = await igdbQuery(
    `search "${safe}"; fields ${FIELDS}; limit 10;`,
  );
  return mapIgdbSearch(games);
}

export async function igdbDraft(id: string) {
  const games = await igdbQuery(`fields ${FIELDS}; where id = ${Number(id)};`);
  if (!games[0]) {
    throw createError({ statusCode: 404, statusMessage: 'Game not found' });
  }
  return mapIgdbDraft(games[0]);
}

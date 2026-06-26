// Plain ofetch $fetch (see tmdb.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';
import {
  mapIgdbDraft,
  mapIgdbSearch,
  type IgdbGame,
} from '../../shared/providers/igdb';
import { getIgdbToken } from './igdbToken';

const FIELDS =
  'name,first_release_date,summary,rating,cover.image_id,artworks.image_id,screenshots.image_id,genres.name,themes.name,involved_companies.developer,involved_companies.company.name';

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

/**
 * A game's series (e.g. "Halo"), main games only, oldest first. Empty if none.
 * Prefers the tighter `collections` grouping, falling back to `franchises`;
 * `game_type = 0` (IGDB's renamed `category`) keeps only main games — no DLC,
 * map packs, bundles, or editions.
 */
export async function igdbGameSeries(id: string) {
  const [game] = await igdbQuery(
    `fields collections,franchises; where id = ${Number(id)};`,
  );
  const collectionId = game?.collections?.[0];
  const franchiseId = game?.franchises?.[0];
  const field = collectionId ? 'collections' : 'franchises';
  const groupId = collectionId ?? franchiseId;
  if (!groupId) return [];
  const members = await igdbQuery(
    `fields ${FIELDS}; where ${field} = (${groupId}) & game_type = 0; sort first_release_date asc; limit 50;`,
  );
  return mapIgdbSearch(members);
}

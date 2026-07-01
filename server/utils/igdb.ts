// Plain ofetch $fetch (see tmdb.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';
import {
	mapIgdbDraft,
	mapIgdbSearch,
	pickTimeToBeat,
	rankIgdbGames,
	TIME_TO_BEAT_STATS,
	type IgdbGame,
	type IgdbTimeToBeat,
	type TimeToBeatStat,
} from '../../shared/providers/igdb';
import { getIgdbToken } from './igdbToken';

const FIELDS =
	'name,first_release_date,summary,rating,total_rating_count,cover.image_id,artworks.image_id,artworks.artwork_type,artworks.width,artworks.height,screenshots.image_id,genres.name,themes.name,involved_companies.developer,involved_companies.company.name';

async function igdbQuery<T>(endpoint: string, body: string): Promise<T[]> {
	const { twitchClientId } = useRuntimeConfig();
	const token = await getIgdbToken();
	return $fetch<T[]>(`https://api.igdb.com/v4/${endpoint}`, {
		method: 'POST',
		headers: {
			'Client-ID': twitchClientId,
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
		},
		body,
	});
}

function timeToBeatStat(): TimeToBeatStat {
	const configured = useRuntimeConfig().igdbTimeToBeatStat;
	return (TIME_TO_BEAT_STATS as readonly string[]).includes(configured)
		? (configured as TimeToBeatStat)
		: 'normally';
}

/**
 * A game's estimated completion time in seconds from IGDB's `game_time_to_beats`
 * endpoint (its HowLongToBeat-style estimate), for the configured stat — or
 * undefined when IGDB has no submissions for it, or when `completely` is an
 * out-of-scale outlier (see pickTimeToBeat). Keyed by `game_id`, which matches
 * our draft's IGDB id exactly — no fuzzy title match needed.
 */
async function igdbTimeToBeat(id: string): Promise<number | undefined> {
	const stat = timeToBeatStat();
	// `completely` also needs `normally` to sanity-check it against.
	const fields = stat === 'completely' ? 'normally,completely' : stat;
	const [record] = await igdbQuery<IgdbTimeToBeat>(
		'game_time_to_beats',
		`fields ${fields}; where game_id = ${Number(id)};`,
	);
	return pickTimeToBeat(record, stat);
}

export async function igdbSearch(q: string) {
	// Strip quotes to keep the APICalypse search literal well-formed.
	const safe = q.replace(/"/g, '');
	// Over-fetch by relevance, then re-rank by popularity and trim — IGDB ignores
	// popularity in `search` and won't let us `sort` alongside it (see igdb.ts).
	const games = await igdbQuery<IgdbGame>(
		'games',
		`search "${safe}"; fields ${FIELDS}; limit 20;`,
	);
	return mapIgdbSearch(rankIgdbGames(games, q).slice(0, 10));
}

export async function igdbDraft(id: string) {
	const [games, timeToBeatSeconds] = await Promise.all([
		igdbQuery<IgdbGame>('games', `fields ${FIELDS}; where id = ${Number(id)};`),
		igdbTimeToBeat(id),
	]);
	if (!games[0]) {
		throw createError({ statusCode: 404, statusMessage: 'Game not found' });
	}
	return mapIgdbDraft(games[0], timeToBeatSeconds);
}

/**
 * A game's series (e.g. "Halo"), main games only, oldest first. Empty if none.
 * Prefers the tighter `collections` grouping, falling back to `franchises`;
 * `game_type = 0` (IGDB's renamed `category`) keeps only main games — no DLC,
 * map packs, bundles, or editions.
 */
export async function igdbGameSeries(id: string) {
	const [game] = await igdbQuery<IgdbGame>(
		'games',
		`fields collections,franchises; where id = ${Number(id)};`,
	);
	const collectionId = game?.collections?.[0];
	const franchiseId = game?.franchises?.[0];
	const field = collectionId ? 'collections' : 'franchises';
	const groupId = collectionId ?? franchiseId;
	if (!groupId) return [];
	const members = await igdbQuery<IgdbGame>(
		'games',
		`fields ${FIELDS}; where ${field} = (${groupId}) & game_type = 0; sort first_release_date asc; limit 50;`,
	);
	return mapIgdbSearch(members);
}

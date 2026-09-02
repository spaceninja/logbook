import {
	IGDB_DRAFT_FIELDS,
	mapIgdbDraft,
	pickTimeToBeat,
	TIME_TO_BEAT_STATS,
	type IgdbGame,
	type IgdbTimeToBeat,
	type TimeToBeatStat,
} from '../../shared/providers/igdb';
import { createSerialQueue } from '../../shared/utils/rateLimit';

/**
 * Node-side (non-Nitro) IGDB client for the metadata sync (#106). Mirrors
 * `server/utils/igdb.ts` + `server/utils/igdbToken.ts` but reads credentials from
 * `process.env` (the script sources them via dotenv) instead of
 * `useRuntimeConfig()`, uses global `fetch`, and throws plain `Error`s rather than
 * Nitro's `createError`. Only `igdbDraft` is mirrored — search and series lookups
 * stay server-only.
 *
 * Unlike the server's token helper there's no expiry cache: the process is
 * short-lived, so one exchange per run is both necessary and sufficient.
 */

const ENDPOINT = 'https://api.igdb.com/v4';
const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';

// Same ceiling the server client works to: IGDB caps clients at ~4 req/s, and a
// game draft makes two calls. See `server/utils/igdb.ts`.
const IGDB_MIN_INTERVAL_MS = 280;
const IGDB_MAX_RETRIES = 4;

const schedule = createSerialQueue(IGDB_MIN_INTERVAL_MS);

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

let tokenPromise: Promise<string> | null = null;

/** The Twitch app access token, exchanged once per run. */
function getToken(): Promise<string> {
	if (!tokenPromise) {
		tokenPromise = (async () => {
			const url = new URL(TOKEN_ENDPOINT);
			url.searchParams.set('client_id', requireEnv('NUXT_TWITCH_CLIENT_ID'));
			url.searchParams.set(
				'client_secret',
				requireEnv('NUXT_TWITCH_CLIENT_SECRET'),
			);
			url.searchParams.set('grant_type', 'client_credentials');
			const res = await fetch(url, { method: 'POST' });
			if (!res.ok) throw new Error(`Twitch token HTTP ${res.status}`);
			const json = (await res.json()) as { access_token: string };
			return json.access_token;
		})();
		// A failed exchange must not poison every later call with the same rejection.
		tokenPromise.catch(() => {
			tokenPromise = null;
		});
	}
	return tokenPromise;
}

async function igdbRequest<T>(endpoint: string, body: string): Promise<T[]> {
	const token = await getToken();
	const res = await fetch(`${ENDPOINT}/${endpoint}`, {
		method: 'POST',
		headers: {
			'Client-ID': requireEnv('NUXT_TWITCH_CLIENT_ID'),
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
		},
		body,
	});
	if (!res.ok) {
		const error = new Error(`IGDB HTTP ${res.status}`) as Error & {
			status: number;
		};
		error.status = res.status;
		throw error;
	}
	return (await res.json()) as T[];
}

/** Queue a call so calls never overlap or exceed the rate, retrying 429s. */
async function igdbQuery<T>(endpoint: string, body: string): Promise<T[]> {
	return schedule(async () => {
		for (let attempt = 0; ; attempt++) {
			try {
				return await igdbRequest<T>(endpoint, body);
			} catch (error) {
				const status = (error as { status?: number }).status;
				if (attempt < IGDB_MAX_RETRIES && status === 429) {
					await sleep(IGDB_MIN_INTERVAL_MS * 2 ** attempt);
					continue;
				}
				throw error;
			}
		}
	});
}

function timeToBeatStat(): TimeToBeatStat {
	const configured = process.env.NUXT_IGDB_TIME_TO_BEAT_STAT ?? '';
	return (TIME_TO_BEAT_STATS as readonly string[]).includes(configured)
		? (configured as TimeToBeatStat)
		: 'normally';
}

/**
 * A game's estimated completion time in seconds for the configured stat, or
 * undefined when IGDB has no submissions. Best-effort: length is optional
 * metadata and must never fail a draft.
 */
async function igdbTimeToBeat(id: string): Promise<number | undefined> {
	const stat = timeToBeatStat();
	// `completely` also needs `normally` to sanity-check it against.
	const fields = stat === 'completely' ? 'normally,completely' : stat;
	try {
		const [record] = await igdbQuery<IgdbTimeToBeat>(
			'game_time_to_beats',
			`fields ${fields}; where game_id = ${Number(id)};`,
		);
		return pickTimeToBeat(record, stat);
	} catch {
		return undefined;
	}
}

export async function igdbDraft(id: string) {
	const [games, timeToBeatSeconds] = await Promise.all([
		igdbQuery<IgdbGame>(
			'games',
			`fields ${IGDB_DRAFT_FIELDS}; where id = ${Number(id)};`,
		),
		igdbTimeToBeat(id),
	]);
	if (!games[0]) throw new Error(`IGDB game ${id} not found`);
	return mapIgdbDraft(games[0], timeToBeatSeconds);
}

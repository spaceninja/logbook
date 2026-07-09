import type { Item } from '../types/item';
import type { SearchResult } from '../types/search';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';
import { makeGameId } from '../utils/itemId';
import {
	draftDefaults,
	normalizeTags,
	round2,
	titleTier,
	toCreator,
	unixSecondsToIsoDate,
} from './helpers';

interface IgdbNamed {
	name: string;
}
export interface IgdbArtwork {
	image_id?: string;
	// IGDB's artwork_type id (see artwork_types endpoint); used to prefer "key art"
	// over bare logos, covers, concept art, etc. when choosing a backdrop.
	artwork_type?: number;
	width?: number;
	height?: number;
}
export interface IgdbGame {
	id: number;
	name: string;
	first_release_date?: number; // unix seconds
	summary?: string;
	rating?: number; // 0–100
	total_rating_count?: number; // # of critic + user ratings — a popularity proxy
	cover?: { image_id?: string };
	artworks?: IgdbArtwork[];
	screenshots?: { image_id?: string }[];
	genres?: IgdbNamed[];
	themes?: IgdbNamed[];
	involved_companies?: { developer?: boolean; company?: { name?: string } }[];
	// The game's "series" groupings (for Add-series). Plural arrays in IGDB v4.
	collections?: number[];
	franchises?: number[];
}

// Portrait cover sizes (retina): big = 528×748, small = 180×256. Avoid t_thumb,
// which is a 90×90 square crop.
const COVER_SIZE = 't_cover_big_2x';
const THUMB_SIZE = 't_cover_small_2x';
// Landscape art for the backdrop (16:9).
const BACKDROP_SIZE = 't_1080p_2x';

function igdbImage(
	imageId: string | undefined,
	size: string,
): string | undefined {
	return imageId
		? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`
		: undefined;
}

// IGDB `artwork_type` ids for promotional "key art" — the clean hero art shown in
// the site's Key Art section — in preference order: without a title logo, then
// with one. All other types (bare game logos, covers, concept art, generic
// artwork) make poor backdrops and are skipped in favor of a screenshot.
const KEY_ART_TYPES = [2, 3] as const; // 2 = key art w/o logo, 3 = key art w/ logo

/**
 * Choose the image_id for a game's backdrop. Prefers key art (without-logo before
 * with-logo, then largest resolution), falling back to the first screenshot, then
 * nothing. Aspect ratio is intentionally ignored: a title/logo overlay is worse on
 * a backdrop than an odd crop, and this mirrors what IGDB's own site displays.
 */
export function pickBackdropId(
	artworks: IgdbArtwork[] | undefined,
	screenshots: { image_id?: string }[] | undefined,
): string | undefined {
	const rank = (type: number | undefined) =>
		(KEY_ART_TYPES as readonly number[]).indexOf(type ?? -1);
	const area = (a: IgdbArtwork) => (a.width ?? 0) * (a.height ?? 0);
	const keyArt = (artworks ?? [])
		.filter((a) => a.image_id && rank(a.artwork_type) !== -1)
		.sort(
			(a, b) =>
				rank(a.artwork_type) - rank(b.artwork_type) || area(b) - area(a),
		);
	return keyArt[0]?.image_id ?? screenshots?.find((s) => s.image_id)?.image_id;
}

function developers(game: IgdbGame): string[] {
	return (game.involved_companies ?? [])
		.filter((c) => c.developer && c.company?.name)
		.map((c) => c.company!.name!);
}

/**
 * Re-rank IGDB search hits. IGDB's `search` orders purely by text match and
 * ignores popularity, and APICalypse forbids combining `search` with `sort`, so
 * we re-rank in code (core design §15): by name-match tier first, then by
 * popularity (`total_rating_count`) as a tiebreaker — e.g. surfacing the 2020
 * "Hades" over the obscure 1995 game. IGDB's original order is the final
 * tiebreaker (stable).
 */
export function rankIgdbGames(games: IgdbGame[], query: string): IgdbGame[] {
	return games
		.map((game, index) => ({ game, index }))
		.sort((a, b) => {
			const tier =
				titleTier(a.game.name, query) - titleTier(b.game.name, query);
			if (tier !== 0) return tier;
			const pop =
				(b.game.total_rating_count ?? 0) - (a.game.total_rating_count ?? 0);
			if (pop !== 0) return pop;
			return a.index - b.index;
		})
		.map((entry) => entry.game);
}

export function mapIgdbSearch(games: IgdbGame[]): SearchResult[] {
	return games.map((g) => ({
		type: 'game',
		providerId: String(g.id),
		title: g.name,
		year: unixSecondsToIsoDate(g.first_release_date)?.slice(0, 4),
		thumbnail: igdbImage(g.cover?.image_id, THUMB_SIZE),
		subtitle: developers(g).join(', ') || undefined,
	}));
}

// IGDB's three time-to-beat stats, all in seconds. Which one pre-fills a game's
// length is configurable (see nuxt.config.ts); default/fallback is `normally`.
export const TIME_TO_BEAT_STATS = [
	'hastily',
	'normally',
	'completely',
] as const;
export type TimeToBeatStat = (typeof TIME_TO_BEAT_STATS)[number];

export type IgdbTimeToBeat = Partial<Record<TimeToBeatStat, number>>;

// `completely` occasionally carries a garbage outlier — a stray submission from
// someone who left the game idling — that dwarfs the real figure (e.g. Baldur's
// Gate III comes back at 6141h). Discard it when it exceeds this multiple of
// `normally`; a wildly out-of-scale value is no more useful than a blank one.
// `hastily`/`normally` don't show this, so only `completely` is guarded.
const COMPLETELY_MAX_NORMALLY_RATIO = 3;

/**
 * Pick the configured time-to-beat stat (seconds) from an IGDB record, or
 * undefined when it's absent. Guards `completely` against outliers: if it's more
 * than 3× `normally`, treat it as unusable and return undefined. When `normally`
 * is itself absent there's nothing to compare against, so the value stands.
 */
export function pickTimeToBeat(
	record: IgdbTimeToBeat | undefined,
	stat: TimeToBeatStat,
): number | undefined {
	const value = record?.[stat];
	if (value === undefined) return undefined;
	if (
		stat === 'completely' &&
		record?.normally !== undefined &&
		value > record.normally * COMPLETELY_MAX_NORMALLY_RATIO
	) {
		return undefined;
	}
	return value;
}

export function mapIgdbDraft(game: IgdbGame, timeToBeatSeconds?: number): Item {
	const item: Item = {
		id: makeGameId('igdb', game.id),
		type: 'game',
		title: game.name,
		provider: 'igdb',
		...draftDefaults(),
		tags: normalizeTags([
			...(game.genres?.map((g) => g.name) ?? []),
			...(game.themes?.map((t) => t.name) ?? []),
		]),
		metadata: {}, // platform is which platform *you* played — user-set
	};
	const creator = toCreator(developers(game));
	if (creator !== undefined) item.creator = creator;
	const releaseDate = unixSecondsToIsoDate(game.first_release_date);
	if (releaseDate) item.release_date = releaseDate;
	if (game.summary) item.description = htmlToMarkdown(game.summary);
	// IGDB rating is 0–100; normalize to 0–10.
	if (game.rating && game.rating > 0) {
		item.community_rating = round2(game.rating / 10);
	}
	const cover = igdbImage(game.cover?.image_id, COVER_SIZE);
	const thumbnail = igdbImage(game.cover?.image_id, THUMB_SIZE);
	const backdrop = igdbImage(
		pickBackdropId(game.artworks, game.screenshots),
		BACKDROP_SIZE,
	);
	if (cover) item.cover = cover;
	if (thumbnail) item.thumbnail = thumbnail;
	if (backdrop) item.backdrop = backdrop;
	// IGDB's time-to-beat estimate is in seconds; round to whole hours. Often
	// absent (thin coverage) — leave length blank when so.
	if (timeToBeatSeconds && timeToBeatSeconds > 0) {
		item.length = Math.round(timeToBeatSeconds / 3600);
		item.length_unit = 'hours';
	}
	return item;
}

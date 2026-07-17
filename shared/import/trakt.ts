import { draftDefaults } from '../providers/helpers';
import type { Item } from '../types/item';
import { makeMovieId, makeShowId } from '../utils/itemId';
import { ratingAuthorityFor } from './merge';
import type { EpisodeWatch } from './rollup';
import type { ImportFileMap, ImportRecord, ParseResult } from './types';

/**
 * Parser for Trakt exports (shows + movies). A zip of JSON files, of which
 * these matter (large files are split and numbered, e.g. `watched-movies-3`):
 *
 * - `watched-movies-*.json`  — movie history: one entry per film, with its
 *                              latest watch date (Plex-scrobbled, so real).
 * - `watched-shows-*.json`   — show history. Older exports carry the full
 *                              `seasons[].episodes[]` with per-episode watch
 *                              dates; newer ones dropped that block, leaving
 *                              only show-level data — so episode watches are
 *                              *also* gathered from the history log below, and
 *                              either source alone suffices.
 * - `watched-history-*.json` — the raw play log, one row per scrobble. The
 *                              per-episode source for new-format exports, and
 *                              per-play movie dates for both.
 * - `ratings-movies-*.json`, `ratings-seasons-*.json`, `ratings-shows*.json`
 *                            — 1–10 ratings, used as-is (already our scale). A
 *                              season prefers its own rating, then the show's.
 * - `lists-watchlist.json`   — the backlog: movie, season, and show entries (a
 *                              whole-show entry maps to season 1, the app's
 *                              convention for "start watching this").
 * - `notes-*.json`           — the owner's own notes, kept as item notes.
 *
 * Season records carry their raw episode watches; the pipeline rolls those up
 * into complete / review / in-progress once TMDB's episode count is known.
 * Every entry carries provider ids, so records resolve directly to
 * `movie-tmdb-<id>` / `show-tmdb-<id>-s<n>` — no fuzzy matching. Ratings are
 * fill-only for movies (Letterboxd is canonical there) and authoritative for
 * shows, per the merge policy. Season 0 (specials) is skipped by design.
 * (issue #20)
 */

/** The id block every Trakt entity carries; only the TMDB id matters here. */
interface TraktIds {
	tmdb?: number | null;
}

interface TraktMovie {
	title?: string;
	year?: number;
	ids?: TraktIds;
}

interface TraktShow {
	title?: string;
	year?: number;
	ids?: TraktIds;
}

interface WatchedMovieEntry {
	last_watched_at?: string;
	last_updated_at?: string;
	movie?: TraktMovie;
}

interface WatchedShowEntry {
	last_updated_at?: string;
	show?: TraktShow;
	/** Old-format exports only; newer ones carry show-level data alone. */
	seasons?: {
		number?: number;
		episodes?: { number?: number; last_watched_at?: string }[];
	}[];
}

/** One play from the raw history log (`watched-history-*.json`). */
interface HistoryEntry {
	watched_at?: string;
	type?: string;
	episode?: { number?: number; season?: number };
	movie?: TraktMovie;
	show?: TraktShow;
}

interface RatingEntry {
	rating?: number;
	movie?: TraktMovie;
	show?: TraktShow;
	season?: { number?: number };
}

interface WatchlistEntry {
	type?: string;
	listed_at?: string;
	notes?: string | null;
	movie?: TraktMovie;
	show?: TraktShow;
	season?: { number?: number };
}

interface NoteEntry {
	movie?: TraktMovie;
	show?: TraktShow;
	season?: { number?: number };
	note?: { notes?: string };
}

/**
 * The combined rows of a possibly-split export file: `watched-movies` matches
 * `watched-movies.json` and every `watched-movies-<n>.json`. Only top-level
 * files count, and non-JSON text under a matching name is just not this file.
 */
function jsonRows<T>(files: ImportFileMap, base: string): T[] {
	const pattern = new RegExp(`^${base}(-\\d+)?\\.json$`, 'i');
	const rows: T[] = [];
	for (const [path, text] of files) {
		if (path.includes('/') || !pattern.test(path)) continue;
		try {
			const parsed: unknown = JSON.parse(text);
			if (Array.isArray(parsed)) rows.push(...(parsed as T[]));
		} catch {
			// Not JSON: not this export's file.
		}
	}
	return rows;
}

/** The TMDB id as a string, or undefined when the entry doesn't carry one. */
function tmdbIdOf(entity: { ids?: TraktIds } | undefined): string | undefined {
	const id = entity?.ids?.tmdb;
	return typeof id === 'number' ? String(id) : undefined;
}

function isoDay(value: string | undefined): string | undefined {
	const day = (value ?? '').trim().slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

function yearOf(value: number | undefined): string | undefined {
	return typeof value === 'number' ? String(value) : undefined;
}

/** A Trakt rating, already on the 0–10 scale; anything unusable is dropped. */
function ratingOf(value: number | undefined): number | undefined {
	return typeof value === 'number' && value > 0 ? value : undefined;
}

/** The join key for a season across files: show TMDB id + season number. */
function seasonKey(showTmdbId: string, season: number): string {
	return `${showTmdbId}-s${season}`;
}

/** Ratings and notes gathered from their own files, keyed by TMDB id / season key. */
interface TraktIndex {
	movieRatings: Map<string, number>;
	seasonRatings: Map<string, number>;
	showRatings: Map<string, number>;
	movieNotes: Map<string, string>;
	seasonNotes: Map<string, string>;
	showNotes: Map<string, string>;
}

function addNote(notes: Map<string, string>, key: string, text: string): void {
	const existing = notes.get(key);
	notes.set(key, existing ? `${existing}\n\n${text}` : text);
}

function buildIndex(files: ImportFileMap): TraktIndex {
	const index: TraktIndex = {
		movieRatings: new Map(),
		seasonRatings: new Map(),
		showRatings: new Map(),
		movieNotes: new Map(),
		seasonNotes: new Map(),
		showNotes: new Map(),
	};

	for (const row of jsonRows<RatingEntry>(files, 'ratings-movies')) {
		const id = tmdbIdOf(row.movie);
		const rating = ratingOf(row.rating);
		if (id && rating !== undefined) index.movieRatings.set(id, rating);
	}
	for (const row of jsonRows<RatingEntry>(files, 'ratings-seasons')) {
		const id = tmdbIdOf(row.show);
		const season = row.season?.number;
		const rating = ratingOf(row.rating);
		if (id && typeof season === 'number' && season > 0 && rating !== undefined)
			index.seasonRatings.set(seasonKey(id, season), rating);
	}
	for (const row of jsonRows<RatingEntry>(files, 'ratings-shows')) {
		const id = tmdbIdOf(row.show);
		const rating = ratingOf(row.rating);
		if (id && rating !== undefined) index.showRatings.set(id, rating);
	}

	for (const row of jsonRows<NoteEntry>(files, 'notes-movies')) {
		const id = tmdbIdOf(row.movie);
		const text = (row.note?.notes ?? '').trim();
		if (id && text) addNote(index.movieNotes, id, text);
	}
	for (const row of jsonRows<NoteEntry>(files, 'notes-seasons')) {
		const id = tmdbIdOf(row.show);
		const season = row.season?.number;
		const text = (row.note?.notes ?? '').trim();
		if (id && typeof season === 'number' && text)
			addNote(index.seasonNotes, seasonKey(id, season), text);
	}
	for (const row of jsonRows<NoteEntry>(files, 'notes-shows')) {
		const id = tmdbIdOf(row.show);
		const text = (row.note?.notes ?? '').trim();
		if (id && text) addNote(index.showNotes, id, text);
	}

	return index;
}

/**
 * A base item from the export's own fields, for when TMDB can't supply a draft
 * even though the entry names a TMDB id — chiefly a watchlisted *future*
 * season TMDB doesn't list yet (announced but unaired), which 404s. It carries
 * the same deterministic id the enriched draft would, so once TMDB lists it a
 * re-import updates the item in place; until then it has no cover or
 * description and the importer flags it for the owner.
 */
function movieFallback(movie: TraktMovie, tmdbId: string): Item {
	const item: Item = {
		id: makeMovieId('tmdb', tmdbId),
		type: 'movie',
		title: (movie.title ?? '').trim() || '(untitled)',
		provider: 'tmdb',
		...draftDefaults(),
		metadata: {},
	};
	if (movie.year) item.release_date = String(movie.year);
	return item;
}

function seasonFallback(
	show: TraktShow,
	showTmdbId: string,
	season: number,
): Item {
	return {
		id: makeShowId('tmdb', showTmdbId, season),
		type: 'show',
		title: (show.title ?? '').trim() || '(untitled)',
		provider: 'tmdb',
		...draftDefaults(),
		// A zero episode count routes any episode rollup to review, which is
		// right: we know nothing about a season TMDB doesn't list.
		metadata: {
			show_tmdb_id: Number(showTmdbId),
			season_number: season,
			episode_count: 0,
			episode_runtime: 0,
		},
	};
}

/** A movie record; rating fill-only, since Letterboxd is canonical for movies. */
function movieRecord(
	movie: TraktMovie,
	tmdbId: string,
	index: TraktIndex,
): Omit<ImportRecord, 'section' | 'status' | 'completedDates'> {
	const rating = index.movieRatings.get(tmdbId);
	const notes = index.movieNotes.get(tmdbId);
	return {
		source: 'trakt',
		type: 'movie',
		resolve: { kind: 'tmdb-movie', tmdbId },
		ratingAuthority: ratingAuthorityFor('trakt', 'movie'),
		title: (movie.title ?? '').trim(),
		year: yearOf(movie.year),
		...(rating !== undefined ? { myRating: rating } : {}),
		...(notes ? { notes } : {}),
		fallbackDraft: movieFallback(movie, tmdbId),
	};
}

/**
 * A season record for a show. The season's own rating wins; a show-level
 * rating fills seasons that were never rated individually. A show-level note
 * lands on season 1 (the same season a whole-show watchlist entry maps to).
 */
function seasonRecord(
	show: TraktShow,
	showTmdbId: string,
	season: number,
	index: TraktIndex,
): Omit<ImportRecord, 'section' | 'status' | 'completedDates'> {
	const rating =
		index.seasonRatings.get(seasonKey(showTmdbId, season)) ??
		index.showRatings.get(showTmdbId);
	const notes =
		index.seasonNotes.get(seasonKey(showTmdbId, season)) ??
		(season === 1 ? index.showNotes.get(showTmdbId) : undefined);
	return {
		source: 'trakt',
		type: 'show',
		resolve: { kind: 'tmdb-season', showTmdbId, season },
		ratingAuthority: ratingAuthorityFor('trakt', 'show'),
		title: (show.title ?? '').trim(),
		year: yearOf(show.year),
		...(rating !== undefined ? { myRating: rating } : {}),
		...(notes ? { notes } : {}),
		fallbackDraft: seasonFallback(show, showTmdbId, season),
	};
}

/** Watch data for one film, merged from `watched-movies` and the history log. */
interface MovieWatches {
	movie: TraktMovie;
	/** Every known watch datetime; the merge dedupes them by day. */
	dates: string[];
	updatedDate?: string;
}

/** Watch data for one season, merged from `watched-shows` and the history log. */
interface SeasonWatches {
	show: TraktShow;
	season: number;
	/** Episode number → latest ISO watch datetime. */
	episodes: Map<number, string>;
	updatedDate?: string;
}

/**
 * Every watch the export records, from whichever files carry them: old-format
 * `watched-shows` season blocks, the raw history log, and `watched-movies` —
 * unioned, so both export vintages (and partial uploads) parse alike.
 */
function collectWatches(
	files: ImportFileMap,
	skip: (title: string | undefined) => void,
): { movies: Map<string, MovieWatches>; seasons: Map<string, SeasonWatches> } {
	const movies = new Map<string, MovieWatches>();
	const seasons = new Map<string, SeasonWatches>();

	const movieOf = (movie: TraktMovie): MovieWatches | undefined => {
		const id = tmdbIdOf(movie);
		if (!id) {
			skip(movie.title);
			return undefined;
		}
		let watches = movies.get(id);
		if (!watches) {
			watches = { movie, dates: [] };
			movies.set(id, watches);
		}
		return watches;
	};

	const addEpisode = (
		show: TraktShow,
		season: number | undefined,
		episode: number | undefined,
		watchedAt: string | undefined,
	): SeasonWatches | undefined => {
		const id = tmdbIdOf(show);
		if (!id) {
			skip(show.title);
			return undefined;
		}
		if (typeof season !== 'number' || season <= 0) return undefined; // specials
		const key = seasonKey(id, season);
		let watches = seasons.get(key);
		if (!watches) {
			watches = { show, season, episodes: new Map() };
			seasons.set(key, watches);
		}
		if (typeof episode !== 'number' || !watchedAt) return watches;
		// Keep each episode's latest watch (ISO strings order lexically).
		const existing = watches.episodes.get(episode);
		if (!existing || watchedAt > existing)
			watches.episodes.set(episode, watchedAt);
		return watches;
	};

	for (const entry of jsonRows<WatchedMovieEntry>(files, 'watched-movies')) {
		const watches = movieOf(entry.movie ?? {});
		if (!watches) continue;
		if (entry.last_watched_at) watches.dates.push(entry.last_watched_at);
		watches.updatedDate ??= isoDay(entry.last_updated_at);
	}

	for (const entry of jsonRows<WatchedShowEntry>(files, 'watched-shows')) {
		const show = entry.show ?? {};
		for (const season of entry.seasons ?? []) {
			for (const episode of season.episodes ?? []) {
				const watches = addEpisode(
					show,
					season.number,
					episode.number,
					episode.last_watched_at,
				);
				if (watches) watches.updatedDate ??= isoDay(entry.last_updated_at);
			}
		}
	}

	for (const row of jsonRows<HistoryEntry>(files, 'watched-history')) {
		if (row.type === 'movie' && row.movie) {
			const watches = movieOf(row.movie);
			if (watches && row.watched_at) watches.dates.push(row.watched_at);
		} else if (row.type === 'episode' && row.show && row.episode) {
			addEpisode(
				row.show,
				row.episode.season,
				row.episode.number,
				row.watched_at,
			);
		}
	}

	return { movies, seasons };
}

export function parseTrakt(files: ImportFileMap): ParseResult {
	const index = buildIndex(files);
	const records: ImportRecord[] = [];
	// One skip line per title — a no-id show would otherwise repeat for every
	// play the history log holds.
	const skippedTitles = new Set<string>();
	const skip = (title: string | undefined) => skippedTitles.add(title ?? '');

	const { movies, seasons } = collectWatches(files, skip);

	// --- Movie history: one completion per film, carrying every play date the
	// export knows (the history log has per-play dates; `watched-movies` only
	// the latest). The merge dedupes them by day.
	for (const [tmdbId, watches] of movies) {
		records.push({
			...movieRecord(watches.movie, tmdbId, index),
			section: 'history',
			status: 'complete',
			completedDates: watches.dates,
			updatedDate: watches.updatedDate,
		});
	}

	// --- Show history: one record per watched season, carrying the raw episode
	// watches. Status here is provisional — the pipeline rolls the episodes up
	// into complete / review / in-progress once TMDB's episode count is known.
	for (const watches of seasons.values()) {
		if (watches.episodes.size === 0) continue;
		const showTmdbId = tmdbIdOf(watches.show)!; // collector requires it
		const seasonEpisodes: EpisodeWatch[] = [...watches.episodes].map(
			([number, watchedAt]) => ({ number, watchedAt }),
		);
		records.push({
			...seasonRecord(watches.show, showTmdbId, watches.season, index),
			section: 'history',
			status: 'in_progress',
			completedDates: [],
			seasonEpisodes,
			updatedDate: watches.updatedDate,
		});
	}

	// --- Backlog: watchlist entries. A whole-show entry means "start watching
	// this," which in a per-season library is its first season.
	for (const entry of jsonRows<WatchlistEntry>(files, 'lists-watchlist')) {
		const note = (entry.notes ?? '').trim();
		const base = {
			section: 'backlog' as const,
			status: 'backlog' as const,
			completedDates: [],
			addedDate: isoDay(entry.listed_at),
		};

		if (entry.type === 'movie') {
			const movie = entry.movie ?? {};
			const tmdbId = tmdbIdOf(movie);
			if (!tmdbId) {
				skip(movie.title);
				continue;
			}
			const record = { ...movieRecord(movie, tmdbId, index), ...base };
			if (note && !record.notes) record.notes = note;
			records.push(record);
			continue;
		}

		if (entry.type !== 'season' && entry.type !== 'show') continue;
		const show = entry.show ?? {};
		const showTmdbId = tmdbIdOf(show);
		if (!showTmdbId) {
			skip(show.title);
			continue;
		}
		const season = entry.type === 'season' ? entry.season?.number : 1;
		if (typeof season !== 'number' || season <= 0) continue; // specials
		const record = {
			...seasonRecord(show, showTmdbId, season, index),
			...base,
		};
		if (note && !record.notes) record.notes = note;
		records.push(record);
	}

	return {
		records,
		skipped: [...skippedTitles].map((title) => ({
			title,
			reason: 'No TMDB id',
		})),
	};
}

import { describe, expect, it } from 'vitest';
import { parseTrakt } from './trakt';
import type { ImportFileMap } from './types';

/** An `ImportFileMap` of `name → JSON`, as `collectFiles` would deliver a zip. */
function exportFiles(entries: Record<string, unknown>): ImportFileMap {
	return new Map(
		Object.entries(entries).map(([name, rows]) => [name, JSON.stringify(rows)]),
	);
}

const OFFICE_SPACE = {
	title: 'Office Space',
	year: 1999,
	ids: { trakt: 1002, slug: 'office-space-1999', tmdb: 1542 },
};

const SEVERANCE = {
	title: 'Severance',
	year: 2022,
	ids: { trakt: 174430, slug: 'severance', tmdb: 95396 },
};

/** `n` episodes watched on consecutive days from `startDay`. */
function episodes(n: number, startDay = '2024-03-01') {
	const start = Date.parse(`${startDay}T20:00:00.000Z`);
	return Array.from({ length: n }, (_, i) => ({
		number: i + 1,
		plays: 1,
		last_watched_at: new Date(start + i * 86_400_000).toISOString(),
	}));
}

describe('parseTrakt — movie history', () => {
	it('maps a watched movie to a dated completion with a fill-only rating', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-movies-1.json': [
					{
						last_watched_at: '2026-07-01T07:13:00.000Z',
						last_updated_at: '2026-07-01T18:32:25.000Z',
						plays: 1,
						movie: OFFICE_SPACE,
					},
				],
				'ratings-movies-1.json': [{ rating: 9, movie: OFFICE_SPACE }],
			}),
		);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			source: 'trakt',
			section: 'history',
			type: 'movie',
			status: 'complete',
			resolve: { kind: 'tmdb-movie', tmdbId: '1542' },
			completedDates: ['2026-07-01T07:13:00.000Z'],
			updatedDate: '2026-07-01',
			myRating: 9, // Trakt is already 0–10
			ratingAuthority: 'fill', // Letterboxd is canonical for movies
			title: 'Office Space',
			year: '1999',
		});
	});

	it('joins split numbered files', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-movies-1.json': [
					{ last_watched_at: '2024-01-01T00:00:00Z', movie: OFFICE_SPACE },
				],
				'watched-movies-2.json': [
					{
						last_watched_at: '2024-01-02T00:00:00Z',
						movie: { title: 'Brazil', year: 1985, ids: { tmdb: 68 } },
					},
				],
			}),
		);
		expect(records).toHaveLength(2);
	});

	it('skips a movie without a TMDB id', () => {
		const { records, skipped } = parseTrakt(
			exportFiles({
				'watched-movies-1.json': [
					{
						last_watched_at: '2024-01-01T00:00:00Z',
						movie: { title: 'Obscure Short', ids: { trakt: 9 } },
					},
				],
			}),
		);
		expect(records).toHaveLength(0);
		expect(skipped).toEqual([{ title: 'Obscure Short', reason: 'No TMDB id' }]);
	});
});

describe('parseTrakt — show history', () => {
	it('emits one provisional record per watched season, carrying episode watches', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-shows-1.json': [
					{
						last_updated_at: '2024-04-01T00:00:00Z',
						show: SEVERANCE,
						seasons: [
							{ number: 1, episodes: episodes(9) },
							{ number: 2, episodes: episodes(3, '2025-01-17') },
						],
					},
				],
			}),
		);
		expect(records).toHaveLength(2);
		expect(records[0]).toMatchObject({
			source: 'trakt',
			section: 'history',
			type: 'show',
			status: 'in_progress', // provisional until the pipeline's rollup
			resolve: { kind: 'tmdb-season', showTmdbId: '95396', season: 1 },
			completedDates: [],
			title: 'Severance',
			ratingAuthority: 'overwrite',
		});
		expect(records[0]!.seasonEpisodes).toHaveLength(9);
		expect(records[0]!.seasonEpisodes![0]).toEqual({
			number: 1,
			watchedAt: '2024-03-01T20:00:00.000Z',
		});
		expect(records[1]!.resolve).toMatchObject({ season: 2 });
	});

	it('skips season 0 (specials) and empty seasons', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-shows-1.json': [
					{
						show: SEVERANCE,
						seasons: [
							{ number: 0, episodes: episodes(2) },
							{ number: 1, episodes: [] },
						],
					},
				],
			}),
		);
		expect(records).toHaveLength(0);
	});

	it('prefers the season rating, falling back to the show rating', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-shows-1.json': [
					{
						show: SEVERANCE,
						seasons: [
							{ number: 1, episodes: episodes(9) },
							{ number: 2, episodes: episodes(9, '2025-01-17') },
						],
					},
				],
				'ratings-seasons-1.json': [
					{ rating: 10, show: SEVERANCE, season: { number: 2 } },
				],
				'ratings-shows.json': [{ rating: 8, show: SEVERANCE }],
			}),
		);
		expect(records[0]!.myRating).toBe(8); // show rating fills S1
		expect(records[1]!.myRating).toBe(10); // S2's own rating wins
	});

	it('keeps a season note, and lands a show note on season 1', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-shows-1.json': [
					{
						show: SEVERANCE,
						seasons: [
							{ number: 1, episodes: episodes(9) },
							{ number: 2, episodes: episodes(9, '2025-01-17') },
						],
					},
				],
				'notes-shows.json': [
					{ show: SEVERANCE, note: { notes: 'Watch with Annie' } },
				],
				'notes-seasons.json': [
					{
						show: SEVERANCE,
						season: { number: 2 },
						note: { notes: 'Rewatch before S3' },
					},
				],
			}),
		);
		expect(records[0]!.notes).toBe('Watch with Annie');
		expect(records[1]!.notes).toBe('Rewatch before S3');
	});
});

describe('parseTrakt — new-format export (no seasons block)', () => {
	// Mid-2026 exports dropped `seasons[].episodes[]` from watched-shows; the
	// episode watches live only in the watched-history play log.
	it('builds season records from watched-history rows', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-shows-1.json': [
					{ last_updated_at: '2025-02-01T00:00:00Z', show: SEVERANCE },
				],
				'watched-history-1.json': [
					{
						watched_at: '2025-01-17T20:00:00.000Z',
						type: 'episode',
						episode: { number: 1, season: 2 },
						show: SEVERANCE,
					},
					{
						watched_at: '2025-01-24T20:00:00.000Z',
						type: 'episode',
						episode: { number: 2, season: 2 },
						show: SEVERANCE,
					},
					{
						watched_at: '2025-01-01T20:00:00.000Z',
						type: 'episode',
						episode: { number: 1, season: 0 }, // specials: skipped
						show: SEVERANCE,
					},
				],
			}),
		);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			section: 'history',
			resolve: { kind: 'tmdb-season', showTmdbId: '95396', season: 2 },
		});
		expect(records[0]!.seasonEpisodes).toEqual([
			{ number: 1, watchedAt: '2025-01-17T20:00:00.000Z' },
			{ number: 2, watchedAt: '2025-01-24T20:00:00.000Z' },
		]);
	});

	it('unions old-format season blocks with history rows, keeping the latest watch', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-shows-1.json': [
					{
						show: SEVERANCE,
						seasons: [{ number: 1, episodes: episodes(2) }],
					},
				],
				'watched-history-1.json': [
					{
						// A later rewatch of episode 1: the newer date wins.
						watched_at: '2025-06-01T20:00:00.000Z',
						type: 'episode',
						episode: { number: 1, season: 1 },
						show: SEVERANCE,
					},
					{
						watched_at: '2024-03-03T20:00:00.000Z',
						type: 'episode',
						episode: { number: 3, season: 1 },
						show: SEVERANCE,
					},
				],
			}),
		);
		expect(records).toHaveLength(1);
		expect(records[0]!.seasonEpisodes).toEqual([
			{ number: 1, watchedAt: '2025-06-01T20:00:00.000Z' },
			{ number: 2, watchedAt: '2024-03-02T20:00:00.000Z' },
			{ number: 3, watchedAt: '2024-03-03T20:00:00.000Z' },
		]);
	});

	it('adds per-play movie dates from the history log to the latest-watch date', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-movies-1.json': [
					{ last_watched_at: '2026-07-01T07:13:00.000Z', movie: OFFICE_SPACE },
				],
				'watched-history-1.json': [
					{
						watched_at: '2019-04-10T02:00:00.000Z',
						type: 'movie',
						movie: OFFICE_SPACE,
					},
					{
						watched_at: '2026-07-01T07:13:00.000Z',
						type: 'movie',
						movie: OFFICE_SPACE,
					},
				],
			}),
		);
		expect(records).toHaveLength(1);
		// Duplicate days collapse in the merge engine, not here.
		expect(records[0]!.completedDates).toEqual([
			'2026-07-01T07:13:00.000Z',
			'2019-04-10T02:00:00.000Z',
			'2026-07-01T07:13:00.000Z',
		]);
	});
});

describe('parseTrakt — fallback drafts', () => {
	it('gives a season record a draft under its deterministic id', () => {
		// A watchlisted future season TMDB doesn't list yet 404s at enrichment;
		// the pipeline then imports this draft instead of skipping the entry.
		const { records } = parseTrakt(
			exportFiles({
				'lists-watchlist.json': [
					{ type: 'season', show: SEVERANCE, season: { number: 3 } },
				],
			}),
		);
		expect(records[0]!.fallbackDraft).toMatchObject({
			id: 'show-tmdb-95396-s3',
			type: 'show',
			title: 'Severance',
			provider: 'tmdb',
			metadata: {
				show_tmdb_id: 95396,
				season_number: 3,
				episode_count: 0,
			},
		});
	});

	it('gives a movie record a draft under its deterministic id', () => {
		const { records } = parseTrakt(
			exportFiles({
				'watched-movies-1.json': [
					{ last_watched_at: '2024-01-01T00:00:00Z', movie: OFFICE_SPACE },
				],
			}),
		);
		expect(records[0]!.fallbackDraft).toMatchObject({
			id: 'movie-tmdb-1542',
			type: 'movie',
			title: 'Office Space',
			provider: 'tmdb',
			release_date: '1999',
		});
	});
});

describe('parseTrakt — watchlist → backlog', () => {
	it('maps movie, season, and whole-show entries (show → season 1)', () => {
		const { records } = parseTrakt(
			exportFiles({
				'lists-watchlist.json': [
					{
						type: 'movie',
						listed_at: '2026-05-20T16:44:17.000Z',
						movie: OFFICE_SPACE,
					},
					{
						type: 'season',
						listed_at: '2026-05-21T00:00:00.000Z',
						show: SEVERANCE,
						season: { number: 3 },
					},
					{
						type: 'show',
						listed_at: '2026-05-22T00:00:00.000Z',
						show: {
							title: 'Twin Peaks',
							year: 1990,
							ids: { tmdb: 1920 },
						},
					},
				],
			}),
		);
		expect(records).toHaveLength(3);
		expect(records[0]).toMatchObject({
			section: 'backlog',
			status: 'backlog',
			resolve: { kind: 'tmdb-movie', tmdbId: '1542' },
			addedDate: '2026-05-20',
		});
		expect(records[1]!.resolve).toMatchObject({
			kind: 'tmdb-season',
			showTmdbId: '95396',
			season: 3,
		});
		expect(records[2]!.resolve).toMatchObject({
			kind: 'tmdb-season',
			showTmdbId: '1920',
			season: 1,
		});
	});

	it('keeps a watchlist entry note', () => {
		const { records } = parseTrakt(
			exportFiles({
				'lists-watchlist.json': [
					{ type: 'movie', movie: OFFICE_SPACE, notes: 'For movie night' },
				],
			}),
		);
		expect(records[0]!.notes).toBe('For movie night');
	});
});

describe('parseTrakt — irrelevant input', () => {
	it('returns nothing for files that are not a Trakt export', () => {
		const files: ImportFileMap = new Map([
			['watched.csv', 'Date,Name,Year\n2024-01-01,Brazil,1985'],
			['watched-movies-1.json', 'not json at all'],
		]);
		expect(parseTrakt(files).records).toHaveLength(0);
	});
});

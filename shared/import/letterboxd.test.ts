import { describe, expect, it } from 'vitest';
import { parseLetterboxd } from './letterboxd';
import type { ImportFileMap } from './types';

/** CSV-encode a row so titles with commas ("O Brother, Where Art Thou?") survive. */
function csvRow(fields: string[]): string {
	return fields
		.map((f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f))
		.join(',');
}

const HEADERS = {
	watched: 'Date,Name,Year,Letterboxd URI',
	watchlist: 'Date,Name,Year,Letterboxd URI',
	ratings: 'Date,Name,Year,Letterboxd URI,Rating',
	diary: 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
	reviews:
		'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date',
};

/** An export as the file collector hands it over: `path → text`. */
function files(
	parts: Partial<Record<keyof typeof HEADERS, string[][]>> & {
		extra?: Record<string, string>;
	},
): ImportFileMap {
	const map: ImportFileMap = new Map();
	for (const [name, rows] of Object.entries(parts)) {
		if (name === 'extra') continue;
		const header = HEADERS[name as keyof typeof HEADERS];
		map.set(
			`${name}.csv`,
			[header, ...(rows as string[][]).map(csvRow)].join('\n'),
		);
	}
	for (const [path, text] of Object.entries(parts.extra ?? {})) {
		map.set(path, text);
	}
	return map;
}

describe('parseLetterboxd — watched films → history', () => {
	it('dates a watched film from its diary entries and rates it from ratings.csv', () => {
		const { records } = parseLetterboxd(
			files({
				watched: [['2018-07-17', 'Megamind', '2010', 'https://boxd.it/16Sk']],
				ratings: [
					['2018-07-17', 'Megamind', '2010', 'https://boxd.it/16Sk', '4'],
				],
				diary: [
					[
						'2021-12-24',
						'Megamind',
						'2010',
						'https://boxd.it/2o3BLr',
						'4',
						'',
						'',
						'2021-12-23',
					],
				],
			}),
		);

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			source: 'letterboxd',
			section: 'history',
			type: 'movie',
			status: 'complete',
			resolve: { kind: 'tmdb-movie-search' },
			title: 'Megamind',
			year: '2010',
			completedDates: ['2021-12-23'],
			addedDate: '2018-07-17',
			myRating: 8, // 4 stars × 2
			ratingAuthority: 'overwrite',
		});
	});

	it('collects every viewing of a rewatched film as a separate date', () => {
		const { records } = parseLetterboxd(
			files({
				watched: [
					['2018-07-17', 'The Blues Brothers', '1980', 'https://boxd.it/2adi'],
				],
				diary: [
					[
						'2022-12-02',
						'The Blues Brothers',
						'1980',
						'https://boxd.it/3ump7z',
						'5',
						'Yes',
						'',
						'2000-06-01',
					],
					[
						'2022-12-02',
						'The Blues Brothers',
						'1980',
						'https://boxd.it/3umpxd',
						'5',
						'Yes',
						'',
						'2008-06-01',
					],
				],
			}),
		);

		expect(records).toHaveLength(1);
		expect(records[0]!.completedDates).toStrictEqual([
			'2000-06-01',
			'2008-06-01',
		]);
	});

	it("keeps ratings.csv's rating over a diary entry's stale one", () => {
		// The diary records the rating given at the time; a later rewatch can re-rate
		// the film, and only ratings.csv carries that current value.
		const { records } = parseLetterboxd(
			files({
				watched: [
					['2018-07-17', 'The Avengers', '2012', 'https://boxd.it/2b6M'],
				],
				ratings: [
					['2018-07-17', 'The Avengers', '2012', 'https://boxd.it/2b6M', '2'],
				],
				diary: [
					[
						'2019-01-01',
						'The Avengers',
						'2012',
						'https://boxd.it/xyz',
						'4',
						'',
						'',
						'2019-01-01',
					],
				],
			}),
		);

		expect(records[0]!.myRating).toBe(4); // 2 stars × 2, not the diary's 4
	});

	it('leaves a film that was never diaried undated, for the date fallback', () => {
		const { records } = parseLetterboxd(
			files({
				watched: [['2018-07-17', 'Nikita', '1990', 'https://boxd.it/1YYm']],
			}),
		);

		expect(records[0]).toMatchObject({
			section: 'history',
			status: 'complete',
			completedDates: [],
			addedDate: '2018-07-17',
		});
	});

	it('scales half-star ratings onto the 0–10 scale', () => {
		const { records } = parseLetterboxd(
			files({
				watched: [
					['2018-07-17', 'Half', '2000', 'https://boxd.it/a'],
					['2018-07-17', 'Full', '2001', 'https://boxd.it/b'],
				],
				ratings: [
					['2018-07-17', 'Half', '2000', 'https://boxd.it/a', '0.5'],
					['2018-07-17', 'Full', '2001', 'https://boxd.it/b', '5'],
				],
			}),
		);

		expect(records.map((r) => r.myRating)).toStrictEqual([1, 10]);
	});

	it("carries the owner's review as notes", () => {
		const { records } = parseLetterboxd(
			files({
				watched: [['2018-12-23', 'The Predator', '2018', 'https://boxd.it/c']],
				reviews: [
					[
						'2018-12-23',
						'The Predator',
						'2018',
						'https://boxd.it/AqIuP',
						'3',
						'',
						'The only worthwhile character is the predator-dog.',
						'',
						'2018-12-23',
					],
				],
			}),
		);

		expect(records[0]!.notes).toBe(
			'The only worthwhile character is the predator-dog.',
		);
	});

	it('joins the files on title and year despite punctuation', () => {
		const { records } = parseLetterboxd(
			files({
				watched: [
					[
						'2018-07-17',
						'O Brother, Where Art Thou?',
						'2000',
						'https://boxd.it/2b3I',
					],
				],
				ratings: [
					[
						'2018-07-17',
						'O Brother, Where Art Thou?',
						'2000',
						'https://boxd.it/2b3I',
						'4.5',
					],
				],
			}),
		);

		expect(records[0]!.myRating).toBe(9);
	});
});

describe('parseLetterboxd — watchlist → backlog', () => {
	it('maps a watchlist film to an unrated backlog record', () => {
		const { records } = parseLetterboxd(
			files({
				watchlist: [
					[
						'2021-12-19',
						'Spider-Man: Beyond the Spider-Verse',
						'2027',
						'https://boxd.it/ykgU',
					],
				],
			}),
		);

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			section: 'backlog',
			status: 'backlog',
			completedDates: [],
			title: 'Spider-Man: Beyond the Spider-Verse',
			year: '2027',
			addedDate: '2021-12-19',
		});
		expect(records[0]!.myRating).toBeUndefined();
	});

	it('handles a watchlist film with no year (an unannounced sequel)', () => {
		const { records } = parseLetterboxd(
			files({
				watchlist: [
					['2021-12-24', 'John Wick: Chapter 5', '', 'https://boxd.it/roO8'],
				],
			}),
		);

		expect(records[0]!.year).toBeUndefined();
		expect(records[0]!.fallbackDraft).toMatchObject({
			id: 'movie-letterboxd-roO8',
		});
	});

	it('emits both records for a film that is watched and still watchlisted', () => {
		const map = files({
			watched: [['2018-07-17', 'Nikita', '1990', 'https://boxd.it/1YYm']],
			watchlist: [['2019-01-01', 'Nikita', '1990', 'https://boxd.it/1YYm']],
		});
		const { records } = parseLetterboxd(map);

		expect(records.map((r) => r.section)).toStrictEqual(['history', 'backlog']);
	});
});

describe('parseLetterboxd — fallback draft for films TMDB may not have', () => {
	it("builds a draft under Letterboxd's own film id", () => {
		const { records } = parseLetterboxd(
			files({
				watched: [
					[
						'2018-07-17',
						"Frank Herbert's Dune",
						'2000',
						'https://boxd.it/16Sk',
					],
				],
			}),
		);

		expect(records[0]!.fallbackDraft).toMatchObject({
			id: 'movie-letterboxd-16Sk',
			type: 'movie',
			title: "Frank Herbert's Dune",
			provider: 'letterboxd',
			release_date: '2000',
			status: 'backlog',
			completed_dates: [],
		});
	});

	it('falls back to a title+year slug when only the diary knows the film', () => {
		// A diary row's URI names the entry, not the film, so there's no film id to use.
		const { records } = parseLetterboxd(
			files({
				diary: [
					[
						'2022-12-02',
						'The Blues Brothers',
						'1980',
						'https://boxd.it/3ump7z',
						'5',
						'',
						'',
						'2000-06-01',
					],
				],
			}),
		);

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			section: 'history',
			completedDates: ['2000-06-01'],
			fallbackDraft: { id: 'movie-letterboxd-the-blues-brothers-1980' },
		});
	});
});

describe('parseLetterboxd — files it must ignore', () => {
	it('ignores the deleted/ and orphaned/ copies of the diary', () => {
		// These shadow the real diary.csv by name; taking them would drop every date.
		const map = files({
			watched: [['2018-07-17', 'Megamind', '2010', 'https://boxd.it/16Sk']],
			diary: [
				[
					'2021-12-24',
					'Megamind',
					'2010',
					'https://boxd.it/2o3BLr',
					'4',
					'',
					'',
					'2021-12-23',
				],
			],
			extra: {
				'deleted/diary.csv': HEADERS.diary,
				'orphaned/diary.csv': HEADERS.diary,
				'likes/films.csv': HEADERS.watched,
				'lists/action.csv': 'Position,Name,Year,URL',
			},
		});
		const { records } = parseLetterboxd(map);

		expect(records).toHaveLength(1);
		expect(records[0]!.completedDates).toStrictEqual(['2021-12-23']);
	});

	it('returns nothing for files that are not a Letterboxd export', () => {
		expect(
			parseLetterboxd(
				new Map([['goodreads_library_export.csv', 'Book Id\n1']]),
			),
		).toStrictEqual({ records: [], skipped: [] });
	});
});

import { describe, expect, it } from 'vitest';
import { parseInfiniteBacklog } from './infiniteBacklog';
import type { ImportFileMap } from './types';

const COLLECTION_HEADER =
	'IGDB ID,Game name,Game release date,Status,Completion,Ownership,Playtime,Completion date,Last updated,Rating (Score)';

function collection(...rows: string[]): ImportFileMap {
	return new Map([
		[
			'InfiniteBacklog_GameCollection_2026-07-02.csv',
			[COLLECTION_HEADER, ...rows].join('\n'),
		],
	]);
}

describe('parseInfiniteBacklog — collection history', () => {
	it('maps a Beaten game with a completion date to a dated completion', () => {
		const { records } = parseInfiniteBacklog(
			collection(
				'1020,Grand Theft Auto V,2013-09-17,Played,Beaten,Owned,60,2013-07-21,2025-01-03T23:29:43.000Z,9',
			),
		);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			source: 'infinite-backlog',
			section: 'history',
			type: 'game',
			status: 'complete',
			resolve: { kind: 'igdb', igdbId: '1020' },
			completedDates: ['2013-07-21'],
			myRating: 9,
			isPurchased: true,
			year: '2013',
			ratingAuthority: 'overwrite',
		});
	});

	it('falls back to Last updated when there is no completion date', () => {
		const { records } = parseInfiniteBacklog(
			collection(
				'2539,Alpha Protocol,2010-05-27,Played,Completed,Owned,,,2025-01-03T23:29:43.000Z,',
			),
		);
		expect(records[0]).toMatchObject({
			status: 'complete',
			completedDates: ['2025-01-03'],
		});
		expect(records[0]?.myRating).toBeUndefined();
	});

	it('maps Dropped to a dnf completion', () => {
		const { records } = parseInfiniteBacklog(
			collection(
				'5,Halt,2015-01-01,Played,Dropped,Owned,,2019-10-06,2020-01-01T00:00:00.000Z,',
			),
		);
		expect(records[0]).toMatchObject({ section: 'history', status: 'dnf' });
	});
});

describe('parseInfiniteBacklog — collection backlog', () => {
	it('maps Continuous and Playing rows to in_progress backlog', () => {
		const { records } = parseInfiniteBacklog(
			collection(
				'7,Destiny 2,2017-09-06,Played,Continuous,Owned,,,2026-01-01T00:00:00.000Z,',
				'8,Elden Ring,2022-02-25,Playing,No Status,Owned,,,2026-01-01T00:00:00.000Z,',
			),
		);
		expect(records).toHaveLength(2);
		expect(
			records.every(
				(r) => r.section === 'backlog' && r.status === 'in_progress',
			),
		).toBe(true);
	});

	it('does not import owned-but-unplayed games', () => {
		const { records } = parseInfiniteBacklog(
			collection(
				'9,Some Game,2020-01-01,Unplayed,No Status,Owned,,,2026-01-01T00:00:00.000Z,',
			),
		);
		expect(records).toHaveLength(0);
	});
});

describe('parseInfiniteBacklog — wishlist & diagnostics', () => {
	it('maps wishlist rows to backlog', () => {
		const files: ImportFileMap = new Map([
			[
				'InfiniteBacklog_Wishlist_2026-07-02.csv',
				'IGDB ID,Game name,Game release date\n1234,Silksong,2025-01-01',
			],
		]);
		const { records } = parseInfiniteBacklog(files);
		expect(records[0]).toMatchObject({
			section: 'backlog',
			status: 'backlog',
			resolve: { kind: 'igdb', igdbId: '1234' },
		});
	});

	it('skips rows with no IGDB id and reports them', () => {
		const { records, skipped } = parseInfiniteBacklog(
			collection(
				',Mystery Game,2020-01-01,Played,Beaten,Owned,,2020-01-01,2020-01-01T00:00:00.000Z,',
			),
		);
		expect(records).toHaveLength(0);
		expect(skipped).toStrictEqual([
			{ title: 'Mystery Game', reason: 'No IGDB id' },
		]);
	});

	it('returns nothing for an unrelated file set', () => {
		expect(
			parseInfiniteBacklog(new Map([['diary.csv', 'a,b\n1,2']])),
		).toStrictEqual({
			records: [],
			skipped: [],
		});
	});
});

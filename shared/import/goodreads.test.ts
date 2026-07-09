import { describe, expect, it } from 'vitest';
import { parseGoodreads } from './goodreads';
import type { ImportFileMap } from './types';

// Only the columns the parser reads (the real export has ~23); parseCsvRecords
// keys by header, so extra columns don't matter and these can stay readable.
const HEADER =
	'Book Id,Title,Author,Additional Authors,ISBN,ISBN13,My Rating,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Exclusive Shelf,Owned Copies';

/** CSV-encode a row so values with commas/quotes (titles, `="..."` ISBNs) round-trip. */
function csvRow(fields: string[]): string {
	return fields
		.map((f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f))
		.join(',');
}

function library(...rows: string[]): ImportFileMap {
	return new Map([
		['goodreads_library_export.csv', [HEADER, ...rows].join('\n')],
	]);
}

describe('parseGoodreads — read shelf → history', () => {
	it('maps a read book with an ISBN to a dated completion', () => {
		const { records } = parseGoodreads(
			library(
				csvRow([
					'75319056',
					'System Collapse (The Murderbot Diaries, #7)',
					'Martha Wells',
					'',
					'="1250826985"',
					'="9781250826985"',
					'5.0',
					'248',
					'2023',
					'2023',
					'2024/02/23',
					'2023/01/26',
					'read',
					'1',
				]),
			),
		);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			source: 'goodreads',
			section: 'history',
			type: 'book',
			status: 'complete',
			resolve: {
				kind: 'goodreads-book',
				bookId: '75319056',
				isbn13: '9781250826985',
				isbn: '1250826985',
			},
			completedDates: ['2024-02-23'],
			addedDate: '2023-01-26',
			myRating: 10, // 5.0 * 2
			isPurchased: true, // Owned Copies = 1
			year: '2023',
			ratingAuthority: 'overwrite',
		});
		// The export-built base, keyed by the Goodreads Book Id, prefers ISBN-13.
		expect(records[0]?.fallbackDraft).toMatchObject({
			id: 'book-goodreads-75319056',
			type: 'book',
			provider: 'goodreads',
			// Goodreads' "(Series, #N)" suffix is parsed off into series metadata.
			title: 'System Collapse',
			creator: 'Martha Wells',
			length: 248,
			length_unit: 'pages',
			release_date: '2023',
			metadata: {
				isbn: '9781250826985',
				series: 'The Murderbot Diaries',
				series_number: 7,
			},
			status: 'backlog',
			is_purchased: false,
			completed_dates: [],
		});
		// The lookup title drops the suffix so Google Books can match it.
		expect(records[0]?.title).toBe('System Collapse');
	});

	it('keeps a read Kindle book with no ISBN, undated and ISBN-free', () => {
		const { records } = parseGoodreads(
			library(
				csvRow([
					'52680842',
					'Network Effect (The Murderbot Diaries, #5)',
					'Martha Wells',
					'',
					'=""',
					'=""',
					'5.0',
					'346',
					'2020',
					'2020',
					'', // no Date Read
					'2018/11/06',
					'read',
					'0',
				]),
			),
		);
		expect(records[0]).toMatchObject({
			section: 'history',
			status: 'complete',
			resolve: { kind: 'goodreads-book', bookId: '52680842' },
			completedDates: [], // undated — the pipeline dates it via the fallback choice
			addedDate: '2018-11-06',
			isPurchased: false, // Owned Copies = 0
		});
		// No usable ISBN on either column.
		expect(records[0]?.resolve).not.toHaveProperty('isbn13');
		expect(records[0]?.resolve).not.toHaveProperty('isbn');
		// No ISBN, but the title still yields series metadata.
		expect(records[0]?.fallbackDraft?.metadata).toStrictEqual({
			series: 'The Murderbot Diaries',
			series_number: 5,
		});
	});

	it('leaves an unrated book without a rating', () => {
		const { records } = parseGoodreads(
			library(
				csvRow([
					'1',
					'Unrated',
					'Someone',
					'',
					'="9780000000001"',
					'="9780000000001"',
					'0', // My Rating 0 = unrated
					'100',
					'2000',
					'2000',
					'2001/01/01',
					'2000/12/31',
					'read',
					'0',
				]),
			),
		);
		expect(records[0]?.myRating).toBeUndefined();
	});
});

describe('parseGoodreads — backlog shelves', () => {
	it('maps to-read to backlog and currently-reading to in_progress', () => {
		const { records } = parseGoodreads(
			library(
				csvRow([
					'10',
					'Later',
					'A',
					'',
					'="9780000000010"',
					'="9780000000010"',
					'0',
					'',
					'2024',
					'2024',
					'',
					'2024/01/01',
					'to-read',
					'0',
				]),
				csvRow([
					'11',
					'Now',
					'B',
					'',
					'="9780000000011"',
					'="9780000000011"',
					'0',
					'',
					'2024',
					'2024',
					'',
					'2024/01/01',
					'currently-reading',
					'0',
				]),
			),
		);
		expect(records).toMatchObject([
			{ section: 'backlog', status: 'backlog', completedDates: [] },
			{ section: 'backlog', status: 'in_progress', completedDates: [] },
		]);
		// Backlog rows carry no completion fallback date.
		expect(records[0]?.addedDate).toBeUndefined();
	});
});

describe('parseGoodreads — diagnostics & detection', () => {
	it('skips rows with no Book Id and reports them', () => {
		const { records, skipped } = parseGoodreads(
			library(
				csvRow([
					'',
					'Mystery',
					'',
					'',
					'',
					'',
					'0',
					'',
					'',
					'',
					'',
					'',
					'read',
					'0',
				]),
			),
		);
		expect(records).toHaveLength(0);
		expect(skipped).toStrictEqual([
			{ title: 'Mystery', reason: 'No Goodreads Book Id' },
		]);
	});

	it('finds the library CSV by its header even when renamed', () => {
		const files: ImportFileMap = new Map([
			[
				'export.csv',
				[
					HEADER,
					csvRow([
						'5',
						'X',
						'Y',
						'',
						'',
						'',
						'4',
						'',
						'2020',
						'2020',
						'2021/02/03',
						'2020/01/01',
						'read',
						'0',
					]),
				].join('\n'),
			],
		]);
		const { records } = parseGoodreads(files);
		expect(records[0]).toMatchObject({
			resolve: { bookId: '5' },
			completedDates: ['2021-02-03'],
			myRating: 8,
		});
	});

	it('returns nothing for an unrelated file set', () => {
		expect(
			parseGoodreads(new Map([['diary.csv', 'Date,Name\n2020,x']])),
		).toStrictEqual({ records: [], skipped: [] });
	});
});

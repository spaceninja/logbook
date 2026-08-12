import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookMetadata, Item } from '../../shared/types/item';
import { applyVolume, enrichBooksWithGoogleBooks } from './googleBooks';

function book(overrides: Partial<Item> = {}): Item {
	return {
		id: 'book-goodreads-1',
		type: 'book',
		title: 'Radiant Star',
		creator: 'Ann Leckie',
		provider: 'goodreads',
		status: 'backlog',
		is_purchased: false,
		is_prioritized: false,
		completed_dates: [],
		completed_years: [],
		tags: [],
		metadata: {},
		...overrides,
	};
}

/** The volume payload Google returns for a search, as the lib parses it. */
function volumeItems(
	...volumes: { id: string; title: string; authors?: string[]; date?: string }[]
) {
	return {
		items: volumes.map((v) => ({
			id: v.id,
			volumeInfo: {
				title: v.title,
				...(v.authors ? { authors: v.authors } : {}),
				...(v.date ? { publishedDate: v.date } : {}),
			},
		})),
	};
}

function ok(body: unknown) {
	return { ok: true, status: 200, json: async () => body };
}

/** No spacing between calls, so a test doesn't wait out the real rate limit. */
const fast = { spacingMs: 0 };

let fetchMock: ReturnType<typeof vi.fn>;

describe('enrichBooksWithGoogleBooks', () => {
	beforeEach(() => {
		// Pin "today" so the release-date window (current year and the two before)
		// doesn't drift with the calendar.
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('stamps the id and a full date on a book matched by ISBN', async () => {
		fetchMock.mockResolvedValueOnce(
			ok(
				volumeItems({ id: 'vol-1', title: 'Radiant Star', date: '2026-05-12' }),
			),
		);
		const item = book({
			release_date: '2026',
			metadata: { isbn: '0316290688' },
		});

		const result = await enrichBooksWithGoogleBooks([item], fast);

		expect(result).toMatchObject({ matched: 1, dated: 1, unmatched: 0 });
		expect((item.metadata as BookMetadata).google_books_id).toBe('vol-1');
		expect(item.release_date).toBe('2026-05-12');
		// The ISBN hit is taken outright — no title search follows.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('leaves a book that already has an id alone', async () => {
		const item = book({
			release_date: '2026',
			metadata: { google_books_id: 'existing' },
		});

		const result = await enrichBooksWithGoogleBooks([item], fast);

		expect(result.matched).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(item.release_date).toBe('2026');
	});

	it('rejects a title match whose author disagrees, stamping nothing', async () => {
		// No ISBN, so this falls to the title path — the risky one. (#98)
		fetchMock.mockResolvedValueOnce(
			ok(
				volumeItems({ id: 'wrong', title: 'Home', authors: ['Toni Morrison'] }),
			),
		);
		const item = book({ title: 'Home', creator: 'Nnedi Okorafor' });

		const result = await enrichBooksWithGoogleBooks([item], fast);

		expect(result).toMatchObject({ matched: 0, unmatched: 1 });
		expect((item.metadata as BookMetadata).google_books_id).toBeUndefined();
	});

	it('takes the first title hit that passes the guard, not merely the first', async () => {
		fetchMock.mockResolvedValueOnce(
			ok(
				volumeItems(
					{ id: 'wrong', title: 'Radiant Star', authors: ['Someone Else'] },
					{ id: 'right', title: 'Radiant Star', authors: ['Ann Leckie'] },
				),
			),
		);
		const item = book();

		await enrichBooksWithGoogleBooks([item], fast);

		expect((item.metadata as BookMetadata).google_books_id).toBe('right');
	});

	it('keeps the id but not the date when Google disagrees on the year', async () => {
		fetchMock.mockResolvedValueOnce(
			ok(
				volumeItems({
					id: 'vol-2',
					title: 'Radiant Star',
					authors: ['Ann Leckie'],
					date: '2019-03-04',
				}),
			),
		);
		const item = book({ release_date: '2026' });

		const result = await enrichBooksWithGoogleBooks([item], fast);

		expect(result).toMatchObject({ matched: 1, dated: 0 });
		expect((item.metadata as BookMetadata).google_books_id).toBe('vol-2');
		expect(item.release_date).toBe('2026');
	});

	it('treats an unrecoverable request as no match rather than throwing', async () => {
		// 404 isn't retryable, so the transport gives up and reports "couldn't
		// ask" — which must degrade to unmatched, never abort the sync.
		fetchMock.mockResolvedValue({ ok: false, status: 404 });
		const item = book();

		const result = await enrichBooksWithGoogleBooks([item], fast);

		expect(result).toMatchObject({ matched: 0, unmatched: 1, errors: 0 });
		expect((item.metadata as BookMetadata).google_books_id).toBeUndefined();
	});

	it('counts an unreadable response as an error and keeps going', async () => {
		fetchMock
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => {
					throw new SyntaxError('Unexpected token < in JSON');
				},
			})
			.mockResolvedValue(
				ok(
					volumeItems({
						id: 'vol-3',
						title: 'Radiant Star',
						authors: ['Ann Leckie'],
					}),
				),
			);
		const failing = book({ id: 'a' });
		const following = book({ id: 'b' });

		const result = await enrichBooksWithGoogleBooks([failing, following], fast);

		expect(result).toMatchObject({ errors: 1, matched: 1 });
		expect((failing.metadata as BookMetadata).google_books_id).toBeUndefined();
		expect((following.metadata as BookMetadata).google_books_id).toBe('vol-3');
	});

	it('caps how many books it looks up in one run', async () => {
		fetchMock.mockResolvedValue(ok({ items: [] }));
		const items = Array.from({ length: 5 }, (_, i) =>
			book({ id: `book-${i}` }),
		);

		const result = await enrichBooksWithGoogleBooks(items, {
			...fast,
			limit: 2,
		});

		expect(result.unmatched).toBe(2);
	});

	it('ignores items that are not books', async () => {
		const movie = book({ id: 'movie-1', type: 'movie' });

		await enrichBooksWithGoogleBooks([movie], fast);

		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('applyVolume', () => {
	it('preserves the metadata already on the book', () => {
		const item = book({
			metadata: { isbn: '0316290688', hardcover_id: '123' },
		});

		applyVolume(item, { id: 'vol-9', volumeInfo: { title: 'Radiant Star' } });

		expect(item.metadata).toStrictEqual({
			isbn: '0316290688',
			hardcover_id: '123',
			google_books_id: 'vol-9',
		});
	});

	it('sets no date when the volume carries none', () => {
		const item = book({ release_date: '2026' });

		expect(
			applyVolume(item, { id: 'v', volumeInfo: { title: 'Radiant Star' } }),
		).toBe(false);
		expect(item.release_date).toBe('2026');
	});

	it('does not overwrite a date that is already day-level', () => {
		const item = book({ release_date: '2026-05-12' });

		applyVolume(item, {
			id: 'v',
			volumeInfo: { title: 'Radiant Star', publishedDate: '2026-06-30' },
		});

		expect(item.release_date).toBe('2026-05-12');
	});
});

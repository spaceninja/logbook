import { describe, expect, it } from 'vitest';
import {
	mapGoogleBooksDraft,
	mapGoogleBooksSearch,
	rankGoogleBooksVolumes,
	type GoogleBooksVolume,
} from './googleBooks';

const volume: GoogleBooksVolume = {
	id: 'zyTCAlFPjgYC',
	volumeInfo: {
		title: 'Dune',
		authors: ['Frank Herbert'],
		publishedDate: '1965-08-01',
		description: '<p>On <b>Arrakis</b>.</p>',
		categories: ['Fiction / Science Fiction / Space Opera'],
		pageCount: 412,
		averageRating: 4.5,
		imageLinks: {
			smallThumbnail:
				'http://books.google.com/books/content?id=z&img=1&zoom=5&edge=curl',
			thumbnail:
				'http://books.google.com/books/content?id=z&img=1&zoom=1&edge=curl',
		},
		industryIdentifiers: [
			{ type: 'ISBN_10', identifier: '0441172717' },
			{ type: 'ISBN_13', identifier: '9780441172719' },
		],
	},
};

describe('mapGoogleBooksSearch', () => {
	it('normalizes a volume to a search result', () => {
		const [r] = mapGoogleBooksSearch([volume]);
		expect(r).toStrictEqual({
			type: 'book',
			providerId: 'zyTCAlFPjgYC',
			title: 'Dune',
			year: '1965',
			thumbnail:
				'https://books.google.com/books/content?id=zyTCAlFPjgYC&printsec=frontcover&img=1&zoom=1&fife=w180',
			subtitle: 'Frank Herbert',
		});
	});
});

describe('rankGoogleBooksVolumes', () => {
	/** A volume with just the fields ranking reads. */
	function vol(
		id: string,
		title: string,
		options: { publicDomain?: boolean; isbn?: boolean } = {},
	): GoogleBooksVolume {
		return {
			id,
			volumeInfo: {
				title,
				...(options.isbn
					? { industryIdentifiers: [{ type: 'ISBN_13', identifier: '9' }] }
					: {}),
			},
			...(options.publicDomain ? { accessInfo: { publicDomain: true } } : {}),
		};
	}

	const ids = (volumes: GoogleBooksVolume[]) => volumes.map((v) => v.id);

	it('demotes public-domain library scans below real books', () => {
		// Google ranks the 1921 magazine scan above the novel it shares words with.
		const scan = vol('scan', 'The Grizzly Bear', { publicDomain: true });
		const book = vol('book', 'The Folded Sky', { isbn: true });
		expect(
			ids(rankGoogleBooksVolumes([scan, book], 'folded sky bear')),
		).toEqual(['book', 'scan']);
	});

	it('keeps a public-domain volume that still carries an ISBN', () => {
		// A modern reprint of a public-domain work is a real book, not a scan.
		const reprint = vol('reprint', 'Poetical Works', {
			publicDomain: true,
			isbn: true,
		});
		const other = vol('other', 'Unrelated');
		expect(ids(rankGoogleBooksVolumes([reprint, other], 'poetical'))).toEqual([
			'reprint',
			'other',
		]);
	});

	it('orders an exact title match above a prefix match', () => {
		const peek = vol('peek', 'Nona the Ninth Sneak Peek', { isbn: true });
		const real = vol('real', 'Nona the Ninth', { isbn: true });
		expect(ids(rankGoogleBooksVolumes([peek, real], 'Nona the Ninth'))).toEqual(
			['real', 'peek'],
		);
	});

	it("preserves Google's order for volumes in the same tier", () => {
		const a = vol('a', 'Unrelated One');
		const b = vol('b', 'Unrelated Two');
		const c = vol('c', 'Unrelated Three');
		expect(ids(rankGoogleBooksVolumes([a, b, c], 'nothing matches'))).toEqual([
			'a',
			'b',
			'c',
		]);
	});
});

describe('mapGoogleBooksDraft', () => {
	it('maps a volume to a draft item', () => {
		const item = mapGoogleBooksDraft(volume);
		expect(item.id).toBe('book-google-books-zyTCAlFPjgYC');
		expect(item.creator).toBe('Frank Herbert');
		expect(item.description).toBe('On **Arrakis**.'); // HTML → markdown
		const pages = item.length;
		expect(pages).toBe(412);
		expect(item.length_unit).toBe('pages');
		expect(item.community_rating).toBe(9); // 4.5 * 2
		expect(item.tags).toStrictEqual([
			'fiction',
			'science fiction',
			'space opera',
		]);
		// Volume id is stored for later refresh/edition-switching; prefers ISBN_13.
		expect(item.metadata).toStrictEqual({
			google_books_id: 'zyTCAlFPjgYC',
			isbn: '9780441172719',
		});
		// Hi-res Google Books cover for the exact edition, built from the volume id.
		// `zoom=1` is required, or the endpoint renders an interior page instead.
		expect(item.cover).toBe(
			'https://books.google.com/books/content?id=zyTCAlFPjgYC&printsec=frontcover&img=1&zoom=1&fife=w640',
		);
		expect(item.thumbnail).toBe(
			'https://books.google.com/books/content?id=zyTCAlFPjgYC&printsec=frontcover&img=1&zoom=1&fife=w180',
		);
		expect(item.provider).toBe('google-books');
	});

	it('omits cover and thumbnail when the volume has no images', () => {
		const noImages: GoogleBooksVolume = {
			id: 'x',
			volumeInfo: { title: 'Coverless' },
		};
		const item = mapGoogleBooksDraft(noImages);
		expect(item.cover).toBeUndefined();
		expect(item.thumbnail).toBeUndefined();
	});
});

import { describe, expect, it } from 'vitest';
import {
  mapGoogleBooksDraft,
  mapGoogleBooksSearch,
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
      thumbnail: 'https://books.google.com/books/content?id=z&img=1&zoom=5',
      subtitle: 'Frank Herbert',
    });
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
    expect(item.metadata).toStrictEqual({ isbn: '9780441172719' }); // prefers ISBN_13
    // Cover-URL cleanup: https + &edge=curl stripped
    expect(item.cover).toBe(
      'https://books.google.com/books/content?id=z&img=1&zoom=1',
    );
    expect(item.provider).toBe('google-books');
  });
});

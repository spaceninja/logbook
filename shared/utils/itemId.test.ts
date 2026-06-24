import { describe, expect, it } from 'vitest';
import { makeBookId, makeGameId, makeMovieId, makeShowId } from './itemId';

describe('item id helpers', () => {
  it('builds a book id from provider and source id', () => {
    expect(makeBookId('goodreads', 20518872)).toBe('book-goodreads-20518872');
  });

  it('builds a movie id from provider and source id', () => {
    expect(makeMovieId('tmdb', 27205)).toBe('movie-tmdb-27205');
  });

  it('builds a game id from provider and source id', () => {
    expect(makeGameId('igdb', 119133)).toBe('game-igdb-119133');
  });

  it('encodes show id and season number into a show id', () => {
    expect(makeShowId('tmdb', 95396, 1)).toBe('show-tmdb-95396-s1');
  });
});

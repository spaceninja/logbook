import { describe, expect, it } from 'vitest';
import {
  cleanCoverUrl,
  normalizeTags,
  toCreator,
  unixSecondsToIsoDate,
  yearOf,
} from './helpers';

describe('cleanCoverUrl', () => {
  it('upgrades http to https', () => {
    expect(cleanCoverUrl('http://example.com/a.jpg')).toBe(
      'https://example.com/a.jpg',
    );
  });

  it("strips Google Books' &edge=curl", () => {
    expect(
      cleanCoverUrl('http://books.google.com/x?img=1&edge=curl&zoom=1'),
    ).toBe('https://books.google.com/x?img=1&zoom=1');
  });

  it('returns undefined for a missing url', () => {
    expect(cleanCoverUrl(undefined)).toBeUndefined();
  });
});

describe('normalizeTags', () => {
  it('lowercases, trims, drops empties, and de-duplicates', () => {
    expect(
      normalizeTags(['Sci-Fi', ' sci-fi ', 'Fantasy', '', undefined, null]),
    ).toStrictEqual(['sci-fi', 'fantasy']);
  });
});

describe('toCreator', () => {
  it('returns undefined when empty', () => {
    expect(toCreator([])).toBeUndefined();
    expect(toCreator([undefined, ' '])).toBeUndefined();
  });

  it('returns a string for one name and an array for many', () => {
    expect(toCreator(['Nolan'])).toBe('Nolan');
    expect(toCreator(['A', 'B'])).toStrictEqual(['A', 'B']);
  });
});

describe('unixSecondsToIsoDate', () => {
  it('converts unix seconds to an ISO date', () => {
    expect(unixSecondsToIsoDate(1582934400)).toBe('2020-02-29');
  });

  it('returns undefined for non-numbers', () => {
    expect(unixSecondsToIsoDate(undefined)).toBeUndefined();
  });
});

describe('yearOf', () => {
  it('extracts a four-digit year', () => {
    expect(yearOf('2010-07-16')).toBe('2010');
    expect(yearOf('2010')).toBe('2010');
  });

  it('returns undefined for partial/invalid input', () => {
    expect(yearOf(undefined)).toBeUndefined();
    expect(yearOf('n/a')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
	authorsMatch,
	cleanCoverUrl,
	normalizeTags,
	titlesMatch,
	titleTier,
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

describe('titleTier', () => {
	it('ranks exact, prefix, substring, then everything else', () => {
		expect(titleTier('Hades', 'Hades')).toBe(0);
		expect(titleTier('Hades II', 'Hades')).toBe(1);
		expect(titleTier('Return to Hades', 'Hades')).toBe(2);
		expect(titleTier('Bastion', 'Hades')).toBe(3);
	});

	it('ignores case and surrounding whitespace in the query', () => {
		expect(titleTier('Hades', '  hades ')).toBe(0);
	});
});

describe('titlesMatch', () => {
	it('accepts a candidate carrying an extra subtitle', () => {
		expect(titlesMatch('Dune (Movie Tie-In)', 'Dune')).toBe(true);
	});

	it('accepts a wanted title carrying the extra subtitle', () => {
		expect(titlesMatch('Gideon the Ninth', 'Gideon the Ninth: A Novel')).toBe(
			true,
		);
	});

	it('ignores punctuation, case and diacritics', () => {
		expect(titlesMatch("The Spirits' Book", 'the spirits book')).toBe(true);
		expect(titlesMatch('Gideon la novéna', 'Gideon la novena')).toBe(true);
	});

	it('rejects a different book by the same author', () => {
		// The bug this guards: an unquoted intitle: lookup returns the Dutch
		// translation of "The Lies of Locke Lamora" for a different short story.
		expect(
			titlesMatch(
				'De leugens van Locke Lamora / druk 1',
				'Locke Lamora and the Bottled Serpent',
			),
		).toBe(false);
	});

	it('rejects a translation whose title is prefixed by another language', () => {
		expect(
			titlesMatch('Gideon la novena / Gideon the Ninth', 'Gideon the Ninth'),
		).toBe(false);
	});
});

describe('authorsMatch', () => {
	it('accepts the same name spelled with different punctuation', () => {
		// Google writes "James S. A. Corey"; Goodreads writes "James S.A. Corey".
		expect(authorsMatch(['James S. A. Corey'], 'James S.A. Corey')).toBe(true);
	});

	it('accepts a name Goodreads double-spaced', () => {
		expect(authorsMatch(['Sara Hashem'], 'Sara  Hashem')).toBe(true);
	});

	it('accepts initials against the spelled-out given names', () => {
		expect(authorsMatch(['John Ronald Reuel Tolkien'], 'J.R.R. Tolkien')).toBe(
			true,
		);
	});

	it('accepts an overlap when either side lists several authors', () => {
		expect(
			authorsMatch(['Neil Gaiman', 'Terry Pratchett'], ['Terry Pratchett']),
		).toBe(true);
	});

	it('rejects a different author with the same surname', () => {
		expect(authorsMatch(['Ann Leckie'], 'George R.R. Martin')).toBe(false);
		expect(authorsMatch(['Nora Roberts'], 'John Roberts')).toBe(false);
	});

	it('rejects when the candidate names no author', () => {
		// Unverifiable is not verified — this is what keeps a generic title like
		// "Home" from being matched to an unrelated volume. (#98)
		expect(authorsMatch([], 'Nnedi Okorafor')).toBe(false);
		expect(authorsMatch(undefined, 'Nnedi Okorafor')).toBe(false);
	});

	it('rejects when the library book itself names no author', () => {
		expect(authorsMatch(['Nnedi Okorafor'], undefined)).toBe(false);
	});
});

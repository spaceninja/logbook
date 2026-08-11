import { describe, expect, it } from 'vitest';
import {
	applyRecovered,
	authorsAgree,
	entryAuthor,
	isbn13,
	matchEntries,
	type BookListEntry,
} from './bookList';
import type { Item } from '../../shared/types/item';

function book(id: string, title: string, over: Partial<Item> = {}): Item {
	return {
		id,
		type: 'book',
		title,
		status: 'backlog',
		is_purchased: false,
		is_prioritized: false,
		completed_dates: [],
		completed_years: [],
		tags: [],
		metadata: {},
		...over,
	};
}

function entry(over: Partial<BookListEntry> = {}): BookListEntry {
	return { isbn: '0062676083', title: 'Caliban', ...over };
}

describe('isbn13', () => {
	it('converts an ISBN-10 to its ISBN-13 form', () => {
		// Book List keys most books by ISBN-10; Logbook stores mostly ISBN-13.
		expect(isbn13('0316332879')).toBe('9780316332873');
	});

	it('passes an ISBN-13 through unchanged', () => {
		expect(isbn13('9780316332873')).toBe('9780316332873');
	});

	it('ignores hyphens and spacing', () => {
		expect(isbn13('0-316-33287-9')).toBe('9780316332873');
	});

	it('returns undefined for an ASIN', () => {
		// Ebook-only titles are keyed by ASIN, which is not an ISBN at all.
		expect(isbn13('B07DW2PMS6')).toBeUndefined();
	});

	it('returns undefined for a placeholder id', () => {
		// Book List let you invent an ISBN for an unannounced book.
		expect(isbn13('0000000000SOIAF')).toBeUndefined();
	});

	it('returns undefined for an empty value', () => {
		expect(isbn13(undefined)).toBeUndefined();
	});
});

describe('authorsAgree', () => {
	it('matches across differing initial punctuation', () => {
		expect(authorsAgree('N.K. Jemisin', 'N. K. Jemisin')).toBe(true);
	});

	it('matches when one side carries a middle initial', () => {
		expect(authorsAgree('Allen M. Steele', 'Allen Steele')).toBe(true);
	});

	it('matches on surname when the given names differ', () => {
		expect(authorsAgree('Laura Lam', 'L.R.  Lam')).toBe(true);
	});

	it('matches a co-authored credit against a single author', () => {
		expect(
			authorsAgree('Amal El-Mohtar & Max Gladstone', 'Amal El-Mohtar'),
		).toBe(true);
	});

	it('matches a creator stored as an array', () => {
		expect(authorsAgree('Amal El-Mohtar', ['Amal El-Mohtar'])).toBe(true);
	});

	it('rejects unrelated authors', () => {
		expect(authorsAgree('Martha Wells', 'Adrian Tchaikovsky')).toBe(false);
	});

	it('rejects a pen name it has no way to connect', () => {
		// Handled by MANUAL_MATCHES instead; see matchEntries.
		expect(authorsAgree('Sam Hughes', 'qntm')).toBe(false);
	});

	it('rejects a match on a shared particle alone', () => {
		// "de" is below the token floor, so these share nothing.
		expect(authorsAgree('Aliette de Bodard', 'Walter de la Mare')).toBe(false);
	});

	it('rejects when the item has no creator', () => {
		expect(authorsAgree('Martha Wells', undefined)).toBe(false);
	});
});

describe('entryAuthor', () => {
	it('joins the split name fields', () => {
		expect(
			entryAuthor(entry({ author_fname: 'David', author_lname: 'Pedreira' })),
		).toBe('David Pedreira');
	});

	it('tolerates a missing given name', () => {
		expect(entryAuthor(entry({ author_lname: 'qntm' }))).toBe('qntm');
	});
});

describe('matchEntries', () => {
	it('matches on ISBN across the 10/13 boundary', () => {
		const items = [
			book('book-goodreads-1', 'Tiamat’s Wrath', {
				metadata: { isbn: '9780316332873' },
			}),
		];
		const [match] = matchEntries(
			[entry({ isbn: '0316332879', title: "Tiamat's Wrath" })],
			items,
		);
		expect(match.kind).toBe('isbn');
		expect(match.item?.id).toBe('book-goodreads-1');
	});

	it('prefers ISBN over a title collision', () => {
		const items = [
			book('book-goodreads-1', 'Normal', {
				metadata: { isbn: '9780316332873' },
			}),
			book('book-goodreads-2', 'Normal', { creator: 'Warren Ellis' }),
		];
		const [match] = matchEntries(
			[entry({ isbn: '0316332879', title: 'Normal', author_lname: 'Ellis' })],
			items,
		);
		expect(match.kind).toBe('isbn');
		expect(match.item?.id).toBe('book-goodreads-1');
	});

	it('falls back to title and author when no ISBN matches', () => {
		const items = [
			book('book-goodreads-9', 'Ninefox Gambit', { creator: 'Yoon Ha Lee' }),
		];
		const [match] = matchEntries(
			[
				entry({
					isbn: '0000000000FAKE',
					title: 'Ninefox Gambit',
					author_lname: 'Ha Lee',
				}),
			],
			items,
		);
		expect(match.kind).toBe('title');
		expect(match.item?.id).toBe('book-goodreads-9');
	});

	it('matches a title whose Logbook copy carries a series suffix', () => {
		const items = [
			book('book-goodreads-3', 'Radiant Star (Imperial Radch)', {
				creator: 'Ann Leckie',
			}),
		];
		const [match] = matchEntries(
			[
				entry({
					isbn: 'B0FAKE00',
					title: 'Radiant Star',
					author_lname: 'Leckie',
				}),
			],
			items,
		);
		expect(match.kind).toBe('title');
	});

	it('reports a title match with competing candidates as ambiguous', () => {
		const items = [
			book('book-goodreads-1', 'Normal: Book 1', { creator: 'Warren Ellis' }),
			book('book-goodreads-2', 'Normal: Book 2', { creator: 'Warren Ellis' }),
		];
		const [match] = matchEntries(
			[entry({ isbn: 'B0FAKE00', title: 'Normal', author_lname: 'Ellis' })],
			items,
		);
		expect(match.kind).toBe('ambiguous');
		expect(match.candidates).toHaveLength(2);
		expect(match.item).toBeUndefined();
	});

	it('does not match a same-titled book by a different author', () => {
		const items = [
			book('book-goodreads-1', 'City of Bones', { creator: 'Cassandra Clare' }),
		];
		const [match] = matchEntries(
			[
				entry({
					isbn: 'B0FAKE00',
					title: 'City of Bones',
					author_lname: 'Wells',
				}),
			],
			items,
		);
		expect(match.kind).toBe('none');
	});

	it('uses a manual override to reach a pen name', () => {
		const items = [
			book('book-goodreads-16066335', 'Fine Structure', { creator: 'qntm' }),
		];
		const [match] = matchEntries(
			[
				entry({
					isbn: 'B07DW2PMS6',
					title: 'Fine Structure',
					author_lname: 'Hughes',
				}),
			],
			items,
		);
		expect(match.kind).toBe('override');
		expect(match.item?.id).toBe('book-goodreads-16066335');
	});

	it('reports an override whose target is missing as unmatched', () => {
		const [match] = matchEntries(
			[
				entry({
					isbn: 'B07DW2PMS6',
					title: 'Fine Structure',
					author_lname: 'Hughes',
				}),
			],
			[],
		);
		expect(match.kind).toBe('none');
	});

	it('reports an entry with no counterpart as unmatched', () => {
		const [match] = matchEntries([entry({ title: 'Fluency' })], []);
		expect(match.kind).toBe('none');
	});
});

describe('applyRecovered', () => {
	it('fills all four fields on an untouched item', () => {
		const result = applyRecovered(
			book('book-goodreads-1', 'Caliban'),
			entry({
				is_purchased: true,
				is_prioritized: true,
				source: 'io9',
				note: 'Life on the Moon.',
			}),
		);
		expect(result.item.is_purchased).toBe(true);
		expect(result.item.is_prioritized).toBe(true);
		expect(result.item.recommended_by).toBe('io9');
		expect(result.item.notes).toBe('Life on the Moon.');
		expect(result.changed).toEqual([
			'is_purchased',
			'is_prioritized',
			'recommended_by',
			'notes',
		]);
	});

	it('never overwrites a value Logbook already holds', () => {
		const existing = book('book-goodreads-1', 'Caliban', {
			recommended_by: 'Kara',
			notes: 'Already written.',
		});
		const result = applyRecovered(
			existing,
			entry({ source: 'io9', note: 'Life on the Moon.' }),
		);
		expect(result.item.recommended_by).toBe('Kara');
		expect(result.item.notes).toBe('Already written.');
		expect(result.changed).toEqual([]);
	});

	it('never flips a boolean back to false', () => {
		const existing = book('book-goodreads-1', 'Caliban', {
			is_purchased: true,
		});
		const result = applyRecovered(existing, entry({ is_purchased: false }));
		expect(result.item.is_purchased).toBe(true);
		expect(result.changed).toEqual([]);
	});

	it('ignores blank and null source and note values', () => {
		// The old database stores an unset field as null, and some are whitespace.
		const result = applyRecovered(
			book('book-goodreads-1', 'Caliban'),
			entry({ source: null, note: '   ' }),
		);
		expect(result.item.recommended_by).toBeUndefined();
		expect(result.item.notes).toBeUndefined();
		expect(result.changed).toEqual([]);
	});

	it('leaves the original item untouched', () => {
		const original = book('book-goodreads-1', 'Caliban');
		applyRecovered(original, entry({ is_purchased: true }));
		expect(original.is_purchased).toBe(false);
	});
});

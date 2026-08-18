import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import {
	absorbTwin,
	bookTitleKey,
	bookTitlesMatch,
	findBookTwin,
} from './bookTwin';

function book(overrides: Partial<Item> & { title: string }): Item {
	return {
		id: `book-google-books-${overrides.title.replace(/\W/g, '')}`,
		type: 'book',
		provider: 'google-books',
		status: 'complete',
		is_purchased: false,
		is_prioritized: false,
		completed_dates: [],
		completed_years: [],
		tags: [],
		metadata: {},
		...overrides,
	};
}

describe('bookTitleKey', () => {
	it('expands volume abbreviations so providers converge', () => {
		expect(bookTitleKey('Saga Vol. 3')).toBe('saga volume 3');
		expect(bookTitleKey('Saga, Volume 3')).toBe('saga volume 3');
	});

	it('leaves an issue number alone', () => {
		expect(bookTitleKey('Saga #1')).toBe('saga 1');
	});
});

describe('bookTitlesMatch', () => {
	it('matches the same book written two ways', () => {
		expect(bookTitlesMatch('Saga Vol. 3', 'Saga, Volume 3')).toBe(true);
	});

	it('ignores case and punctuation drift', () => {
		expect(bookTitlesMatch('Elric of Melniboné', 'Elric Of Melnibone')).toBe(
			true,
		);
	});

	it('rejects a different book by the same author', () => {
		expect(bookTitlesMatch('Dune Messiah', 'Dune')).toBe(false);
	});

	it('rejects different volumes of one series', () => {
		expect(bookTitlesMatch('Saga, Volume 1', 'Saga, Volume 3')).toBe(false);
		expect(bookTitlesMatch('Normal: Book 1', 'Normal: Book 4')).toBe(false);
	});

	it('does not fold a single issue into the collected volume', () => {
		expect(bookTitlesMatch('Saga #1', 'Saga, Volume 1')).toBe(false);
	});

	it('will not let a bare series title reach a numbered volume', () => {
		expect(bookTitlesMatch('Saga', 'Saga, Volume 3')).toBe(false);
	});
});

describe('findBookTwin', () => {
	const target = book({
		title: 'Saga, Volume 3',
		creator: 'Brian K. Vaughan',
		id: 'book-goodreads-1',
		provider: 'goodreads',
	});

	it('matches on title and author across different editions', () => {
		const twin = book({ title: 'Saga Vol. 3', creator: 'Brian K. Vaughan' });
		const match = findBookTwin([twin], target);
		expect(match).toEqual({ kind: 'title', twin });
	});

	it('prefers an exact ISBN when the editions do agree', () => {
		const byIsbn = book({
			title: 'Something Else Entirely',
			metadata: { isbn: '9781632150646' },
		});
		const withIsbn = { ...target, metadata: { isbn: '9781632150646' } };
		expect(findBookTwin([byIsbn], withIsbn)).toEqual({
			kind: 'isbn',
			twin: byIsbn,
		});
	});

	it('requires the authors to agree', () => {
		const twin = book({ title: 'Saga Vol. 3', creator: 'Someone Else' });
		expect(findBookTwin([twin], target)).toEqual({ kind: 'none' });
	});

	it('reports ambiguity rather than guessing', () => {
		const a = book({
			title: 'Saga Vol. 3',
			creator: 'Brian K. Vaughan',
			id: 'a',
		});
		const b = book({
			title: 'Saga, Volume 3',
			creator: 'Brian K. Vaughan',
			id: 'b',
		});
		const match = findBookTwin([a, b], target);
		expect(match.kind).toBe('ambiguous');
	});

	it('finds nothing when no candidate names the same book', () => {
		expect(findBookTwin([book({ title: 'Dune' })], target)).toEqual({
			kind: 'none',
		});
	});
});

describe('absorbTwin', () => {
	const keeper = book({
		title: 'The Dracula Tape',
		id: 'book-goodreads-1',
		provider: 'goodreads',
		tags: ['horror'],
	});

	it('carries the user-owned fields the sync never writes', () => {
		const twin = book({
			title: 'The Dracula Tape',
			notes: 'a note',
			recommended_by: 'Polygon',
			is_purchased: true,
			is_prioritized: true,
		});
		const { item, carried } = absorbTwin(keeper, twin);
		expect(item.notes).toBe('a note');
		expect(item.recommended_by).toBe('Polygon');
		expect(item.is_purchased).toBe(true);
		expect(item.is_prioritized).toBe(true);
		expect(carried.map((c) => c.field)).toEqual([
			'notes',
			'recommended_by',
			'is_purchased',
			'is_prioritized',
		]);
	});

	it('never overwrites a value the keeper already holds', () => {
		const held = { ...keeper, notes: 'mine', recommended_by: 'Chuck' };
		const twin = book({
			title: 'The Dracula Tape',
			notes: 'theirs',
			recommended_by: 'Someone',
		});
		const { item, carried } = absorbTwin(held, twin);
		expect(item.notes).toBe('mine');
		expect(item.recommended_by).toBe('Chuck');
		expect(carried).toEqual([]);
	});

	it('does not carry auto-derived tags', () => {
		const twin = book({
			title: 'The Dracula Tape',
			tags: ['bilingual materials'],
		});
		expect(absorbTwin(keeper, twin).item.tags).toEqual(['horror']);
	});

	it('unions completion dates', () => {
		const held = { ...keeper, completed_dates: ['2016-04-11'] };
		const twin = book({
			title: 'The Dracula Tape',
			completed_dates: ['2014-01-02'],
		});
		expect(absorbTwin(held, twin).item.completed_dates).toEqual([
			'2014-01-02',
			'2016-04-11',
		]);
	});
});

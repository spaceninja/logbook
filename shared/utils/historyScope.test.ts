import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { topRatedItems, unratedItems } from './historyScope';

function makeItem(overrides: Partial<Item> = {}): Item {
	return {
		id: overrides.id ?? 'id',
		type: 'book',
		title: 'Untitled',
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

const ids = (items: Item[]) => items.map((i) => i.id);

describe('unratedItems', () => {
	it('keeps completions with no rating and drops rated ones', () => {
		const unrated = makeItem({ id: 'unrated' });
		const rated = makeItem({ id: 'rated', my_rating: 7 });
		expect(ids(unratedItems([unrated, rated]))).toEqual(['unrated']);
	});

	it('treats a rating of 0 as unrated', () => {
		const zero = makeItem({ id: 'zero', my_rating: 0 });
		expect(ids(unratedItems([zero]))).toEqual(['zero']);
	});

	it('excludes DNF items', () => {
		const dnf = makeItem({ id: 'dnf', status: 'dnf' });
		expect(unratedItems([dnf])).toEqual([]);
	});

	it('excludes items that were never completed', () => {
		const backlog = makeItem({ id: 'backlog', status: 'backlog' });
		const started = makeItem({ id: 'started', status: 'in_progress' });
		expect(unratedItems([backlog, started])).toEqual([]);
	});

	it('includes undated completions and dated re-reads still in the backlog', () => {
		const undated = makeItem({ id: 'undated' });
		const reread = makeItem({
			id: 'reread',
			status: 'backlog',
			completed_dates: ['2019-04-01'],
			completed_years: [2019],
		});
		expect(ids(unratedItems([undated, reread]))).toEqual(['undated', 'reread']);
	});
});

describe('topRatedItems', () => {
	it('orders by rating, highest first', () => {
		const items = [
			makeItem({ id: 'mid', my_rating: 6 }),
			makeItem({ id: 'high', my_rating: 10 }),
			makeItem({ id: 'low', my_rating: 2 }),
		];
		expect(ids(topRatedItems(items))).toEqual(['high', 'mid', 'low']);
	});

	it('drops unrated and uncompleted items', () => {
		const rated = makeItem({ id: 'rated', my_rating: 8 });
		const unrated = makeItem({ id: 'unrated' });
		const backlog = makeItem({
			id: 'backlog',
			status: 'backlog',
			my_rating: 9,
		});
		expect(ids(topRatedItems([rated, unrated, backlog]))).toEqual(['rated']);
	});

	it('breaks a tie at the cut-off by title, deterministically', () => {
		const items = [
			makeItem({ id: 'b', title: 'Beta', my_rating: 8 }),
			makeItem({ id: 'a', title: 'Alpha', my_rating: 8 }),
		];
		expect(ids(topRatedItems(items, 1))).toEqual(['a']);
	});

	it('caps the list at the limit without mutating the input', () => {
		const items = [
			makeItem({ id: 'one', my_rating: 1 }),
			makeItem({ id: 'ten', my_rating: 10 }),
		];
		expect(ids(topRatedItems(items, 1))).toEqual(['ten']);
		expect(ids(items)).toEqual(['one', 'ten']);
	});
});

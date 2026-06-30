import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../types/item';
import { applyItemFilters } from './itemFilter';

function makeItem(overrides: Partial<Item> = {}): Item {
	return {
		id: overrides.id ?? 'id',
		type: 'book',
		title: 'Untitled',
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

const ids = (items: Item[]) => items.map((i) => i.id);

describe('applyItemFilters', () => {
	it('is a no-op when every filter is "all"', () => {
		const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
		expect(applyItemFilters(items, { purchased: 'all' })).toBe(items);
	});

	it('keeps matching items for "yes" and non-matching for "no"', () => {
		const bought = makeItem({ id: 'bought', is_purchased: true });
		const notBought = makeItem({ id: 'not', is_purchased: false });
		const items = [bought, notBought];
		expect(ids(applyItemFilters(items, { purchased: 'yes' }))).toEqual([
			'bought',
		]);
		expect(ids(applyItemFilters(items, { purchased: 'no' }))).toEqual(['not']);
	});

	it('filters on prioritized', () => {
		const hi = makeItem({ id: 'hi', is_prioritized: true });
		const lo = makeItem({ id: 'lo', is_prioritized: false });
		expect(ids(applyItemFilters([hi, lo], { prioritized: 'yes' }))).toEqual([
			'hi',
		]);
	});

	it('combines multiple active filters (AND)', () => {
		const both = makeItem({
			id: 'both',
			is_purchased: true,
			is_prioritized: true,
		});
		const onlyBought = makeItem({ id: 'one', is_purchased: true });
		const items = [both, onlyBought];
		expect(
			ids(applyItemFilters(items, { purchased: 'yes', prioritized: 'yes' })),
		).toEqual(['both']);
	});

	describe('released', () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-06-26T00:00:00Z'));
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it('treats a past date as released and a future date as not', () => {
			const past = makeItem({ id: 'past', release_date: '2020-01-01' });
			const future = makeItem({ id: 'future', release_date: '2030-01-01' });
			const undated = makeItem({ id: 'undated' });
			const items = [past, future, undated];
			expect(ids(applyItemFilters(items, { released: 'yes' }))).toEqual([
				'past',
			]);
			expect(ids(applyItemFilters(items, { released: 'no' }))).toEqual([
				'future',
				'undated',
			]);
		});
	});
});

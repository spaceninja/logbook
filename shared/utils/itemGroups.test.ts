import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { groupBacklogItems } from './itemGroups';

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

describe('groupBacklogItems', () => {
	it('pulls in-progress items into a labelled group above the rest', () => {
		const groups = groupBacklogItems([
			makeItem({ id: 'waiting' }),
			makeItem({ id: 'started', status: 'in_progress' }),
			makeItem({ id: 'later' }),
		]);
		expect(groups.map((g) => g.label)).toEqual(['In Progress', 'Backlog']);
		expect(ids(groups[0]!.items)).toEqual(['started']);
		expect(ids(groups[1]!.items)).toEqual(['waiting', 'later']);
	});

	it('preserves the incoming sort order within each group', () => {
		const groups = groupBacklogItems([
			makeItem({ id: 'b', status: 'in_progress' }),
			makeItem({ id: 'c' }),
			makeItem({ id: 'a', status: 'in_progress' }),
			makeItem({ id: 'd' }),
		]);
		expect(ids(groups[0]!.items)).toEqual(['b', 'a']);
		expect(ids(groups[1]!.items)).toEqual(['c', 'd']);
	});

	it('leaves a list with nothing in progress as one unlabelled group', () => {
		const items = [makeItem({ id: 'waiting' }), makeItem({ id: 'later' })];
		const groups = groupBacklogItems(items);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.label).toBeUndefined();
		expect(ids(groups[0]!.items)).toEqual(['waiting', 'later']);
	});

	it('drops the backlog group when everything is in progress', () => {
		const groups = groupBacklogItems([
			makeItem({ id: 'started', status: 'in_progress' }),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.label).toBe('In Progress');
		expect(ids(groups[0]!.items)).toEqual(['started']);
	});

	it('returns one empty group for an empty list', () => {
		expect(groupBacklogItems([])).toEqual([{ key: 'all', items: [] }]);
	});
});

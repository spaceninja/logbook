import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import { applyItemSearch, searchTerms } from './itemSearch';

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

describe('searchTerms', () => {
	it('lowercases and splits on whitespace', () => {
		expect(searchTerms('Dune Part')).toEqual(['dune', 'part']);
	});

	it('yields nothing for a blank query', () => {
		expect(searchTerms('')).toEqual([]);
		expect(searchTerms('   ')).toEqual([]);
	});
});

describe('applyItemSearch', () => {
	it('returns the input untouched for a blank query', () => {
		const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
		expect(applyItemSearch(items, '')).toBe(items);
		expect(applyItemSearch(items, '  ')).toBe(items);
	});

	it('matches a substring of the title, not just a prefix', () => {
		const dune = makeItem({ id: 'dune', title: 'Dune' });
		const children = makeItem({ id: 'children', title: 'Children of Dune' });
		const other = makeItem({ id: 'other', title: 'Neuromancer' });
		expect(ids(applyItemSearch([dune, children, other], 'dune'))).toEqual([
			'dune',
			'children',
		]);
	});

	it('is case-insensitive', () => {
		const item = makeItem({ id: 'a', title: 'Dune' });
		expect(ids(applyItemSearch([item], 'DUNE'))).toEqual(['a']);
		expect(ids(applyItemSearch([item], 'dUnE'))).toEqual(['a']);
	});

	it('requires every term to match (AND)', () => {
		const one = makeItem({ id: 'one', title: 'Dune Messiah' });
		const two = makeItem({ id: 'two', title: 'Dune' });
		expect(ids(applyItemSearch([one, two], 'dune messiah'))).toEqual(['one']);
	});

	it('matches terms across intervening punctuation', () => {
		const item = makeItem({ id: 'a', title: 'Dune: Part Two' });
		expect(ids(applyItemSearch([item], 'dune part'))).toEqual(['a']);
	});

	it('matches terms in any order', () => {
		const item = makeItem({ id: 'a', title: 'Dune: Part Two' });
		expect(ids(applyItemSearch([item], 'two dune'))).toEqual(['a']);
	});

	it('matches on a single creator', () => {
		const item = makeItem({ id: 'a', title: 'Dune', creator: 'Frank Herbert' });
		expect(ids(applyItemSearch([item], 'herbert'))).toEqual(['a']);
	});

	it('matches on any of several creators', () => {
		const item = makeItem({
			id: 'a',
			title: 'Good Omens',
			creator: ['Terry Pratchett', 'Neil Gaiman'],
		});
		expect(ids(applyItemSearch([item], 'gaiman'))).toEqual(['a']);
	});

	it('matches on the series name', () => {
		const item = makeItem({
			id: 'a',
			title: 'Leviathan Wakes',
			metadata: { series: 'The Expanse', series_number: 1 },
		});
		expect(ids(applyItemSearch([item], 'expanse'))).toEqual(['a']);
	});

	it('combines terms across title and creator', () => {
		const match = makeItem({
			id: 'match',
			title: 'Dune',
			creator: 'Frank Herbert',
		});
		const wrongAuthor = makeItem({
			id: 'wrong',
			title: 'Dune',
			creator: 'Brian Herbert',
		});
		expect(ids(applyItemSearch([match, wrongAuthor], 'dune frank'))).toEqual([
			'match',
		]);
	});

	it('matches a show on its name, without the season suffix interfering', () => {
		const season1 = makeItem({
			id: 's1',
			type: 'show',
			title: 'Severance',
			metadata: {
				show_tmdb_id: 1,
				season_number: 1,
				episode_count: 9,
				episode_runtime: 45,
			},
		});
		const season2 = makeItem({
			id: 's2',
			type: 'show',
			title: 'Severance',
			metadata: {
				show_tmdb_id: 1,
				season_number: 2,
				episode_count: 10,
				episode_runtime: 45,
			},
		});
		expect(ids(applyItemSearch([season1, season2], 'severance'))).toEqual([
			's1',
			's2',
		]);
	});

	it('returns nothing when no item matches', () => {
		const item = makeItem({ id: 'a', title: 'Dune' });
		expect(applyItemSearch([item], 'neuromancer')).toEqual([]);
	});

	it('tolerates items with no creator or series', () => {
		const item = makeItem({ id: 'a', title: 'Dune' });
		expect(ids(applyItemSearch([item], 'dune'))).toEqual(['a']);
	});
});

import { describe, expect, it } from 'vitest';
import type { Item } from '../types/item';
import {
	itemDisplayTitle,
	itemPageTitle,
	mediaTypeLabel,
	formatCreator,
	formatSeries,
	formatCompletedDate,
	formatCompletedDateWithYear,
} from './itemDisplay';

function makeShow(overrides: Partial<Item> = {}): Item {
	return {
		id: 'show-1',
		type: 'show',
		title: 'Avatar: The Last Airbender',
		status: 'backlog',
		is_purchased: false,
		is_prioritized: false,
		completed_dates: [],
		completed_years: [],
		tags: [],
		metadata: {
			show_tmdb_id: 1,
			season_number: 1,
			episode_count: 20,
			episode_runtime: 23,
		},
		...overrides,
	};
}

describe('itemDisplayTitle', () => {
	it('composes show + season for a season without its own title', () => {
		expect(itemDisplayTitle(makeShow())).toBe(
			'Avatar: The Last Airbender — Season 1',
		);
	});

	it('keeps the title clean when a season has its own title (shown separately)', () => {
		const show = makeShow({
			metadata: {
				show_tmdb_id: 1,
				season_number: 1,
				episode_count: 20,
				episode_runtime: 23,
				season_title: 'Book One: Water',
			},
		});
		expect(itemDisplayTitle(show)).toBe(
			'Avatar: The Last Airbender — Season 1',
		);
	});

	it('uses the title verbatim for non-shows', () => {
		const book = makeShow({ type: 'book', title: 'Dune', metadata: {} });
		expect(itemDisplayTitle(book)).toBe('Dune');
	});
});

describe('itemPageTitle', () => {
	it('appends the series position when there is one', () => {
		const book = makeShow({
			type: 'book',
			title: 'Leviathan Wakes',
			metadata: { series: 'Expanse', series_number: 1 },
		});
		expect(itemPageTitle(book)).toBe('Leviathan Wakes, Expanse #1');
	});

	it('is the display title alone without a series', () => {
		const book = makeShow({
			type: 'book',
			title: 'Project Hail Mary',
			metadata: {},
		});
		expect(itemPageTitle(book)).toBe('Project Hail Mary');
	});

	it('uses the composed season title for shows', () => {
		expect(itemPageTitle(makeShow())).toBe(
			'Avatar: The Last Airbender — Season 1',
		);
	});
});

describe('mediaTypeLabel', () => {
	it('gives a plural, title-cased label per type', () => {
		expect(mediaTypeLabel('book')).toBe('Books');
		expect(mediaTypeLabel('movie')).toBe('Movies');
		expect(mediaTypeLabel('show')).toBe('Shows');
		expect(mediaTypeLabel('game')).toBe('Games');
	});
});

describe('formatCreator', () => {
	it('joins an array of creators', () => {
		expect(formatCreator(['Joel Coen', 'Ethan Coen'])).toBe(
			'Joel Coen, Ethan Coen',
		);
	});

	it('returns a single creator as-is and empty for none', () => {
		expect(formatCreator('Andy Weir')).toBe('Andy Weir');
		expect(formatCreator(undefined)).toBe('');
	});
});

describe('formatSeries', () => {
	const book = (meta: object) =>
		makeShow({ type: 'book', title: 'X', metadata: meta });

	it('formats series name and number', () => {
		expect(formatSeries(book({ series: 'Dune', series_number: 2 }))).toBe(
			'Dune #2',
		);
	});

	it('omits the number when absent', () => {
		expect(formatSeries(book({ series: 'Discworld' }))).toBe('Discworld');
	});

	it('is empty when there is no series', () => {
		expect(formatSeries(book({}))).toBe('');
	});

	it('is empty for shows (the season is in the title)', () => {
		expect(formatSeries(makeShow())).toBe('');
	});
});

describe('formatCompletedDate', () => {
	it('formats an ISO date as a short "Mon D" label', () => {
		expect(formatCompletedDate('2026-01-30')).toBe('Jan 30');
	});

	it('keeps the calendar day stable regardless of viewer timezone', () => {
		expect(formatCompletedDate('2026-12-01')).toBe('Dec 1');
	});

	it('tolerates a full ISO timestamp', () => {
		expect(formatCompletedDate('2026-07-04T13:45:00Z')).toBe('Jul 4');
	});
});

describe('formatCompletedDateWithYear', () => {
	it('includes the year, for results that span years', () => {
		expect(formatCompletedDateWithYear('2024-03-03')).toBe('Mar 3, 2024');
	});

	it('keeps the calendar day stable regardless of viewer timezone', () => {
		expect(formatCompletedDateWithYear('2026-12-01')).toBe('Dec 1, 2026');
	});

	it('tolerates a full ISO timestamp', () => {
		expect(formatCompletedDateWithYear('2026-07-04T13:45:00Z')).toBe(
			'Jul 4, 2026',
		);
	});
});

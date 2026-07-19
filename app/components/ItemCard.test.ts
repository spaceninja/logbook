import { renderSuspended } from '@nuxt/test-utils/runtime';
import { screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import type { Item } from '~~/shared/types/item';
import ItemCard from './ItemCard.vue';

function makeItem(overrides: Partial<Item> = {}): Item {
	return {
		id: 'id',
		type: 'movie',
		title: 'Dune',
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

/**
 * Search results mix backlog and completed items, so the card spells out the
 * unfinished ones (#40). The "backlog item that also has a completion date"
 * case — a re-watch queued up again — is the reason the label keys off `status`
 * rather than the absence of dates.
 */
describe('ItemCard status label (search view)', () => {
	it('shows the completion date and no label for a completed item', async () => {
		await renderSuspended(ItemCard, {
			props: {
				item: makeItem({
					status: 'complete',
					completed_dates: ['2019-11-16'],
					completed_years: [2019],
				}),
				view: 'search',
			},
		});

		expect(screen.getByText('Nov 16, 2019')).toBeInTheDocument();
		expect(screen.queryByText('Backlog')).not.toBeInTheDocument();
		expect(screen.queryByText('In progress')).not.toBeInTheDocument();
	});

	it('shows "Backlog" and no date for an unstarted item', async () => {
		await renderSuspended(ItemCard, {
			props: { item: makeItem({ status: 'backlog' }), view: 'search' },
		});

		expect(screen.getByText('Backlog')).toBeInTheDocument();
		expect(screen.queryByText(/\d{4}$/)).not.toBeInTheDocument();
	});

	it('shows both the date and the label when an item is completed and queued again', async () => {
		await renderSuspended(ItemCard, {
			props: {
				item: makeItem({
					status: 'backlog',
					completed_dates: ['2019-11-16'],
					completed_years: [2019],
				}),
				view: 'search',
			},
		});

		expect(screen.getByText('Nov 16, 2019')).toBeInTheDocument();
		expect(screen.getByText('Backlog')).toBeInTheDocument();
	});

	it('distinguishes an in-progress item from an unstarted one', async () => {
		await renderSuspended(ItemCard, {
			props: { item: makeItem({ status: 'in_progress' }), view: 'search' },
		});

		expect(screen.getByText('In progress')).toBeInTheDocument();
		expect(screen.queryByText('Backlog')).not.toBeInTheDocument();
	});

	it('shows no label for a did-not-finish item, which has its own badge', async () => {
		await renderSuspended(ItemCard, {
			props: {
				item: makeItem({
					status: 'dnf',
					completed_dates: ['2019-11-16'],
					completed_years: [2019],
				}),
				view: 'search',
			},
		});

		expect(screen.getByText('DNF')).toBeInTheDocument();
		expect(screen.queryByText('Backlog')).not.toBeInTheDocument();
	});

	it('omits the label entirely on the backlog and history views', async () => {
		for (const view of ['backlog', 'history'] as const) {
			const { unmount } = await renderSuspended(ItemCard, {
				props: { item: makeItem({ status: 'backlog' }), view },
			});

			expect(screen.queryByText('Backlog')).not.toBeInTheDocument();
			unmount();
		}
	});
});

describe('ItemCard completion dates', () => {
	it('includes the year on search but not on history', async () => {
		const item = makeItem({
			status: 'complete',
			completed_dates: ['2019-11-16'],
			completed_years: [2019],
		});

		const { unmount } = await renderSuspended(ItemCard, {
			props: { item, view: 'search' },
		});
		expect(screen.getByText('Nov 16, 2019')).toBeInTheDocument();
		unmount();

		await renderSuspended(ItemCard, {
			props: { item, view: 'history', year: 2019 },
		});
		expect(screen.getByText('Nov 16')).toBeInTheDocument();
	});

	it('shows every completion on search, not just the selected year', async () => {
		await renderSuspended(ItemCard, {
			props: {
				item: makeItem({
					status: 'complete',
					completed_dates: ['2019-11-16', '2024-03-03'],
					completed_years: [2019, 2024],
				}),
				view: 'search',
			},
		});

		expect(screen.getByText('Nov 16, 2019')).toBeInTheDocument();
		expect(screen.getByText('Mar 3, 2024')).toBeInTheDocument();
	});
});

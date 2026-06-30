import { mount } from '@vue/test-utils';
import { fireEvent, render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import type { Item } from '~~/shared/types/item';
import ItemForm from './ItemForm.vue';

// Submit by dispatching the form's submit event directly. Unlike clicking the
// submit button, this bypasses native constraint validation — which keeps the
// component's real-browser validation intact while sidestepping a jsdom bug in
// its `step` constraint check. It still runs our @submit.prevent handler.
function submitForm() {
	return fireEvent.submit(screen.getByRole('form'));
}

describe('ItemForm', () => {
	it('emits a manual-id item assembled from the inputs (create)', async () => {
		const { emitted } = render(ItemForm, { props: { mode: 'create' } });

		await fireEvent.update(screen.getByLabelText('Type'), 'movie');
		await fireEvent.update(screen.getByLabelText('Title'), 'Inception');
		await fireEvent.update(
			screen.getByLabelText(/Creator \(/),
			'Nolan, Thomas',
		);
		await fireEvent.update(screen.getByLabelText(/Tags/), 'sci-fi, heist');
		await submitForm();

		const item = (emitted().submit as [Item][])[0]![0];
		expect(item.id).toMatch(/^movie-manual-/);
		expect(item.type).toBe('movie');
		expect(item.title).toBe('Inception');
		expect(item.creator).toStrictEqual(['Nolan', 'Thomas']);
		expect(item.tags).toStrictEqual(['sci-fi', 'heist']);
		expect(item.provider).toBe('manual');
		expect(item.status).toBe('backlog');
		expect(item.completed_dates).toStrictEqual([]);
		expect(item.completed_years).toStrictEqual([]);
		expect(item.metadata).toStrictEqual({});
	});

	it('keeps the existing id and derives completed_years (edit)', async () => {
		const initial: Item = {
			id: 'movie-tmdb-27205',
			type: 'movie',
			title: 'Inception',
			provider: 'tmdb',
			status: 'complete',
			is_purchased: false,
			is_prioritized: false,
			completed_dates: ['2024-01-02', '2026-02-14'],
			completed_years: [2024, 2026],
			tags: [],
			metadata: {},
		};
		const { emitted } = render(ItemForm, {
			props: { mode: 'edit', initial },
		});

		await submitForm();

		const item = (emitted().submit as [Item][])[0]![0];
		expect(item.id).toBe('movie-tmdb-27205');
		expect(item.completed_years).toStrictEqual([2024, 2026]);
	});

	it('swaps the metadata block when the type changes', async () => {
		render(ItemForm, { props: { mode: 'create' } });

		await fireEvent.update(screen.getByLabelText('Type'), 'book');
		expect(screen.getByText('Book details')).toBeInTheDocument();
		expect(screen.getByLabelText('Series')).toBeInTheDocument();

		await fireEvent.update(screen.getByLabelText('Type'), 'show');
		expect(screen.getByText('Show details')).toBeInTheDocument();
		expect(screen.getByLabelText('Season number')).toBeInTheDocument();
	});

	it('blocks submit and shows an error when the title is empty', async () => {
		const { emitted } = render(ItemForm, { props: { mode: 'create' } });

		await submitForm();

		expect(emitted().submit).toBeUndefined();
		expect(screen.getByRole('alert')).toHaveTextContent('Title is required.');
	});

	it('keeps the provider id when creating from a draft', async () => {
		const draft: Item = {
			id: 'movie-tmdb-27205',
			type: 'movie',
			title: 'Inception',
			provider: 'tmdb',
			status: 'backlog',
			is_purchased: false,
			is_prioritized: false,
			completed_dates: [],
			completed_years: [],
			tags: ['action'],
			metadata: {},
		};
		const { emitted } = render(ItemForm, {
			props: { mode: 'create', initial: draft },
		});

		await submitForm();

		expect((emitted().submit as [Item][])[0]![0].id).toBe('movie-tmdb-27205');
	});

	it('submits after editing a numeric input (number-typed v-model)', async () => {
		// Regression: `<input type="number">` v-model yields a number once edited,
		// which previously crashed assemble's string-trimming.
		const { emitted } = render(ItemForm, {
			props: { mode: 'create', initialType: 'movie' },
		});

		await fireEvent.update(screen.getByLabelText('Title'), 'Inception');
		await fireEvent.update(screen.getByLabelText(/Community rating/), '6.7');
		await submitForm();

		expect((emitted().submit as [Item][])[0]![0].community_rating).toBe(6.7);
	});

	it('applyProviderFields overwrites provider fields but keeps user fields', async () => {
		const initial: Item = {
			id: 'movie-tmdb-1',
			type: 'movie',
			title: 'Old Title',
			provider: 'tmdb',
			status: 'complete',
			my_rating: 9,
			is_purchased: true,
			is_prioritized: false,
			completed_dates: ['2025-01-01'],
			completed_years: [2025],
			notes: 'my notes',
			tags: ['fav'],
			metadata: {},
		};
		const wrapper = mount(ItemForm, { props: { mode: 'edit', initial } });

		// A fresh provider draft (with different values in both groups).
		const fresh: Item = {
			...initial,
			title: 'New Title',
			description: 'Fresh synopsis',
			community_rating: 8.5,
			my_rating: 1,
			notes: 'should-not-apply',
		};
		(wrapper.vm as InstanceType<typeof ItemForm>).applyProviderFields(fresh);
		await wrapper.find('form').trigger('submit');

		const item = wrapper.emitted('submit')![0]![0] as Item;
		expect(item.title).toBe('New Title'); // provider field overwritten
		expect(item.description).toBe('Fresh synopsis'); // provider field applied
		expect(item.community_rating).toBe(8.5); // provider field applied
		expect(item.my_rating).toBe(9); // user field preserved
		expect(item.notes).toBe('my notes'); // user field preserved
		expect(item.status).toBe('complete'); // user field preserved
	});

	it('derives creator_sort on submit when the field is left blank', async () => {
		const { emitted } = render(ItemForm, {
			props: { mode: 'create', initialType: 'book' },
		});

		await fireEvent.update(screen.getByLabelText('Title'), 'Project Hail Mary');
		await fireEvent.update(screen.getByLabelText(/Creator \(/), 'Andy Weir');
		await submitForm();

		expect((emitted().submit as [Item][])[0]![0].creator_sort).toBe(
			'Weir Andy',
		);
	});

	it('pre-fills creator_sort from an existing creator and persists overrides', async () => {
		const initial: Item = {
			id: 'book-1',
			type: 'book',
			title: 'A Wizard of Earthsea',
			creator: 'Ursula K. Le Guin',
			provider: 'goodreads',
			status: 'backlog',
			is_purchased: false,
			is_prioritized: false,
			completed_dates: [],
			completed_years: [],
			tags: [],
			metadata: {},
		};
		const { emitted } = render(ItemForm, { props: { mode: 'edit', initial } });

		// The heuristic mis-files "Le Guin"; the field shows it and can be corrected.
		const sortField = screen.getByLabelText(/Creator sort key/);
		expect((sortField as HTMLInputElement).value).toBe('Guin Ursula K. Le');
		await fireEvent.update(sortField, 'Le Guin Ursula K.');
		await submitForm();

		expect((emitted().submit as [Item][])[0]![0].creator_sort).toBe(
			'Le Guin Ursula K.',
		);
	});

	it('stores movie series metadata', async () => {
		const { emitted } = render(ItemForm, {
			props: { mode: 'create', initialType: 'movie' },
		});

		await fireEvent.update(
			screen.getByLabelText('Title'),
			'The Fellowship of the Ring',
		);
		await fireEvent.update(
			screen.getByLabelText('Series'),
			'The Lord of the Rings',
		);
		await fireEvent.update(screen.getByLabelText('Series number'), '1');
		await submitForm();

		const item = (emitted().submit as [Item][])[0]![0];
		expect(item.metadata).toStrictEqual({
			series: 'The Lord of the Rings',
			series_number: 1,
		});
	});

	it('preserves a hand-entered movie series across a metadata refresh', async () => {
		const initial: Item = {
			id: 'movie-tmdb-120',
			type: 'movie',
			title: 'The Fellowship of the Ring',
			provider: 'tmdb',
			status: 'backlog',
			is_purchased: false,
			is_prioritized: false,
			completed_dates: [],
			completed_years: [],
			tags: [],
			metadata: { series: 'The Lord of the Rings', series_number: 1 },
		};
		const wrapper = mount(ItemForm, { props: { mode: 'edit', initial } });

		// A fresh TMDB draft has no series info (providers don't return it).
		const fresh: Item = {
			...initial,
			title: 'The Lord of the Rings: The Fellowship of the Ring',
			community_rating: 8.4,
			metadata: {},
		};
		(wrapper.vm as InstanceType<typeof ItemForm>).applyProviderFields(fresh);
		await wrapper.find('form').trigger('submit');

		const item = wrapper.emitted('submit')![0]![0] as Item;
		expect(item.title).toBe(
			'The Lord of the Rings: The Fellowship of the Ring',
		); // provider field refreshed
		expect(item.community_rating).toBe(8.4); // provider field applied
		expect(item.metadata).toStrictEqual({
			series: 'The Lord of the Rings',
			series_number: 1,
		}); // user-maintained series preserved
	});

	it('records a show season title in metadata', async () => {
		const initial: Item = {
			id: 'show-tmdb-246-1',
			type: 'show',
			title: 'Avatar: The Last Airbender',
			provider: 'tmdb',
			status: 'backlog',
			is_purchased: false,
			is_prioritized: false,
			completed_dates: [],
			completed_years: [],
			tags: [],
			metadata: {
				show_tmdb_id: 246,
				season_number: 1,
				episode_count: 20,
				episode_runtime: 23,
				season_title: 'Book One: Water',
			},
		};
		const { emitted } = render(ItemForm, { props: { mode: 'edit', initial } });

		expect(
			(screen.getByLabelText(/Season title/) as HTMLInputElement).value,
		).toBe('Book One: Water');
		await submitForm();

		const item = (emitted().submit as [Item][])[0]![0];
		expect((item.metadata as { season_title?: string }).season_title).toBe(
			'Book One: Water',
		);
	});

	it('starts a manual add on the given initialType with a manual id', async () => {
		const { emitted } = render(ItemForm, {
			props: { mode: 'create', initialType: 'game' },
		});

		await fireEvent.update(screen.getByLabelText('Title'), 'Some Indie Game');
		await submitForm();

		const item = (emitted().submit as [Item][])[0]![0];
		expect(item.type).toBe('game');
		expect(item.id).toMatch(/^game-manual-/);
	});
});

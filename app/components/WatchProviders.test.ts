import { registerEndpoint, renderSuspended } from '@nuxt/test-utils/runtime';
import { screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import type { WatchAvailability } from '~~/shared/types/search';
import WatchProviders from './WatchProviders.vue';

let availability: WatchAvailability = { flatrate: [], rent: [], buy: [] };

registerEndpoint('/api/watch', (): WatchAvailability => availability);

describe('WatchProviders', () => {
	it('groups providers by stream, rent, and buy', async () => {
		availability = {
			flatrate: [{ id: 8, name: 'Netflix', logo: 'https://img/nf.jpg' }],
			rent: [{ id: 3, name: 'Apple TV' }],
			buy: [],
			link: 'https://www.themoviedb.org/movie/27205/watch?locale=US',
		};

		await renderSuspended(WatchProviders, {
			props: { type: 'movie', tmdbId: '27205' },
		});

		expect(
			await screen.findByRole('heading', { name: 'Stream' }),
		).toBeInTheDocument();
		expect(screen.getByText('Netflix')).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Rent' })).toBeInTheDocument();
		expect(screen.getByText('Apple TV')).toBeInTheDocument();
		// Buy is empty, so it gets no heading.
		expect(
			screen.queryByRole('heading', { name: 'Buy' }),
		).not.toBeInTheDocument();
	});

	it('credits JustWatch when it shows availability', async () => {
		availability = {
			flatrate: [{ id: 8, name: 'Netflix' }],
			rent: [],
			buy: [],
		};

		await renderSuspended(WatchProviders, {
			props: { type: 'movie', tmdbId: '27205' },
		});

		expect(await screen.findByText(/JustWatch/)).toBeInTheDocument();
	});

	it('says so when a title is carried nowhere', async () => {
		availability = { flatrate: [], rent: [], buy: [] };

		await renderSuspended(WatchProviders, {
			props: { type: 'show', tmdbId: '95396' },
		});

		expect(
			await screen.findByText(/Not currently available/),
		).toBeInTheDocument();
	});
});

import { registerEndpoint, renderSuspended } from '@nuxt/test-utils/runtime';
import { screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import type { WatchAvailability } from '~~/shared/types/search';
import WatchProviders from './WatchProviders.vue';

let availability: WatchAvailability = { flatrate: [], rent: [], buy: [] };
/** The query the component actually asked for, so tests can assert on it. */
let requestUrl = '';

registerEndpoint('/api/watch', (event): WatchAvailability => {
	requestUrl = String(event.node.req.url);
	return availability;
});

describe('WatchProviders', () => {
	// Regression: the props were once passed to `useFetch` as getter functions,
	// which it stringifies rather than calls — every lookup went out as the
	// literal `type=undefined&id=undefined` and came back a 400.
	it('sends the type and id it was given', async () => {
		availability = { flatrate: [], rent: [], buy: [] };
		requestUrl = '';

		await renderSuspended(WatchProviders, {
			props: { type: 'show', tmdbId: '655' },
		});
		await screen.findByText(/Not currently available/);

		expect(requestUrl).toContain('type=show');
		expect(requestUrl).toContain('id=655');
	});

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

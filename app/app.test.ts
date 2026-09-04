import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime';
import { screen, within } from '@testing-library/vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from './app.vue';

// The nav's links follow whatever type the current page published (#128), so the
// shared state is the input under test.
const { mediaTypeState } = vi.hoisted(() => ({
	mediaTypeState: { type: 'book' },
}));
mockNuxtImport('useCurrentMediaType', () => () => ref(mediaTypeState.type));

/** The layout's primary nav, scoped so in-page links can't collide. */
function nav() {
	return within(screen.getByRole('navigation', { name: 'primary' }));
}

describe('app', () => {
	beforeEach(() => {
		mediaTypeState.type = 'book';
	});

	it('renders the layout navigation', async () => {
		// renderSuspended mounts within the Nuxt runtime (router, plugins, layouts),
		// which the app shell needs — NuxtLayout/NuxtPage read the current route.
		await renderSuspended(app);
		expect(nav().getByRole('link', { name: 'Backlog' })).toBeInTheDocument();
		expect(nav().getByRole('link', { name: 'History' })).toBeInTheDocument();
	});

	it('links to the bare views for the default media type', async () => {
		await renderSuspended(app);
		expect(nav().getByRole('link', { name: 'Backlog' })).toHaveAttribute(
			'href',
			'/',
		);
		expect(nav().getByRole('link', { name: 'History' })).toHaveAttribute(
			'href',
			'/history',
		);
	});

	it('carries the current media type into both links', async () => {
		mediaTypeState.type = 'game';
		await renderSuspended(app);
		expect(nav().getByRole('link', { name: 'Backlog' })).toHaveAttribute(
			'href',
			'/?type=game',
		);
		expect(nav().getByRole('link', { name: 'History' })).toHaveAttribute(
			'href',
			'/history?type=game',
		);
	});
});

import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime';
import { screen } from '@testing-library/vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncRun, SyncRunsDoc } from '~~/shared/utils/syncHealth';
import SyncHealthLink from './SyncHealthLink.vue';

const { getSyncRunsMock } = vi.hoisted(() => ({ getSyncRunsMock: vi.fn() }));

mockNuxtImport('useItems', () => {
	return () => ({ getSyncRuns: getSyncRunsMock });
});

/** A clean run, timestamped now so it never trips the staleness rule. */
function run(overrides: Partial<SyncRun> = {}): SyncRun {
	return {
		at: new Date().toISOString(),
		ok: true,
		attempted: 311,
		written: 12,
		skipped: 2,
		errors: 0,
		errorSamples: [],
		...overrides,
	};
}

function bothSyncs(overrides: Partial<SyncRunsDoc> = {}): SyncRunsDoc {
	return { goodreads: [run()], metadata: [run()], ...overrides };
}

/** Render and let the onMounted fetch settle. */
async function render(doc: SyncRunsDoc | Error) {
	if (doc instanceof Error) getSyncRunsMock.mockRejectedValue(doc);
	else getSyncRunsMock.mockResolvedValue(doc);
	await renderSuspended(SyncHealthLink);
	await vi.waitFor(() => expect(getSyncRunsMock).toHaveBeenCalled());
	await nextTick();
}

describe('SyncHealthLink', () => {
	beforeEach(() => {
		getSyncRunsMock.mockReset();
	});

	it('reports healthy syncs', async () => {
		await render(bothSyncs());
		expect(screen.getByRole('link', { name: /Syncs OK/ })).toBeInTheDocument();
	});

	it('links to the detail page', async () => {
		await render(bothSyncs());
		expect(screen.getByRole('link', { name: /Syncs OK/ })).toHaveAttribute(
			'href',
			'/sync',
		);
	});

	it('counts a single failing sync', async () => {
		await render(bothSyncs({ metadata: [run({ errors: 1 })] }));
		expect(
			screen.getByRole('link', { name: /1 sync issue/ }),
		).toBeInTheDocument();
	});

	it('pluralizes multiple failing syncs', async () => {
		await render({
			goodreads: [run({ errors: 2 })],
			metadata: [run({ ok: false, failure: 'boom' })],
		});
		expect(
			screen.getByRole('link', { name: /2 sync issues/ }),
		).toBeInTheDocument();
	});

	it('shows unknown before anything has been recorded', async () => {
		await render({});
		expect(screen.getByRole('link', { name: /Syncs —/ })).toBeInTheDocument();
	});

	it('degrades to unknown rather than breaking when the read fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await render(new Error('offline'));
		expect(screen.getByRole('link', { name: /Syncs —/ })).toBeInTheDocument();
	});
});

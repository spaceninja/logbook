import { describe, expect, it, vi } from 'vitest';
import { paginate } from './paginate';

/** A feed of `total` numbered items served in pages of `pageSize`. */
function feed(total: number, pageSize: number) {
	return vi.fn((page: number) => {
		const start = (page - 1) * pageSize;
		return Promise.resolve(
			Array.from(
				{ length: Math.max(0, Math.min(pageSize, total - start)) },
				(_, i) => start + i,
			),
		);
	});
}

const opts = { pageSize: 100, maxPages: 10, sleep: () => Promise.resolve() };

describe('paginate', () => {
	it('walks every page of a multi-page feed', async () => {
		const fetchPage = feed(491, 100);
		const items = await paginate(fetchPage, opts);
		expect(items).toHaveLength(491);
		expect(fetchPage).toHaveBeenCalledTimes(5);
	});

	it('stops on the first short page', async () => {
		const fetchPage = feed(75, 100);
		expect(await paginate(fetchPage, opts)).toHaveLength(75);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('fetches one extra page when the total is an exact multiple', async () => {
		// 200 items in pages of 100 look "full" twice; only the empty third page
		// proves the shelf ended.
		const fetchPage = feed(200, 100);
		expect(await paginate(fetchPage, opts)).toHaveLength(200);
		expect(fetchPage).toHaveBeenCalledTimes(3);
	});

	it('handles an empty feed', async () => {
		expect(await paginate(feed(0, 100), opts)).toEqual([]);
	});

	it('throws rather than looping when the feed never ends', async () => {
		const endless = vi.fn(() =>
			Promise.resolve(Array.from({ length: 100 }, (_, i) => i)),
		);
		await expect(paginate(endless, opts)).rejects.toThrow(
			'still a full page at page 10',
		);
		expect(endless).toHaveBeenCalledTimes(10);
	});

	it('propagates a page error instead of returning a partial shelf', async () => {
		const failing = vi.fn((page: number) =>
			page === 2
				? Promise.reject(new Error('HTTP 503'))
				: Promise.resolve(Array.from({ length: 100 }, (_, i) => i)),
		);
		await expect(paginate(failing, opts)).rejects.toThrow('HTTP 503');
	});

	it('pauses between pages but not before the first', async () => {
		const sleep = vi.fn(() => Promise.resolve());
		await paginate(feed(250, 100), { ...opts, delayMs: 1000, sleep });
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(1000);
	});
});

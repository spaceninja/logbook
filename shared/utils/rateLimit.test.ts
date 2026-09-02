import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSerialQueue } from './rateLimit';

describe('createSerialQueue', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('never overlaps two scheduled tasks', async () => {
		const schedule = createSerialQueue(280);
		const events: string[] = [];
		let releaseFirst!: () => void;
		const firstDone = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = schedule(async () => {
			events.push('start-1');
			await firstDone;
			events.push('end-1');
		});
		const second = schedule(async () => {
			events.push('start-2');
			events.push('end-2');
		});

		// While the first task is still in flight, the second must not have begun,
		// no matter how much time passes.
		await vi.advanceTimersByTimeAsync(1000);
		expect(events).toEqual(['start-1']);

		releaseFirst();
		await vi.advanceTimersByTimeAsync(1000);
		await Promise.all([first, second]);

		expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
	});

	it('spaces tasks by at least the interval', async () => {
		const schedule = createSerialQueue(280);
		const times: number[] = [];
		const started = Date.now();

		const first = schedule(async () => {
			times.push(Date.now() - started);
		});
		const second = schedule(async () => {
			times.push(Date.now() - started);
		});

		await vi.advanceTimersByTimeAsync(1000);
		await Promise.all([first, second]);

		expect(times[0]).toBe(0);
		expect(times[1]).toBeGreaterThanOrEqual(280);
	});

	it('runs the next task after the previous one rejects', async () => {
		const schedule = createSerialQueue(280);
		const events: string[] = [];

		const failing = schedule(async () => {
			events.push('start-1');
			throw new Error('boom');
		});
		failing.catch(() => {});
		const second = schedule(async () => {
			events.push('start-2');
			return 'ok';
		});

		await vi.advanceTimersByTimeAsync(1000);
		await expect(failing).rejects.toThrow('boom');
		await expect(second).resolves.toBe('ok');
		expect(events).toEqual(['start-1', 'start-2']);
	});
});

/**
 * A promise-chain queue that runs tasks one at a time, spaced by a minimum
 * interval. Shared by the Nitro IGDB client (`server/utils/igdb.ts`) and the
 * Node-side script mirrors (`scripts/lib/`), which face the same per-client rate
 * ceilings from the same providers.
 */

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A `schedule` that queues each task onto a single chain so calls never overlap
 * or exceed `minIntervalMs`. The chain advances after a task settles *either*
 * way, so one rejection doesn't stall the queue — the caller still sees the
 * rejection, it just doesn't break the spacing for whatever is queued behind it.
 */
export function createSerialQueue(minIntervalMs: number) {
	let chain: Promise<unknown> = Promise.resolve();

	return function schedule<T>(task: () => Promise<T>): Promise<T> {
		const result = chain.then(task, task);
		const settle = () => sleep(minIntervalMs);
		chain = result.then(settle, settle);
		return result;
	};
}

/**
 * Paging for feeds that signal "last page" only by returning a short one — which
 * is all the Goodreads shelf RSS offers (#103). Kept separate from the sync so the
 * termination rules can be tested without touching the network.
 */

export interface PaginateOptions {
	/** Items per full page. A page shorter than this ends the walk. */
	pageSize: number;
	/**
	 * Hard stop, so a feed that never returns a short page — a Goodreads bug, or a
	 * `page` param it quietly starts ignoring — can't loop forever.
	 */
	maxPages: number;
	/** Pause between page requests, to stay polite to the source. */
	delayMs?: number;
	/** Injectable for tests; defaults to a real timer. */
	sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every item across a paginated feed, in page order.
 *
 * Pages until a short (or empty) page arrives. Errors from `fetchPage` propagate
 * untouched: a truncated read presented as a complete shelf is indistinguishable
 * from books having been removed, so the caller must abort the run rather than
 * write a partial result.
 *
 * Throws when `maxPages` is reached with every page still full, since that means
 * the end-of-list signal never came and the result would be silently incomplete.
 */
export async function paginate<T>(
	fetchPage: (page: number) => Promise<T[]>,
	options: PaginateOptions,
): Promise<T[]> {
	const { pageSize, maxPages, delayMs = 0 } = options;
	const sleep = options.sleep ?? defaultSleep;
	const items: T[] = [];

	for (let page = 1; page <= maxPages; page++) {
		if (page > 1 && delayMs > 0) await sleep(delayMs);
		const batch = await fetchPage(page);
		items.push(...batch);
		if (batch.length < pageSize) return items;
	}

	throw new Error(
		`still a full page at page ${maxPages} — refusing to page further`,
	);
}

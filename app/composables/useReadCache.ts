import type { NuxtApp } from '#app';

/**
 * Shared client-side read cache for the list views (#24). The Backlog and
 * History reads are cached in Nuxt's payload keyed by query
 * (`backlog:<type>`, `history:<year>:<type>`, `search:<type>`,
 * `completionYears`), so
 * re-selecting a previously viewed query serves the cached list with no
 * refetch — switching is instant and we don't re-hit Firestore.
 *
 * The cache lives in memory for the SPA session only; it is not persisted, so a
 * fresh page load (including reopening the app or switching devices) starts
 * clean and reads fresh. The only staleness window is the same tab left open
 * across a write made elsewhere — and `clearReadCache()`, called on every local
 * write, covers edits made from this tab.
 */

/** True for keys this cache owns, so clears never touch unrelated asyncData. */
function isReadCacheKey(key: string): boolean {
	return (
		key.startsWith('backlog:') ||
		key.startsWith('history:') ||
		key.startsWith('search:') ||
		key === 'completionYears'
	);
}

/**
 * `useAsyncData` options that serve the cached payload for a key instead of
 * refetching. Spread into each list view's `useAsyncData` call. A manual
 * `refresh()` still bypasses the cache; everything else (initial load, watch on
 * a key change) reuses the payload when present.
 */
export function readCacheOptions() {
	return {
		getCachedData(key: string, nuxtApp: NuxtApp, ctx: { cause: string }) {
			if (ctx.cause === 'refresh:manual') return undefined;
			return nuxtApp.payload.data[key] ?? nuxtApp.static.data[key];
		},
	};
}

/**
 * Drop every cached list read so the next view refetches. Called by
 * `saveItem`/`deleteItem` after a write (single-writer app: all mutations go
 * through there, so coarse invalidation is correct and cheap).
 */
export function clearReadCache(): void {
	clearNuxtData((key) => isReadCacheKey(key));
}

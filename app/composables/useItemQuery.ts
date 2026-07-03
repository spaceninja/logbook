import type { Ref, WatchSource } from 'vue';
import type { Item } from '~~/shared/types/item';

/**
 * Shared wrapper for the list views' Firestore reads (Backlog and History). Both
 * fetch a coarse `Item[]` client-side, key the result for the read cache (#24),
 * and refetch when their inputs change — only the key, fetcher, and watched refs
 * differ. Centralising the `useAsyncData` options keeps the two views from
 * drifting on `server`/`lazy`/caching behaviour.
 */
export function useItemQuery(
	key: Ref<string>,
	fetcher: () => Promise<Item[]>,
	watchSources: WatchSource[],
) {
	return useAsyncData<Item[]>(key, fetcher, {
		server: false,
		lazy: true,
		default: () => [],
		watch: watchSources,
		...readCacheOptions(),
	});
}

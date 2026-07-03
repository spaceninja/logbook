<template>
	<section>
		<!-- View-specific controls (e.g. the History year switcher) render above the
		     type selector; the Backlog leaves this empty. -->
		<slot name="controls" />

		<fieldset>
			<legend>Type</legend>
			<label v-for="t in MEDIA_TYPES" :key="t">
				<input v-model="type" type="radio" :value="t" />
				{{ t }}
			</label>
		</fieldset>

		<!-- Data comes from the client-only Firestore SDK, so render it client-side
		     to avoid hydrating against the empty SSR default. -->
		<ClientOnly>
			<template #fallback>
				<p>Loading…</p>
			</template>
			<ItemControls
				v-model:sort-key="sortKey"
				v-model:reversed="reversed"
				:sort-keys="sortKeys"
				:filter-keys="filterKeys"
				:filters="filters"
				@update:filter="(k, s) => emit('update:filter', k, s)"
			/>
			<p v-if="pending">Loading…</p>
			<p v-else-if="error">{{ errorMessage }}: {{ error.message }}</p>
			<p v-else-if="displayed.length === 0">{{ emptyMessage }}</p>
			<ItemCardList v-else :items="displayed" :view="view" :year="year" />
		</ClientOnly>
	</section>
</template>

<script setup lang="ts">
import type { Item, MediaType } from '~~/shared/types/item';
import type {
	FilterKey,
	FilterState,
	ItemFilters,
} from '~~/shared/utils/itemFilter';
import type { SortKey } from '~~/shared/utils/itemSort';

const MEDIA_TYPES: MediaType[] = ['book', 'movie', 'show', 'game'];

withDefaults(
	defineProps<{
		/** Sort keys offered for the current view/type. */
		sortKeys: SortKey[];
		/** Filter keys to expose; empty means no filters (History today). */
		filterKeys?: FilterKey[];
		/** Active filter states, passed through to ItemControls. */
		filters?: ItemFilters;
		/** Async-read flags from useItemQuery. */
		pending: boolean;
		error?: { message: string } | null;
		/** The refined list to render (sorted + filtered by the page). */
		displayed: Item[];
		view: 'history' | 'backlog';
		/** Scopes ItemCard rendering to the selected History year. */
		year?: number;
		/** Shown when the read succeeds but nothing matches. */
		emptyMessage: string;
		/** Prefixes the read error message. */
		errorMessage: string;
	}>(),
	{
		filterKeys: () => [],
		filters: () => ({}),
		year: undefined,
	},
);

const emit = defineEmits<{
	'update:filter': [key: FilterKey, state: FilterState];
}>();

const type = defineModel<MediaType>('type', { required: true });
const sortKey = defineModel<SortKey>('sortKey', { required: true });
const reversed = defineModel<boolean>('reversed', { required: true });
</script>

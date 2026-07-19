<!--
	Data comes from the client-only Firestore SDK, so we render some
	parts client-side to avoid hydrating against the empty SSR default.
-->
<template>
	<section>
		<header class="controls">
			<!-- Media type switcher -->
			<fieldset class="type-switcher">
				<legend>Type</legend>
				<label v-for="t in mediaTypes" :key="t">
					<input v-model="type" type="radio" :value="t" />
					{{ t }}
				</label>
			</fieldset>
			<!-- View-specific controls (e.g. the History year switcher) -->
			<slot name="controls" />
			<!-- Sort and filter controls -->
			<ClientOnly>
				<ItemControls
					v-model:sort-key="sortKey"
					v-model:reversed="reversed"
					:sort-keys="sortKeys"
					:filter-keys="filterKeys"
					:filters="filters"
					@update:filter="(k, s) => emit('update:filter', k, s)"
				/>
			</ClientOnly>
		</header>
		<ClientOnly>
			<template #fallback><p>Loading…</p></template>
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

const mediaTypes: MediaType[] = ['book', 'movie', 'show', 'game'];

const {
	filterKeys = [],
	filters = {},
	year = undefined,
} = defineProps<{
	sortKeys: SortKey[];
	filterKeys?: FilterKey[];
	filters?: ItemFilters;
	pending: boolean;
	error?: { message: string } | null;
	displayed: Item[];
	view: 'history' | 'backlog' | 'search';
	year?: number;
	emptyMessage: string;
	errorMessage: string;
}>();

const emit = defineEmits<{
	'update:filter': [key: FilterKey, state: FilterState];
}>();

const type = defineModel<MediaType>('type', { required: true });
const sortKey = defineModel<SortKey>('sortKey', { required: true });
const reversed = defineModel<boolean>('reversed', { required: true });
</script>

<style scoped>
.controls {
	align-items: center;
	display: flex;
	gap: 1em;
}

.type-switcher {
	margin-right: auto;
}
</style>

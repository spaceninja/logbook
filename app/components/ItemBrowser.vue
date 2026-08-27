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
			<template v-else>
				<template v-for="group in groups" :key="group.key">
					<h2 v-if="group.label">{{ group.label }}</h2>
					<ItemCardList :items="group.items" :view="view" :year="year" />
				</template>
			</template>
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
import { groupBacklogItems, type ItemGroup } from '~~/shared/utils/itemGroups';
import type { SortKey } from '~~/shared/utils/itemSort';

const mediaTypes: MediaType[] = ['book', 'movie', 'show', 'game'];

const {
	displayed,
	view,
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

// Only the Backlog splits its list: History and search are date- and query-driven,
// where an item being underway isn't what the list is organized around.
const groups = computed<ItemGroup[]>(() =>
	view === 'backlog'
		? groupBacklogItems(displayed)
		: [{ key: 'all', items: displayed }],
);

const type = defineModel<MediaType>('type', { required: true });
const sortKey = defineModel<SortKey>('sortKey', { required: true });
const reversed = defineModel<boolean>('reversed', { required: true });
</script>

<style scoped>
.controls {
	align-items: center;
	display: flex;
	flex-wrap: wrap;
	gap: 1em;
}

.type-switcher {
	margin-right: auto;
}

/* Sits directly above its list, so the space below is tighter than above. */
h2 {
	font-size: 1.2em;
	margin-block: 1em 0.5em;
}
</style>

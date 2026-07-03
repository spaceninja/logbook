<template>
	<div class="filter sort-by">
		<label for="sort-by">Sort</label>
		<select id="sort-by" v-model="sortKey">
			<option v-for="k in sortKeys" :key="k" :value="k">
				{{ SORT_LABELS[k] }}
			</option>
		</select>
		<label>
			<input v-model="reversed" type="checkbox" />
			Reverse
		</label>
	</div>

	<div v-for="k in filterKeys" :key="k" :class="`filter filter-${k}`">
		<label :for="k">
			{{ FILTER_LABELS[k] }}
		</label>
		<select
			:id="k"
			:value="filters[k] ?? 'all'"
			@change="onFilterChange(k, $event)"
		>
			<option v-for="s in FILTER_STATES" :key="s.value" :value="s.value">
				{{ s.label }}
			</option>
		</select>
	</div>
</template>

<script setup lang="ts">
import type {
	FilterKey,
	FilterState,
	ItemFilters,
} from '~~/shared/utils/itemFilter';
import type { SortKey } from '~~/shared/utils/itemSort';

defineProps<{
	sortKeys: SortKey[];
	filterKeys: FilterKey[];
	filters: ItemFilters;
}>();

const emit = defineEmits<{
	'update:filter': [key: FilterKey, state: FilterState];
}>();

const sortKey = defineModel<SortKey>('sortKey', { required: true });
const reversed = defineModel<boolean>('reversed', { required: true });

const SORT_LABELS: Record<SortKey, string> = {
	rating: 'Rating',
	title: 'Title',
	creator: 'Creator',
	series: 'Series',
	length: 'Length',
	release_date: 'Release date',
	completion_date: 'Completion date',
};

const FILTER_LABELS: Record<FilterKey, string> = {
	purchased: 'Purchased',
	prioritized: 'Prioritized',
	released: 'Released',
};

const FILTER_STATES: { value: FilterState; label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'yes', label: 'Yes' },
	{ value: 'no', label: 'No' },
];

function onFilterChange(key: FilterKey, event: Event) {
	const state = (event.target as HTMLSelectElement).value as FilterState;
	emit('update:filter', key, state);
}
</script>

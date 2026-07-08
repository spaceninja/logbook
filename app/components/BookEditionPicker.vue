<template>
	<div>
		<label>
			Find this book in Google Books
			<input v-model="query" type="search" placeholder="Title and author…" />
		</label>

		<p v-if="pending">Searching…</p>
		<p v-else-if="error" role="alert">{{ error }}</p>
		<ul v-else-if="results.length">
			<li v-for="result in results" :key="result.providerId">
				<button type="button" @click="emit('select', result)">
					<img
						v-if="result.thumbnail"
						:src="result.thumbnail"
						:alt="`${result.title} cover`"
						width="40"
					/>
					<strong>{{ result.title }}</strong>
					<span v-if="result.year"> ({{ result.year }})</span>
					<span v-if="result.subtitle"> · {{ result.subtitle }}</span>
				</button>
			</li>
		</ul>
		<p v-else-if="query.trim()">No results.</p>

		<p><button type="button" @click="emit('cancel')">Cancel</button></p>
	</div>
</template>

<script setup lang="ts">
import type { SearchResult } from '~~/shared/types/search';

/**
 * A book-scoped Google Books search for switching which edition/volume a book's
 * metadata is sourced from (issue #20). Prefilled with the book's title+author;
 * emitting a pick lets the edit page re-enrich from that volume without changing
 * the item's (Goodreads-namespaced) id.
 */
const props = defineProps<{ initialQuery: string }>();
const emit = defineEmits<{ select: [result: SearchResult]; cancel: [] }>();

const query = ref(props.initialQuery);
const results = ref<SearchResult[]>([]);
const pending = ref(false);
const error = ref('');

// Monotonic token so out-of-order responses from fast typing are ignored.
let latest = 0;
let debounce: ReturnType<typeof setTimeout> | undefined;

async function runSearch() {
	const q = query.value.trim();
	if (!q) {
		results.value = [];
		error.value = '';
		pending.value = false;
		return;
	}
	const token = ++latest;
	pending.value = true;
	error.value = '';
	try {
		const res = await $fetch<SearchResult[]>('/api/search', {
			params: { type: 'book', q },
		});
		if (token !== latest) return; // a newer search superseded this one
		results.value = res;
	} catch {
		if (token !== latest) return;
		results.value = [];
		error.value = 'Search failed. Try adjusting the title or author.';
	} finally {
		if (token === latest) pending.value = false;
	}
}

// Run once for the prefilled query, then debounce further typing.
onMounted(runSearch);
watch(query, () => {
	clearTimeout(debounce);
	debounce = setTimeout(runSearch, 300);
});
</script>

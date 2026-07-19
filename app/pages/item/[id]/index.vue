<template>
	<section>
		<p>
			<NuxtLink :to="backlogLink">← Backlog</NuxtLink> ·
			<NuxtLink to="/history">History</NuxtLink>
		</p>

		<!-- Client-only Firestore data; render client-side to avoid hydrating
         against the empty SSR default. -->
		<ClientOnly>
			<template #fallback>
				<p>Loading…</p>
			</template>
			<p v-if="pending">Loading…</p>
			<p v-else-if="error">Failed to load item: {{ error.message }}</p>
			<p v-else-if="!item">Item not found.</p>

			<article v-else>
				<h1>{{ itemDisplayTitle(item) }}</h1>

				<p v-if="isOwner">
					<NuxtLink :to="`/item/${id}/edit`">Edit</NuxtLink>
					<button type="button" :disabled="deleting" @click="onDelete">
						{{ deleting ? 'Deleting…' : 'Delete' }}
					</button>
				</p>

				<img
					v-if="item.cover"
					:src="item.cover"
					:alt="`${itemDisplayTitle(item)} cover`"
					width="200"
				/>
				<img
					v-if="item.backdrop"
					:src="item.backdrop"
					:alt="`${itemDisplayTitle(item)} backdrop`"
					width="400"
				/>
				<dl>
					<dt>Type</dt>
					<dd>{{ item.type }}</dd>

					<dt>Status</dt>
					<dd>{{ item.status }}</dd>

					<template v-if="item.creator">
						<dt>Creator</dt>
						<dd>{{ formatCreator(item.creator) }}</dd>
					</template>

					<template v-if="item.release_date">
						<dt>Released</dt>
						<dd>{{ item.release_date }}</dd>
					</template>

					<template v-if="item.length">
						<dt>Length</dt>
						<dd>{{ item.length }} {{ item.length_unit }}</dd>
					</template>

					<template v-if="item.community_rating !== undefined">
						<dt>Community rating</dt>
						<dd>{{ item.community_rating }}</dd>
					</template>

					<template v-if="item.my_rating !== undefined">
						<dt>My rating</dt>
						<dd>{{ item.my_rating }}</dd>
					</template>

					<template v-if="item.provider">
						<dt>Provider</dt>
						<dd>{{ item.provider }}</dd>
					</template>

					<template v-if="item.recommended_by">
						<dt>Recommended by</dt>
						<dd>{{ item.recommended_by }}</dd>
					</template>

					<dt>Purchased</dt>
					<dd>{{ item.is_purchased ? 'yes' : 'no' }}</dd>

					<dt>Prioritized</dt>
					<dd>{{ item.is_prioritized ? 'yes' : 'no' }}</dd>

					<template v-if="item.completed_dates.length">
						<dt>Completed</dt>
						<dd>{{ item.completed_dates.join(', ') }}</dd>
					</template>

					<template v-if="item.tags.length">
						<dt>Tags</dt>
						<dd>{{ item.tags.join(', ') }}</dd>
					</template>

					<template v-if="item.description">
						<dt>Description</dt>
						<!-- eslint-disable-next-line vue/no-v-html -- markdown rendered with raw HTML disabled (safe) -->
						<dd v-html="renderMarkdown(item.description)" />
					</template>

					<template v-if="item.notes">
						<dt>Notes</dt>
						<dd>{{ item.notes }}</dd>
					</template>

					<template v-for="[key, value] in metadataEntries" :key="key">
						<dt>{{ key }}</dt>
						<dd>{{ value }}</dd>
					</template>
				</dl>

				<WatchProviders
					v-if="watchTarget"
					:type="watchTarget.type"
					:tmdb-id="watchTarget.tmdbId"
				/>
			</article>
		</ClientOnly>
	</section>
</template>

<script setup lang="ts">
import { itemDisplayTitle, formatCreator } from '~~/shared/utils/itemDisplay';
import { tmdbIdForItem } from '~~/shared/utils/itemId';

const route = useRoute();
const id = computed(() => String(route.params.id));

const { getItem, deleteItem } = useItems();
const { isOwner } = useAuth();

const {
	data: item,
	pending,
	error,
} = useAsyncData(
	() => `item:${id.value}`,
	() => getItem(id.value),
	{
		server: false,
		lazy: true,
		watch: [id],
	},
);

// Return to the backlog filtered to this item's media type. Mirrors the backlog's
// own query convention (`book` is the default, so it's omitted); falls back to a
// bare link while the item is still loading.
const backlogLink = computed(() => {
	const type = item.value?.type;
	return type && type !== 'book' ? { path: '/', query: { type } } : '/';
});

// Streaming availability is movies/shows only, and needs a TMDB id to look up —
// manual and Letterboxd-only titles have none, and books/games have no source.
const watchTarget = computed(() => {
	const value = item.value;
	if (!value || (value.type !== 'movie' && value.type !== 'show')) return null;
	const tmdbId = tmdbIdForItem(value);
	return tmdbId ? { type: value.type, tmdbId } : null;
});

// Entries of the type-specific metadata map, for display.
const metadataEntries = computed(() =>
	item.value ? Object.entries(item.value.metadata) : [],
);

const deleting = ref(false);

async function onDelete() {
	if (!item.value) return;
	if (
		!window.confirm(
			`Delete "${itemDisplayTitle(item.value)}"? This cannot be undone.`,
		)
	) {
		return;
	}
	deleting.value = true;
	try {
		await deleteItem(id.value);
		await navigateTo('/');
	} finally {
		deleting.value = false;
	}
}
</script>

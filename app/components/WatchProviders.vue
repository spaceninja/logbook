<template>
	<section v-if="pending">
		<h2>Where to watch</h2>
		<p>Checking availability…</p>
	</section>

	<!-- A failed lookup is a missing nicety, not a broken page: say so quietly
	     and move on. Same for a title nobody carries. -->
	<section v-else-if="error">
		<h2>Where to watch</h2>
		<p>Couldn't load streaming availability.</p>
	</section>

	<section v-else-if="hasAny">
		<h2>Where to watch</h2>

		<template v-for="group in groups" :key="group.label">
			<template v-if="group.providers.length">
				<h3>{{ group.label }}</h3>
				<ul>
					<li v-for="provider in group.providers" :key="provider.id">
						<img
							v-if="provider.logo"
							:src="provider.logo"
							:alt="`${provider.name} logo`"
							width="30"
						/>
						{{ provider.name }}
					</li>
				</ul>
			</template>
		</template>

		<!-- TMDB exposes no per-service deep links, only this landing page. -->
		<p v-if="availability?.link">
			<a :href="availability.link" target="_blank" rel="noopener">
				More options on TMDB
			</a>
		</p>

		<!-- Required by TMDB's terms of use for this endpoint. -->
		<p><small>Streaming data provided by JustWatch.</small></p>
	</section>

	<section v-else>
		<h2>Where to watch</h2>
		<p>Not currently available to stream, rent, or buy.</p>
	</section>
</template>

<script setup lang="ts">
import type { WatchAvailability } from '~~/shared/types/search';

/**
 * Streaming availability for a movie or show, fetched live on every view —
 * TMDB's JustWatch data changes constantly, so it's never stored on the item.
 */
const props = defineProps<{ type: 'movie' | 'show'; tmdbId: string }>();

const {
	data: availability,
	pending,
	error,
} = useFetch<WatchAvailability>('/api/watch', {
	query: { type: () => props.type, id: () => props.tmdbId },
	// Firestore items only exist client-side, so this can't run during SSR.
	server: false,
	lazy: true,
});

const groups = computed(() => [
	{ label: 'Stream', providers: availability.value?.flatrate ?? [] },
	{ label: 'Rent', providers: availability.value?.rent ?? [] },
	{ label: 'Buy', providers: availability.value?.buy ?? [] },
]);

const hasAny = computed(() => groups.value.some((g) => g.providers.length));
</script>

<template>
	<div>
		<h1>{{ error.status }}</h1>
		<NuxtLink to="/">Go back home</NuxtLink>
	</div>
</template>

<script setup lang="ts">
import type { NuxtError } from '#app';

const props = defineProps<{ error: NuxtError }>();

// The error page replaces app.vue, so app.vue's title template never runs here —
// this title carries the site name itself.
useHead({
	title: () =>
		props.error.status === 404
			? 'Page Not Found - Logbook'
			: `Error ${props.error.status} - Logbook`,
});
</script>

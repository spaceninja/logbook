<template>
	<NuxtRouteAnnouncer />
	<NuxtLayout>
		<NuxtPage />
	</NuxtLayout>
</template>

<script setup lang="ts">
// Every page sets its own bare title ("Shows Backlog"); this suffixes the site
// name onto it, and covers the case of a page that sets none.
useHead({
	titleTemplate: (title) => (title ? `${title} - Logbook` : 'Logbook'),
});
</script>

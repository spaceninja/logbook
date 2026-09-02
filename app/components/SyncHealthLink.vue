<template>
	<NuxtLink
		class="button sync-health"
		:class="`sync-health--${status}`"
		to="/sync"
	>
		<span class="sync-health__dot" aria-hidden="true" />
		{{ label }}
	</NuxtLink>
</template>

<script setup lang="ts">
import { syncHealth, type SyncRunsDoc } from '~~/shared/utils/syncHealth';

/**
 * Footer indicator for the scheduled syncs (#126). Owner-only — the layout keeps
 * it inside the signed-in branch, since sync health is operational detail nobody
 * else can act on.
 *
 * Fetched in `onMounted` rather than `useAsyncData`: this renders in the footer
 * of every page, so it stays a plain synchronous component — an async setup would
 * make the whole layout wait on Suspense for a decoration. A read failure is
 * swallowed to `unknown` for the same reason: a broken health indicator must not
 * be able to break the page it reports on.
 */
const { getSyncRuns } = useItems();

const data = ref<SyncRunsDoc | null>(null);

onMounted(async () => {
	try {
		data.value = await getSyncRuns();
	} catch (error) {
		console.error('[logbook] Could not read sync health', error);
	}
});

const health = computed(() => syncHealth(data.value));
const status = computed(() => health.value.status);

const label = computed(() => {
	if (status.value === 'unknown') return 'Syncs —';
	if (status.value === 'ok') return 'Syncs OK';
	const count = health.value.errorCount;
	return count === 1 ? '1 sync issue' : `${count} sync issues`;
});
</script>

<style scoped>
.sync-health {
	align-items: center;
	display: inline-flex;
	gap: 0.4em;
}

/* Never the only signal: the label states the status in words too. */
.sync-health__dot {
	background: var(--sync-health-color);
	block-size: 0.6em;
	border-radius: 50%;
	inline-size: 0.6em;
}

.sync-health--ok {
	--sync-health-color: light-dark(green, lightgreen);
}

.sync-health--error {
	--sync-health-color: light-dark(firebrick, lightcoral);
}

.sync-health--unknown {
	--sync-health-color: var(--color-currentcolor-20);
}
</style>

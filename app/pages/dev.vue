<template>
	<section>
		<h1>Dev — Seed data</h1>
		<p>
			Each button <strong>wipes the entire database</strong> and replaces it
			with the chosen dataset. Dev only.
		</p>
		<!-- Dev rules are owner-only, so seeding requires the owner to be signed in. -->
		<ClientOnly>
			<template #fallback>
				<p>Loading…</p>
			</template>
			<p v-if="!isOwner">
				<button type="button" @click="login">Log in with GitHub to seed</button>
			</p>
			<template v-else>
				<ul>
					<li v-for="dataset in datasets" :key="dataset.key">
						<button
							type="button"
							:disabled="busy !== null"
							@click="load(dataset)"
						>
							{{ busy === dataset.key ? 'Loading…' : `Load ${dataset.label}` }}
						</button>
					</li>
				</ul>
				<p v-if="message">{{ message }}</p>
			</template>
		</ClientOnly>
	</section>
</template>

<script setup lang="ts">
import type { Item } from '~~/shared/types/item';
import { sampleSeed } from '~~/shared/seeds/sample';

// This page exists only in dev. A built/deployed app must never expose seeding;
// prod Firestore rules also block writes as a second layer of defense.
definePageMeta({
	// Redirect away if somehow reached outside dev.
	middleware: [
		() => {
			if (!import.meta.dev) return navigateTo('/');
		},
	],
});

const { loadDataset } = useSeed();
const { isOwner, login } = useAuth();

type DatasetKey = 'empty' | 'sample';

const datasets: { key: DatasetKey; label: string; items: Item[] }[] = [
	{ key: 'empty', label: 'Empty', items: [] },
	{
		key: 'sample',
		label: `Sample (${sampleSeed.length} items)`,
		items: sampleSeed,
	},
];

const busy = ref<DatasetKey | null>(null);
const message = ref('');

async function load(dataset: (typeof datasets)[number]) {
	const ok = window.confirm(
		`This will ERASE the entire database and replace it with the ` +
			`"${dataset.label}" dataset. Continue?`,
	);
	if (!ok) return;

	busy.value = dataset.key;
	message.value = '';
	try {
		await loadDataset(dataset.items);
		message.value = `Loaded "${dataset.label}" — ${dataset.items.length} item(s).`;
	} catch (error) {
		message.value = `Failed to load "${dataset.label}": ${(error as Error).message}`;
	} finally {
		busy.value = null;
	}
}
</script>

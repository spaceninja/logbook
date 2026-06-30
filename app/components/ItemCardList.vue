<template>
	<ol>
		<ItemCard
			v-for="item in items"
			:key="item.id"
			:item="item"
			:view="view"
			:year="year"
		/>
	</ol>
</template>

<script setup lang="ts">
defineProps<{
	items: Item[];
	view: 'history' | 'backlog';
	year?: number;
}>();
</script>

<style scoped>
ol {
	display: grid;
	gap: 1em;
	grid-template-columns: repeat(auto-fill, minmax(var(--width-thumb), 1fr));
	list-style: none;
	padding: 0;
}
</style>

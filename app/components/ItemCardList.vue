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
	view: 'history' | 'backlog' | 'search';
	year?: number;
}>();
</script>

<style scoped>
ol {
	display: grid;
	gap: 10px;
	grid-template-columns: repeat(4, calc((100% - 30px) / 4));
	list-style: none;
	padding: 0;

	@media screen and (width >= 500px) {
		grid-template-columns: repeat(auto-fill, minmax(var(--width-thumb), 1fr));
	}
}
</style>

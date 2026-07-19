<!--
	The search input. Deliberately dumb about what search *means*: it reports what
	was typed and when the field was submitted, and the page decides whether that
	filters the current list (Backlog, Search) or navigates to the search view
	(History). Always a form, so Enter submits and browsers offer the clear button.
-->
<template>
	<form
		class="filter item-search"
		role="search"
		@submit.prevent="emit('submit')"
	>
		<label :for="id">{{ label }}</label>
		<input
			:id="id"
			v-model="query"
			type="search"
			:placeholder="placeholder"
			autocomplete="off"
		/>
	</form>
</template>

<script setup lang="ts">
const { label = 'Search', placeholder = '' } = defineProps<{
	label?: string;
	placeholder?: string;
}>();

const emit = defineEmits<{ submit: [] }>();

const query = defineModel<string>({ required: true });

const id = useId();
</script>

<style scoped>
.item-search {
	display: flex;
	gap: 0.5em;
}
</style>

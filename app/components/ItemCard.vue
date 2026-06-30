<template>
	<li :class="{ 'status-dnf': item.status === 'dnf' }">
		<NuxtLink :to="`/item/${item.id}`">
			<img
				v-if="item.thumbnail"
				:src="item.thumbnail"
				:alt="`${itemDisplayTitle(item)} cover`"
				width="125"
			/>
		</NuxtLink>
		<strong class="title">{{ itemDisplayTitle(item) }}</strong>
		<em v-if="formatSeries(item)" class="series">{{ formatSeries(item) }}</em>
		<span v-if="item.creator" class="creator">{{
			formatCreator(item.creator)
		}}</span>
		<time v-if="releaseYear" class="year" :datetime="releaseYear">{{
			releaseYear
		}}</time>
		<span v-if="rating" class="rating">{{ rating }}</span>
		<span v-if="length" class="length">{{ length }}</span>
		<span v-if="item.status === 'dnf'" class="dnf">DNF</span>
		<span v-if="completedDates.length" class="dates">
			<time v-for="d in completedDates" :key="d" :datetime="d">{{
				formatCompletedDate(d)
			}}</time>
		</span>
	</li>
</template>

<script setup lang="ts">
import type { Item } from '~~/shared/types/item';

import {
	itemDisplayTitle,
	formatCreator,
	formatSeries,
	formatCompletedDate,
} from '~~/shared/utils/itemDisplay';

const { item, view, year } = defineProps<{
	item: Item;
	view: 'history' | 'backlog';
	year?: number;
}>();

const rating = computed(() => {
	if (view === 'backlog' && item.community_rating) {
		return item.community_rating;
	}
	if (view === 'history' && item.my_rating) {
		return item.my_rating;
	}
	return null;
});

/** The release year (the season's air year for shows), for display. */
const releaseYear = computed(() => item.release_date?.slice(0, 4) ?? '');

/** The completion date(s) for this item that fall in the selected year. */
const completedDates = computed(() => {
	if (!year) return [];
	return item.completed_dates.filter(
		(d) => Number.parseInt(d.slice(0, 4), 10) === year,
	);
});

const length = computed(() => {
	if (!item.length) return '';
	switch (item.length_unit) {
		case 'pages':
			return `${item.length}p`;
		case 'min':
			if (item.length > 120) {
				const hours = Math.round(item.length / 60);
				return `${hours} hrs`;
			}
			return `${item.length} min`;
		case 'episodes':
			return `${item.length} eps`;
		case 'hours':
			return `${item.length} hrs`;
		default:
			break;
	}
});
</script>

<style scoped>
li {
	font-size: small;
	position: relative;
	text-align: center;
	text-wrap: balance;
}

.title {
	margin: 0.33em;
}

/* TODO maybe these should be list items? */
.title,
.series,
.creator, /* TODO just show one creator */
.year,
.rating {
	display: block;
}

/* TODO hey man, maybe just change the root font size? */
.series,
.creator,
.year,
.rating,
.dnf,
.dates,
.length {
	font-size: smaller;
}

.rating,
.dnf {
	background: rgb(0 0 0 / 50%);
	color: white;
	padding: 0.1em 0.25em;
	position: absolute;
	right: 0;
	top: 0;
}

.status-dnf {
	filter: sepia(100%) grayscale(50%);
}

.dates time:not(:last-child)::after {
	content: ', ';
}
</style>

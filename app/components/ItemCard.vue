<template>
	<li :class="{ 'status-dnf': item.status === 'dnf' }">
		<NuxtLink :to="`/item/${item.id}`">
			<img
				v-if="item.thumbnail"
				:src="item.thumbnail"
				:alt="`${itemDisplayTitle(item)} cover`"
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
				formatDate(d)
			}}</time>
		</span>
		<span v-if="statusLabel" class="status">{{ statusLabel }}</span>
	</li>
</template>

<script setup lang="ts">
import type { Item } from '~~/shared/types/item';

import {
	itemDisplayTitle,
	formatCreator,
	formatSeries,
	formatCompletedDate,
	formatCompletedDateWithYear,
} from '~~/shared/utils/itemDisplay';

const { item, view, year } = defineProps<{
	item: Item;
	view: 'history' | 'backlog' | 'search';
	year?: number;
}>();

const rating = computed(() => {
	if (view === 'backlog' && item.community_rating) {
		return item.community_rating;
	}
	if (view === 'history' && item.my_rating) {
		return item.my_rating;
	}
	// Search results mix completed and backlog items, so show whichever rating
	// this item actually has, preferring the owner's own.
	if (view === 'search') {
		return item.my_rating || item.community_rating || null;
	}
	return null;
});

/** The release year (the season's air year for shows), for display. */
const releaseYear = computed(() => item.release_date?.slice(0, 4) ?? '');

/**
 * The completion date(s) to show. History scopes them to the selected year;
 * search spans every year, so it shows them all — seeing *when* you finished
 * something is the whole point of searching for it (#40).
 */
const completedDates = computed(() => {
	if (view === 'search') return item.completed_dates;
	if (!year) return [];
	return item.completed_dates.filter(
		(d) => Number.parseInt(d.slice(0, 4), 10) === year,
	);
});

/**
 * Unfinished status, spelled out on search results only. Those results mix
 * backlog and completed items, so a card with no date would otherwise read as
 * "completed, date unknown" rather than "not started". Driven by `status`, not
 * by the absence of dates: an item can be re-read/re-watched and so carry both a
 * completion date *and* backlog status, in which case both show. `complete` and
 * `dnf` get no label — `dnf` already has its own badge.
 */
const statusLabel = computed(() => {
	if (view !== 'search') return null;
	if (item.status === 'backlog') return 'Backlog';
	if (item.status === 'in_progress') return 'In progress';
	return null;
});

// The year is redundant on History (the list is already one year) but essential
// in search results, which span years.
function formatDate(isoDate: string): string {
	return view === 'search'
		? formatCompletedDateWithYear(isoDate)
		: formatCompletedDate(isoDate);
}

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

img {
	height: auto;
	outline: 1px solid light-dark(hotpink, cyan);
	width: 100%;
}

.title {
	margin: 0.33em;
}

/* TODO maybe these should be list items? */

/* One fact per line. `.length` and `.dates` used to be inline, which ran them
   together with no separator ("20 hrsMay 16, 1988"). */
.title,
.series,
.creator, /* TODO just show one creator */
.year,
.rating,
.length,
.dates,
.status {
	display: block;
}

/* TODO hey man, maybe just change the root font size? */
.series,
.creator,
.year,
.rating,
.dnf,
.dates,
.length,
.status {
	font-size: smaller;
}

.status {
	font-style: italic;
	opacity: 0.8;
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

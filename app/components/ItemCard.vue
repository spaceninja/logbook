<template>
	<li :class="{ 'status-dnf': item.status === 'dnf' }">
		<NuxtLink :to="`/item/${item.id}`">
			<img
				v-if="item.thumbnail"
				:src="item.thumbnail"
				:alt="`${itemDisplayTitle(item)} cover`"
			/>
			<div v-else class="placeholder">
				{{ itemDisplayTitle(item) }}
			</div>
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
		<span v-if="item.status === 'in_progress'" class="in-progress"
			>In Progress</span
		>
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
 * The completion date(s) to show. A year-scoped list (History on a single year)
 * shows only that year's; any other completion list — search, or History's
 * all-years scopes (#33) — shows them all, since seeing *when* you finished
 * something is the whole point of those views (#40). The backlog shows none: a
 * re-read can sit there carrying old dates, which aren't what that view is about.
 */
const completedDates = computed(() => {
	if (view === 'backlog') return [];
	if (!year) return item.completed_dates;
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

// The year is redundant when the list is already scoped to one, but essential in
// any list that spans years (search, History's all-years scopes).
function formatDate(isoDate: string): string {
	return year
		? formatCompletedDate(isoDate)
		: formatCompletedDateWithYear(isoDate);
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
a {
	color: currentcolor;
	text-decoration: none;
}

li {
	font-size: small;
	position: relative;
	text-align: center;
	text-wrap: balance;
}

img,
.placeholder {
	aspect-ratio: 2/3;
	filter: drop-shadow(1px 1px 0 light-dark(hotpink, cyan))
		drop-shadow(-1px -1px 0 light-dark(hotpink, cyan));
	height: auto;
	width: 100%;
}

img {
	object-fit: contain;
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

.title {
	-webkit-box-orient: vertical;
	display: -webkit-box;
	-webkit-line-clamp: 5;
	margin: 0.33em;
	overflow: hidden;
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

/*
.rating,
.dnf {
	background: rgb(0 0 0 / 50%);
	color: white;
	padding: 0.1em 0.25em;
	position: absolute;
	right: 0;
	top: 0;
}
*/

.status-dnf {
	filter: sepia(100%) grayscale(50%);
}

.dates time:not(:last-child)::after {
	content: ', ';
}

.placeholder {
	--gradient-bg-color: #006dca;
	--gradient-spot1-color: #001a39;
	--gradient-spot1-w: 75%;
	--gradient-spot1-h: 75%;
	--gradient-spot1-x: 0%;
	--gradient-spot1-y: 0%;
	--gradient-spot2-color: #9b70ff;
	--gradient-spot2-w: 75%;
	--gradient-spot2-h: 75%;
	--gradient-spot2-x: 100%;
	--gradient-spot2-y: 0%;
	--gradient-spot3-color: #42ffc6;
	--gradient-spot3-w: 75%;
	--gradient-spot3-h: 75%;
	--gradient-spot3-x: 100%;
	--gradient-spot3-y: 100%;
	--gradient-spot4-color: #ff3b8d;
	--gradient-spot4-w: 75%;
	--gradient-spot4-h: 75%;
	--gradient-spot4-x: 0%;
	--gradient-spot4-y: 100%;
	align-items: center;
	aspect-ratio: 2/3;
	background:
		radial-gradient(rgb(0 0 0 / 80%), transparent),
		linear-gradient(darkorchid, teal);
	color: rgb(255 255 255 / 80%);
	display: flex;
	font-size: 1.2em;
	font-stretch: 66%;
	font-weight: 700;
	justify-content: center;
	letter-spacing: 0.05ch;
	overflow: hidden;
	padding: 1em;
	text-wrap: balance;
}
</style>

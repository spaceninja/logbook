import type { Item, ShowMetadata } from '../types/item';
import { itemSeries } from './series';

/**
 * Display title. Shows are stored per-season with the show name in `title`, so
 * the season is composed at render time as "<title> — Season <n>" (core design
 * §3.4). A season's own name (`season_title`, e.g. "Book One: Water") is shown
 * separately, not folded into this title. All other types use `title` verbatim.
 */
export function itemDisplayTitle(item: Item): string {
	if (item.type === 'show') {
		const { season_number } = item.metadata as ShowMetadata;
		return `${item.title} — Season ${season_number}`;
	}
	return item.title;
}

/** Joins multi-value creators into a single readable string. */
export function formatCreator(creator: Item['creator']): string {
	if (Array.isArray(creator)) return creator.join(', ');
	return creator ?? '';
}

/**
 * "Series Name #N" for an item in a series (or just the name when unnumbered).
 * Empty when there is no series. Shows are skipped — their season is already in
 * the display title.
 */
export function formatSeries(item: Item): string {
	if (item.type === 'show') return '';
	const { name, number } = itemSeries(item);
	if (!name) return '';
	return number !== undefined ? `${name} #${number}` : name;
}

/**
 * Formats an ISO completion date (`YYYY-MM-DD`) as a short "Mon D" label, e.g.
 * "Jan 30". Parsed and formatted in UTC so the calendar day never shifts under
 * the viewer's local timezone (date-only strings parse as UTC midnight, which a
 * local-time formatter would render as the previous day west of UTC).
 */
export function formatCompletedDate(isoDate: string): string {
	const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	}).format(date);
}

/**
 * As `formatCompletedDate`, but includes the year ("Mar 3, 2024"). The History
 * view scopes its list to one year so the year is redundant there, but search
 * results span every year — and the year is the whole point of looking a
 * completion up (#40).
 */
export function formatCompletedDateWithYear(isoDate: string): string {
	const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
	return new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	}).format(date);
}

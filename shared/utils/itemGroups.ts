import type { Item } from '../types/item';

/** A labelled run of items rendered as its own list. */
export interface ItemGroup {
	/** Stable key for the render loop. */
	key: string;
	/** Heading above the list; omitted when the list needs no introduction. */
	label?: string;
	items: Item[];
}

/**
 * Splits a Backlog list into what's underway and what's still waiting (#96).
 * In-progress items are a short list buried among hundreds of untouched ones, so
 * they get their own list at the top rather than being scattered through it.
 *
 * The caller has already sorted and filtered; partitioning preserves that order
 * within each group. A group with nothing in it is dropped, and a list with
 * nothing in progress stays a single unlabelled list — the headings only earn
 * their space once there's a distinction to draw.
 */
export function groupBacklogItems(items: Item[]): ItemGroup[] {
	const inProgress = items.filter((item) => item.status === 'in_progress');
	if (inProgress.length === 0) return [{ key: 'all', items }];
	const rest = items.filter((item) => item.status !== 'in_progress');
	return [
		{ key: 'in-progress', label: 'In Progress', items: inProgress },
		{ key: 'backlog', label: 'Backlog', items: rest },
	].filter((group) => group.items.length > 0);
}

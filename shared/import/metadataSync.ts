import type { Item } from '../types/item';

/**
 * Which fields the nightly movie/show/game metadata sync is allowed to touch
 * (issue #106). Books are not merged here — they arrive through the Goodreads RSS
 * sync, which has its own precedence rules (`import/goodreadsRss.ts`, and the
 * table in `providers/bookFields.ts`).
 *
 * | Field                                                    | Rule                                         |
 * | -------------------------------------------------------- | -------------------------------------------- |
 * | `title`, `creator`                                        | provider wins                                |
 * | `cover`, `thumbnail`, `backdrop`                          | refresh when present; never blank a stored image |
 * | `release_date`, `description`, `length`, `length_unit`    | refresh when present; keep existing otherwise |
 * | `community_rating`                                        | provider wins, including deletion            |
 * | `tags`                                                    | fill only when the item has none             |
 * | `metadata`                                                | `{ ...existing, ...fresh }`                  |
 * | `creator_sort`                                            | never touched                                |
 * | `id`, `type`, `provider`                                  | never touched                                |
 * | `status`, `completed_dates`, `completed_years`, `my_rating`, `notes`, `recommended_by`, `is_purchased`, `is_prioritized` | never touched |
 *
 * This deliberately does *not* reuse `applyProviderFields` from `ItemForm.vue`,
 * which the manual "Refresh metadata" button runs. That one unconditionally
 * overwrites `tags` and replaces `metadata` wholesale, which is fine with a human
 * watching — the clobber is visible and cancellable before save — but unattended
 * at 12:47 UTC it is silent data loss. Three concrete casualties if we reused it:
 * hand-added tags on movies and games would revert nightly (TMDB returns genres,
 * IGDB genres + themes); `MovieMetadata.series`/`series_number` and
 * `GameMetadata.platform` are user-maintained and no provider returns them
 * (`providers/igdb.ts` maps `metadata: {}`), so a metadata replace would wipe them;
 * and `creator_sort` is documented as hand-fixable, so re-deriving it would undo
 * every fix.
 *
 * Two rules were judgment calls, both settled on #106:
 *
 * 1. `title`/`creator` refresh from the provider, matching what `mergeSyncedBook`
 *    does for books (`title: fresh.title`, `overwrite(creator)`) so the two syncs
 *    behave alike. The cost is accepted: a disambiguating hand-edit to a title
 *    reverts on the next run.
 * 2. `tags` fill only when empty, mirroring the Hardcover precedent (books enrich
 *    only when `hardcover_id` is absent). The cost is accepted: a genre TMDB adds
 *    later never reaches an item that already carries tags.
 */

/** Set a provider field from the fresh draft, deleting it when the draft omits it. */
export function overwrite<K extends keyof Item>(
	target: Item,
	key: K,
	value: Item[K] | undefined,
): void {
	if (value === undefined) delete target[key];
	else target[key] = value;
}

/**
 * Set a provider field from the fresh draft, keeping the existing value when the
 * draft omits it. An absent draft value means "the provider has nothing here",
 * not "this item has no value" — IGDB's time-to-beat coverage is thin, and a
 * lookup that returns no `length` must not delete one the import found.
 */
export function preferFresh<K extends keyof Item>(
	target: Item,
	key: K,
	value: Item[K] | undefined,
): void {
	if (value !== undefined) target[key] = value;
}

/**
 * Merge a fresh provider draft onto the stored item, following the table above.
 * One function serves all three types: spreading `fresh.metadata` over
 * `existing.metadata` gives a show its refreshed season fields, while movies and
 * games — whose drafts carry `metadata: {}` — keep their user-maintained
 * `platform`/`series`/`series_number`.
 */
export function mergeSyncedItem(existing: Item, fresh: Item): Item {
	const merged: Item = {
		...existing,
		title: fresh.title,
		metadata: { ...existing.metadata, ...fresh.metadata },
	};
	overwrite(merged, 'creator', fresh.creator);
	overwrite(merged, 'community_rating', fresh.community_rating);
	preferFresh(merged, 'cover', fresh.cover);
	preferFresh(merged, 'thumbnail', fresh.thumbnail);
	preferFresh(merged, 'backdrop', fresh.backdrop);
	preferFresh(merged, 'release_date', fresh.release_date);
	preferFresh(merged, 'description', fresh.description);
	preferFresh(merged, 'length', fresh.length);
	preferFresh(merged, 'length_unit', fresh.length_unit);
	// Fill only — a curated tag list is never re-clobbered by provider genres.
	if (existing.tags.length === 0 && fresh.tags.length > 0) {
		merged.tags = fresh.tags;
	}
	return merged;
}

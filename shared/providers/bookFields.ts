import type { Item } from '../types/item';

/**
 * Which source wins which book field (issue #69). Books arrive through two doors
 * — the bulk CSV import (`import/goodreads.ts` → Google Books → Hardcover) and the
 * daily RSS sync (`import/goodreadsRss.ts` → Hardcover) — and used to disagree,
 * because each door made its own field-by-field choices. This module is the single
 * table both obey:
 *
 * | Field                                              | Source of truth        | Fallback   |
 * | -------------------------------------------------- | ---------------------- | ---------- |
 * | `id`, `title`, `creator`, `series`, `isbn`           | Goodreads              | —          |
 * | `status`, `my_rating`, `completed_dates`, purchased  | Goodreads              | —          |
 * | `release_date`                                       | Goodreads              | Google     |
 * | `length`, `length_unit`                              | Goodreads              | Google     |
 * | `description`                                        | Goodreads RSS          | Google     |
 * | `community_rating`                                   | Goodreads RSS          | Hardcover  |
 * | `tags`                                               | Hardcover `Genre`      | Google     |
 * | `cover`, `thumbnail`                                 | Goodreads if ≥ 640px   | Google     |
 *
 * The two entries that motivated the issue are `release_date` and `length`. Google
 * Books resolves an ISBN (or a title search) to one *edition*, and reports that
 * edition's reprint date and page count — Neuromancer as 2000-07-01 rather than
 * 1984, Wool as a 597-page 2020 omnibus rather than the 56-page 2011 novelette.
 * Goodreads carries the work's original publication year and the page count of the
 * edition actually shelved, and is right in every case checked. Note this is *not*
 * an edition preference: the shelved edition is already what Goodreads reports, and
 * preferring Google's ebook volume would make page counts worse, not better (it
 * gives System Collapse 189 pages against Goodreads' correct 248).
 *
 * Cover is the one field Google usually wins, because Goodreads' art is served off
 * Amazon's CDN where the `._SX640_` directive only ever scales *down* — 55 of the
 * 100 covers on the `read` shelf have an original narrower than 640px. That rule
 * needs a measured width, so it lives in the sync (`import/goodreadsRss.ts`); the
 * CSV export carries no cover URL at all, leaving the import with Google either way.
 */

/**
 * A Google Books draft with the export's own values restored for the fields
 * Goodreads owns. `goodreads` is the importer's `fallbackDraft` (built from the
 * CSV row); when it's absent, or carries nothing for a field, Google's value
 * stands — a fallback, not a veto.
 *
 * `length` and `length_unit` move as a pair, so a page count never inherits the
 * other source's unit.
 */
export function preferGoodreadsFields(
	google: Item,
	goodreads: Item | undefined,
): Item {
	if (!goodreads) return google;

	const merged: Item = { ...google };
	if (goodreads.release_date !== undefined) {
		merged.release_date = goodreads.release_date;
	}
	if (goodreads.length !== undefined) {
		merged.length = goodreads.length;
		merged.length_unit = goodreads.length_unit ?? 'pages';
	}
	return merged;
}

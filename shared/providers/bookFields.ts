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
 * | `release_date`                                       | Goodreads *            | Google     |
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
 * \* `release_date` has one carve-out, added in #97: Goodreads carries only a bare
 * year, and for a book published in the last three years Google's day-level date
 * for the *same* year is the same edition — there has been no time for a reprint
 * to exist, let alone be the one Google resolves. So a recent full date that agrees
 * with Goodreads on the year wins; everything else keeps the Goodreads year. See
 * `preferGoogleReleaseDate` for why the year check is the whole safety mechanism.
 *
 * Cover is the one field Google usually wins, because Goodreads' art is served off
 * Amazon's CDN where the `._SX640_` directive only ever scales *down* — 55 of the
 * 100 covers on the `read` shelf have an original narrower than 640px. That rule
 * needs a measured width, so it lives in the sync (`import/goodreadsRss.ts`); the
 * CSV export carries no cover URL at all, leaving the import with Google either way.
 */

/** A bare `YYYY` — all Goodreads' `book_published` ever carries. */
const YEAR_ONLY = /^\d{4}$/;
/** A `YYYY-MM-DD`, the shape every other media type stores. */
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A date carrying more than a year: `YYYY-MM` (hand-typed) or `YYYY-MM-DD`. */
const REFINED_DATE = /^\d{4}-\d{2}(-\d{2})?$/;

/**
 * How far back the carve-out reaches, in years before the current one. Three years
 * total (this year and the two prior) is where the two sources still agree: across
 * the 34 library books dated 2024 or later, Google returned a full date agreeing
 * with the Goodreads year 31 times and disagreed 0 times. A 56-book sample of older
 * titles disagreed on 16 — Neuromancer's 1984 answered as 2000-07-01, Fight Club's
 * 1996 as 2005-10-17 — which is the reprint problem #69 was written to avoid.
 */
const RECENT_YEARS = 2;

/**
 * Whether Google's date should override the Goodreads year for this book.
 *
 * The year check does the real work: an edition Google picked that *isn't* the
 * original prints a different year than Goodreads' original-publication year, so
 * requiring the years to match rejects every reprint before recency is even
 * consulted. Recency then guards the remaining case — a same-year paperback or
 * ebook reissue, which only becomes possible once a book is old enough to have one.
 *
 * Takes `now` so tests can pin the window; production always passes today.
 */
export function preferGoogleReleaseDate(
	goodreads: string,
	google: string,
	now: Date = new Date(),
): boolean {
	if (!YEAR_ONLY.test(goodreads) || !FULL_DATE.test(google)) return false;
	if (google.slice(0, 4) !== goodreads) return false;
	return Number(goodreads) >= now.getFullYear() - RECENT_YEARS;
}

/**
 * Whether writing `incoming` over `stored` would throw away precision — a bare
 * `YYYY` replacing a `YYYY-MM`/`YYYY-MM-DD` that already starts with that year.
 *
 * The Goodreads RSS sync re-applies the feed's year on every run, so without this
 * check any full date the library holds for a currently-shelved book — put there by
 * the carve-out above, by the backfill script, or by hand in the edit form — is
 * silently downgraded the next morning. Unlike the carve-out this has no recency
 * window: a hand-typed date on a 1984 book deserves the same protection. (#97)
 */
export function isReleaseDateDowngrade(
	stored: string | undefined,
	incoming: string | undefined,
): boolean {
	if (!stored || !incoming) return false;
	if (!YEAR_ONLY.test(incoming) || !REFINED_DATE.test(stored)) return false;
	return stored.startsWith(incoming);
}

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
	const goodreadsDate = goodreads.release_date;
	const googleDate = google.release_date;
	if (goodreadsDate !== undefined) {
		merged.release_date =
			googleDate !== undefined &&
			preferGoogleReleaseDate(goodreadsDate, googleDate)
				? googleDate
				: goodreadsDate;
	}
	if (goodreads.length !== undefined) {
		merged.length = goodreads.length;
		merged.length_unit = goodreads.length_unit ?? 'pages';
	}
	return merged;
}

import 'dotenv/config';
import { itemsEqual, readBooks, writeItems } from './lib/firestore-admin';
import {
	applyVolume,
	fetchVolume,
	GOOGLE_BOOKS_INTERVAL_MS,
	resolveVolume,
	sleep,
} from './lib/googleBooks';
import type { BookMetadata, Item } from '../shared/types/item';

/**
 * Backfill of the two things only Google Books can give an already-stored book:
 * `metadata.google_books_id` (#98) and a day-level `release_date` (#97).
 *
 * Books arrive from Goodreads carrying only a bare year, because that's all the
 * RSS feed's `book_published` holds. Google has the exact date, and for a book
 * published in the last three years its answer is trustworthy — no time has passed
 * for a reprint edition to exist, so the edition it resolves *is* the first one.
 * `preferGoogleReleaseDate` owns that rule and this script only applies it.
 *
 * The id matters separately: without one, "Refresh metadata" in the edit form has
 * nothing to refresh from, and the book gets re-queried on every sync forever.
 * Books that arrived before the sync learned to fetch one (#98) still lack it.
 *
 * This is the bulk counterpart to the sync's own pass, which is capped per run and
 * only looks at books with no id at all. Safe to re-run: a book keeps whatever it
 * already has unless Google clearly improves on it, and nothing here overwrites a
 * field the feed or Hardcover owns.
 *
 * Run:      npm run backfill:google-books
 * Preview:  npm run backfill:google-books -- --dry-run
 *
 * Requires FIREBASE_SERVICE_ACCOUNT. NUXT_GOOGLE_BOOKS_API_KEY is optional —
 * Google Books answers unkeyed requests, just at a lower rate limit.
 */

/** A bare `YYYY` — the only date shape worth trying to refine. */
const YEAR_ONLY = /^\d{4}$/;

/**
 * How far back to look for dates, matching `RECENT_YEARS` in
 * `providers/bookFields.ts`. A wider net wouldn't hurt correctness
 * (`preferGoogleReleaseDate` rejects anything older anyway), but every extra year
 * is a few hundred pointless Google Books calls.
 */
const RECENT_YEARS = 2;

/** Books whose date could still be refined by a recent, agreeing Google date. */
function needsDate(book: Item, cutoff: number): boolean {
	const date = book.release_date ?? '';
	return YEAR_ONLY.test(date) && Number(date) >= cutoff;
}

/** Books with no Google handle at all. */
function needsId(book: Item): boolean {
	return !(book.metadata as BookMetadata).google_books_id;
}

/**
 * The volume for a book: its stored id when it has one (the most exact handle —
 * it names the edition the import already chose), otherwise the ISBN/title
 * resolution, which carries the author-corroboration guard.
 */
async function volumeFor(book: Item) {
	const id = (book.metadata as BookMetadata).google_books_id;
	if (id) {
		const volume = await fetchVolume(id);
		if (volume) return volume;
		await sleep(GOOGLE_BOOKS_INTERVAL_MS);
	}
	return resolveVolume(book);
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	const books = await readBooks();
	const cutoff = new Date().getFullYear() - RECENT_YEARS;
	const candidates = books.filter(
		(book) => needsDate(book, cutoff) || needsId(book),
	);
	console.log(
		`${books.length} books; ${candidates.length} to check — ` +
			`${books.filter((b) => needsDate(b, cutoff)).length} with a year-only date ` +
			`from ${cutoff} or later, ${books.filter(needsId).length} with no google_books_id.`,
	);

	const toWrite: Item[] = [];
	let unmatched = 0;
	for (const book of candidates) {
		const volume = await volumeFor(book);
		await sleep(GOOGLE_BOOKS_INTERVAL_MS);

		if (!volume) {
			unmatched++;
			console.warn(`  ? ${book.title} — no confident Google Books match`);
			continue;
		}

		const updated: Item = { ...book, metadata: { ...book.metadata } };
		const dated = applyVolume(updated, volume);
		if (itemsEqual(book, updated)) continue;

		const notes = [
			needsId(book) ? `id ${volume.id}` : undefined,
			dated ? `${book.release_date} → ${updated.release_date}` : undefined,
		].filter(Boolean);
		toWrite.push(updated);
		console.log(`  + ${book.title} — ${notes.join(', ')}`);
	}

	console.log(
		`Updating ${toWrite.length} books; ${unmatched} had no confident match.`,
	);

	if (dryRun) {
		console.log('--dry-run: no writes.');
		return;
	}
	await writeItems(toWrite);
	console.log(`Wrote ${toWrite.length} books.`);
}

main().catch((error: unknown) => {
	console.error('Google Books backfill failed:', error);
	process.exit(1);
});

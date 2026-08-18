import 'dotenv/config';
import type { Item } from '../shared/types/item';
import { deleteItems, readBooks, writeItems } from './lib/firestore-admin';

/**
 * One-off cleanup for books that exist twice: once under a Google Books volume id
 * (`book-google-books-<id>`, the shape the app's Add search mints) and once under
 * a Goodreads book id (`book-goodreads-<id>`, the shape the daily sync mints).
 *
 * The two id spaces never collide, so adding a book in the app *and* shelving it
 * on Goodreads yields two independent documents. The sync only ever reads the ids
 * it derives from the feed (`sync-goodreads.ts`), so the app-created twin is
 * invisible to it forever — it keeps whatever community rating Google Books had
 * on the day it was added, or none at all when Google carried no `averageRating`.
 *
 * The Goodreads twin is the keeper: it's the one the sync refreshes, and its tags
 * come from Hardcover rather than Google's `categories` (which are auto-derived,
 * not chosen — so they are deliberately *not* merged). But the app-created twin is
 * where the owner actually typed, so the user-owned fields move across before it
 * is deleted.
 *
 * Only pairs that agree on title *and* author are touched, and only when exactly
 * one Goodreads twin exists. Anything else — including duplicate pairs where both
 * sides are Goodreads ids — is reported for manual review, never merged.
 *
 * Run:      npm run merge:duplicate-books
 * Preview:  npm run merge:duplicate-books -- --dry-run
 *
 * Requires FIREBASE_SERVICE_ACCOUNT.
 */

/** A loose key for "the same work": title and author, punctuation-insensitive. */
function matchKey(book: Item): string {
	const creator = Array.isArray(book.creator)
		? (book.creator[0] ?? '')
		: (book.creator ?? '');
	return [book.title, creator]
		.map((part) => part.toLowerCase().replace(/[^a-z0-9]/g, ''))
		.join('|');
}

/** The fields the sync never writes, so only the app-created twin can hold them. */
interface Carried {
	field: string;
	from: unknown;
	to: unknown;
}

/**
 * Fold the app-created twin's user-owned fields onto the Goodreads keeper. The
 * keeper wins any field it already has — it's the document that stayed in sync, so
 * a value on it is at least as fresh — except the booleans, where either side
 * saying "yes" is the answer, and `completed_dates`, which unions.
 */
function carryOver(
	keeper: Item,
	loser: Item,
): { item: Item; carried: Carried[] } {
	const item: Item = { ...keeper };
	const carried: Carried[] = [];

	const note = (field: string, from: unknown, to: unknown) => {
		carried.push({ field, from, to });
	};

	if (loser.notes && !item.notes) {
		note('notes', loser.notes, undefined);
		item.notes = loser.notes;
	}
	if (loser.recommended_by && !item.recommended_by) {
		note('recommended_by', loser.recommended_by, undefined);
		item.recommended_by = loser.recommended_by;
	}
	if (loser.my_rating !== undefined && item.my_rating === undefined) {
		note('my_rating', loser.my_rating, undefined);
		item.my_rating = loser.my_rating;
	}
	if (loser.is_purchased && !item.is_purchased) {
		note('is_purchased', true, false);
		item.is_purchased = true;
	}
	if (loser.is_prioritized && !item.is_prioritized) {
		note('is_prioritized', true, false);
		item.is_prioritized = true;
	}

	const dates = new Set([
		...(item.completed_dates ?? []),
		...(loser.completed_dates ?? []),
	]);
	if (dates.size > (item.completed_dates ?? []).length) {
		const merged = [...dates].sort();
		note('completed_dates', merged, item.completed_dates);
		item.completed_dates = merged;
	}

	return { item, carried };
}

function describe(value: unknown): string {
	if (value === undefined) return '—';
	if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '[]';
	const text = String(value);
	return text.length > 70 ? `${text.slice(0, 67)}…` : text;
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run');

	const books = await readBooks();
	const groups = new Map<string, Item[]>();
	for (const book of books) {
		const key = matchKey(book);
		groups.set(key, [...(groups.get(key) ?? []), book]);
	}

	const toWrite: Item[] = [];
	const toDelete: string[] = [];
	const unhandled: Item[][] = [];

	for (const group of groups.values()) {
		if (group.length < 2) continue;

		const keepers = group.filter((b) => b.id.startsWith('book-goodreads-'));
		const losers = group.filter((b) => b.id.startsWith('book-google-books-'));
		// Only the one shape this script understands: a single Goodreads survivor
		// absorbing its app-created twins, with nothing else in the group.
		if (keepers.length !== 1 || losers.length !== group.length - 1) {
			unhandled.push(group);
			continue;
		}

		let keeper = keepers[0]!;
		console.log(`\n${keeper.title} — ${describe(keeper.creator)}`);
		console.log(
			`  keep   ${keeper.id}  (community ${describe(keeper.community_rating)})`,
		);
		for (const loser of losers) {
			console.log(
				`  delete ${loser.id}  (community ${describe(loser.community_rating)})`,
			);
			const { item, carried } = carryOver(keeper, loser);
			keeper = item;
			for (const { field, from, to } of carried) {
				console.log(`    carry ${field}: ${describe(to)} → ${describe(from)}`);
			}
		}
		toWrite.push(keeper);
		toDelete.push(...losers.map((l) => l.id));
	}

	if (unhandled.length > 0) {
		console.log('\nDuplicate groups left alone (manual review):');
		for (const group of unhandled) {
			console.log(
				`  ${group[0]!.title} — ${group.map((b) => `${b.id} [${b.status}]`).join('  |  ')}`,
			);
		}
	}

	console.log(
		`\n${books.length} books scanned: ${toWrite.length} merged, ${toDelete.length} to delete, ${unhandled.length} left alone`,
	);

	if (dryRun) {
		console.log('--dry-run: no writes.');
		return;
	}
	// Write the absorbed keeper before dropping the twin, so an interruption
	// between the two leaves a harmless duplicate rather than losing the notes.
	await writeItems(toWrite);
	await deleteItems(toDelete);
	console.log('Done.');
}

main().catch((error: unknown) => {
	console.error('Merge failed:', error);
	process.exit(1);
});

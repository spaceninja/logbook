import { decodeEntities } from '../utils/htmlToMarkdown';
import type { SyncedBook, SyncShelf } from './goodreadsSync';
import { parseSeriesSuffix } from './series';

/**
 * Reader for Goodreads' public shelf widget (`/review/custom_widget/<user>`), the
 * one shelf view still served without signing in since Goodreads retired RSS
 * (#205). The response is a JavaScript snippet that assigns the widget's HTML to a
 * string literal; we decode that literal and pull each book out of it.
 *
 * Its limits shape the sync:
 * - At most `WIDGET_LIMIT` books per shelf, with no paging. Sorting newest-first
 *   keeps every *change* in view, which is all a daily sync needs.
 * - No dates of any kind — see `inferReadDates` for how the sync copes.
 * - No book id field. The cover's filename is the Goodreads book id
 *   (`…/books/1731705848l/217582924._SY75_.jpg`), which is how a widget book keys
 *   into `book-goodreads-<id>`. A book with no cover has no id and is skipped.
 */

/** The most books the widget returns; asking for more still returns this many. */
export const WIDGET_LIMIT = 100;

/**
 * Goodreads' sort for each shelf. `read` must be by date read, newest first:
 * `inferReadDates` reads meaning into that order. The others only need recent
 * additions to stay inside the 100-book window.
 */
const SHELF_SORT: Record<SyncShelf, string> = {
	read: 'date_read',
	'currently-reading': 'date_added',
	'to-read': 'date_added',
};

/**
 * The widget URL for one shelf. `widgetId` must differ between requests: Goodreads
 * caches the rendered widget per id, and a reused id served the `read` shelf back
 * for every other shelf asked for.
 */
export function widgetUrl(
	userId: string,
	shelf: SyncShelf,
	widgetId: string,
): string {
	const params = new URLSearchParams({
		shelf,
		sort: SHELF_SORT[shelf],
		order: 'd',
		num_books: String(WIDGET_LIMIT),
		show_author: '1',
		show_cover: '1',
		show_rating: '1',
		show_title: '1',
		widget_id: widgetId,
	});
	return `https://www.goodreads.com/review/custom_widget/${encodeURIComponent(userId)}?${params}`;
}

/** The HTML inside the snippet's `var widget_code = '…'` string literal. */
function widgetHtml(script: string): string | undefined {
	const literal = script.match(/var widget_code = '((?:[^'\\]|\\.)*)'/s)?.[1];
	if (literal === undefined) return undefined;
	const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t' };
	return literal.replace(/\\(u[0-9a-fA-F]{4}|.)/gs, (_, code: string) =>
		code.length === 5
			? String.fromCharCode(Number.parseInt(code.slice(1), 16))
			: (escapes[code] ?? code),
	);
}

/** A cover URL at the given width, or undefined for a `nophoto` placeholder. */
function coverUrl(raw: string | undefined, width: number): string | undefined {
	if (!raw || raw.includes('nophoto')) return undefined;
	// Swap Amazon's resize directive (`._SY75_`, `._SX98_`, …) for our width.
	return raw.replace(/\._S[XY]\d+_(\.\w+)(?=$|\?)/i, `._SX${width}_$1`);
}

/**
 * Entity-decoded text with whitespace runs collapsed — Goodreads pads some names
 * ("Gareth L.   Powell"), which would otherwise rewrite the stored author.
 */
function cleanText(raw: string | undefined): string | undefined {
	const text = decodeEntities(raw ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > 0 ? text : undefined;
}

/** The cleaned text of the first `<a>` inside a block. */
function linkText(block: string | undefined): string | undefined {
	return cleanText(block?.match(/<a\b[^>]*>([^<]*)<\/a>/)?.[1]);
}

/** One `gr_custom_<part>_<widgetId>` block's inner HTML. */
function part(entry: string, name: string): string | undefined {
	const pattern = new RegExp(
		`<div class="gr_custom_${name}_\\d+">([\\s\\S]*?)</div>`,
	);
	return entry.match(pattern)?.[1];
}

export interface WidgetShelf {
	books: SyncedBook[];
	/** Titles of entries with no usable cover, so no book id to key them by. */
	skipped: string[];
}

/**
 * Parse one shelf's widget response, preserving Goodreads' order. Throws when the
 * response isn't a widget at all (an error page, a sign-in redirect), so the sync
 * aborts rather than reading an empty shelf as books having been removed.
 */
export function parseWidget(script: string, shelf: SyncShelf): WidgetShelf {
	const html = widgetHtml(script);
	if (html === undefined) {
		throw new Error(`${shelf} widget: response has no widget_code`);
	}

	const books: SyncedBook[] = [];
	const skipped: string[] = [];
	const entries = html.split(/<div class="gr_custom_each_container_\d+">/);
	for (const entry of entries.slice(1)) {
		const cover = part(entry, 'book_container');
		// The cover link's `title` keeps the series suffix the title link drops.
		const fullTitle =
			cleanText(cover?.match(/<a title="([^"]*)"/)?.[1]) ??
			linkText(part(entry, 'title')) ??
			'';
		const src = cover?.match(/<img\b[^>]*\bsrc="([^"]*)"/)?.[1];
		const bookId = coverUrl(src, 1)?.match(/\/books\/\d+[lms]\/(\d+)\./)?.[1];
		if (!bookId) {
			skipped.push(fullTitle || '(untitled)');
			continue;
		}

		const { title, series, seriesNumber } = parseSeriesSuffix(fullTitle);
		const stars = (
			part(entry, 'rating')?.match(/gr_flat_red_star_active/g) ?? []
		).length;
		const author = linkText(part(entry, 'author'));

		books.push({
			bookId,
			title,
			...(series ? { series } : {}),
			...(seriesNumber !== undefined ? { seriesNumber } : {}),
			...(author ? { author } : {}),
			coverLarge: coverUrl(src, 640),
			coverSmall: coverUrl(src, 180),
			...(stars > 0 ? { myRating: stars * 2 } : {}),
			shelf,
		});
	}
	return { books, skipped };
}

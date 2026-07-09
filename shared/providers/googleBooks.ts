import type { Item } from '../types/item';
import type { SearchResult } from '../types/search';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';
import { makeBookId } from '../utils/itemId';
import {
	draftDefaults,
	normalizeTags,
	round2,
	titleTier,
	toCreator,
	yearOf,
} from './helpers';

interface GoogleBooksVolumeInfo {
	title?: string;
	authors?: string[];
	publishedDate?: string;
	description?: string;
	categories?: string[];
	pageCount?: number;
	averageRating?: number;
	imageLinks?: { thumbnail?: string; smallThumbnail?: string };
	industryIdentifiers?: { type: string; identifier: string }[];
}
export interface GoogleBooksVolume {
	id: string;
	volumeInfo?: GoogleBooksVolumeInfo;
	accessInfo?: { publicDomain?: boolean };
}

// Cover widths in px. Google Books' `imageLinks` only give a ~128px thumbnail,
// but the same volume's content endpoint serves any width — and always for the
// exact edition search showed (unlike Open Library, which we used to reach for
// and which routinely returned the wrong edition/language). Cover for the detail
// view, thumbnail for lists (~matching the other media types).
const COVER_WIDTH = 640;
const THUMB_WIDTH = 180;

/**
 * A Google Books cover URL at the given width, or undefined when the volume has
 * no cover. Gated on `imageLinks`, because the content endpoint otherwise returns
 * a generic "image not available" placeholder for coverless volumes.
 *
 * `zoom=1` is load-bearing: without it the endpoint ignores `printsec=frontcover`
 * and renders an interior page instead (for "Ancestral Night", the praise page).
 * `fife=w{width}` then scales that cover to any width. The API's own `imageLinks`
 * URLs carry a signed `imgtk` token, but it isn't needed — this URL returns the
 * byte-identical image without one, so stored covers can't expire with it.
 */
function googleBooksCover(
	volume: GoogleBooksVolume,
	width: number,
): string | undefined {
	if (!volume.volumeInfo?.imageLinks?.thumbnail) return undefined;
	return `https://books.google.com/books/content?id=${volume.id}&printsec=frontcover&img=1&zoom=1&fife=w${width}`;
}

/** Google Books categories are slash/comma-delimited strings → flat tag list. */
function categoriesToTags(categories: string[] | undefined): string[] {
	return normalizeTags((categories ?? []).flatMap((c) => c.split(/[/,]/)));
}

function isbnOf(info: GoogleBooksVolumeInfo): string | undefined {
	const ids = info.industryIdentifiers ?? [];
	return (
		ids.find((i) => i.type === 'ISBN_13')?.identifier ??
		ids.find((i) => i.type === 'ISBN_10')?.identifier
	);
}

/**
 * A public-domain library scan with no ISBN — Google's "cover" for these is a
 * photograph of the title page, and they crowd out real books (a search for
 * "folded sky elizabeth bear" surfaces 1921's "The Grizzly Bear"). Demoted, never
 * dropped, so a genuinely old book stays reachable.
 */
function isLibraryScan(volume: GoogleBooksVolume): boolean {
	return (
		volume.accessInfo?.publicDomain === true &&
		isbnOf(volume.volumeInfo ?? {}) === undefined
	);
}

/**
 * Re-rank Google Books hits: real books before library scans, then by how well
 * the title matches the query, with Google's original order as the final
 * (stable) tiebreaker. Google's own relevance mixes periodicals and library
 * scans in among the books it can't distinguish them by `printType`, which
 * reports "BOOK" even for "Chapman's Magazine of Fiction". Mirrors
 * `rankIgdbGames`.
 */
export function rankGoogleBooksVolumes(
	volumes: GoogleBooksVolume[],
	query: string,
): GoogleBooksVolume[] {
	return volumes
		.map((volume, index) => ({ volume, index }))
		.sort((a, b) => {
			const scan =
				Number(isLibraryScan(a.volume)) - Number(isLibraryScan(b.volume));
			if (scan !== 0) return scan;
			const tier =
				titleTier(a.volume.volumeInfo?.title ?? '', query) -
				titleTier(b.volume.volumeInfo?.title ?? '', query);
			if (tier !== 0) return tier;
			return a.index - b.index;
		})
		.map((entry) => entry.volume);
}

export function mapGoogleBooksSearch(
	volumes: GoogleBooksVolume[],
): SearchResult[] {
	return volumes.map((v) => {
		const info = v.volumeInfo ?? {};
		return {
			type: 'book',
			providerId: v.id,
			title: info.title ?? '(untitled)',
			year: yearOf(info.publishedDate),
			thumbnail: googleBooksCover(v, THUMB_WIDTH),
			subtitle: info.authors?.join(', '),
		};
	});
}

export function mapGoogleBooksDraft(volume: GoogleBooksVolume): Item {
	const info = volume.volumeInfo ?? {};
	const isbn = isbnOf(info);
	const item: Item = {
		id: makeBookId('google-books', volume.id),
		type: 'book',
		title: info.title ?? '(untitled)',
		provider: 'google-books',
		...draftDefaults(),
		tags: categoriesToTags(info.categories),
		metadata: { google_books_id: volume.id, ...(isbn ? { isbn } : {}) },
	};
	const creator = toCreator(info.authors ?? []);
	if (creator !== undefined) item.creator = creator;
	if (info.publishedDate) item.release_date = info.publishedDate;
	if (info.description) item.description = htmlToMarkdown(info.description);
	if (info.pageCount && info.pageCount > 0) {
		item.length = info.pageCount;
		item.length_unit = 'pages';
	}
	// Google Books averageRating is 0–5; normalize to 0–10 (often absent).
	if (info.averageRating && info.averageRating > 0) {
		item.community_rating = round2(info.averageRating * 2);
	}
	const cover = googleBooksCover(volume, COVER_WIDTH);
	const thumbnail = googleBooksCover(volume, THUMB_WIDTH);
	if (cover) item.cover = cover;
	if (thumbnail) item.thumbnail = thumbnail;
	return item;
}

import type { Item } from '../types/item';
import type { SearchResult } from '../types/search';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';
import { makeBookId } from '../utils/itemId';
import {
	draftDefaults,
	normalizeTags,
	round2,
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
}

// Cover widths in px. Google Books' `imageLinks` only give a ~128px thumbnail,
// but the same volume's content endpoint serves any width via `fife` — and always
// for the exact edition search showed (unlike Open Library, which we used to reach
// for and which routinely returned the wrong edition/language). Cover for the
// detail view, thumbnail for lists (~matching the other media types).
const COVER_WIDTH = 640;
const THUMB_WIDTH = 180;

/**
 * A Google Books cover URL at the given width, or undefined when the volume has
 * no cover. Gated on `imageLinks`, because the content endpoint otherwise returns
 * a generic "image not available" placeholder for coverless volumes.
 */
function googleBooksCover(
	volume: GoogleBooksVolume,
	width: number,
): string | undefined {
	if (!volume.volumeInfo?.imageLinks?.thumbnail) return undefined;
	return `https://books.google.com/books/content?id=${volume.id}&printsec=frontcover&img=1&fife=w${width}`;
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

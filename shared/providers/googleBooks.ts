import type { Item } from '../types/item';
import type { SearchResult } from '../types/search';
import { makeBookId } from '../utils/itemId';
import {
  cleanCoverUrl,
  draftDefaults,
  normalizeTags,
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
      thumbnail: cleanCoverUrl(
        info.imageLinks?.smallThumbnail ?? info.imageLinks?.thumbnail,
      ),
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
    metadata: isbn ? { isbn } : {},
  };
  const creator = toCreator(info.authors ?? []);
  if (creator !== undefined) item.creator = creator;
  if (info.publishedDate) item.release_date = info.publishedDate;
  if (info.description) item.description = info.description;
  if (info.pageCount && info.pageCount > 0) {
    item.length = info.pageCount;
    item.length_unit = 'pages';
  }
  // Google Books averageRating is 0–5; normalize to 0–10 (often absent).
  if (info.averageRating && info.averageRating > 0) {
    item.community_rating = info.averageRating * 2;
  }
  const cover = cleanCoverUrl(
    info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail,
  );
  const thumbnail = cleanCoverUrl(
    info.imageLinks?.smallThumbnail ?? info.imageLinks?.thumbnail,
  );
  if (cover) item.cover = cover;
  if (thumbnail) item.thumbnail = thumbnail;
  return item;
}

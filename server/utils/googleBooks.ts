// Plain ofetch $fetch (see tmdb.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';
import type { BookMetadata } from '../../shared/types/item';
import {
  mapGoogleBooksDraft,
  mapGoogleBooksSearch,
  type GoogleBooksVolume,
} from '../../shared/providers/googleBooks';

const BASE = 'https://www.googleapis.com/books/v1';

type Covers = { cover: string; thumbnail: string };

const olCovers = (path: string): Covers => ({
  cover: `https://covers.openlibrary.org/b/${path}-L.jpg`,
  thumbnail: `https://covers.openlibrary.org/b/${path}-M.jpg`,
});

/**
 * Google Books only serves ~128px covers. Open Library has higher-res ones. The
 * by-ISBN cover only exists for editions whose ISBN was uploaded (often a miss),
 * so we try that exact edition first, then fall back to OL's search endpoint,
 * which resolves the title+author to the work's `cover_i` (reliably present).
 * Returns null when neither hits, so the caller keeps the Google Books cover.
 */
async function openLibraryCovers(
  title: string,
  author: string | undefined,
  isbn: string | undefined,
): Promise<Covers | null> {
  try {
    // 1) Exact edition cover by ISBN (?default=false → 404 when absent).
    if (isbn) {
      const head = await fetch(
        `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
        { method: 'HEAD' },
      );
      if (head.ok) return olCovers(`isbn/${isbn}`);
    }
    // 2) The work's representative cover, via search.
    const params = new URLSearchParams({
      title,
      fields: 'cover_i',
      limit: '1',
    });
    if (author) params.set('author', author);
    const search = await $fetch<{ docs?: { cover_i?: number }[] }>(
      `https://openlibrary.org/search.json?${params}`,
    );
    const coverId = search.docs?.[0]?.cover_i;
    if (coverId) return olCovers(`id/${coverId}`);
  } catch {
    // Network error → keep the Google Books cover.
  }
  return null;
}

export async function googleBooksSearch(q: string) {
  const { googleBooksApiKey } = useRuntimeConfig();
  const res = await $fetch<{ items?: GoogleBooksVolume[] }>(`${BASE}/volumes`, {
    params: { q, country: 'US', maxResults: 10, key: googleBooksApiKey },
  });
  return mapGoogleBooksSearch(res.items ?? []);
}

export async function googleBooksDraft(id: string) {
  const { googleBooksApiKey } = useRuntimeConfig();
  const volume = await $fetch<GoogleBooksVolume>(`${BASE}/volumes/${id}`, {
    params: { country: 'US', key: googleBooksApiKey },
  });
  const item = mapGoogleBooksDraft(volume);

  // Upgrade to a higher-res Open Library cover when available.
  const author = Array.isArray(item.creator) ? item.creator[0] : item.creator;
  const isbn = (item.metadata as BookMetadata).isbn;
  const ol = await openLibraryCovers(item.title, author, isbn);
  if (ol) {
    item.cover = ol.cover;
    item.thumbnail = ol.thumbnail;
  }
  return item;
}

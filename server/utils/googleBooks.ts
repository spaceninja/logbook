// Plain ofetch $fetch (see tmdb.ts) — avoids internal-route type matching.
import { $fetch } from 'ofetch';
import type { BookMetadata } from '../../shared/types/item';
import {
  mapGoogleBooksDraft,
  mapGoogleBooksSearch,
  type GoogleBooksVolume,
} from '../../shared/providers/googleBooks';

const BASE = 'https://www.googleapis.com/books/v1';

/**
 * Google Books only serves ~128px covers. Open Library has higher-res covers by
 * ISBN (L ≈ 500px+, M ≈ 180px). Returns them only when OL actually has one
 * (`?default=false` → 404 otherwise), so callers can fall back to Google Books.
 */
async function openLibraryCovers(
  isbn: string,
): Promise<{ cover: string; thumbnail: string } | null> {
  const base = `https://covers.openlibrary.org/b/isbn/${isbn}`;
  try {
    const res = await fetch(`${base}-L.jpg?default=false`, { method: 'HEAD' });
    if (res.ok) return { cover: `${base}-L.jpg`, thumbnail: `${base}-M.jpg` };
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
  const isbn = (item.metadata as BookMetadata).isbn;
  if (isbn) {
    const ol = await openLibraryCovers(isbn);
    if (ol) {
      item.cover = ol.cover;
      item.thumbnail = ol.thumbnail;
    }
  }
  return item;
}

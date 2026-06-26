import type { Item } from '../types/item';
import type { SearchResult } from '../types/search';
import { htmlToMarkdown } from '../utils/htmlToMarkdown';
import { makeGameId } from '../utils/itemId';
import {
  draftDefaults,
  normalizeTags,
  round2,
  toCreator,
  unixSecondsToIsoDate,
} from './helpers';

interface IgdbNamed {
  name: string;
}
export interface IgdbGame {
  id: number;
  name: string;
  first_release_date?: number; // unix seconds
  summary?: string;
  rating?: number; // 0–100
  cover?: { image_id?: string };
  artworks?: { image_id?: string }[];
  screenshots?: { image_id?: string }[];
  genres?: IgdbNamed[];
  themes?: IgdbNamed[];
  involved_companies?: { developer?: boolean; company?: { name?: string } }[];
  // The game's "series" groupings (for Add-series). Plural arrays in IGDB v4.
  collections?: number[];
  franchises?: number[];
}

// Portrait cover sizes (retina): big = 528×748, small = 180×256. Avoid t_thumb,
// which is a 90×90 square crop.
const COVER_SIZE = 't_cover_big_2x';
const THUMB_SIZE = 't_cover_small_2x';
// Landscape art for the backdrop (16:9).
const BACKDROP_SIZE = 't_1080p_2x';

function igdbImage(
  imageId: string | undefined,
  size: string,
): string | undefined {
  return imageId
    ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`
    : undefined;
}

function developers(game: IgdbGame): string[] {
  return (game.involved_companies ?? [])
    .filter((c) => c.developer && c.company?.name)
    .map((c) => c.company!.name!);
}

export function mapIgdbSearch(games: IgdbGame[]): SearchResult[] {
  return games.map((g) => ({
    type: 'game',
    providerId: String(g.id),
    title: g.name,
    year: unixSecondsToIsoDate(g.first_release_date)?.slice(0, 4),
    thumbnail: igdbImage(g.cover?.image_id, THUMB_SIZE),
    subtitle: developers(g).join(', ') || undefined,
  }));
}

export function mapIgdbDraft(game: IgdbGame): Item {
  const item: Item = {
    id: makeGameId('igdb', game.id),
    type: 'game',
    title: game.name,
    provider: 'igdb',
    ...draftDefaults(),
    tags: normalizeTags([
      ...(game.genres?.map((g) => g.name) ?? []),
      ...(game.themes?.map((t) => t.name) ?? []),
    ]),
    metadata: {}, // platform is which platform *you* played — user-set
  };
  const creator = toCreator(developers(game));
  if (creator !== undefined) item.creator = creator;
  const releaseDate = unixSecondsToIsoDate(game.first_release_date);
  if (releaseDate) item.release_date = releaseDate;
  if (game.summary) item.description = htmlToMarkdown(game.summary);
  // IGDB rating is 0–100; normalize to 0–10.
  if (game.rating && game.rating > 0) {
    item.community_rating = round2(game.rating / 10);
  }
  const cover = igdbImage(game.cover?.image_id, COVER_SIZE);
  const thumbnail = igdbImage(game.cover?.image_id, THUMB_SIZE);
  // Prefer official artwork; fall back to a screenshot.
  const backdropId =
    game.artworks?.[0]?.image_id ?? game.screenshots?.[0]?.image_id;
  const backdrop = igdbImage(backdropId, BACKDROP_SIZE);
  if (cover) item.cover = cover;
  if (thumbnail) item.thumbnail = thumbnail;
  if (backdrop) item.backdrop = backdrop;
  return item;
}

import type { Item } from '../types/item';
import type { SearchResult } from '../types/search';
import { makeGameId } from '../utils/itemId';
import {
  draftDefaults,
  normalizeTags,
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
  genres?: IgdbNamed[];
  themes?: IgdbNamed[];
  involved_companies?: { developer?: boolean; company?: { name?: string } }[];
}

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
    thumbnail: igdbImage(g.cover?.image_id, 't_thumb'),
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
  if (game.summary) item.description = game.summary;
  // IGDB rating is 0–100; normalize to 0–10.
  if (game.rating && game.rating > 0) item.community_rating = game.rating / 10;
  const cover = igdbImage(game.cover?.image_id, 't_cover_big');
  const thumbnail = igdbImage(game.cover?.image_id, 't_thumb');
  if (cover) item.cover = cover;
  if (thumbnail) item.thumbnail = thumbnail;
  return item;
}

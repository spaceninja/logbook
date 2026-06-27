import type { Item, MediaType } from '../types/item';

/** Types whose `creator` is a person's name (so we sort by surname). */
const PERSON_TYPES: ReadonlySet<MediaType> = new Set(['book', 'movie', 'show']);

/**
 * Derives the surname-first sort key for an item's `creator`. There is no
 * structured last-name field — `creator` is a display string (or array) — so this
 * is a heuristic: the user can override the result via the form's "Creator sort
 * key" field (core design §4, §15).
 *
 * - No creator → `undefined`.
 * - Games credit a studio, not a person, so the name is returned as-is.
 * - People (book/movie/show): the last whitespace token is moved to the front, so
 *   "George R. R. Martin" → "Martin George R. R.". Multi-word surnames ("Le Guin")
 *   land wrong and need a manual override.
 */
export function deriveCreatorSort(
  creator: Item['creator'],
  type: MediaType,
): string | undefined {
  const primary = Array.isArray(creator) ? creator[0] : creator;
  const name = primary?.trim();
  if (!name) return undefined;

  if (!PERSON_TYPES.has(type)) return name;

  const tokens = name.split(/\s+/);
  if (tokens.length < 2) return name;

  const last = tokens[tokens.length - 1];
  const rest = tokens.slice(0, -1).join(' ');
  return `${last} ${rest}`;
}

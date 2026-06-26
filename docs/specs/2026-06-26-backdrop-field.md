# Logbook — Backdrop Field

> Add a `backdrop` field (large landscape art) populated from the metadata
> source for movies, shows, and games.

- **Date:** 2026-06-26
- **Status:** Approved, pending implementation
- **Relates to:** core design §3.1 (item schema), §5 (add/edit flow)

---

## 1. Goal

TMDB exposes "backdrops" (16:9 promotional art) for movies and shows, and IGDB
exposes large-format artwork/screenshots for games. Capture that as a new
top-level `backdrop` image field, sibling to the existing `cover` (large
portrait) and `thumbnail` (small portrait). Books have no equivalent source and
get no backdrop.

The field is **optional**, so existing items, book items, and any item whose
source lacks a backdrop are unaffected — no data migration.

## 2. Schema

`shared/types/item.ts` — add one optional top-level field after `thumbnail`:

```ts
/** Large landscape art (16:9) for the detail view. Movies/shows/games only. */
backdrop?: string;
```

## 3. Population (provider mappers)

All three reuse the existing `tmdbImage` / `igdbImage` URL helpers with a
landscape size constant (the existing `COVER_SIZE` / `THUMB_SIZE` are portrait).

### 3.1 TMDB movie — `mapTmdbMovieDraft` (`shared/providers/tmdb.ts`)

- Add `backdrop_path?: string | null` to the `TmdbMovieDetails` interface.
- Build the URL from `d.backdrop_path` at size `w1280`; set `item.backdrop`
  only when present (mirroring the `cover`/`thumbnail` guard).

### 3.2 TMDB show — `mapTmdbSeasonDraft` (`shared/providers/tmdb.ts`)

- Add `backdrop_path?: string | null` to the `TmdbShowDetails` interface.
- TMDB **season** details carry no backdrop, so use the **show's**
  `backdrop_path` (already fetched in `tmdbSeasonDraft`). Set `item.backdrop`
  only when present.

### 3.3 IGDB game — `mapIgdbDraft` (`shared/providers/igdb.ts`)

- Add `artworks?: { image_id?: string }[]` and
  `screenshots?: { image_id?: string }[]` to the `IgdbGame` interface.
- Add `artworks.image_id,screenshots.image_id` to the `FIELDS` query string in
  `server/utils/igdb.ts`.
- Source preference: `artworks[0].image_id`, falling back to
  `screenshots[0].image_id`. Build the URL at size `t_1080p_2x`. Set
  `item.backdrop` only when an image id is found.

## 4. Edit form (`app/components/ItemForm.vue`)

Add a "Backdrop URL" field immediately after the existing "Thumbnail URL"
field, wired identically to `cover`/`thumbnail`:

- `form.backdrop: string`, initialized `i?.backdrop ?? ''`.
- Reset in `applyDraft` from `source.backdrop ?? ''`.
- On submit, `if (form.backdrop.trim()) item.backdrop = form.backdrop.trim()`.
- `<input v-model="form.backdrop" type="url" />`.

This gives manual entry/override for every type (a book could be given one by
hand if ever wanted, but no source populates it automatically).

## 5. Display (`app/pages/item/[id]/index.vue`)

Render the backdrop as a simple `<img width="400">` when `item.backdrop`
exists, matching the existing `cover` `<img>` exactly (same width, same
placement region). No hero/banner styling — deliberately minimal, consistent
with the current bare page.

## 6. Out of scope

- List/grid views (Backlog/History) — they use `thumbnail`; no change.
- Goodreads sync / books — no backdrop source.
- NDJSON backup — picks up the new optional field automatically (full-fidelity
  serialization); no change needed.

## 7. Testing

Extend the existing provider unit tests, mirroring the current
`cover`/`thumbnail` assertions:

- `shared/providers/tmdb.test.ts` — movie and show drafts set `backdrop` from
  `backdrop_path`; absent path → `backdrop` undefined.
- `shared/providers/igdb.test.ts` — draft sets `backdrop` from `artworks[0]`;
  artwork absent but screenshot present → uses screenshot; both absent →
  undefined.

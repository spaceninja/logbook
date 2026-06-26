# Logbook — Implementation Plan: Search-Assisted Add (Milestone 3)

> Third milestone toward the [core design](./2026-06-19-logbook-core-design.md),
> building on [read-only](./2026-06-23-logbook-implementation-plan.md) and
> [auth + manual CRUD](./2026-06-24-logbook-auth-add-edit-plan.md). Turns manual
> entry into "type a title, pick the match, save," autofilling metadata from
> public APIs through key-hiding Nitro proxy routes — across all four media types.

- **Date:** 2026-06-25
- **Status:** Approved design, pending implementation
- **Scope:** The search-assisted add flow (TMDB, Google Books, IGDB), the show
  season multi-select, a per-item "refresh metadata" action, and a prerequisite
  status-enum change. Goodreads sync, NDJSON backup, and streaming availability
  remain later milestones. Movie/game **series** enumeration is included as the
  final, optional phase.

---

## 1. Goal & non-goals

**Goal:** On `/add`, choose a type, search by title, pick a match, and get a
prefilled `ItemForm` to tweak and save — with API keys kept server-side. Shows add
per-season via a multi-select + batch panel. Existing items gain a "refresh
metadata" button.

**Non-goals:** Goodreads sync, backup, streaming availability, SSR. Book **series**
enumeration (no reliable live source; deferred to the Goodreads-sync milestone —
manual book add stays single-item). Auth-gating the search proxy (left open; see §10).

---

## 2. Prerequisite: status enum change (Phase 0)

Implemented and committed **first**, as its own change, before the add flow.

- `ItemStatus` becomes `'backlog' | 'in_progress' | 'complete' | 'dnf'` (was
  `…| 'inactive'`).
- **View membership is unchanged in mechanism:**
  - **Backlog** = `where('status','in',['backlog','in_progress'])`.
  - **History** = `where('completed_years','array-contains', year)` — purely
    date-driven, grouped by year. `complete` and `dnf` items both appear if they
    have a completion date; `dnf` is rendered with a visual marker only.
- `dnf` with **no** completion date appears in neither view (a never-logged drop) —
  acceptable and matches the old "inactive + no dates" behavior.
- **Migration:** old `inactive` → `complete`. (All current seed/history items have
  dates, so they map to `complete`.) Update:
  - `shared/types/item.ts` (`ItemStatus`).
  - `app/components/ItemForm.vue` (`STATUSES` options + default stays `backlog`).
  - `app/pages/history.vue` — add a per-row `dnf` marker (e.g. a "DNF" badge when
    `item.status === 'dnf'`).
  - `shared/seeds/edge.ts` + `shared/seeds/sample.ts` — `inactive` → `complete`;
    add one `dnf` edge item (with a completion date) so the marker is exercised.
  - Tests referencing `inactive`.

This phase ships behind no flag; it's a clean rename + one visual addition.

---

## 3. Architecture

```
Browser (/add)
  │  GET /api/search?type&q          ← debounced; returns SearchResult[]
  │  GET /api/draft?type&id[&season] ← on pick; returns a draft Item
  │  GET /api/seasons?showId         ← shows; returns SeasonSummary[]
  │  GET /api/series?type&id         ← movie/game series (Phase 5); members
  ▼
Nitro server routes (Netlify functions)
  ├── providers/tmdb.ts        (movies, shows, collections)
  ├── providers/googleBooks.ts (books)
  ├── providers/igdb.ts        (games, franchises; Twitch token)
  └── mappers → normalized SearchResult / Item
        ▲ keys from server-only runtimeConfig (never shipped to client)
```

- The browser never sees API keys. All third-party calls happen in Nitro routes
  using `$fetch`, with keys from **server-only** `runtimeConfig` (§4).
- Routes return either a normalized `SearchResult[]` (for the list) or a draft
  `Item` (on pick) so the client stays provider-agnostic.

### 3.1 Normalized shapes

```ts
// shared/types/search.ts
export interface SearchResult {
  type: MediaType;
  providerId: string; // provider's native id (TMDB id, IGDB id, Books volumeId)
  title: string;
  year?: string; // from release/air/publish date, for disambiguation
  thumbnail?: string; // small cover
  subtitle?: string; // creator / platform / "Series · N seasons"
  isSeries?: boolean; // movie/game that belongs to a TMDB collection / IGDB franchise
  seriesId?: string; // collection/franchise id, when isSeries
}

export interface SeasonSummary {
  season_number: number;
  name: string; // e.g. "Season 1"
  year?: string;
  episode_count: number;
}
```

`/api/draft` returns a partial `Item` with provider-sourced fields filled and
user fields at defaults (`status: 'backlog'`, booleans false, arrays empty). Its
`id` is the **provider** id (e.g. `movie-tmdb-27205`), not a manual id.

---

## 4. Keys, env, and the IGDB token

Server-only `runtimeConfig` (top-level, **not** `public`) in `nuxt.config.ts`:

```ts
runtimeConfig: {
  tmdbApiKey: '',         // NUXT_TMDB_API_KEY
  googleBooksApiKey: '',  // NUXT_GOOGLE_BOOKS_API_KEY
  twitchClientId: '',     // NUXT_TWITCH_CLIENT_ID
  twitchClientSecret: '', // NUXT_TWITCH_CLIENT_SECRET
  public: { /* …existing… */ },
}
```

- `.env.example` gains the four `NUXT_*` keys (no `PUBLIC_` — they stay server-side).
- Local `.env` gets the real values; **Netlify** gets them for prod.
- **IGDB** needs a Twitch app token: the igdb provider exchanges
  `twitchClientId`/`twitchClientSecret` for an app access token via
  `POST https://id.twitch.tv/oauth2/token?…&grant_type=client_credentials`, and
  **caches it in module scope** with its `expires_in` (≈60 days), refreshing on
  expiry. IGDB calls send `Client-ID` + `Authorization: Bearer <token>`.

### Setup handed to the owner (§ end)

TMDB API key (free, from a TMDB account), Google Books API key (existing), and a
Twitch application (client id + secret) for IGDB.

---

## 5. Provider modules & result→Item mapping

Each provider exposes `search(q)`, `draft(id, season?)`, and (where supported)
`seasons(showId)` / `series(id)`. Mapping highlights:

**Cover-URL cleanup (all providers):** rewrite `http→https`; strip Google Books'
`&edge=curl`. Capture both `cover` (large) and `thumbnail` (small); `thumbnail`
falls back to `cover` when only one size exists.

| Field            | TMDB movie                | TMDB show (season)                                          | Google Books                               | IGDB game                                      |
| ---------------- | ------------------------- | ----------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| id               | `movie-tmdb-<id>`         | `show-tmdb-<showId>-s<n>`                                   | `book-google-books-<volId>`                | `game-igdb-<id>`                               |
| title            | `title`                   | show `name`                                                 | `volumeInfo.title`                         | `name`                                         |
| creator          | director (from `credits`) | `created_by[].name`                                         | `authors`                                  | developer (involved_companies, developer=true) |
| release_date     | `release_date`            | season `air_date`                                           | `publishedDate`                            | `first_release_date` (unix→ISO)                |
| description      | `overview`                | show `overview`                                             | `description`                              | `summary`                                      |
| length / unit    | `runtime` / min           | Σ episode runtimes / min                                    | `pageCount` / pages                        | — / hours (user)                               |
| community_rating | `vote_average` (0–10)     | show `vote_average`                                         | `averageRating`×2 if present (often empty) | `rating`÷10 (0–100→0–10)                       |
| cover/thumbnail  | `poster_path` w500/w185   | season poster → show poster fallback                        | `imageLinks` (cleaned)                     | `cover.image_id` t_cover_big/t_thumb           |
| tags             | `genres[].name`           | show `genres[].name`                                        | split `categories[]`                       | `genres[]`+`themes[]`                          |
| provider         | `tmdb`                    | `tmdb`                                                      | `google-books`                             | `igdb`                                         |
| metadata         | —                         | show_tmdb_id, season_number, episode_count, episode_runtime | series/series_number if present, isbn      | platform (left blank — user-set)               |

Notes:

- **TMDB movie draft** uses `/movie/{id}?append_to_response=credits` (director +
  runtime). **TMDB show season draft** uses `/tv/{id}` (creators, show poster,
  vote_average) + `/tv/{id}/season/{n}` (air_date, episode_count, per-episode
  runtimes summed → `length`).
- **IGDB `platform`** is genuinely per-user (which platform _you_ played), so it's
  **not** auto-filled — it stays a form field.
- All numeric ratings land on the **0–10** scale per the existing convention.
- `tags` are lowercased + de-duplicated.

---

## 6. The `/add` page (single-page state machine)

`app/pages/add.vue` holds `picked: Item | null`. No new routes.

- `picked === null` → render `<AddSearch>`.
- `picked !== null` → render `<ItemForm mode="create" :initial="picked">` with a
  "← Back to search" control (resets `picked`).
- Manual fallback: an "Enter manually" button sets `picked` to an **empty** draft.

`app/components/AddSearch.vue` (presentational; emits a chosen draft or a season
batch):

- A `role="radiogroup"` of the four types (one click), bound to a `type` ref.
- A debounced search input (~300ms after typing stops; non-empty) → `GET
/api/search`. **Stale-response guard:** track the latest query token and ignore
  out-of-order responses. Loading / empty / error states.
- Results list: each shows thumbnail, title, year, subtitle. Plus, for movie/game
  results with `isSeries`, an **"Add series"** affordance (Phase 5).
- On pick (non-show): `GET /api/draft` → emit the draft → page sets `picked`.
- On pick (show): go to the **season step** (§7).

**`ItemForm` change:** in create mode, use `props.initial?.id` when present (a
provider draft), else `makeManualId(form.type)`. (Edit mode already keeps the id.)
This lets picked results carry their provider id while manual adds stay UUID-based.

---

## 7. Shows: season multi-select → batch

When a show is picked:

1. `GET /api/seasons?showId=<id>` → `SeasonSummary[]`. Season 0 / "Specials"
   hidden by default with an opt-in toggle.
2. `app/components/SeasonPicker.vue` renders a multi-select (each row: "S1 · 2022 ·
   9 eps"). Selecting **exactly one** → fetch its draft and go straight to the full
   `ItemForm` (the batch panel adds nothing for one item). Selecting **2+** →
   `BatchAddPanel`.
3. `app/components/BatchAddPanel.vue` (generic; takes the N selected drafts):
   - A read-only checklist of the seasons being created (confirmation).
   - The **shared owner fields**: Status (default `backlog`), Prioritized,
     Purchased, Recommended by, Tags, Notes.
   - If Status is switched to **`complete`**, show info text: "each season will be
     saved as complete with an initial completion date of its air date and no
     rating; edit individual seasons to set a custom date or rating," and on save
     set each season's `completed_dates = [air_date]`.
   - A **"Full edit instead"** toggle → step through each season's `ItemForm` one at
     a time ("Season 2 of 5"), **saving as you go** (resilient to bailing).
   - **Save:** fetch each selected season's draft (`/api/draft?…&season=n`), apply
     the shared fields, and write each via `saveItem` (which recomputes
     `completed_years`). Navigate to Backlog (or the first item) on success.

The N season drafts each carry their own per-season metadata (air date, length,
season poster) and the inherited show-level fields (title, creator, description,
community_rating).

---

## 8. Refresh metadata (edit)

On `app/pages/item/[id]/edit.vue`, a **"Refresh metadata"** button (owner-only):

- Calls `GET /api/draft` for that item's provider + id (+ season for shows).
- **Overwrites provider-sourced fields** on the working copy: title, creator,
  description, community_rating, cover, thumbnail, release_date, length,
  length_unit, and (shows) episode_count / episode_runtime / season_number.
- **Preserves user fields**: status, my_rating, completed_dates, completed_years,
  is_prioritized, is_purchased, recommended_by, notes, tags.
- Updates the form in place (does not auto-save) so you can review, then Save.
- Hidden when `provider === 'manual'` (nothing to refresh from).

No "sync to all seasons" — dropped (per-item ratings/data must not be propagated
across a movie/book/game series; shows are kept consistent at add-time + refresh).

---

## 9. Movie/game series (Phase 5 — last, optional)

Reuses `BatchAddPanel`. Only TMDB collections / IGDB franchises (books opt out).

- A movie/game `SearchResult` flagged `isSeries` shows an **"Add series"** action.
- `GET /api/series?type&id` → member `SearchResult[]` (TMDB `/collection/{id}` →
  `parts[]`; IGDB franchise/collection query).
- `SeriesPicker.vue` multi-select (mirrors `SeasonPicker`) → drafts → `BatchAddPanel`.
- Each member keeps **its own** community_rating and metadata (not shared).

If time-boxed, the milestone can ship Phases 0–4 and land Phase 5 as a fast-follow;
the `BatchAddPanel` seam makes it additive.

---

## 10. Error handling & proxy policy

- **Search/API failure:** the route returns a clear error; `AddSearch` shows a
  message and the **"Enter manually"** path always remains. Never block adding.
- **IGDB token failure:** surfaced as a game-search error; retry re-exchanges.
- **Proxy is left open** (not auth-gated). It only relays public metadata searches
  and is triggered from the owner-only `/add` page; worst case is trivial use of our
  free quota. Optional future hardening: send the Firebase ID token and verify it
  server-side. Documented, not built.
- **Write failures** reuse the existing `saveItem` error surfacing.

---

## 11. Testing

Pure, isolated units (the providers' mappers are the high-value targets):

- **Mappers** (`server/providers/*` → `SearchResult` / `Item`): given a recorded
  sample provider payload (fixture), assert the normalized output — id format,
  creator extraction, date parsing (IGDB unix→ISO), rating normalization
  (TMDB as-is, Books ×2, IGDB ÷10), cover-URL cleanup (https, strip `&edge=curl`),
  tags from genres (lowercased/deduped), and (shows) summed episode runtimes.
- **`AddSearch`** debounce + stale-response guard (fake timers; out-of-order
  responses ignored).
- **`BatchAddPanel`** assembles N items from drafts + shared fields, and the
  `complete → air-date` rule populates each `completed_dates`.
- **`ItemForm`** uses `initial.id` when present (provider draft) vs. mints a manual
  id when absent.
- Status-change tests (Phase 0): history shows `dnf` with a date; `dnf` carries the
  marker.

Server routes are thin dispatchers over the mappers; mapper unit tests + a couple of
route smoke tests (mocked `$fetch`) cover them. `npm run validate` must pass.

---

## 12. Build order

0. **Status enum change** (§2) — type, form, history marker, seeds, tests; commit.
1. `nuxt.config.ts` server `runtimeConfig` keys + `.env.example`; local `.env` values.
2. `shared/types/search.ts`; provider modules + mappers (TMDB, Google Books, IGDB
   incl. Twitch-token cache) with mapper unit tests.
3. Nitro routes: `server/api/search.get.ts`, `draft.get.ts`, `seasons.get.ts`.
4. `ItemForm` `initial.id` tweak; `AddSearch.vue` (radios + debounced search +
   results + manual entry); rewire `add.vue` to the state machine.
5. `SeasonPicker.vue` + `BatchAddPanel.vue`; show season flow.
6. "Refresh metadata" on the edit page.
7. Phase 5 (optional): `series.get.ts` + `SeriesPicker.vue`.
8. Tests throughout; `npm run validate`.

---

## 13. Open items (deferred, not blocking)

- Book series enumeration — no reliable live source; handled in the Goodreads-sync
  milestone (RSS carries series info).
- Proxy auth hardening via Firebase ID token (§10).
- Caching of search results to further reduce provider calls (YAGNI for one user).

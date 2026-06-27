# Logbook — Core Design

> A personal media tracker for books, shows, movies, and video games.
> Backlog (what's next) + History (what's done), as a Nuxt app over Firebase.

- **Date:** 2026-06-19 (created) · **Revised:** 2026-06-22 (architecture pivot)
- **Status:** Validated architecture (Nuxt + Firebase), pending implementation plan
- **Home:** `log.oscorp.net`
- **Replaces:** [book-list-vue](https://github.com/spaceninja/book-list-vue) (Firebase/Vue), plus paid Trakt + Letterboxd subscriptions

> **Revision note (2026-06-22):** The original design targeted a static **Eleventy**
> site with **JSON-files-in-git** as the store and **Netlify Functions + a GitHub App**
> for writes. After reviewing the real data volume (~4,250 items, see §11) and the
> friction of modelling a queryable collection as thousands of committed files +
> per-item static pages, the architecture moved to a **Nuxt app backed by Firebase
> (Auth + Firestore)**. Git-JSON survives — repurposed as a **daily backup**, not the
> primary store. This document reflects the new architecture throughout; prior
> revisions remain in git history.

---

## 1. Overview

Logbook tracks four media types — **books, movies, shows, games** — in a single
unified collection. Each tracked thing (a book, a movie, a _season_ of a show, a
game) is one **item**. Two views read over that collection:

- **Backlog** — things you intend to consume (not yet completed, or completed and
  flagged for a repeat).
- **History** — things you have completed at least once, grouped by year.

The site is a **Nuxt (Vue) application** hosted on **Netlify**, with item data
stored in **Firebase Firestore**. Reads are public; writes are gated by **Firebase
Auth (GitHub provider)** and enforced by **Firestore security rules**. There is no
custom data API and no committed-file store — writes go straight to Firestore and
are live instantly. A **daily backup** exports Firestore to NDJSON committed to git
for data ownership.

### Design priorities

1. **Low maintenance.** A fully managed backend (Firebase) means no servers to
   patch, no idle-pause, and a set-and-forget operational profile.
2. **Instant writes.** Edits are live immediately — no build/deploy delay.
3. **Low-effort entry.** Manual logging is the norm, but a search-assisted add flow
   autofills metadata so "manual" means "type a title, pick the match, save."
4. **Uniformity.** One schema and one view pipeline for all four media types.
5. **Data ownership (as a safety net).** Firestore is the live store; a daily
   git-committed NDJSON export gives an off-Firebase, version-controlled copy.

---

## 2. Architecture

```
Browser (Nuxt app)
  │  read:  Firestore client SDK (public)            ← public-read
  │  write: Firestore client SDK (after GitHub login) ← owner-only via rules
  │  search: POST to Nitro server route (key-hidden)  ← add flow
  ▼
Netlify
  ├── Nuxt app (SSR/hybrid via Nitro)
  │     └── server routes: search proxies (TMDB / IGDB / Google Books)
  ├── Scheduled Function: sync-goodreads (daily)   ← books only → Firestore
  └── Scheduled Function: backup (daily)           ← Firestore → NDJSON → git
        ▲                          │
        │                          ▼
   Firebase Auth (GitHub)     Firebase Firestore  ← items collection
                                   │
                                   ▼ (daily export)
                              Git repo (NDJSON backup)
```

- **Reads** use the Firestore client SDK directly from the browser. Public-read —
  anyone can browse; only the owner can write.
- **Writes** also use the client SDK; **Firestore security rules** restrict all
  mutations to the authenticated owner (§7). No custom write API.
- **Search** during the add flow goes through **Nuxt Nitro server routes** that
  proxy the third-party metadata APIs, keeping their keys server-side (§5).
- **Sync** (Goodreads) and **backup** are **Netlify scheduled functions** using the
  Firebase Admin SDK.

### Why Firebase + Nuxt (not static + git-JSON)

The data is a **queryable collection of ~4,250 items** (growing to ~10K over a
decade), read-heavy and single-writer. Modelling that as thousands of committed
JSON files plus a per-item static page works but fights the grain: awkward repo
folders, per-item page generation, and a write→rebuild delay. A managed
document database removes all of that — instant writes, real queries, dynamic
detail pages, and proper auth — while a daily git export preserves ownership.

Firebase specifically (over Supabase / PocketBase / a custom API): it is fully
managed and **never idle-pauses** (the reason a prior Supabase trial was
abandoned), the **Spark free tier** covers single-user usage at **$0**, and prior
experience confirms a genuine set-and-forget operational profile. The cost —
NoSQL query constraints and vendor lock-in — is mitigated by the coarse-query
model (§4) and the daily NDJSON backup (§8).

---

## 3. Data model

### 3.1 Unified item schema

Every item — regardless of type — shares one shape. Each item is one Firestore
document in the `items` collection; the document id is the item `id`.
Type-specific fields live in a nested `metadata` map.

```jsonc
{
  "id": "movie-tmdb-27205", // unique; also the Firestore document id
  "type": "movie", // book | movie | show | game
  "title": "Inception",
  "creator": "Christopher Nolan", // unified: author | director | created_by | developer
  "cover": "https://image.tmdb.org/t/p/w500/...jpg", // large image, detail view
  "thumbnail": "https://image.tmdb.org/t/p/w185/...jpg", // small image, list view
  "release_date": "2010-07-16", // ISO date; for shows, the season air date
  "description": "A thief who steals corporate secrets...", // official synopsis/blurb

  "length": 148, // numeric size of the work
  "length_unit": "min", // pages | min | episodes | hours

  "community_rating": 8.2, // optional; aggregate rating from the provider
  "my_rating": 9, // optional; the owner's rating
  "provider": "tmdb", // data origin: tmdb | igdb | goodreads | google-books | open-library | manual
  "recommended_by": "Chuck", // optional; person who recommended this item

  "status": "backlog", // backlog | in_progress | complete | dnf
  "is_purchased": false,
  "is_prioritized": true,
  "completed_dates": [], // array of ISO dates; one entry per completion
  "completed_years": [], // derived from completed_dates; for year queries (§4)
  "notes": "", // private notes (distinct from description)
  "tags": [],

  "metadata": {
    // type-specific (see §3.3)
  },
}
```

### 3.2 Status, completions, and the two views

The two views read **different** fields, so an item can appear in both without any
special-case status:

- **History membership** = `completed_dates.length > 0`
- **Backlog membership** = `status` is `backlog` or `in_progress`

`status` describes _current intent only_; `completed_dates` is the record of what
you've finished. Their combination expresses every state:

| `completed_dates` | `status`      | Backlog? | History? | Meaning                          |
| ----------------- | ------------- | :------: | :------: | -------------------------------- |
| `[]`              | `backlog`     |    ✅    |    —     | want to; never started           |
| `[]`              | `in_progress` |    ✅    |    —     | consuming for the first time     |
| `[]`              | `dnf`         |    —     |    —     | abandoned; no date recorded      |
| `[d1]`            | `complete`    |    —     |    ✅    | finished; no replay planned      |
| `[d1]`            | `dnf`         |    —     |    ✅    | gave up partway; logged the date |
| `[d1]`            | `backlog`     |    ✅    |    ✅    | finished; want to repeat         |
| `[d1]`            | `in_progress` |    ✅    |    ✅    | finished before; repeating now   |
| `[d1, d2]`        | `complete`    |    —     |    ✅    | finished twice; done             |

**Repeats:** marking an item complete appends today's date (or the source's date)
to `completed_dates` and sets `status` to `complete` (or `dnf` if abandoned).
Wanting a repeat sets `status` back to `backlog`/`in_progress`; the prior
completion dates remain. An item with multiple completion dates appears in History
under **each** relevant year.

**`completed_years` is derived, not authored.** Whenever `completed_dates`
changes, the write recomputes `completed_years` as the de-duplicated set of years
(e.g. `["2022-04-10", "2024-01-02"]` → `[2022, 2024]`). It exists solely so the
History view can query by year (§4) — Firestore cannot extract a year from a date
string in a query, so the year must be stored as a matchable value.

### 3.3 Type-specific `metadata`

`creator` (top-level) absorbs the former per-type author/director/developer, so
`metadata` now holds only genuinely type-specific fields:

| Type    | `metadata` fields                                                   | `length_unit` |
| ------- | ------------------------------------------------------------------- | ------------- |
| `book`  | `series`, `series_number`, `isbn`                                   | `pages`       |
| `movie` | `series`, `series_number`                                           | `min`         |
| `show`  | `show_tmdb_id`, `season_number`, `episode_count`, `episode_runtime` | `min`         |
| `game`  | `platform`, `series`, `series_number`                               | `hours`       |

Notes:

- **`creator`** maps per provider: Goodreads `author`, TMDB movie director (from
  credits), TMDB show `created_by`, IGDB developer (involved companies). String, or
  array when there are multiple.
- **`series`/`series_number`** apply to books, movies, and games (e.g. a film or
  game franchise); `itemSeries()` reads them generically for the series sort. A
  show is its own series — the show title is the series name and `season_number`
  the position — so it needs no explicit `series` field.
- **`show_tmdb_id`** is kept explicit (not derived from `id`) because grouping a
  show's seasons is a Firestore `where('metadata.show_tmdb_id','==',N)` query. The
  `show_` qualifier distinguishes the parent series id from a season's own TMDB id.
- **`isbn`** is kept because it is _not_ derivable: book ids use the Goodreads id
  (`book-goodreads-<id>`), not ISBN.

### 3.4 Shows are tracked per-season

A show item is **one season**, not the whole series. Seasons are linked by a shared
`show_tmdb_id` so views can group them under their show _for display_ while storage
stays flat and uniform.

- `id` format: `show-tmdb-<showId>-s<seasonNumber>` (e.g. `show-tmdb-95396-s1`)
- `title`: the **show name only** (e.g. `"Severance"`). The display string
  `"<title> — Season <season_number>"` is composed at render time. (There is no
  stored `show_title`.)
- `release_date`: the season's air date
- `length`: **summed episode runtime** (`length_unit: min`), so a season is
  length-comparable to movies; `metadata.episode_count` and
  `metadata.episode_runtime` (typical per-episode minutes) are stored alongside.
  TMDB season details expose per-episode runtimes (summable) and episode count;
  summing falls back gracefully when individual runtimes are missing.
- `community_rating`: the parent show's TMDB `vote_average` (TMDB has no reliable
  per-season aggregate; community-rating sorting is a books-centric need anyway, so
  this is an acceptable proxy)

### 3.5 Storage layout

- **Live store:** a single Firestore collection, `items`, one document per item,
  document id = item `id`. The unified schema means one collection serves all four
  types; `type` is a field, not a separate collection.
- **Why one collection (not per-type collections):** the unified schema and the
  two-view pipeline read across all types; a single collection keeps queries and
  security rules uniform. Type filtering is a `where('type','==',…)` clause.
- **Backup store:** see §8 — a daily NDJSON export, sharded `backup/<type>/<year>.ndjson`,
  committed to git.

---

## 4. Views & querying

Both views are Nuxt pages. The query strategy is **coarse Firestore query →
client-side fine filter/sort**: Firestore returns a bounded working set (a few
hundred docs), and the browser does the rich filtering and sorting over it. This
keeps reads low, indexes few, and preserves the snappy client-side filter/sort UX
of the current app.

### 4.1 Backlog

- **Coarse query:** `where('status','in',['backlog','in_progress'])`, optionally
  `+ where('type','==',…)`.
- **Client-side filters:** media type; purchased/unpurchased;
  prioritized/unprioritized; tagged/untagged; released/unreleased.
- **Client-side sorts:** title, `community_rating` (e.g. "most popular books in my
  backlog"), `length`, `release_date`.

### 4.2 History

- **Coarse query:** `where('completed_years','array-contains',<year>)`, optionally
  `+ where('type','==',…)`. Year-scoping bounds the working set (e.g. one year of
  movies is ~100–150 docs, not all ~1,750).
- **Grouping/filter:** by **completion year** (from `completed_years`). An item
  completed in multiple years appears under each.
- **Client-side filters:** media type; plus the shared filters above where relevant.
- **Client-side sorts:** `my_rating` (e.g. "top-rated movies last year"), completion
  date, title.

### 4.3 Detail pages

Each item has a dynamic Nuxt route, `/item/[id]`, fetching the single Firestore
document on demand. No pages are pre-generated. Movie/show detail pages
additionally fetch live streaming availability (§12).

### 4.4 Indexes

Composite indexes are defined for the coarse queries only, e.g.:

- `status` + `release_date` / `community_rating` / `length` (Backlog sorts that
  Firestore can serve before client refinement)
- `type` + `status`
- `completed_years` (array-contains) + `type`

Fine filtering/sorting beyond these runs client-side, so the index set stays small.

### 4.5 Target queries (validation)

| Question                            | View    | Coarse query                          | Client sort          |
| ----------------------------------- | ------- | ------------------------------------- | -------------------- |
| "What shows did I watch in 2024?"   | History | `type=show` + `completed_years∋2024`  | completion date      |
| "Top-rated movies last year?"       | History | `type=movie` + `completed_years∋2024` | `my_rating` ↓        |
| "Most popular books in my backlog?" | Backlog | `type=book` + `status∈{backlog,…}`    | `community_rating` ↓ |

---

## 5. Add / edit flow (search-assisted)

The core value-add: manual entry that autofills metadata from public APIs.

1. **Choose media type** — determines which API is queried.
2. **Search by title** — the browser POSTs to a **Nuxt Nitro server route** that
   proxies the relevant metadata API (keeping API keys server-side) and returns a
   ranked list of candidate matches, each showing cover, year, and a disambiguator
   (creator / platform).
3. **Shows are two-step:** pick the show → the app fetches its season list from
   TMDB (via the proxy) → a **multi-select of seasons** (each showing air date +
   episode count). Season 0 / Specials hidden by default, opt-in to include.
4. **Select a match** → metadata fields autofill → set custom fields
   (`is_purchased`, `is_prioritized`, `recommended_by`, `notes`, `tags`, `status`)
   → save. Saving **writes the document directly to Firestore** (instant; no
   rebuild).
5. **Manual fallback** — every field is editable by hand for items the APIs miss.
6. **Edit / delete** existing items operate on the Firestore document through the
   same form. Edit pre-fills from the in-memory document; delete removes the doc.

### Metadata sources (all proxied through Nitro server routes)

| Type    | Search API                                 | Notes                                                         |
| ------- | ------------------------------------------ | ------------------------------------------------------------- |
| `book`  | Google Books (existing key) / Open Library | Most books arrive via Goodreads sync; manual is the exception |
| `movie` | TMDB                                       | Free key                                                      |
| `show`  | TMDB (show search → season details)        | Free key; two-step                                            |
| `game`  | IGDB (Twitch OAuth)                        | Free non-commercial; requires server-side token               |

All searches route through the proxy (not browser-direct) for one consistent code
path and to keep every key server-side — IGDB _requires_ a server-side Twitch
OAuth token regardless.

Cover-URL cleanup carried over from the current app: rewrite `http→https` and strip
Google Books' `&edge=curl`. Both `cover` (large) and `thumbnail` (small) URLs are
captured at add-time; for single-image sources, `thumbnail` falls back to `cover`.

---

## 6. Goodreads sync (the only automated integration)

A **Netlify Scheduled Function** running **daily**, writing to Firestore via the
Firebase Admin SDK:

1. Fetch the `to-read` and `read` shelf RSS feeds
   (`/review/list_rss/<userId>?shelf=<name>`).
2. Dedup by Goodreads book ID → item `id` is `book-goodreads-<bookId>`.
3. Map feed → item:
   - On **`to-read`** → `status: backlog`. Set `community_rating` from the feed's
     `average_rating`. **Refresh `community_rating` on every run** while the book
     remains on the shelf (handles pre-release ratings "ripening" after release).
   - On **`read`** → append the feed's `user_read_at` to `completed_dates`,
     recompute `completed_years`, set `status: complete`, set `my_rating` from
     `user_rating`.
4. Write all changes for the run to Firestore (idempotent upserts by document id).

**Constraints:** the Goodreads profile must be public; each shelf feed is capped at
the first 100 items (fine for ongoing sync; full backfill is handled by the
one-time import — §10).

**Why books keep Goodreads:** it auto-integrates with Kindle, and its RSS
`average_rating` is the only book community-rating source with meaningful volume
(Open Library samples are statistically noise; Google Books rating fields are
empty).

---

## 7. Auth & hosting

- **Public-read:** the `items` collection is world-readable; no read auth.
- **Write auth:** **Firebase Auth with the GitHub provider** ("Log in with
  GitHub"). **Firestore security rules** enforce that all writes come from the
  authenticated owner:

  ```
  match /items/{id} {
    allow read: if true;
    allow write: if request.auth != null && request.auth.uid == "<owner-uid>";
  }
  ```

  This is the real gate; the Nuxt UI additionally shows/hides Add/Edit/Delete
  controls based on auth state, which is cosmetic only.

- **Hosting:** the Nuxt app deploys to **Netlify** (Nitro Netlify preset). Firebase
  is used only for **Auth + Firestore**, which stay on the **free Spark tier** — no
  Cloud Functions, so no Blaze plan required.
- **Server-side code** (search proxies) runs as Nitro server routes on Netlify;
  scheduled work (sync, backup) runs as Netlify scheduled functions.

### Cost

Effectively **$0**: Firebase Spark (Auth + Firestore) and Netlify free tiers cover
single-user usage. The only credential beyond Firebase config is one fine-grained
GitHub PAT used solely by the backup function (§8).

---

## 8. Backup (data ownership)

A **Netlify Scheduled Function** running **daily** exports Firestore to git:

1. Read all `items` documents via the Firebase Admin SDK.
2. Serialize to **NDJSON** (one item per line), **sharded** into
   `backup/<type>/<year>.ndjson` files, records **sorted by `id`**. Items appear in
   each year file matching their `completed_years` (plus a backlog/unfinished file
   for items with no completions).
3. Commit only changed shard files to the repo (via the GitHub API, using a
   repo-scoped fine-grained PAT with `contents: write`). Skip the run if nothing
   changed.

**Why NDJSON, sharded by type/year:** NDJSON gives one-line-per-item diffs (a
changed item touches one line) with **full fidelity** for arrays and nested
`metadata` — unlike CSV, which would force lossy flattening. Sharding by type/year
scopes each day's diff to the shards that actually changed, keeping commits and
history small. An item completed in multiple years appears in each matching year
shard (mirroring the History view); a restore dedupes by `id`. This is an
off-Firebase, version-controlled safety net, not the live store.

**Backup commits must not trigger a site rebuild.** The Goodreads sync writes only
to Firestore, so it never causes a deploy — but the backup commits to the repo,
which Netlify watches. Two mechanisms prevent wasted builds:

1. The backup function appends **`[skip ci]`** to its commit message; Netlify
   honors this (and `[skip netlify]`) and skips the deploy. This is the primary
   mechanism and is fully under the function's control.
2. A safety-net **`ignore` build command** in `netlify.toml` skips a build when
   nothing outside `backup/` changed:
   ```toml
   [build]
   ignore = "git diff --quiet HEAD^ HEAD -- ':(exclude)backup/'"
   ```
   (exit 0 = skip), covering any stray manual commit under `backup/` as well.

**Open: backup destination (do not bundle backups with the app).** Committing
backups into the app repo made sense when the repo _was_ the data store. But the
app now ships **without data** and could be forked or self-hosted by others against
their own Firebase project — bundling the owner's personal backups into a clone
would be odd. The backup should therefore live **outside the app repo** (a separate
private git repo, Dropbox, Google Drive, or similar); the exact destination is
deferred to the implementation plan (§14). Note: if the backup moves out of the app
repo entirely, the build-skip mechanism above becomes unnecessary — there are no
in-repo commits left to ignore.

---

## 9. Error handling

- **Search/API failure (add flow):** the proxy surfaces a clear message; fall back
  to fully manual entry. Never block adding an item because a lookup failed.
- **Write failure (Firestore):** the client surfaces an error; the SDK's local
  cache and retry behavior handle transient issues. No optimistic-UI rollback is
  needed because writes are direct and confirmed.
- **Sync failure:** log and retry on the next scheduled run; only write on a
  successful fetch+parse so partial/garbage state is never committed.
- **Backup failure:** log and retry next run; a missed day is harmless because the
  next successful run re-exports current state.

---

## 10. Out of scope (separate efforts)

- **Bulk one-time import** — its own design doc. Local one-shot scripts that write
  items **directly to Firestore**, sourcing from: Goodreads CSV (books),
  Letterboxd export (movies), Trakt export (shows), Infinite Backlog (games).
  Shared challenge: metadata-matching by title+year to TMDB/IGDB. Notable wrinkles:
  Trakt tracks _episodes_, so its history must be rolled up into season
  completions; the movie source should be **Letterboxd only** (Trakt also has
  movies — avoid duplicates); games must filter the collection export to the
  _completed_ subset for History.
- **Achievement / streaming auto-sync** (Steam, PSN, Xbox, Younify, Plex) —
  intentionally dropped; these are logged manually. Possible future enhancement.
- **Private (auth-gated) reads** — not needed; the site is public-read.

---

## 11. Data volume (validation)

Counts from existing exports (2026-06-22), in _logbook items_ (a book, a movie, a
show-**season**, or a game):

| Type    | Source           | History (completed) | Backlog       | ~Total     |
| ------- | ---------------- | ------------------- | ------------- | ---------- |
| Books   | Goodreads        | 488 `read`          | 251           | 739        |
| Movies  | Letterboxd       | 1,755 watched       | 161 watchlist | ~1,900     |
| Shows   | Trakt            | 770 seasons         | + watchlist   | ~770+      |
| Games   | Infinite Backlog | subset of 770       | 49 wishlist   | ~820       |
| **All** |                  | **~3,800**          |               | **~4,250** |

Movies dominate; History is the heavy view (~3,800). Growth is at human pace
(~hundreds/year), so the 10-year ceiling is ~10K items — comfortably within
Firestore and the coarse-query model.

---

## 12. Future feature: streaming availability (movies & shows)

Replicate the "what services is this on?" feature from Trakt/Letterboxd. Both get
this from **JustWatch** — and so can we, via **TMDB**, with no new integration.

- **Source:** TMDB's Watch Providers endpoints, which re-serve JustWatch data:
  - `/movie/{id}/watch/providers`, `/tv/{id}/watch/providers`
  - Response is grouped by country, then by type: `flatrate` (subscription
    streaming — the primary list we want), plus `rent` and `buy`. Each provider
    gives name, logo, and id.
- **JustWatch has no open API** (partner-only B2B); TMDB is the practical path, and
  almost certainly how Trakt/Letterboxd source it too.

**Constraints (all acceptable, none change the architecture):**

1. **No deep links.** TMDB returns provider names/logos + a single TMDB `/watch`
   landing-page link, not a direct "play on Netflix" URL.
2. **Attribution required** — must credit JustWatch as the source.
3. **Volatile + per-title.** Availability changes constantly and refreshes ~daily.

**Design implication — this is live/volatile data, so it is NOT stored in
Firestore.** Instead it is **fetched on demand** when a movie/show detail page is
opened — a call to the TMDB watch-providers endpoint (via the Nitro search proxy to
keep the key tidy), rendered fresh each time. **Scope:** movies & shows only;
**display-only** — does not touch the schema, the Goodreads sync, the write path, or
the backup.

---

## 13. Testing

- **Unit tests (pure transforms):** RSS item → item document; API search result →
  item document; `id` generation per type; the season/episode helpers (runtime
  summing, season display string); `completed_years` derivation; the
  filter/sort logic.
- **Integration tests:** the Goodreads sync against mocked RSS payloads (including
  the pre-release rating-refresh and the to-read → read transition), writing to a
  Firestore emulator; the backup function against a Firestore emulator (NDJSON
  shape, sharding, change-only commits).
- Follow the testing conventions established in the project.

---

## 14. Decisions deferred to the implementation plan

- Nuxt rendering strategy per route (SSR vs hybrid vs client-only) and the
  Firestore client vs Admin SDK boundaries.
- Exact composite index definitions and the client-side filter/sort module shape.
- The backup function's multi-file commit mechanism (GitHub Contents API per file
  vs Git Data API tree commit).
- The backup **destination** — a separate private git repo, Dropbox, Google Drive,
  or similar — chosen so it lives **outside the app repo** (forks/self-hosters must
  not inherit the owner's data).
- Firebase Auth session handling in Nuxt (module choice, owner-uid configuration).

---

## 15. Open threads & backlog

Running list of work not yet done, so nothing gets lost. Status as of 2026-06-27
(after the read-only, auth, search-assisted-add, and client-side filter/sort
milestones shipped).

### Remaining feature milestones (already designed above)

- **Goodreads sync** (§6) — daily scheduled import of the `read` / `to-read`
  shelves; the primary way books get added (manual book add is the fallback). Book
  **series** handling is folded in here (the RSS feed carries series info), since
  the manual add flow has no reliable live series source.
- **NDJSON backup** (§8) — daily Firestore→git export for data ownership; backup
  **destination** still to be chosen (§14).
- **Streaming availability** (§12) — "what's it on?" on movie/show detail pages via
  TMDB watch providers; display-only, on-demand, not stored.

### New: bulk import from other services' export files

- **Import from export files** — a UI button that ingests export files from other
  services and bulk-creates items. Have example exports on hand from **Goodreads**,
  **Trakt**, **Letterboxd**, and **Infinite Backlog**. Each service has its own
  format (CSV/JSON) and field mapping to the unified item schema, and items need
  de-duplication against what's already in Firestore. Details (parsing, mapping,
  conflict handling, dedupe keys) to be worked out when this is tackled.

### Known gaps & polish (surfaced during implementation)

- **SSR / hybrid reads (larger block of work, not polish)** (§14) — reads are
  currently client-only, which causes an accepted brief "Loading…" flash on
  Backlog/History/Detail. Removing it is **not** a quick fix: it depends on the
  still-undecided Firestore client-vs-Admin-SDK boundary (§14) and would mean
  standing up a server-side data path (Firebase Admin SDK, a Netlify
  service-account credential), reworking the owner/auth boundary, and reintroducing
  hydration the current `<ClientOnly>` wrapping avoids. The flash was explicitly
  accepted (2026-06-23). Tackle as its own milestone, gated on the §14 decision —
  do not "fix" it piecemeal.
- **Make the repo fork-friendly (de-hardwire the owner's Firebase)** — strip
  setup-specific values so a fork needs only its own env/config, not edits to
  tracked files. Offenders:
  - `firestore.rules` / `firestore.dev.rules` carry the owner UID literally. The
    hard part: rules can't read env, so this needs a templated rules file with a
    deploy-time substitution (e.g. an `${OWNER_UID}` placeholder filled by the
    deploy script) or, at minimum, a documented manual edit.
  - `.firebaserc` hardcodes the project ids (`spaceninja-logbook-dev`/`-prod`) —
    move to a gitignored real file plus a committed `.firebaserc.example`.
  - The dev/prod split (two rules files, `firebase.json` + `firebase.dev.json`)
    encodes the owner's two-project layout; reconsider whether a fork should
    inherit it or start single-project.
  - `.nuxtrc` is an auto-generated `@nuxt/test-utils` marker (not owner-specific);
    evaluate gitignoring it.
  - Already generic, leave alone: `.env.test` (dummy values), `.env.example`,
    `nuxt.config.ts` (owner UID + Firebase config all sourced from env).
- **Surface read failures instead of an endless "Loading…"** — the Backlog/
  History/Detail reads use `useAsyncData(..., { server: false })` over
  `getDocs`, which has no timeout. When the Firestore connection stalls (the
  forced long-polling is flaky under Safari/content blockers — see the
  client-rendering notes), the promise never rejects, so `pending` stays `true`
  forever and the existing `v-else-if="error"` branch never shows. The pages
  already render "Failed to load …" on `error`; the gap is making a stall
  _become_ an error. Add a timeout wrapper around the reads (a hang → reject) and
  at minimum `console.error` the failure, so a slow/broken connection shows a
  real error rather than a silent spinner.
- **Stale-while-revalidate caching for snappy switching** — every content-type/
  year switch refetches from Firestore (`useAsyncData` keyed `backlog`/`history`
  re-runs on its `watch`), so rapid clicking pays a fresh round-trip each time
  and re-triggers the "Loading…" state. Cache results client-side keyed by the
  query (type, and year for History) and show the cached list immediately while
  revalidating in the background. **Cache duration is TBD — discuss** (a short
  TTL vs. revalidate-every-time-but-show-stale). Options to weigh: a simple
  in-memory keyed cache in `useItems`, Firestore's own persistent/IndexedDB
  cache, or a Nuxt payload-cache approach. Pairs naturally with the timeout work
  above (cached data softens a slow revalidate).

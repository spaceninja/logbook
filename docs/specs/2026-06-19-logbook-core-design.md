# Logbook — Core Design

> A personal media tracker for books, shows, movies, and video games.
> Backlog (what's next) + History (what's done), as a git-backed static site.

- **Date:** 2026-06-19
- **Status:** Validated design, pending implementation plan
- **Home:** `log.oscorp.net`
- **Replaces:** [book-list-vue](https://github.com/spaceninja/book-list-vue) (Firebase/Vue), plus paid Trakt + Letterboxd subscriptions

---

## 1. Overview

Logbook tracks four media types — **books, movies, shows, games** — in a single
unified collection. Each tracked thing (a book, a movie, a *season* of a show, a
game) is one **item**. Two views read over that collection:

- **Backlog** — things you intend to consume (not yet completed, or completed and
  flagged for a repeat).
- **History** — things you have completed at least once, grouped by year.

The site is a **static Eleventy build** hosted on **Netlify**, with item data
stored as **JSON files committed to git**. Writes (manual adds/edits and the
Goodreads sync) happen through small **Netlify Functions** that commit JSON files
via the GitHub API; each commit triggers a rebuild. There is no JavaScript
framework and no database.

### Design priorities

1. **Simplicity over real-time.** A ~1-minute write→deploy delay is acceptable.
2. **Data ownership.** Plain JSON in git; full version history for free.
3. **Low-effort entry.** Manual logging is the norm, but a search-assisted add
   flow autofills metadata so "manual" means "type a title, pick the match, save."
4. **Uniformity.** One schema and one view pipeline for all four media types.

---

## 2. Architecture

```
Browser (static HTML + light JS)
  │  read: pre-rendered pages from CDN
  │  write: POST to function (after GitHub login)
  ▼
Netlify
  ├── Static site (Eleventy build output)         ← public-read
  ├── Function: write-item    (auth + commit)     ← manual add/edit/delete
  └── Scheduled Function: sync-goodreads (daily)  ← books only
        │
        ▼ GitHub Contents API (PAT, contents:write)
   Git repo (per-item JSON files)
        │
        ▼ push triggers
   Netlify rebuild → new static pages live (~1 min)
```

- **Reads** are free and instant: Eleventy bakes item JSON into static pages
  served from Netlify's CDN. Public-read — anyone can browse; only the owner edits.
- **Writes** go through a Netlify Function gated by GitHub login (see §7). The
  function commits the relevant JSON file(s) using a GitHub Personal Access Token.
- **Sync** is a single scheduled function (Goodreads only); everything else is
  entered manually through the add flow.

### Why JSON-in-git (not a database)

Single-user, low write frequency, and a strong preference for data ownership make
git-backed JSON the right fit. It gives free version history, trivial backups, and
fits the scheduled-sync model (a sync is just a commit). The only cost is that
writes aren't instant — mitigated with optimistic UI.

---

## 3. Data model

### 3.1 Unified item schema

Every item — regardless of type — shares one shape. Type-specific fields live in a
nested `metadata` object.

```jsonc
{
  "id": "movie-tmdb-27205",        // unique; also the filename (without .json)
  "type": "movie",                 // book | movie | show | game
  "title": "Inception",
  "cover": "https://image.tmdb.org/t/p/w500/...jpg",  // remote URL only
  "release_date": "2010-07-16",    // ISO date; for shows, the season air date

  "length": 148,                   // numeric size of the work
  "length_unit": "min",            // pages | min | episodes | hours

  "community_rating": 8.2,         // optional; aggregate rating from the source
  "my_rating": 9,                  // optional; the owner's rating
  "source": "tmdb",                // tmdb | igdb | goodreads | google-books | open-library | manual

  "status": "backlog",            // backlog | in_progress | inactive
  "is_purchased": false,
  "is_prioritized": true,
  "completed_dates": [],           // array of ISO dates; one entry per completion
  "notes": "",
  "tags": [],

  "metadata": {                    // type-specific (see §3.3)
    "director": "Christopher Nolan"
  }
}
```

### 3.2 Status, completions, and the two views

The two views read **different** fields, so an item can appear in both without any
special-case status:

- **History membership** = `completed_dates.length > 0`
- **Backlog membership** = `status` is `backlog` or `in_progress`

`status` describes *current intent only*; `completed_dates` is the record of what
you've finished. Their combination expresses every state:

| `completed_dates` | `status`      | Backlog? | History? | Meaning                         |
| ----------------- | ------------- | :------: | :------: | ------------------------------- |
| `[]`              | `backlog`     |    ✅    |    —     | want to; never started          |
| `[]`              | `in_progress` |    ✅    |    —     | consuming for the first time    |
| `[]`              | `inactive`    |    —     |    —     | abandoned / DNF ("Dropped")     |
| `[d1]`            | `inactive`    |    —     |    ✅    | finished; no replay planned     |
| `[d1]`            | `backlog`     |    ✅    |    ✅    | finished; want to repeat        |
| `[d1]`            | `in_progress` |    ✅    |    ✅    | finished before; repeating now  |
| `[d1, d2]`        | `inactive`    |    —     |    ✅    | finished twice; done            |

**Repeats:** marking an item complete appends today's date (or the source's date)
to `completed_dates` and sets `status` to `inactive`. Wanting a repeat sets
`status` back to `backlog`/`in_progress`; the prior completion dates remain. An
item with multiple completion dates appears in History under **each** relevant
year.

### 3.3 Type-specific `metadata`

| Type    | `metadata` fields                          | `length_unit` |
| ------- | ------------------------------------------ | ------------- |
| `book`  | `author`, `series`, `isbn`                 | `pages`       |
| `movie` | `director`                                 | `min`         |
| `show`  | `show_title`, `show_tmdb_id`, `season_number` | `episodes` |
| `game`  | `platform`, `developer`                    | `hours`       |

### 3.4 Shows are tracked per-season

A show item is **one season**, not the whole series. Seasons are linked by a
shared `show_tmdb_id` so views can group them under their show *for display* while
storage stays flat and uniform (see §3.5 for why we don't nest).

- `id` format: `show-tmdb-<showId>-s<seasonNumber>` (e.g. `show-tmdb-95396-s1`)
- `title`: composed as `"<show_title> — Season <n>"`
- `release_date`: the season's air date
- `length`: episode count; `length_unit`: `episodes`
- `community_rating`: the parent show's TMDB `vote_average` (TMDB has no reliable
  per-season aggregate; community-rating sorting is a books-centric need anyway,
  so this is an acceptable proxy)

### 3.5 File layout

One file per item, grouped into per-type directories, surfaced to Eleventy as
collections (`collections.book`, `collections.movie`, etc.):

```
src/content/items/
  book/   book-goodreads-12345.json
  movie/  movie-tmdb-27205.json
  show/   show-tmdb-95396-s1.json
  game/   game-igdb-1234.json
```

**Why one file per item (not one big file, not per-show nesting):** the file is
git's unit of change, and we have two concurrent writers (manual edits + the
Goodreads sync). File-per-item makes every write touch one tiny file — O(1),
conflict-free, with clean, meaningful diffs. A single large file would force
whole-file rewrites and conflicting commits. Nesting seasons inside a per-show
file would break the unified schema (shows would need special-case flattening in
every view) and reintroduce whole-file array mutations on every "season complete."

**Covers are remote URLs, never committed binaries** — keeps the repo tiny
(thousands of ~1KB JSON files is a few MB and a sub-second-to-few-second build).

---

## 4. Views

Both views are static pages generated from the item collection, with client-side
filtering and sorting over the rendered set (carried over from the current app's
proven approach).

### 4.1 Backlog

- **Contents:** items where `status` ∈ {`backlog`, `in_progress`}.
- **Filters:** media type; purchased/unpurchased; prioritized/unprioritized;
  tagged/untagged; released/unreleased.
- **Sorts:** title, `community_rating` (e.g. "most popular books in my backlog"),
  `length`, `release_date`.

### 4.2 History

- **Contents:** items where `completed_dates` is non-empty.
- **Grouping/filter:** by **completion year** (derived from `completed_dates`). An
  item completed in multiple years appears under each.
- **Filters:** media type; plus the shared filters above where relevant.
- **Sorts:** `my_rating` (e.g. "top-rated movies last year"), completion date, title.
- **Scale:** History grows largest. Group/paginate by year to keep any single
  rendered page light (year-grouping doubles as a primary feature, not just a perf
  measure).

### 4.3 Target queries (validation)

| Question                                | View    | Filter                          | Sort               |
| --------------------------------------- | ------- | ------------------------------- | ------------------ |
| "What shows did I watch in 2024?"       | History | `type=show` + 2024 completion   | completion date    |
| "Top-rated movies last year?"           | History | `type=movie` + 2024 completion  | `my_rating` ↓      |
| "Most popular books in my backlog?"     | Backlog | `type=book`                     | `community_rating` ↓ |

---

## 5. Add / edit flow (search-assisted)

The core value-add: manual entry that autofills metadata from public APIs.

1. **Choose media type** — determines which API is queried.
2. **Search by title** — returns a ranked list of candidate matches, each showing
   cover, year, and a disambiguator (author / director / platform).
3. **Shows are two-step:** pick the show → the app fetches its season list from
   TMDB → a **multi-select of seasons** (each showing air date + episode count).
   Season 0 / Specials hidden by default, opt-in to include.
4. **Select a match** → metadata fields autofill → set custom fields
   (`is_purchased`, `is_prioritized`, `notes`, `tags`, `status`) → save.
5. **Manual fallback** — every field is editable by hand for items the APIs miss.
6. **Edit / delete** existing items through the same form and write path.

### Metadata sources

| Type    | Search API                                  | Notes                                            |
| ------- | ------------------------------------------- | ------------------------------------------------ |
| `book`  | Google Books (existing key) / Open Library  | Most books arrive via Goodreads sync; manual is the exception |
| `movie` | TMDB                                         | Free key                                         |
| `show`  | TMDB (show search → season details)         | Free key; two-step                               |
| `game`  | IGDB (Twitch OAuth)                          | Free non-commercial                              |

Cover-URL cleanup carried over from the current app: rewrite `http→https` and strip
Google Books' `&edge=curl`.

---

## 6. Goodreads sync (the only automated integration)

A **Netlify Scheduled Function** running **daily**:

1. Fetch the `to-read` and `read` shelf RSS feeds
   (`/review/list_rss/<userId>?shelf=<name>`).
2. Dedup by Goodreads book ID → item `id` is `book-goodreads-<bookId>`.
3. Map feed → item:
   - On **`to-read`** → `status: backlog`. Set `community_rating` from the feed's
     `average_rating`. **Refresh `community_rating` on every run** while the book
     remains on the shelf (handles pre-release ratings "ripening" after release).
   - On **`read`** → append the feed's `user_read_at` to `completed_dates`, set
     `status: inactive`, set `my_rating` from `user_rating`.
4. Commit all changes for the run as a **single commit** (one build/day).

**Constraints:** the Goodreads profile must be public; each shelf feed is capped at
the first 100 items (fine for ongoing sync; full backfill is handled by the
one-time import — §9).

**Why books keep Goodreads:** it auto-integrates with Kindle, and its RSS
`average_rating` is the only book community-rating source with meaningful volume
(Open Library samples are statistically noise; Google Books rating fields are
empty).

---

## 7. Write path, auth, and hosting

- **Public-read:** static pages are world-readable; no read auth.
- **Write auth:** the `write-item` function is gated by **"Log in with GitHub"**,
  verifying the authenticated user is the owner (GitHub username match). No
  passwords; the editing identity is the same one that owns the repo. (Netlify
  Identity is deprecated; Auth0/Clerk are overkill for one user.)
- **Commit mechanism:** a **fine-grained GitHub PAT**, scoped to this one repo
  with `contents: write`, stored as a Netlify environment variable. The function
  uses the **GitHub Contents API** to create/update/delete per-item JSON files.
- **Deploy:** the push triggers a Netlify rebuild; new static pages are live in
  ~1 minute. The browser uses **optimistic UI** so edits appear instantly locally.

### Netlify usage

Comfortably within free-tier limits: a daily cron is ~30 invocations/month
(limit 125k). Build minutes (~300/month) are the only metric worth watching;
the sync coalesces each day's changes into one build, so manual edits are the
larger consumer and are owner-controlled.

---

## 8. Error handling

- **Search/API failure (add flow):** surface a clear message; fall back to fully
  manual entry. Never block adding an item because a lookup failed.
- **Write/commit failure:** the function returns an error; the UI shows an alert
  and rolls back the optimistic update.
- **GitHub Contents API conflict** (rare `409`/sha mismatch): re-fetch the file's
  current sha and retry the commit once.
- **Sync failure:** log and retry on the next scheduled run; only commit on a
  successful fetch+parse so partial/garbage state is never written.

---

## 9. Out of scope (separate efforts)

- **Bulk one-time import** — its own design doc. Local one-shot scripts that
  generate JSON files and commit them, sourcing from: Firebase (books),
  Letterboxd export (movies), Trakt (shows), Infinite Backlog (games). Shared
  challenge: metadata-matching by title+year to TMDB/IGDB. Notable wrinkle: Trakt
  tracks *episodes*, so its history must be rolled up into season completions.
  Infinite Backlog's export availability to be verified during that pass.
- **Achievement / streaming auto-sync** (Steam, PSN, Xbox, Younify, Plex) —
  intentionally dropped; these are logged manually. Possible future enhancement.
- **Private (auth-gated) reads** — not needed; the site is public-read.

---

## 10. Testing

- **Unit tests (pure transforms):** RSS item → item JSON; API search result →
  item JSON; `id` generation per type; the season/episode helpers; the
  filter/sort logic; the History year-grouping derivation.
- **Integration tests:** `write-item` function against a mocked GitHub Contents
  API; `sync-goodreads` against mocked RSS payloads (including the pre-release
  rating-refresh and the to-read → read transition).
- Follow the testing conventions already established in the current project.

---

## 11. Decisions deferred to the implementation plan

- Exact Eleventy collection wiring (per-type directory → named collection).
- The History pagination/virtualization threshold and exact year-grouping UI.
- GitHub-login function specifics (OAuth exchange vs. a thin provider).

---

## 12. Open feedback on the metadata model (2026-06-19)

Scott's immediate reactions to §3 — to be worked out before implementation, not yet decided:

1. **Drop `show_title` from `metadata`.** The show name is the item's main `title`.
   *Reconcile:* §3.4 currently composes `title` as `"<show_title> — Season <n>"`. If
   `title` is just the show name, the season must come from `season_number` alone (and
   the display string is composed at render time). Decide whether `title` includes the
   season or not, then drop `show_title` accordingly.

2. **`show_tmdb_id` and `isbn` may be redundant with `id`.** The TMDB show id is already
   embedded in the item `id` (`show-tmdb-<showId>-s<n>`); likewise the book source id.
   Decide whether to derive these from `id` instead of storing them separately — and
   note book items are currently keyed on the Goodreads id (`book-goodreads-<id>`), not
   ISBN, so if ISBN matters it stays a real field.

3. **Pair `series` with `series_number`** for books, mirroring `season_number` for shows.

4. **Consider a unified `creator` field** replacing per-type `author` / `director`.
   *To verify:* TMDB exposes `created_by` for shows and director via credits for movies;
   IGDB exposes developer via involved companies. A single `creator` looks feasible —
   confirm the mapping per source before adopting.

5. **Show season length = total runtime, not episode count.** Prefer `length` =
   summed runtime (`length_unit: min`) for seasons; optionally also keep
   `episode_count` as a `metadata` field. *To verify:* TMDB season details include
   per-episode runtimes (summable) and episode count.

---

## 13. Future feature: streaming availability (movies & shows)

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
   landing-page link, not a direct "play on Netflix" URL (that's JustWatch's
   paid-partner revenue model). Same limit Letterboxd/Trakt have.
2. **Attribution required** — must credit JustWatch as the source.
3. **Volatile + per-title.** Availability changes constantly and refreshes ~daily
   (can lag the site by hours).

**Design implication — this is the first live/volatile field, so it must NOT be
baked into the committed item JSON** (it would go stale). Instead, **fetch it
client-side on demand** when a movie/show detail view is opened — a small JS call
to TMDB (optionally proxied through a thin Netlify function to keep the API key
tidy), rendered fresh each time. Keeps git data clean and availability current.

**Scope:** movies & shows only (no JustWatch data for books/games); **display-only**
— does not touch the schema, the Goodreads sync, or the write path.
```

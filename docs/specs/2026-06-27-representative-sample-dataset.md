# Representative sample dataset (generated from real providers)

Status: draft for review. Date: 2026-06-27.

## 1. Goal

Replace the two existing seed datasets (`shared/seeds/edge.ts`, 17-item test
fixture; `shared/seeds/sample.ts`, ~60 tidy items) with **one** dataset that
models a typical mainstream sci-fi / action fan who has used the app for a while.
It must populate the Backlog and History views densely enough to be genuinely
useful for eyeballing, exercise every item state, and — critically — carry
**real provider metadata and cover images**, identical to what a user gets when
they add an item through the search-assisted flow.

The current `sample.ts` uses `placehold.co` placeholder covers and hand-written
descriptions. That was an accepted stopgap; this effort supersedes it.

## 2. Approach: generate from the real provider endpoints

"Real metadata matching what a user would get" rules out hand-authoring (provider
cover URLs are opaque CDN paths; descriptions, ratings, runtimes, episode counts
are all provider-supplied). The app already has the exact code path for this:

- `GET /api/search?type=&q=` — title → ranked provider hits (each with a
  `providerId`).
- `GET /api/draft?type=&id=[&season=]` — provider id → a fully-populated `Item`
  with real `cover`/`thumbnail`/`backdrop`, `release_date`, `description`,
  `community_rating`, `creator`, and type-specific metadata (book series, show
  `episode_count`/`episode_runtime`, etc.).

So we **generate** the dataset with a one-off script that drives these endpoints,
overlays the user-state layer, and emits a static, committed `sample.ts`. The
script stays in the repo so the dataset can be regenerated (schema changes,
refreshed metadata).

Verified during design (2026-06-27): Google Books and IGDB drafts return real
data reliably; TMDB (movies + shows) is currently intermittently 5xx-ing — see
§7 (resilience).

## 3. Generator architecture

New: `scripts/generate-sample.ts`, run against a local `npm run dev` server
(so it reuses the app's real mapping logic verbatim) via `tsx`
(added as a devDependency) and an npm script `generate:sample`.

### 3.1 Inputs — the manifest

A curated list (`scripts/sample-manifest.ts`) of entries, one per intended item:

```ts
interface ManifestEntry {
  type: MediaType;
  providerId?: string; // preferred: exact item
  query?: string;      // fallback: generator resolves via /api/search, logs the pick
  season?: number;     // shows only
  // user-state overlay hints (optional; most are derived — see §4):
  status?: ItemStatus;       // override the derived status
  recommended_by?: string;
  notes?: string;
  series?: string;           // for franchises where the provider lacks it
  series_number?: number;
}
```

Franchise items pin `providerId` for exactness; padding/singletons may use
`query` and are reviewed from the generator's match log.

### 3.2 Per-entry flow

1. Resolve `providerId` (use it directly, or `/api/search` + take the logged
   best match).
2. Fetch the draft via `/api/draft`.
3. Apply the deterministic user-state overlay (§4).
4. Apply manifest overrides (`series`, `recommended_by`, `notes`, `status`).

### 3.3 Determinism & resumability

- The overlay uses a **seeded PRNG keyed by the item `id`**, so re-running the
  generator produces identical values for unchanged entries (staged runs don't
  churn unrelated items).
- Successful drafts are cached to a local gitignored JSON
  (`scripts/.sample-cache.json`). A re-run reads the cache and only re-fetches
  missing entries — essential given TMDB flakiness (§7).

### 3.4 Output

Writes `shared/seeds/sample.ts` as a typed `Item[]` with a header comment, then
the build runs Prettier over it. No runtime logic in the output file — it is
plain data.

## 4. User-state overlay (the "lived-in" layer)

Applied on top of each real draft. All randomness is seeded and frozen into the
committed file.

### 4.1 Status & completion dates (hybrid model)

Let `ry` = release year from the draft's `release_date`; today is `2026-06-27`.

- `ry >= 2026` or unreleased → **backlog** (no `completed_dates`).
- `ry` in {2024, 2025} → **complete**, `completed_dates = [random date in ry]`
  (on/after release date; 2026 dates capped at today).
- `ry <= 2023` (catalog) → "consumed recently": **complete**, completion year
  picked randomly from {2024, 2025, 2026}, date random within it (2026 capped at
  today). This is what fills the three dense recent history years.
- A small minority (~2–3 per type) of catalog items instead keep a completion
  date in their **original** release year, giving each type a longer, divergent
  year tail so the per-type year switcher shows variety, not a uniform
  2024–2026 for everyone.

### 4.2 Ratings

- Completed items: `my_rating` random in {8, 9, 10} (your "4–5 stars" on the
  0–10 scale the form uses). `community_rating` comes from the provider.
- DNF items: no `my_rating`.

### 4.3 Special states

- **DNF** (4 total, one per type, off-genre): `status: 'dnf'` with a "stopped"
  date so it surfaces in History with the `[DNF]` marker. Seeds: *Sex and the
  City* (show), *Stardew Valley* (game), plus a book and a movie (e.g.
  *Eat, Pray, Love*; *The Notebook*).
- **in_progress** (~4–8): `status: 'in_progress'`, no completion date — appears
  in Backlog (e.g. currently reading the latest Expanse, mid-season on a show,
  playing Halo Infinite).
- **Repeats** (~4): completed in the past **and** flagged `backlog`/`in_progress`
  for a re-read/re-watch → appears in **both** Backlog and History (exercises the
  §3.2 repeat capability nothing currently demonstrates).

### 4.4 Backlog flavor

For backlog items: `is_purchased` / `is_prioritized` randomly set (some both,
most neither); a scatter of `recommended_by` (small name pool) and `notes`.

### 4.5 Series metadata (series-sort coverage)

Set `metadata.series` + `metadata.series_number` on franchise **books, movies,
and games** (e.g. The Expanse #1–9, the Halo and GTA mainlines, LOTR, Fast &
Furious, Dune, Mass Effect). Shows are already series-sortable via title +
`season_number`. `itemSeries()` already reads `series`/`series_number`
generically for non-show types, so this works today — but core design §3.3
documents `series` for books only, so that line is reconciled (§6).

## 5. Composition targets

Modeling a fan with a deep, mostly-recent log. Franchises listed by the user are
a starting point; the generator supplements with other mainstream titles and a
deliberate mix of **singletons and franchises** in every type.

| Bucket            | Target                                            |
| ----------------- | ------------------------------------------------- |
| Backlog           | ≥10 per type (~40)                                |
| History           | ~10 per type per year across 2024–2026 (~80–120)  |
| DNF               | 4 (one per type)                                  |
| in_progress       | ~4–8                                              |
| Repeats           | ~4                                                |
| **Total**         | **~140–170**                                      |

Source pools (franchise + supplements + singletons), per type:

- **Books:** The Expanse, The Culture, LOTR; + Dune, Foundation, Hyperion,
  Bobiverse, Project Hail Mary (singleton), etc.
- **Movies:** LOTR/Hobbit, Fast & Furious, Marvel tentpoles; + Dune films,
  Blade Runner 2049 (singleton), Edge of Tomorrow (singleton), etc.
- **Shows (per season):** Doctor Who, Star Trek (TNG + modern), The Expanse,
  Rings of Power, Marvel TV; + Stranger Things, The Mandalorian, Foundation,
  Severance (singleton-ish), etc.
- **Games:** Halo (mainline), GTA; + Mass Effect, Doom, Gears of War, Horizon,
  Cyberpunk 2077 (singleton), Elden Ring (singleton), etc.

Halo + GTA alone is ~14 games and the named book franchises ~22 books, which is
why those types lean on supplements to hit the per-year density.

## 6. Files changed

- **Add** `scripts/generate-sample.ts`, `scripts/sample-manifest.ts`; add `tsx`
  devDependency and a `generate:sample` npm script; gitignore
  `scripts/.sample-cache.json`.
- **Replace** `shared/seeds/sample.ts` (now generated; new header note that it
  carries real provider data).
- **Delete** `shared/seeds/edge.ts`.
- **Update** `app/pages/dev.vue` — drop the "Edge" dataset button; keep Empty +
  the new dataset.
- **Update** `shared/seeds/seeds.test.ts` — remove `edgeSeed`; keep the shared
  shape / unique-id / `completed_years`-consistency checks against the new
  dataset; fold in coverage assertions (all four types present, all four
  statuses present, a dated DNF exists) so the edge fixture's guarantees are not
  lost.
- **Reconcile** core design §3.3 — note `series`/`series_number` apply to movies
  and games too (matching `itemSeries()`), not books alone.

## 7. Resilience (TMDB flakiness / possible throttling)

Observed 2026-06-27: TMDB intermittently returns 502→500 on both search and
detail, recovering after a pause; Google Books and IGDB are stable. Root cause
is most likely a TMDB incident (5xx, not 429; failures began before heavy
volume), but soft IP throttling can't be fully excluded. Mitigations (apply
regardless of cause):

- **Pace** requests (~300–500 ms between calls; serial, not parallel).
- **Retry** on any 5xx with exponential backoff (e.g. up to 5 attempts).
- **Cache** successful drafts (§3.3) so a re-run resumes rather than re-fetching.
- Movies/shows may need more than one run to fully populate; books/games can be
  generated immediately. The committed file is the source of truth either way.

## 8. Testing

- `seeds.test.ts` validates the generated dataset: unique ids, required-field
  shape, `completed_years` consistent with `completed_dates`, all four types
  present, all four statuses present, ≥1 dated DNF, and the per-bucket minimums
  from §5.
- The generator's pure overlay logic (hybrid date rule, rating range, status
  derivation) gets a small unit test. Network/IO code stays untested, consistent
  with the existing provider utils.
- Full CI (lint, type-check, test, build) must pass on the generated file.

## 9. Risks & open items

- **TMDB availability** — primary execution risk; handled by §7, but timing of a
  complete run depends on TMDB stabilizing.
- **Search match accuracy** — wrong provider matches; mitigated by pinning
  `providerId` for franchises and reviewing the generator's match log.
- **Provider data gaps** — some items lack a cover or rating; acceptable (it
  exercises the UI's fallback paths) but the generator logs them for review.
- **Unreleased backlog items** (e.g. GTA VI) — may have sparse provider data;
  pick backlog items that actually have entries.

## 10. Out of scope

- Real Goodreads ids / Goodreads sync (§6 of core design; separate milestone).
- Self-hosting provider images (covers remain hot-linked provider URLs, as in the
  real add flow).
- Any automated/scheduled refresh of the dataset.

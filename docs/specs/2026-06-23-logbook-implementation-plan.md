# Logbook — Implementation Plan: Bare-Bones Read-Only Milestone

> First milestone toward the [core design](./2026-06-19-logbook-core-design.md):
> an unstyled Nuxt app that **reads** items from Firestore and renders the Backlog,
> History, and Detail views, plus dev-only **seed datasets** loadable from in-app
> buttons. No auth, no add/edit, no Goodreads sync, no backup, no search proxy.

- **Date:** 2026-06-23
- **Status:** Approved design, pending implementation
- **Scope:** Milestone 1 only. Auth, add/edit, sync, backup, and search proxies are
  later milestones.

---

## 1. Goal & non-goals

**Goal:** Get to a working, unstyled app as fast as possible where:

1. Two real Firebase projects exist (`logbook-dev`, `logbook-prod`).
2. Local dev reads from and writes to `logbook-dev` only; prod is untouchable locally.
3. Backlog, History, and item Detail views render real data from Firestore.
4. A `/dev` page exposes buttons to **completely overwrite** the database with one
   of three seed datasets (empty / edge / sample), each behind a confirmation.

**Non-goals (later milestones):** GitHub auth, add/edit/delete UI, search-assisted
add flow, Goodreads sync, NDJSON backup, streaming availability, SSR data fetching.

---

## 2. Environment & credentials

Two real Firebase projects, distinguished purely by **which config is present**:

- **Local dev** always targets `logbook-dev`. Its web-app config lives in a
  gitignored `.env`, loaded automatically by Nuxt.
- **Prod** (`logbook-prod`) config is **never on the dev machine** — it is set as
  environment variables in Netlify only. Locally there is nothing to point at prod.
- Env var names follow Nuxt convention: **`NUXT_PUBLIC_FIREBASE_*`**, surfaced via
  `runtimeConfig.public`.

### 2.1 Env var set (replaces the current `VITE_FIREBASE_*` list)

```
NUXT_PUBLIC_FIREBASE_API_KEY=
NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NUXT_PUBLIC_FIREBASE_PROJECT_ID=
NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NUXT_PUBLIC_FIREBASE_APP_ID=
```

The Realtime-Database `DATABASE_URL` from the old `.env.example` is dropped — we use
Firestore only.

### 2.2 Dev-tools gating

The `/dev` seed page and its nav link render only when `import.meta.dev` is true
(i.e. under `nuxt dev`). A built/deployed app never exposes seeding. Prod Firestore
rules also block writes, so this is defense-in-depth, not the sole guard.

---

## 3. Firebase setup (CLI + console)

Prerequisite: `firebase login` (the user runs this once; it is interactive).

Driven via the Firebase CLI where possible, falling back to console clicks only when
the CLI cannot do it:

1. `firebase projects:create logbook-dev --display-name "Logbook Dev"`
2. `firebase projects:create logbook-prod --display-name "Logbook Prod"`
3. Create a Firestore (Native mode) database in each project:
   `firebase firestore:databases:create "(default)" --project logbook-dev --location nam5`
   (and the same for `logbook-prod`).
4. Register a web app in each project and capture its config:
   `firebase apps:create web logbook-web --project logbook-dev`
   then `firebase apps:sdkconfig web --project logbook-dev` → copy values into `.env`.
5. Write `.firebaserc` with aliases:
   ```json
   { "projects": { "dev": "logbook-dev", "prod": "logbook-prod" } }
   ```
6. `firebase use dev` to set the default active project for local CLI commands.

**Console fallback** (only if a CLI step is blocked by permissions/terms): create the
project, enable Firestore in Native mode, and add a Web app under Project Settings,
then copy the config snippet into `.env`. GitHub auth provider is **not** enabled in
this milestone.

---

## 4. Data model

`shared/types/item.ts` — the single source of truth, matching core-design §3.

```ts
export type MediaType = 'book' | 'movie' | 'show' | 'game';
export type ItemStatus = 'backlog' | 'in_progress' | 'inactive';
export type LengthUnit = 'pages' | 'min' | 'episodes' | 'hours';
export type Provider =
  | 'tmdb' | 'igdb' | 'goodreads' | 'google-books' | 'open-library' | 'manual';

export interface BookMetadata {
  series?: string;
  series_number?: number;
  isbn?: string;
}
export interface MovieMetadata {} // none
export interface ShowMetadata {
  show_tmdb_id: number;
  season_number: number;
  episode_count: number;
  episode_runtime: number;
}
export interface GameMetadata {
  platform?: string;
}

export interface Item {
  id: string;                 // also the Firestore document id
  type: MediaType;
  title: string;
  creator?: string | string[];
  cover?: string;
  thumbnail?: string;
  release_date?: string;      // ISO date
  description?: string;
  length?: number;
  length_unit?: LengthUnit;
  community_rating?: number;
  my_rating?: number;
  provider?: Provider;
  recommended_by?: string;
  status: ItemStatus;
  is_purchased: boolean;
  is_prioritized: boolean;
  completed_dates: string[];  // ISO dates
  completed_years: number[];  // derived from completed_dates
  notes?: string;
  tags: string[];
  metadata: BookMetadata | MovieMetadata | ShowMetadata | GameMetadata;
}
```

**Required fields** (must be present on every item, including minimal seed items):
`id`, `type`, `title`, `status`, `is_purchased`, `is_prioritized`,
`completed_dates`, `completed_years`, `tags`, `metadata`. Everything else is optional.

`shared/utils/completedYears.ts` exports `deriveCompletedYears(dates: string[]):
number[]` — the de-duplicated, sorted set of calendar years from `completed_dates`.

`shared/utils/itemId.ts` exports `makeItemId(...)` helpers per type, matching the id
formats in core-design §3 (e.g. `movie-tmdb-<id>`, `show-tmdb-<showId>-s<season>`,
`book-goodreads-<id>`, `game-igdb-<id>`).

---

## 5. Firebase wiring in Nuxt

- Add `firebase` to `dependencies`.
- `app/plugins/firebase.client.ts`: initialize the Firebase app + Firestore from
  `runtimeConfig.public`, provide `$firestore`. Client-only (`.client.ts`).
- `nuxt.config.ts`: add `runtimeConfig.public.firebase` keys mapped from the
  `NUXT_PUBLIC_FIREBASE_*` env vars (Nuxt maps these automatically by name).

Reads are **client-side** this milestone (pages fetch on mount via the composables
below). SSR/hybrid is deferred (core-design §14).

---

## 6. Data-access layer

`app/composables/useItems.ts` — read queries (core-design §4):

- `getBacklog(): Promise<Item[]>` → `where('status','in',['backlog','in_progress'])`,
  ordered client-side by title.
- `getHistory(year: number): Promise<Item[]>` →
  `where('completed_years','array-contains', year)`, ordered client-side.
- `getItem(id: string): Promise<Item | null>` → single `doc()` fetch.

`app/composables/useSeed.ts` — dev-only writes (kept out of the read path):

- `wipeAll(): Promise<void>` → query all docs in `items`, delete in batches of 500.
- `loadDataset(items: Item[]): Promise<void>` → `wipeAll()`, then for each item
  recompute `completed_years` via `deriveCompletedYears(item.completed_dates)` and
  write in batches of 500 using the item `id` as the document id.

---

## 7. Views (unstyled)

All under `app/pages/`, plus a minimal nav layout.

- `layouts/default.vue` — replace placeholder with a nav (`Backlog`, `History`, and
  `Dev` only when `import.meta.dev`) + `<slot/>`.
- `pages/index.vue` — replace `<NuxtWelcome/>` with a short intro + the same nav links.
- `pages/backlog.vue` — calls `getBacklog()`; renders a list: thumbnail, title, type,
  creator, status. Each row links to `/item/[id]`.
- `pages/history.vue` — a year `<select>` (options: 2026, 2025; default 2026) →
  `getHistory(year)`; renders a list with completion date(s), title, type, creator.
- `pages/item/[id].vue` — `getItem(route.params.id)`; renders every populated field,
  including nested `metadata`. Shows a "not found" message when null.

For shows, the display title is composed at render time as
`"<title> — Season <season_number>"` (core-design §3.4).

---

## 8. Seed datasets

Authored as typed `Item[]` fixtures in `shared/seeds/`.

### 8.1 `empty`

No file needed — the empty dataset is `[]`; its button wipes and loads nothing.

### 8.2 `edge.ts` — 16 items

For each of the 4 types, four items covering the field-coverage and view-membership
corners:

| variant          | fields populated            | status        | completed_dates |
| ---------------- | --------------------------- | ------------- | --------------- |
| minimal-backlog  | required only               | `backlog`     | `[]`            |
| maximal-backlog  | every field                 | `backlog`     | `[]`            |
| minimal-history  | required only               | `inactive`    | `[one date]`    |
| maximal-history  | every field                 | `inactive`    | `[two dates]`   |

4 types × 4 variants = **16 items**. Maximal items populate type-specific `metadata`
fully; minimal items use the empty/required `metadata` for their type.

### 8.3 `sample.ts` — realistic data

Per type: ~5–8 backlog + ~5–8 completed in 2026 + ~5–8 completed in 2025, using real
titles, creators, release dates, and plausible ratings/lengths. Target ~60–90 items
total. Covers all four types so every view has content across both history years.

### 8.4 `/dev` page

`pages/dev.vue` (gated on `import.meta.dev`): one button per dataset
(Empty / Edge / Sample). Each button → `confirm('This will ERASE the entire database
and replace it with the <name> dataset. Continue?')` → `loadDataset(...)` → success
message with item count.

---

## 9. Security rules & indexes

Two rules files (rules cannot branch on project id, so we keep one per environment):

- `firestore.rules` (**prod**):
  ```
  match /items/{id} {
    allow read: if true;
    allow write: if false;   // tightened to owner-only when auth lands
  }
  ```
- `firestore.dev.rules` (**dev**):
  ```
  match /items/{id} {
    allow read, write: if true;   // open sandbox; dev project only
  }
  ```

`firestore.indexes.json` — composite indexes from core-design §4.4:

- `type` (asc) + `status` (asc)
- `completed_years` (array-contains) + `type` (asc)

`firebase.json` points `firestore.rules` at `firestore.rules` and
`firestore.indexes` at `firestore.indexes.json`. npm scripts deploy per project:

- `deploy:rules:dev` → `firebase deploy --only firestore:rules --project dev` after
  swapping in `firestore.dev.rules` (script copies dev rules into place, deploys,
  restores prod rules — or uses a second `firebase.json` target; final mechanism
  chosen at implementation).
- `deploy:rules:prod` → `firebase deploy --only firestore:rules --project prod`.
- `deploy:indexes` → `firebase deploy --only firestore:indexes` to both projects.

---

## 10. Testing

Light unit tests under the existing Vitest setup:

- `deriveCompletedYears` — empty, single, multi-year, duplicate-year inputs.
- `makeItemId` helpers — correct format per type, including show season ids.
- Seed validity — every item in `edge` and `sample` satisfies the required-field set
  and a valid `type`/`status`, and `completed_years` matches
  `deriveCompletedYears(completed_dates)`.

`npm run validate` (lint + type-check + test) must pass before the milestone is done.

---

## 11. Build order

1. Replace `.env.example` with the `NUXT_PUBLIC_FIREBASE_*` set (§2.1); drop `DATABASE_URL`.
2. Add `firebase` dependency; add `runtimeConfig.public.firebase` to `nuxt.config.ts`.
3. `app/plugins/firebase.client.ts`.
4. `shared/types/item.ts`, `shared/utils/completedYears.ts`, `shared/utils/itemId.ts`.
5. Firebase CLI/console setup (§3) → projects live, `.env` populated, `firebase use dev`.
6. `firestore.rules`, `firestore.dev.rules`, `firestore.indexes.json`, `firebase.json`,
   `.firebaserc`; deploy rules + indexes to both projects.
7. `shared/seeds/edge.ts`, `shared/seeds/sample.ts`; `app/composables/useSeed.ts`;
   `pages/dev.vue` → load the sample dataset into `logbook-dev`.
8. `app/composables/useItems.ts`; `layouts/default.vue`, `pages/index.vue`,
   `pages/backlog.vue`, `pages/history.vue`, `pages/item/[id].vue`.
9. Tests (§10); run `npm run validate`.

---

## 12. Open items (deferred, not blocking)

- SSR/hybrid rendering strategy (core-design §14) — milestone uses client-side reads.
- Whether `shared/seeds/*` ships in the public bundle long-term (acceptable now; the
  `/dev` page that consumes them is dev-gated).
- Final rules-deploy mechanism (rules-file swap vs `firebase.json` targets) — chosen
  during implementation of §9.

# URL query params for Backlog & History views

Status: approved 2026-06-27.

## 1. Goal

Make the Backlog and History views **bookmarkable / shareable** by reflecting
their filter and sort state in the URL query string, and make **content-type
switches behave like separate pages** for the browser back button. Type and (on
History) year create history entries; sort, direction, and filters update the URL
in place.

## 2. Scope

- **Backlog** (`app/pages/index.vue`): `type`, `sort`, direction, and the three
  filters (`purchased`, `prioritized`, `released`).
- **History** (`app/pages/history.vue`): `type`, `year`, `sort`, direction.

Out of scope: the detail/edit pages (not list views), and any new filters/sorts.

## 3. Approach

Use VueUse's `useRouteQuery` (from `@vueuse/router`) as the per-param binding
primitive — it gives a ref synced to one query param, reactive to back/forward
navigation, with a per-param `mode: 'push' | 'replace'`. That removes the
bug-prone hand-rolled bidirectional sync / loop-guarding.

Three units:

1. **`shared/utils/viewQuery.ts` (pure, unit-tested):** small (de)serialization
   helpers per param type — parse-with-validation (bad/unknown → `undefined`) and
   serialize-with-default-omission (value equal to default → param absent, for
   clean URLs). E.g. `parseEnum(allowed)`, `parseBool`, `parseYear`.
2. **`app/composables/useViewQuery.ts` (wiring):** a thin wrapper that builds a
   route-bound ref from `useRouteQuery` for a binding `{ param, default, mode,
parse, serialize }`, applying validation + default-omission. Returns the refs.
3. **`useItemList` refactor:** today it _creates_ `sortKey` / `reversed` /
   `filters`. Change it to _accept_ them, so the route-bound refs are the single
   source of truth (no second set to keep in sync). It keeps only the
   `displayed` computed.

## 4. Param scheme

Direction is encoded as `reverse=1` (present when reversed; omitted when not) —
"reversed" is relative to each sort's natural order, not an absolute asc/desc.

### Backlog `/`

| Param         | Default  | Mode    | Values                                                      |
| ------------- | -------- | ------- | ----------------------------------------------------------- |
| `type`        | `book`   | push    | `book` \| `movie` \| `show` \| `game`                       |
| `sort`        | `rating` | replace | `rating`/`title`/`creator`/`series`/`length`/`release_date` |
| `reverse`     | off      | replace | `1`                                                         |
| `purchased`   | `all`    | replace | `yes` \| `no`                                               |
| `prioritized` | `all`    | replace | `yes` \| `no`                                               |
| `released`    | `all`    | replace | `yes` \| `no`                                               |

Example: `/?type=movie&sort=title&purchased=yes`

### History `/history`

| Param     | Default           | Mode    | Values                                                               |
| --------- | ----------------- | ------- | -------------------------------------------------------------------- |
| `type`    | `book`            | push    | `book` \| `movie` \| `show` \| `game`                                |
| `year`    | newest available  | push    | any integer year                                                     |
| `sort`    | `completion_date` | replace | `completion_date`/`rating`/`title`/`creator`/`length`/`release_date` |
| `reverse` | off               | replace | `1`                                                                  |

Example: `/history?type=show&year=2025&sort=rating`

## 5. Sync behaviour

- **Init from URL:** refs read their value from the query on load; absent/invalid
  params use the default. Bookmarks and deep links work.
- **Writeback:** changing a ref updates the query via its `mode`. Setting a ref to
  its default omits the param (clean URL).
- **Back/forward:** handled natively by `useRouteQuery` (refs are reactive to the
  route).
- **Type-switch sort reset:** the existing `watch(sortKeys)` that resets an
  unavailable sort (e.g. `title` → switched to Shows) still runs; because the
  type change (push) fires before the sort reset (replace), the net result is one
  correct history entry.

### Year (special case — dynamic default)

`year`'s default is data-driven (newest year with completions for the current
type), so it can't be a static default. Model it as:

- **Absent param = "newest available".** A bound `urlYear` ref (`useRouteQuery`,
  `mode: 'push'`) holds the explicit selection or `undefined`.
- The page's effective `year` is a computed: `urlYear ?? newestAvailable`. The
  dropdown binds to it; selecting a year sets `urlYear` (push). This means the
  initial newest-year view writes **nothing** to the URL (no spurious history
  entry on load), and Back from a chosen year returns to the newest-available
  view.
- **Self-correction:** once `completionYears` loads, if `urlYear` is set but not
  among the available years for the current type, clear it (replace) so the view
  falls back to newest. Replaces the old `watch(years)` snap.

## 6. `useItemList` refactor

Change the signature so state refs are injected rather than created:

```ts
// before: useItemList(items, { sortKeys, defaultSort, ratingField, filterKeys, year })
//   -> returns { sortKey, reversed, filters, displayed }
// after:
useItemList(items, {
  sortKey: Ref<SortKey>,
  reversed: Ref<boolean>,
  filters: Ref<ItemFilters> | reactive,
  ratingField: RatingField,
  year?: Ref<number>,
}); // -> returns { displayed }
```

The pages create `sortKey` / `reversed` / filter refs via `useViewQuery`, pass
them in, and keep the page-local `watch(sortKeys)` reset logic. `displayed` is
unchanged in behaviour.

## 7. Files changed

- `package.json` — add `@vueuse/router` dependency; import `useRouteQuery`
  explicitly (no Nuxt module needed, since only this composable is used).
- New: `shared/utils/viewQuery.ts` (+ `.test.ts`),
  `app/composables/useViewQuery.ts`.
- `app/composables/useItemList.ts` — accept injected refs (§6).
- `app/pages/index.vue`, `app/pages/history.vue` — build refs via `useViewQuery`,
  pass to `useItemList`; History year becomes the computed wrapper.
- Possibly `app/components/ItemControls.vue` — unchanged (still `v-model`s on the
  route-bound refs).

## 8. Testing

- Unit-test `shared/utils/viewQuery.ts`: parse validation (unknown enum/bad year/
  bad bool → undefined), serialize default-omission, round-trips.
- Composables/pages remain wired-but-untested, consistent with the repo.
- Full CI (lint, type-check, test, build) must pass.

## 9. Edge cases & risks

- `?type=foo` / `?sort=bogus` / `?year=abc` → ignored, default used.
- `/history?year=2019` with no 2019 data for that type → self-corrected to newest
  (param cleared). The bookmark "loses" an empty year, which is acceptable.
- SSR: `useRoute().query` is SSR-safe, so `type` (rendered outside `<ClientOnly>`)
  initializes consistently across hydration — no mismatch.
- Switching type keeps a still-valid `year` (e.g. both have 2025); otherwise it
  self-corrects.

## 10. Out of scope

- Persisting view state beyond the URL (e.g. localStorage).
- Encoding multiple filters into a single param; each filter stays its own param.

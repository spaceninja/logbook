---
name: verify
description: Drive the Logbook Nuxt app in a real browser to observe a change working. Use when verifying UI or data-layer changes end-to-end.
---

# Verifying Logbook

Logbook is a Nuxt 4 SPA whose data comes from a **client-only** Firestore SDK.
Nothing meaningful renders server-side, so verification means driving a real
browser — `curl` only ever returns the empty SSR shell.

## Launch

The dev server is usually already running on `http://localhost:3000`. Check
before starting another:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
```

Start with `npm run dev` if it isn't up.

## Browser handle

There's no Playwright in `node_modules` and no test-runner harness. Install it
into the scratchpad and point it at the **cached** browser — the bundled version
almost never matches what's in `~/Library/Caches/ms-playwright`:

```bash
cd "$SCRATCHPAD" && npm init -y && npm i playwright@latest
ls ~/Library/Caches/ms-playwright   # note the chromium_headless_shell-<N> build
```

```js
const EXE = '/Users/scott/Library/Caches/ms-playwright/chromium_headless_shell-<N>/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const b = await chromium.launch({ executablePath: EXE });
```

### Two gotchas that will cost you 20 minutes

1. **Never `waitUntil: 'networkidle'`.** Firestore is forced to long-polling
   (see the client-rendering notes), so the connection is held open and
   networkidle *never* fires — `page.goto` just times out. Use
   `waitUntil: 'domcontentloaded'`.
2. **Wait ~4s after navigation.** Reads are client-side and deferred; the views
   show a "Loading…" flash first. Asserting sooner sees an empty list.

## Data

The dev Firestore has real imported data, and it is **uneven** — don't conclude
"no data" from one empty view, and re-check the counts before trusting this
table (it goes stale every time the database is reseeded). Measured 2026-07-24:

| Type  | Backlog | History |
|-------|---------|---------|
| book  | 254     | 1963–2026 (49 years, 718 items all told) |
| movie | empty   | empty |
| show  | empty   | empty |
| game  | empty   | empty |

So right now: **use `?type=book` for everything.** A type with no data shows only
the current year in the switcher — that fallback is the tell that the type is
empty, not that the view is broken. Reads are public (`allow read: if true`), so
none of this needs login — but anything that *writes* does, including the `/dev`
seed buttons, and GitHub OAuth isn't drivable headlessly. If a flow needs data
that isn't there, ask rather than trying to seed.

## Flows worth driving

- **Backlog** `/?type=book` — sort/filter/search controls over a loaded list
- **History** `/history?type=book` — year/scope switcher, completion dates
- **Search** `/search?type=book&q=dune` — cross-year results
- **Detail** `/item/<id>` — click a card

Useful selectors: `ol li` for cards, `.title` / `.dates time` within a card,
`#history-scope` (the year/scope switcher), `#sort-by`, `getByRole('searchbox')`,
`getByRole('radio', { name: 'show' })`.

Two more time sinks: `page.goto` output is block-buffered when redirected to a
file (nothing appears until the run ends — tail the process, don't panic), and
`locator.textContent()` on an element that isn't there auto-waits the full 30s.
Guard optional lookups with `if (await loc.count())` instead of `.catch()`.

Check `history.length` before/after typing to confirm URL-bound state uses
replace mode rather than pushing an entry per keystroke.

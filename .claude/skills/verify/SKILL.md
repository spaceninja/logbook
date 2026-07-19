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
"no data" from one empty view. As of 2026-07:

| Type  | Backlog | History |
|-------|---------|---------|
| book  | empty   | empty   |
| movie | empty   | 2008–2026 (44 in 2026) |
| show  | 279     | some    |
| game  | empty   | empty   |

So: **use `?type=show` for backlog flows and `?type=movie` for history flows.**
Reads are public (`allow read: if true`), so none of this needs login — but
anything that *writes* does, and GitHub OAuth isn't drivable headlessly.

## Flows worth driving

- **Backlog** `/?type=show` — sort/filter/search controls over a loaded list
- **History** `/history?type=movie` — year switcher, completion dates
- **Search** `/search?type=movie&q=star+wars` — cross-year results
- **Detail** `/item/<id>` — click a card

Useful selectors: `ol li` for cards, `.title` / `.dates time` within a card,
`#year-switcher`, `getByRole('searchbox')`, `getByRole('radio', { name: 'show' })`.

Check `history.length` before/after typing to confirm URL-bound state uses
replace mode rather than pushing an entry per keystroke.

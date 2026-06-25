# Logbook — Implementation Plan: Auth + Add/Edit/Delete (Milestone 2)

> Second milestone toward the [core design](./2026-06-19-logbook-core-design.md),
> building on the [read-only milestone](./2026-06-23-logbook-implementation-plan.md):
> GitHub login, owner-only Firestore writes, and a **manual** add/edit/delete flow.
> No search-assisted autofill yet (that's the next milestone), no Goodreads sync,
> no backup.

- **Date:** 2026-06-24
- **Status:** Approved design, pending implementation
- **Scope:** Milestone 2 only. The search-assisted add flow (TMDB/IGDB/Books
  proxies), Goodreads sync, NDJSON backup, and streaming availability are later
  milestones.

---

## 1. Goal & non-goals

**Goal:** Turn the read-only viewer into a single-owner editable app:

1. "Log in with GitHub" via Firebase Auth (client SDK).
2. Firestore writes restricted to the owner's UID, in **both** dev and prod.
3. Owner-only **add**, **edit**, and **delete** of items through a manual form
   (every field typed by hand).
4. The `/dev` seed page works for the logged-in owner (dev rules are now
   owner-only).

**Non-goals (later milestones):** search-assisted add/autofill, the two-step show
season picker, Goodreads sync, backup, streaming availability, SSR auth/session
cookies.

---

## 2. Auth model

Firebase Auth with the GitHub provider, wired by hand with the client SDK
(consistent with the existing direct-SDK approach; no auth module).

- **Plugin:** extend `app/plugins/firebase.client.ts` to also call `getAuth(app)`,
  provide it as `$auth`, and register a single `onAuthStateChanged` listener that
  writes the current user into shared state.
- **Shared state:** `useState<User | null>('auth-user')`, set by the listener.
  `null` on the server (auth is client-only); populated on the client after the
  SDK restores the session.
- **`app/composables/useAuth.ts`:**
  - `user` — the shared state ref.
  - `isOwner` — `computed(() => !!user.value && user.value.uid === ownerUid)`,
    where `ownerUid = useRuntimeConfig().public.ownerUid`.
  - `login()` — `signInWithPopup(auth, new GithubAuthProvider())`.
  - `logout()` — `signOut(auth)`.
- **Persistence:** Firebase default (`browserLocalPersistence`) — stays logged in
  across reloads.
- **Hydration:** auth-dependent UI is wrapped in `<ClientOnly>` (the server renders
  the logged-out state; the client fills in after the listener fires), matching the
  pattern already used for Firestore data.

### 2.1 Owner UID configuration

Firebase Auth UIDs are **per-project**, so the same GitHub account has a different
UID in `spaceninja-logbook-dev` than in `spaceninja-logbook-prod`.

- Add `NUXT_PUBLIC_OWNER_UID` to the env set → `runtimeConfig.public.ownerUid`.
  - Dev UID lives in local `.env`.
  - Prod UID is set in Netlify env vars.
- Update `.env.example` to include `NUXT_PUBLIC_OWNER_UID=`.
- `nuxt.config.ts`: add `runtimeConfig.public.ownerUid: ''`.

---

## 3. Security rules

Both rules files move from their milestone-1 state to owner-only writes, each
hardcoding **its own project's** owner UID (rules cannot read runtime config).

- `firestore.rules` (**prod**):
  ```
  match /items/{id} {
    allow read: if true;
    allow write: if request.auth != null
                 && request.auth.uid == '<PROD_OWNER_UID>';
  }
  ```
- `firestore.dev.rules` (**dev**): identical shape with `<DEV_OWNER_UID>`. This
  replaces the milestone-1 open `read, write: if true`.

Redeploy after filling the UIDs: `npm run deploy:rules:dev` and
`npm run deploy:rules:prod`.

**Consequence for `/dev` seeding:** dev writes now require the owner to be signed
in. The seed page is updated accordingly (§6).

---

## 4. Routing & pages

All new pages are owner-gated by route middleware **and** by rules.

- **`app/middleware/owner.ts`** — a named middleware: if `!isOwner`, redirect to
  `/`. Applied to `/add`, `/item/[id]/edit`. (Client-side; `isOwner` is only known
  on the client, so the middleware no-ops during SSR and runs on hydration/nav.)
- **`app/pages/add.vue`** — renders `<ItemForm mode="create" />`. On the form's
  `submit` event: `saveItem(item)` then `navigateTo('/item/' + item.id)`.
- **`app/pages/item/[id]/edit.vue`** — loads the item via `getItem(id)`; when found,
  renders `<ItemForm mode="edit" :initial="item" />`. On `submit`: `saveItem(item)`
  (same id) then `navigateTo('/item/' + id)`. Shows "Item not found" when missing.
- **`app/pages/item/[id].vue`** (existing) — add an owner-only block: an **Edit**
  link (`/item/[id]/edit`) and a **Delete** button → `window.confirm(...)` →
  `deleteItem(id)` → `navigateTo('/backlog')`.
- **`app/layouts/default.vue`** (existing) — inside `<ClientOnly>`, add:
  - when `isOwner`: an **Add** link and **Log out** button.
  - when not signed in: a **Log in with GitHub** button.

Moving the existing `app/pages/item/[id].vue` into a folder route
(`app/pages/item/[id]/index.vue`) so the sibling `edit.vue` can live at
`app/pages/item/[id]/edit.vue`.

---

## 5. `<ItemForm>` component

`app/components/ItemForm.vue` — the single reusable form, kept **pure** (no
Firestore dependency) so it is unit-testable in isolation.

- **Props:** `mode: 'create' | 'edit'`; `initial?: Item`.
- **Emits:** `submit` with a fully-assembled `Item`. The parent page performs the
  write. (Delete is not the form's concern.)
- **Local state:** a reactive working copy seeded from `initial` (edit) or sensible
  defaults (create): `status: 'backlog'`, `provider: 'manual'`, booleans `false`,
  arrays empty, `metadata` per the chosen type.
- **Fields** (all schema fields from core-design §3):
  - `type` `<select>` (book/movie/show/game) — drives which metadata block renders.
  - `title`, `creator` (text; comma-separated → `string | string[]`), `release_date`
    (`<input type="date">`), `description` (textarea), `cover`, `thumbnail` (url),
    `length` (number) + `length_unit` (select), `community_rating`, `my_rating`
    (number, 0–10), `provider` (select; default `manual`), `recommended_by` (text),
    `status` (select), `is_purchased`, `is_prioritized` (checkboxes),
    `completed_dates` (an add/remove list of date inputs), `notes` (textarea),
    `tags` (text; comma-separated).
  - **Metadata blocks (conditional on `type`):** book → `series`, `series_number`,
    `isbn`; show → `show_tmdb_id`, `season_number`, `episode_count`,
    `episode_runtime`; game → `platform`; movie → none.
- **Assemble (on submit):**
  - Trim/parse comma lists; **omit** empty optional fields entirely (do not include
    the key at all — Firestore rejects explicit `undefined` values), so optional
    fields stay truly optional.
  - Recompute `completed_years` via `deriveCompletedYears(completed_dates)`.
  - `create`: `id = makeManualId(type)`, `provider` defaults to `'manual'`.
    `edit`: keep `initial.id` (immutable) and `initial`'s provider/created identity.
  - Keep required structural fields concrete (`tags: []`, `completed_dates: []`,
    booleans, `metadata: {}`) per the milestone-1 convention.
- **Validation:** required = `type`, `title`, `status` (HTML `required` + a submit
  guard that blocks emit and shows a message). Everything else optional. Numeric
  inputs constrained with `min`/`max` where sensible (ratings 0–10).

---

## 6. `/dev` seed page (update)

Dev rules are now owner-only, so seeding requires the owner to be signed in.

- `app/pages/dev.vue`: if `!isOwner`, render a **Log in with GitHub** button and a
  note instead of the seed buttons. When `isOwner`, render the existing
  Empty/Edge/Sample buttons unchanged.
- No change to `useSeed`; its writes simply now run as the authenticated owner.

---

## 7. Data-access additions

`app/composables/useItems.ts`:

- `saveItem(item: Item): Promise<void>` → recompute `completed_years` defensively,
  then `setDoc(doc(items, item.id), item)`. Used by both create and edit.
- `deleteItem(id: string): Promise<void>` → `deleteDoc(doc(items, id))`.

Both are called from pages only after an `isOwner` check; rules enforce the real
boundary. Firestore continues to use forced long-polling (existing plugin config).

`shared/utils/itemId.ts`:

- `makeManualId(type: MediaType): string` → `` `${type}-manual-${crypto.randomUUID()}` ``.
  Manual items keep this id permanently; provider-sourced ids arrive with the future
  lookup flow.

---

## 8. Testing

Unit tests under the existing Vitest setup:

- **`ItemForm`** (the highest-value target, testable because it emits rather than
  writes): mounting with `initial` prefills fields; changing `type` swaps the
  metadata block; submitting emits an `Item` with correct `completed_years`,
  parsed comma lists, per-type metadata, and (create) a `*-manual-*` id; the submit
  guard blocks emit when `title` is empty.
- **`makeManualId`** — format `^<type>-manual-<uuid>$` and uniqueness across calls.
- **`isOwner`** — true only when `user.uid === ownerUid`; false for null user and
  for a non-owner uid.

`npm run validate` (lint + type-check + test) must pass.

---

## 9. Setup steps handed to the owner (console + GitHub)

GitHub provider requires a GitHub OAuth App per Firebase project.

1. **GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps →
   New) for each project. Homepage URL = the site; Authorization callback URL =
   the value Firebase shows in the GitHub provider config
   (`https://<project>.firebaseapp.com/__/auth/handler`). Copy the **Client ID**
   and **Client secret**.
2. **Enable GitHub provider** in Firebase console → Authentication → Sign-in
   method → GitHub, pasting the client ID/secret, for **both** projects.
3. **Authorized domains** — Firebase console → Authentication → Settings →
   Authorized domains: add `spaceninja-logbook.netlify.app` and `log.oscorp.net`
   to **both** projects (`localhost` is preset for local dev).
4. **Capture owner UIDs** — after the first successful GitHub login in each project
   (Authentication → Users shows the UID, or log it from `user.uid`): put the dev
   UID in `.env`, the prod UID in Netlify, and hardcode each into its rules file
   (§3), then redeploy rules.

(Two OAuth Apps because callback URLs differ per project; a single app cannot list
both Firebase handler domains cleanly. Dev and prod stay fully isolated.)

---

## 10. Build order

1. `nuxt.config.ts` + `.env.example`: add `ownerUid` runtime config /
   `NUXT_PUBLIC_OWNER_UID`.
2. Extend `firebase.client.ts` with Auth + the `onAuthStateChanged` → `useState`
   listener; `app/composables/useAuth.ts`.
3. GitHub OAuth Apps + enable provider + authorized domains (owner, §9); first
   login in dev → capture dev UID into `.env`.
4. `firestore.dev.rules` → owner-only with dev UID; `firestore.rules` → owner-only
   with prod UID (prod UID captured after a prod login, or deploy dev first and do
   prod when ready); deploy rules.
5. `shared/utils/itemId.ts`: `makeManualId`.
6. `app/components/ItemForm.vue` (pure, emits `Item`).
7. `useItems`: `saveItem`, `deleteItem`.
8. Routes: move `item/[id].vue` → `item/[id]/index.vue`; add `item/[id]/edit.vue`,
   `add.vue`, `middleware/owner.ts`; owner-only Edit/Delete on the detail page; nav
   Login/Logout/Add in `default.vue`.
9. `/dev` page owner gate.
10. Tests (§8); `npm run validate`.

---

## 11. Open items (deferred, not blocking)

- Search-assisted autofill and the two-step show-season picker (next milestone) —
  this milestone is manual-only.
- Re-keying a manual item to a provider id if a later lookup matches it — possible
  future merge feature; out of scope.
- SSR-aware auth via session cookies (core-design §14) — not needed while reads are
  public and rules are the gate.

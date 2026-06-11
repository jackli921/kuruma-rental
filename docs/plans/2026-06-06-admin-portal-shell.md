# Platform Admin Portal — Shell + Revenue-Tab Placeholder (Implementation Plan)

**Issue:** #462 — feat(marketplace): platform admin portal + per-partner revenue/commission (4%) tab
**Epic:** #385 (marketplace MVP)
**Branch:** `feat/462-admin-portal-shell` (off `marketplace-pivot`)
**Worktree:** `/Users/jack/Dev/kuruma-admin-portal`
**Source of truth:** `docs/plans/2026-06-05-scope-update-du-kaku.md` §1.5, §2, §5
**Status:** MERGED 2026-06-06 (#462, PR #481, `4c15833`) on the **Next.js** shell. NOT yet ported to the Vite shell — the revenue tab is unreachable on the live CF Pages deploy until ported (tracked by #541; unblocks #515 and #501).

---

## 1. Goal & Non-Goals

### Goal

Stand up a **third dashboard** for platform operations, distinct from the renter
portal (`/dashboard` + renter pages, no prefix) and the operator portal
(`/manage/*`). This slice delivers the **shell only**:

- A `PLATFORM_ADMIN`-gated route prefix (`/admin`, decided §6.1).
- Auth guard at two layers: the edge middleware (`middleware.ts`) and a
  server-side layout check (defence in depth, mirroring the operator portal).
- A layout + sidebar nav scaffold that mirrors the operator portal
  (`(business)/layout.tsx` + `BusinessSidebar.tsx`), including the
  `aria-current` hydration-safe active-state pattern.
- A landing page (admin home) and a **Partner Revenue tab placeholder** that
  renders an empty/"coming soon" state and documents the gated follow-up.
- An `admin` i18n namespace across all three locales (en/ja/zh).

### Non-Goals (explicitly out of scope for this slice)

- **Revenue aggregation.** Computing per-business gross / 4% / net payable from
  `payment_events` is gated on **#461** (Stripe + `payment_events` table — the
  table does not exist in `schema.ts` yet, confirmed). This slice ships a
  placeholder only.
- **No new API endpoint** for the shell. The shell needs no data (the dashboard
  cards on the operator side fetch stats; the admin shell renders static
  scaffolding). When the revenue tab is built, it will read via a new Hono API
  route — never direct DB from web (architecture rule).
- **No schema migration.** Nothing in `packages/shared/src/db/schema.ts` changes.
- No write actions, no payout export, no Stripe wiring.
- No richer admin features (operator management, document-verification queue,
  user admin) — those are post-demo fast-follow (§5 of the scope doc).

---

## 2. Current State (verified against real code)

### 2.1 Role enum

`packages/shared/src/db/schema.ts:25-32` — `roleEnum` has exactly six values:

```
'RENTER', 'STAFF', 'ADMIN', 'OPERATOR_OWNER', 'OPERATOR_STAFF', 'PLATFORM_ADMIN'
```

Comment at lines 21-24 is the governing intent: `PLATFORM_ADMIN` is **the only
role allowed to bypass operator scope (env-gated)**; legacy `STAFF`/`ADMIN`
"remain as temporary platform-admin equivalents during the transition — no new
users get them." `users.role` defaults to `'RENTER'`; `users.operatorId` is
NULL for renters **and** platform admins (`schema.ts:62-64`).

### 2.2 Auth split (edge-safe vs Node)

- **`packages/web/src/auth.config.ts`** — edge-safe, NO DB imports. Providers
  (Google, Apple) + `jwt`/`session` callbacks that thread `token.role` and
  `token.operatorId` onto `session.user`. This is what the middleware loads.
- **`packages/web/src/auth.ts`** — full config: lazy singleton (`getAuthResult`),
  DrizzleAdapter, `session: { strategy: 'jwt' }`. Its `jwt` callback re-fetches
  `role`/`operatorId` from the DB **at most every 5 minutes** (`auth.ts:33-55`,
  `ROLE_REFRESH_MS`), because the `user` object is only present on first sign-in.
  Exposes `auth()` (0-arg session getter) for server components (`auth.ts:79-84`).

**Boundary rule (CLAUDE.md):** middleware imports `auth.config.ts`, never
`auth.ts` (which pulls postgres-js → breaks the CF Workers Edge runtime).

### 2.3 Middleware route guard

`packages/web/src/middleware.ts`:

- Wraps `NextAuth(authConfig).auth(...)` (edge config, line 17).
- Per request: `stripLocale` → `classifyRoute` → branch (lines 22-45).
- Unauthenticated on a `renter`/`business` route → redirect to `/{locale}/login`
  with `callbackUrl` (lines 29-33).
- `business` route + session: `extractSessionRole(session)` then
  `isBusinessRole(role)`; non-business roles are redirected to `/{locale}`
  (lines 38-43). `extractSessionRole` is the #22 crash guard (handles
  `session.user === undefined` on CF Workers).
- Falls through to `intlMiddleware` (line 45).
- Matcher: `['/', '/(en|ja|zh)/:path*']` (lines 48-50).

`packages/web/src/lib/route-helpers.ts`:

- `RENTER_PATHS = ['/bookings', '/messages']`, `BUSINESS_PATHS = ['/dashboard', '/manage/']`.
- `classifyRoute(path)` returns `{ type: 'public' | 'renter' | 'business' }`.
- `stripLocale`, `getLocaleFromPath`, `extractSessionRole` — all pure, all
  unit-tested in `packages/web/tests/lib/route-helpers.test.ts` (122 lines).

`packages/web/src/lib/business-roles.ts`:

- `BUSINESS_ROLES = Set('STAFF','ADMIN','PLATFORM_ADMIN','OPERATOR_OWNER','OPERATOR_STAFF')`,
  `isBusinessRole(role)`. Dependency-free so the Edge middleware can import it.
- Unit-tested in `packages/web/tests/lib/business-roles.test.ts`.

**Key observation:** `PLATFORM_ADMIN` is currently inside `BUSINESS_ROLES`, so a
platform admin can already enter `/manage/*`. The admin portal needs a
**narrower** guard (`PLATFORM_ADMIN` + legacy `STAFF`/`ADMIN` only — decided
§6.1) that does NOT admit `OPERATOR_*`.

### 2.4 Operator portal routing + layout + sidebar (the template to mirror)

- Route group: `packages/web/src/app/[locale]/(business)/` with children
  `dashboard/` and `manage/{bookings,vehicles,classes,locations,insurance,fees,customers,messages}`
  (verified via the app tree).
- **`(business)/layout.tsx`** (34 lines): `await Promise.all([auth(), params])`;
  guards `!session?.user → redirect login`; `!isBusinessRole(role) → redirect /{locale}`;
  renders `<BusinessSidebar /> + <main>{children}</main>`. This is the
  server-side defence-in-depth layer behind the middleware.
- **`components/nav/BusinessSidebar.tsx`** (85 lines, `'use client'`):
  `SIDEBAR_ITEMS` array of `{ href, icon, labelKey }`; a single static
  `LINK_CLASSNAME` with `aria-[current=page]:*` Tailwind variants; the
  `mounted` state defers `aria-current` until after hydration to kill the
  hydration mismatch (#25 pattern, documented in comments lines 31-58). Labels
  via `useTranslations('nav')`, links via `Link`/`usePathname` from
  `@/i18n/routing`.
- Dashboard page (`dashboard/page.tsx`, 56 lines) is the page-style reference:
  `getTranslations('business')`, Card grid, thin composition.

### 2.5 i18n

- `packages/web/src/i18n/routing.ts` — `defineRouting({ locales: ['en','ja','zh'], defaultLocale: 'en' })`; exports `Link`, `redirect`, `usePathname`, `useRouter`.
- `i18n/request.ts` loads `messages/<locale>.json` wholesale per request.
- Namespaces (top-level keys) in `messages/en.json`: `common, errors, auth, nav,
  acriss, catalog, vehicles, business, messaging, bookings, landing, search`.
  `nav` already holds sidebar labels (dashboard, fleet, classes, …).
- **`scripts/lint-i18n-parity.ts`** is a CI gate (`ci.yml:41`,
  `bun run lint:i18n-parity`): every key added to `en.json` **must** exist in
  `ja.json` and `zh.json` or CI fails. CLAUDE.md gotcha: new namespaces need a
  dev-server restart (`rm -rf packages/web/.next && bun run dev`).

### 2.6 Tests / CI

- Web tests: `vitest run`, files in `packages/web/tests/**` (mirrored, not
  colocated — e.g. `tests/lib/route-helpers.test.ts`). `@testing-library/react`
  available for component tests.
- E2E: Playwright, `testDir: ./e2e`, specs like `e2e/storefront-search.spec.ts`;
  a real-DB lane exists (`e2e/real-db/locations.auth.spec.ts`).
- CI `test-and-build` gate runs: biome, `lint:size`, `lint:modules`,
  `lint:i18n-parity`, `bun run test`, build (`ci.yml:13-48`); `db-drift` is a
  separate job (not triggered — no schema change here).

### 2.7 Architecture constraints (apply to this slice)

- Web feature code → `packages/web/src/modules/<feature>/`; existing web modules:
  `auth, classes, fees, insurance, locations, operators, storefronts, vehicles`.
  Pages stay thin (≤80 lines, R7); cross-module primitives in `src/lib/`;
  design primitives in `components/ui/` (`docs/architecture/modules.md`).
- Web has **NO direct DB access** — any future data comes via the Hono API.
- Next 16 + shadcn (base-ui): **no `asChild`** (use `buttonVariants()` on `Link`
  or `render` prop); `middleware.ts` not `proxy.ts`.

---

## 3. Proposed Design

### 3.1 Route prefix & structure

**Prefix: `/admin`** (decided §6.1 — clean, parallel to `/manage`).
Use a new route group `(admin)` so the admin chrome is isolated from the
`(business)` chrome, exactly as `(business)` is isolated from `(renter)`:

```
packages/web/src/app/[locale]/(admin)/
  layout.tsx                 # server guard + <AdminSidebar/> + <main>
  admin/
    page.tsx                 # admin home (overview placeholder)
    revenue/
      page.tsx               # Partner Revenue tab — placeholder
```

Resulting URLs: `/{locale}/admin`, `/{locale}/admin/revenue`. The route-group
folder `(admin)` is path-invisible; the `admin/` segment carries the prefix
(same trick `(business)` uses with the `manage/` segment).

### 3.2 The `PLATFORM_ADMIN` guard (two layers, edge-safe split respected)

Introduce a **dedicated platform-roles module** rather than overloading
`business-roles.ts` (which intentionally admits `OPERATOR_*`):

`packages/web/src/lib/platform-roles.ts` (dependency-free, Edge-importable):

```ts
export const PLATFORM_ADMIN_ROLES: ReadonlySet<string> = new Set([
  'PLATFORM_ADMIN',
  'STAFF',   // legacy transitional super-admin (schema.ts:23) — admitted, decided §6.1
  'ADMIN',   // legacy transitional super-admin
])
export function isPlatformAdmin(role: string | undefined): boolean {
  return PLATFORM_ADMIN_ROLES.has(role ?? '')
}
```

**Layer 1 — edge middleware** (`route-helpers.ts` + `middleware.ts`):

- Add `ADMIN_PATHS = ['/admin']` and extend the `RouteClassification` union with
  `{ type: 'admin' }`; `classifyRoute` checks `ADMIN_PATHS` first.
- In `middleware.ts`: treat `admin` like `business` for the unauthenticated
  redirect, then add an admin branch that uses `isPlatformAdmin` (not
  `isBusinessRole`) and redirects non-admins to `/{locale}`.

```ts
if ((route.type === 'renter' || route.type === 'business' || route.type === 'admin') && !session) {
  /* redirect to login (existing logic) */
}
if (route.type === 'admin' && session) {
  const role = extractSessionRole(session as { user?: { role?: unknown } | null })
  if (!isPlatformAdmin(role ?? undefined)) {
    return NextResponse.redirect(new URL(`/${locale}`, req.url))
  }
}
```

The matcher already covers `/(en|ja|zh)/:path*`, so `/admin` is matched without
config change.

**Layer 2 — server layout** (`(admin)/layout.tsx`), mirroring
`(business)/layout.tsx` but with `isPlatformAdmin`:

```ts
const [session, { locale }] = await Promise.all([auth(), params])
if (!session?.user) redirect(`/${safeLocale}/login`)
if (!isPlatformAdmin(session.user.role)) redirect(`/${safeLocale}`)
return <div className="flex flex-1"><AdminSidebar /><main className="flex-1 min-w-0">{children}</main></div>
```

This uses the full `auth()` (Node) — correct, because layouts run on the Node
server, not the Edge. Defence in depth: the middleware blocks at the edge; the
layout re-checks server-side so a misconfigured matcher can never leak the page.

**Why both layers:** the middleware is the fast edge gate but can be bypassed if
the matcher regresses; the layout is the authoritative server check. This mirrors
the existing operator-portal pattern exactly (middleware + `(business)/layout.tsx`).
*Learn: Defence in depth — never rely on a single guard for authz; the edge
check is an optimisation, the server check is the source of truth.*

### 3.3 Layout + sidebar (mirror the operator portal)

`packages/web/src/components/nav/AdminSidebar.tsx` — a near-copy of
`BusinessSidebar.tsx`, preserving the hydration-safe pattern verbatim:

- Same `LINK_CLASSNAME` static string + `aria-[current=page]:*` variants.
- Same `mounted` deferral of `aria-current` (the #25 fix).
- `useTranslations('admin')` (so labels resolve as `t('nav.overview')` /
  `t('nav.revenue')`), `Link`/`usePathname` from `@/i18n/routing`.
- `SIDEBAR_ITEMS` for this slice (labelKeys are under `nav.*`, resolved via
  `useTranslations('admin')` → `t('nav.overview')` / `t('nav.revenue')`; these
  are strings, distinct from the `admin.revenue` page object):
  - `{ href: '/admin', icon: LayoutDashboard, labelKey: 'nav.overview' }`
  - `{ href: '/admin/revenue', icon: Banknote, labelKey: 'nav.revenue' }`
    (`Banknote` from `lucide-react`).

Rule-of-three note (modules R9): `AdminSidebar` is the 2nd sidebar of this shape.
Copy now; if a 3rd appears, extract a shared `<NavSidebar items namespace>`. Do
**not** pre-abstract in this slice.

### 3.4 Revenue-tab placeholder

`(admin)/admin/revenue/page.tsx` — thin (≤80 lines), `getTranslations('admin')`,
renders:

- Page title + subtitle (`revenue.title`, `revenue.subtitle`).
- An empty-state card explaining the money-flow model so the placeholder is a
  useful spec for the follow-up: renter pays sticker price → platform Stripe
  collects full amount → platform retains **4%** → **remittance = paid − 4%**,
  aggregated **per business** (a business may have multiple stores) for the
  **monthly payout** (scope doc §2).
- A visible "Coming soon — gated on #461 (`payment_events`)" note.

A short code comment in the page links the follow-up: aggregation reads via a new
Hono API route (e.g. `GET /admin/revenue?month=YYYY-MM`) that sums successful
`payment_events` grouped by `operatorId`, computing gross / 4% fee / net. Out of
scope here.

### 3.5 i18n namespace plan

Add a new top-level `admin` namespace to **all three** `messages/{en,ja,zh}.json`
(parity gate is mandatory). Minimal keys for this slice:

```jsonc
"admin": {
  "nav":       { "overview": "Overview", "revenue": "Partner Revenue" },
  "home":      { "title": "Platform Admin", "subtitle": "Platform operations" },
  "revenue":   { "title": "Partner Revenue", "subtitle": "Monthly payout per partner",
                 "comingSoon": "Coming soon — depends on payment events (#461)",
                 "model": "Renter pays the listed price; the platform keeps 4%; remittance = paid − 4%, aggregated per business for monthly payout." }
}
```

Sidebar nav labels live under `admin.nav.*` (strings) and page strings under
`admin.home.*` / `admin.revenue.*` (objects), so the two never collide — note
`admin.revenue` is the page object, while the sidebar label is `admin.nav.revenue`.
Labels stay under `admin` (not the global `nav`) to keep the admin namespace
self-contained; final key shape settled during TDD.
**Reminder:** new namespace → `rm -rf packages/web/.next && bun run dev` before
manual verification, or keys render as `MISSING_MESSAGE`.

---

## 4. Files to Create / Modify

### Create (web)

| Path | Purpose |
|---|---|
| `packages/web/src/lib/platform-roles.ts` | `PLATFORM_ADMIN_ROLES` set + `isPlatformAdmin`; dependency-free, Edge-safe. |
| `packages/web/tests/lib/platform-roles.test.ts` | Unit tests for `isPlatformAdmin` (admits PLATFORM_ADMIN + legacy; rejects OPERATOR_*/RENTER). |
| `packages/web/src/app/[locale]/(admin)/layout.tsx` | Server guard (`isPlatformAdmin`) + admin chrome. |
| `packages/web/src/app/[locale]/(admin)/admin/page.tsx` | Admin home / overview placeholder. |
| `packages/web/src/app/[locale]/(admin)/admin/revenue/page.tsx` | Partner Revenue tab placeholder (money-flow spec + gated note). |
| `packages/web/src/components/nav/AdminSidebar.tsx` | Admin nav, mirrors `BusinessSidebar` (aria-current hydration pattern). |
| `e2e/admin-portal.spec.ts` | E2E: unauthenticated → login; (real-db lane) non-admin blocked, admin sees nav + revenue tab. |

### Modify (web)

| Path | Change |
|---|---|
| `packages/web/src/lib/route-helpers.ts` | Add `ADMIN_PATHS`, `{ type: 'admin' }` to the union, classify `/admin` first; add the pure `decideAdminAccess(...)` decision helper. |
| `packages/web/tests/lib/route-helpers.test.ts` | Add cases: `/admin` and `/admin/revenue` → `{ type: 'admin' }`; `decideAdminAccess` login/forbidden/allow. |
| `packages/web/src/middleware.ts` | Add admin branch (unauth redirect + `isPlatformAdmin` guard). |
| `packages/web/messages/en.json` | Add `admin` namespace. |
| `packages/web/messages/ja.json` | Add `admin` namespace (parity). |
| `packages/web/messages/zh.json` | Add `admin` namespace (parity). |

### API

**None.** The shell needs no data; no Hono route, no `packages/shared` change.
(Documented for the follow-up: revenue aggregation will add an API read route +
`payment_events` query under #461/#462-followup.)

---

## 5. TDD Vertical-Slice Breakdown (RED → GREEN, each shippable)

Each slice is independently committable and ends in working/observable behaviour.
Pure logic first (route classification + role gate) because it is the testable
core of the guard; UI follows.

### Slice 1 — Non-`PLATFORM_ADMIN` is blocked from `/admin` (the guard core)

**RED** (`platform-roles.test.ts`):
```ts
test('isPlatformAdmin admits PLATFORM_ADMIN', () => {
  expect(isPlatformAdmin('PLATFORM_ADMIN')).toBe(true)
})
test('isPlatformAdmin rejects operator and renter roles', () => {
  expect(isPlatformAdmin('OPERATOR_OWNER')).toBe(false)
  expect(isPlatformAdmin('OPERATOR_STAFF')).toBe(false)
  expect(isPlatformAdmin('RENTER')).toBe(false)
  expect(isPlatformAdmin(undefined)).toBe(false)
})
test('isPlatformAdmin admits legacy STAFF/ADMIN (transitional)', () => {
  expect(isPlatformAdmin('STAFF')).toBe(true)
  expect(isPlatformAdmin('ADMIN')).toBe(true)
})
```
**RED** (`route-helpers.test.ts`):
```ts
test('classifies /admin and subpaths as admin', () => {
  expect(classifyRoute('/admin')).toEqual({ type: 'admin' })
  expect(classifyRoute('/admin/revenue')).toEqual({ type: 'admin' })
})
```
**GREEN:** create `platform-roles.ts`; add `ADMIN_PATHS`/`admin` type to
`route-helpers.ts`. Mutation-resistant: exact `toEqual({ type: 'admin' })` and
explicit `true`/`false` per role (no `toBeTruthy`).

### Slice 2 — Middleware wires the admin branch

**RED:** a middleware-logic test. Because `middleware.ts` couples `NextAuth` +
`intlMiddleware` (hard to unit-test directly), extract the **decision** into a
pure helper `decideAdminAccess({ routeType, session, locale })` in
`route-helpers.ts` returning `{ action: 'login' | 'forbidden' | 'allow' }`
(decided §6.1), and test that:
```ts
expect(decideAdminAccess({ routeType: 'admin', role: null }).action).toBe('login')
expect(decideAdminAccess({ routeType: 'admin', role: 'RENTER' }).action).toBe('forbidden')
expect(decideAdminAccess({ routeType: 'admin', role: 'PLATFORM_ADMIN' }).action).toBe('allow')
```
**GREEN:** implement the helper; `middleware.ts` calls it for the `admin` branch
(keeps the controller thin, makes the authz decision unit-testable — FC/IS:
decision is pure, the redirect I/O stays in the shell). The redirect itself is
exercised by the Slice 5 E2E.

### Slice 3 — Admin layout + sidebar render for an admin (working UI)

**RED:** component test for `AdminSidebar` (vitest + testing-library):
```ts
render(<AdminSidebar/> within NextIntlClientProvider with admin messages)
expect(screen.getByRole('link', { name: /partner revenue/i }))
  .toHaveAttribute('href', expect.stringContaining('/admin/revenue'))
```
**GREEN:** create `AdminSidebar.tsx` (copy hydration pattern) + `(admin)/layout.tsx`
with the `isPlatformAdmin` server guard. End state: `/admin` renders the sidebar
shell for an admin; the layout redirects non-admins.

### Slice 4 — Revenue-tab placeholder page

**RED:** page render test asserting the placeholder + money-flow copy:
```ts
expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
expect(screen.getByText(/4%/)).toBeInTheDocument()  // money-flow spec present
```
**GREEN:** `(admin)/admin/revenue/page.tsx` + `(admin)/admin/page.tsx`; add the
`admin` namespace to all three locale files; restart dev server.

### Slice 5 — E2E guard + nav (real-db lane)

**RED → GREEN:** `e2e/admin-portal.spec.ts`:
- unauthenticated visit to `/en/admin` → redirected to `/en/login?callbackUrl=...`.
- (real-db) a `RENTER` session hitting `/en/admin` lands on `/en` (forbidden).
- (real-db) a `PLATFORM_ADMIN` session sees the sidebar + a "Partner Revenue"
  link, and `/en/admin/revenue` shows the coming-soon placeholder.

Run the full CI gate locally after each green slice: biome, `lint:size`,
`lint:modules`, `lint:i18n-parity`, `vitest run`.

---

## 6. Decisions (approved) + Residual Risks

### 6.1 Decisions (approved 2026-06-06)

The four open questions were resolved by approving the plan's recommended
defaults. These are now binding for this slice:

1. **Route prefix = `/admin`** (DECIDED). Clear, parallels `/manage`; no
   collision (no existing `admin` route in the app tree). Reflected in the
   `(admin)` route group, `ADMIN_PATHS`, and all URLs (`/{locale}/admin`,
   `/{locale}/admin/revenue`).

2. **Admit legacy `STAFF`/`ADMIN` into `/admin`** (DECIDED). They are
   transitional platform-admin equivalents (`schema.ts:23`, "no new users get
   them"). They are admitted via the single named constant `PLATFORM_ADMIN_ROLES`
   in `lib/platform-roles.ts` — tightening to `PLATFORM_ADMIN`-only later is one
   edit to that constant. Matches the `business-roles.ts` precedent and the
   schema comment.

3. **Extract a pure `decideAdminAccess(...)` decision function** (DECIDED).
   `middleware.ts` stays a thin shell; the authz rule lives in a unit-tested,
   mutation-resistant pure function (`route-helpers.ts`) returning
   `{ action: 'login' | 'forbidden' | 'allow' }`. The redirect itself is covered
   by E2E. FC/IS: decision is pure, the redirect I/O stays in the shell.

4. **No `src/modules/admin/` folder this slice** (DECIDED). The shell is small
   (sidebar + 2 pages + a roles lib); per modules.md it does not warrant a module
   yet — nav lives in `components/nav/`, the roles gate in `lib/` (alongside
   `business-roles.ts`), pages stay thin. Introduce `src/modules/admin/` when the
   revenue tab gets real data + an API client.

### 6.2 Residual risks (informational — no decision required)

1. **`PLATFORM_ADMIN` is also a business role today.** `BUSINESS_ROLES` includes
   `PLATFORM_ADMIN`, so an admin can also enter `/manage/*`. This is intended
   (super-admin) and unchanged by this slice — flagged so it is a conscious
   decision, not a leak. No action unless we later want to scope admins out of
   `/manage`.

2. **Navbar / view-mode switching.** The top `Navbar` + `view-mode.ts` toggle
   only `renter`↔`business`. This slice does **not** add an admin entry to the
   global nav or view switcher (admins reach `/admin` directly). A header link to
   `/admin` is a deliberate follow-up (deferred).

3. **i18n dev-server restart.** New `admin` namespace will render
   `MISSING_MESSAGE` until `rm -rf packages/web/.next && bun run dev`. Operational
   risk only; called out so manual verification isn't mistaken for a bug.

---

## 7. Acceptance Criteria (mapped to issue #462)

| Issue acceptance | This slice |
|---|---|
| Platform-admin-only portal (`PLATFORM_ADMIN` role / env-gated) | **Met.** `/admin` guarded at edge (middleware) + server (layout) via `isPlatformAdmin`; non-admins redirected. (Role-gated; "env-gated" handled by who holds the role — no extra env flag added.) |
| Third dashboard, separate from renter + operator portals | **Met.** New `(admin)` route group with its own layout + sidebar, distinct from `(renter)` and `(business)`. |
| Revenue tab | **Partially — placeholder only (by design).** Tab exists, renders the money-flow spec + "gated on #461" note. Aggregation is explicitly out of scope (table doesn't exist yet). |
| Aggregate successful `payment_events` per partner → gross / 4% / net, grouped monthly | **Deferred (gated on #461).** Documented as the follow-up; placeholder states the exact formula (remittance = paid − 4%, per business, monthly). |
| Read-only for MVP | **Met.** No write actions in the shell. |

**Definition of done for THIS slice:** all five TDD slices green; full CI gate
passes locally (biome, lint:size, lint:modules, lint:i18n-parity, vitest);
`/admin` reachable only by platform admins with a working nav + a revenue-tab
placeholder; no schema/API changes; follow-up for aggregation captured.

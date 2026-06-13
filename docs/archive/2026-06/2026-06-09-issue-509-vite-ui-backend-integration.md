# Plan — Finish Vite UI/backend integration for demo-ready MVP pivot

> **Issue:** #509 · **Epic:** #385 (marketplace MVP) · **Migration:** #378 (Vite/TanStack + CF Pages) · **Demo path:** #488
> **Trunk:** `marketplace-pivot` · **Date:** 2026-06-09 · **Status:** PLAN — awaiting review (no code yet)

## 1. Problem restated

The public Vite shell (landing, search, storefronts, vehicles — slices 5d-2/5d-3) is live and styled, but the **authenticated demo path is broken in three places**: there is no real login screen, no renter booking-creation UI, and no operator booking view in the active Vite app. Those surfaces still only exist in the **frozen Next.js** tree, so a stakeholder cannot click renter `search → book → confirmation → operator sees it` end to end. The visible blocker is `/$locale/login` rendering `Login (port pending)`.

This is a **UI integration + wiring** effort, not new product scope. No schema changes, no payments/IDV/R2 (non-goals from the issue).

## 2. Verified current state (ground truth, read from `origin/marketplace-pivot`)

**Backend (API) — already done, just needs a UI client:**
- `POST /auth/google/start` → 302 to Google (sets HttpOnly state cookie). `GET /auth/google/callback` → mints session cookie, 302 to `postLoginRedirect`. `GET /auth/session` → `ok()` envelope `{ user:{id,role,name?,email?,image?}, csrfToken }` or 401. `POST /auth/signout` → 204 (CSRF-gated). (`packages/api/src/routes/auth.ts`)
- CSRF middleware (`middleware/csrf.ts`) skips safe methods **and unauthenticated requests** (no session cookie → `next()`), so `POST /auth/google/start` needs no CSRF token; `POST /bookings` and `/auth/signout` **do** (echo `X-CSRF-Token: session.csrfToken`).
- OAuth config resolved from env: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL` (→ `redirectUri = ${AUTH_URL}/auth/google/callback`, `postLoginRedirect`), `AUTH_SECRET`, `DATABASE_URL` (pooled). Callback also needs a live DB (DrizzleOAuthAccountStore); absent ⇒ 503.
- `POST /bookings` contract (`createBookingSchema`): `requestedVehicleId`, `pickupLocationId`, `dropoffLocationId`, `insuranceOptionId?`, `startAt`/`endAt` (ISO), `notes?`, `idempotencyKey?`. `renterId` is **staff-override only**; renters derive identity from the session. Returns the booking incl. confirmation code. `GET /bookings` is operator-scoped by session; `GET /bookings/:id` for confirmation.

**Web (Vite shell) — what exists:**
- `vite/session.ts`: `fetchSession()` (401→null, unwraps envelope), `signOut(csrf)`, `sessionQueryOptions()`, `useSession()`. Navbar already consumes it.
- Guards live: `_renter.tsx` / `_business.tsx` layouts call `renterGuard`/`businessGuard`, redirect to `/$locale/login?returnTo=…` (renter) or `/$locale` (wrong role). Children are **placeholders**: `_renter/bookings.tsx`, `_business/dashboard.tsx`, and `login.tsx`.
- Public route `search.tsx`, `storefronts/$locationId.tsx`, `vehicles/*` done. **Book CTA is an inert `<button disabled>`** in `vite/storefronts/AvailableVehicleCard.tsx`; `StorefrontDetailView` holds `from`/`to`/`locationId` but does not pass them down.
- Pages proxy: `functions/auth/[[path]].ts` + `functions/api/[[path]].ts` forward same-origin `/auth/*` and `/api/*` to the API with `redirect:'manual'` (carries OAuth 302s). Vite dev proxies `/api`+`/auth` to the API (port 3001) per #497.

**Frozen Next.js (port source, do NOT revive):** `bookings/new/{page,VehicleBookingForm,BookingVehicleSummary}.tsx`, `bookings/confirmation/page.tsx`, `(renter)/bookings/page.tsx`, `(business)/manage/bookings/{page,BookingsCalendarView}.tsx`, `(business)/dashboard/page.tsx`. All use server actions / `next/navigation` / `next-intl` that must become loaders + `useNavigate` + `use-intl`.

## 3. Key decisions (resolved)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Google OAuth only** — no dev-login seam. Login screen = "Continue with Google". | User choice. Local demo uses a real OAuth client with `http://localhost:3001/auth/google/callback` allowlisted; runbook documents the setup. |
| D2 | Login triggers OAuth via a **real navigation** (`<form method="POST" action="/auth/google/start">` or `window.location` form-submit), **not `fetch()`** | The browser must follow the 302 to Google; `fetch` cannot follow a cross-origin opaque redirect. |
| D3 | Booking routes live **under the `_renter` guard** (`$locale/_renter/bookings/new`, `/confirmation`) | Free login-redirect + `returnTo` with no extra code; identity comes from session. |
| D4 | Operator proof = **bookings list** (status + renter + dates + vehicle), not react-big-calendar | "Prove it landed" needs a list; the calendar is heavy (bundle/dist-size budget) → deferred follow-up. |
| D5 | Pickup = dropoff for the MVP demo (single-location storefront) | `createBookingSchema` requires both; storefront gives one `locationId`. |

**Open gap (P1):** `returnTo` is not threaded `google/start → callback → postLoginRedirect` (server hardcodes `postLoginRedirect`). For the demo, post-login lands on the default origin route; honoring `returnTo` end-to-end is a small API follow-up, out of scope here unless trivial.

## 4. The three parts (vertical slices — each ships demo-able with tests)

### Part 1 — Auth & login (P0, unblocks everything)
**Goal:** real `/$locale/login` that signs a renter/operator in and keeps them logged in across navigation.
- Replace `routes/$locale/login.tsx` placeholder with a `vite/auth/LoginCard` (use-intl strings, Tailwind): heading, "Continue with Google" submitting `POST /auth/google/start` (D2), carries optional `returnTo`. If already authenticated (`useSession`), redirect to `returnTo`/home.
- Verify `vite/session.ts` 401 handling is quiet in the UI (no error toast/log for signed-out) — P0 req "expected 401s must not look like app errors". Suppress the alarming dev log for the expected session 401 (P1) without hiding real failures.
- Confirm `globals.css` is imported in the Vite entry (`main.tsx`/`__root`) so the screen is Tailwind-styled (P0 req).
- **i18n:** new `auth`/`login` namespace, en/ja/zh.
- **Tests (TDD):** component test — renders Google button, posts to `/auth/google/start`, authenticated session redirects away; guard redirect already covered. `lint:i18n-parity` green.
- **Acceptance:** `/en/login` no longer shows "Login (port pending)"; after Google round-trip the session persists across route changes (navbar shows the user).

### Part 2 — Renter booking path (P0)
**Goal:** `search → storefront → vehicle → book → confirmation code`, fully clickable.
- `vite/storefronts/StorefrontDetailView` passes `locationId`/`from`/`to` into `AvailableVehicleCard`; enable the book CTA → `navigate({ to:'/$locale/bookings/new', search:{ vehicleId, locationId, from, to } })` (typed optional search params — memory gotcha: `field?: T | undefined`).
- New route `$locale/_renter/bookings/new` (under guard): loader fetches storefront detail + insurance options for the range; renders `BookingVehicleSummary` (vehicle/dates/rate, port) + `InsurancePicker` (select + decline). Submit → `POST /bookings` with `X-CSRF-Token` from session, body = D3 contract (pickup=dropoff, D5) → on success `navigate` to confirmation.
- New route `$locale/_renter/bookings/confirmation` (under guard): loader `GET /bookings/:id`; renders success + **confirmation code** (`/^[2-9A-HJ-NP-Z]{8}$/`), insurance snapshot, fees, CTAs. `PreAuthHandoffCard` port optional (P1).
- Restructure the `_renter/bookings.tsx` placeholder into `bookings/index.tsx` = renter's own bookings list (`GET /bookings` renter-scoped). **Regenerate `routeTree.gen.ts` via `vite build` and stage it** (memory gotcha) before typecheck.
- Reuse pure `@/lib` helpers only (`formatJpy`, `cn`) — no `@/modules/*` deep imports (`lint:modules`). Vite shell owns its DTOs.
- **i18n:** `booking` namespace en/ja/zh, ICU plurals where the frozen UI used `{count}`.
- **Tests (TDD):** form posts correct body incl. CSRF header; confirmation renders the code; book CTA carries the 4 params; loaders gate on a valid JST range.
- **Acceptance:** a logged-in renter completes the path against a fresh seeded Neon branch and sees a confirmation code.

### Part 3 — Operator booking view (P0)
**Goal:** operator owner logs in and sees the booking landed.
- Replace `_business/dashboard.tsx` placeholder: dashboard stat cards (port `dashboard/page.tsx`, `GET /stats`) — small, optional but cheap.
- New route `$locale/_business/bookings` (under `_business` guard): loader `GET /bookings` (operator-scoped); render a list — `BookingStatusBadge` + renter name + dates + vehicle/plate. Tenant isolation already enforced server-side (operator-2 cannot see operator-1).
- **i18n:** `operatorBookings` keys en/ja/zh.
- **Tests (TDD):** list renders seeded + newly-created booking; wrong-role redirect covered by guard.
- **Acceptance:** `owner@best-car-rental.local` authenticates and sees the seeded/new booking in the Vite business UI.

## 5. Cross-cutting (done as part of the slices, finalized last)

- **Runbook** (`docs/runbooks/2026-demo-runbook.md`): update §2 cold-start with the **exact** env block (`AUTH_GOOGLE_ID/SECRET`, `AUTH_URL=http://localhost:3001`, `AUTH_SECRET`, pooled `DATABASE_URL`), Google console redirect-URI allowlist step, fresh-Neon-branch guidance, seeded demo accounts (`sarah@example.test` / `owner@best-car-rental.local`), and **Vite** route paths (`/$locale/login`, `/bookings/new`, `/bookings/confirmation`, `/$locale/bookings` business) replacing the old Next `/manage/*` paths in §4.
- **E2E (#501):** rewrite/re-enable `e2e/real-db/marketplace-happy-path.auth.spec.ts` to drive the **Vite** routes (it currently `testIgnore`s the deferred booking/admin specs and targets the Next app). Keeps the mint-session helper + real-DB lane (postgres-js API server) as the automated merge gate; assert confirmation-code regex + operator sees the booking. Public-route smoke already green.
- **Gates (run the full ci.yml list locally before claiming green):** `bun run --filter @kuruma/web typecheck` (default + frozen tsconfig), `lint`, `lint:modules`, `lint:i18n-parity`, `lint:dist-size`, web vitest, api tests, `vite build` (regen routeTree), real-DB E2E lane.

## 6. Risks

| Risk | Mitigation |
|------|-----------|
| Local Google OAuth setup friction (per D1) | Runbook step-by-step; `http://localhost` redirect URIs are allowed by Google for testing. Callback needs a live Neon branch (DrizzleOAuthAccountStore). |
| OAuth callback 503 if `DATABASE_URL`/secrets absent | Document required env; surface a friendly "sign-in not configured" state instead of a crash. |
| `returnTo` not honored end-to-end (open gap) | Accept default `postLoginRedirect` for the demo; file a small API follow-up. |
| New route files break typed Links until `routeTree.gen.ts` regenerated | `vite build` + stage the gen before typecheck (known gotcha). |
| Bundle/dist-size growth from booking + operator UI | Stay list-first (D4); `lint:dist-size` budget is at ~11% (large headroom). |
| Live preview blocked on CF `global_fetch_strictly_public` (#304) + `AUTH_URL` secret | Out of scope here; this issue targets **local** demo-readiness. Note the dependency in the runbook. |

## 7. Sequencing & estimate

1. **Part 1 (auth/login)** — unblocks the guarded routes. ~½ day.
2. **Part 2 (renter booking)** — depends on Part 1 for guard + session/CSRF. ~1–1.5 days (port + 2 routes + form).
3. **Part 3 (operator view)** — depends on Part 1; parallelizable with Part 2. ~½ day.
4. **Cross-cutting** (runbook + E2E rewrite + final gates). ~½ day.

**Complexity: MEDIUM.** Mostly porting + wiring; no schema/API changes. Each part is an independently mergeable vertical slice with its own tests.

## 8. Non-goals (from the issue)

No reviving Next.js as the demo surface; no payments/IDV/R2/partner-revenue scope; no schema changes unless a UI integration forces one; no production DNS/CF cutover.

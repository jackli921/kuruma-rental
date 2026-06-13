# Handoff — #616 operator order management (substitute / cancel / status + new-order red-dot)

**Last canonical-MVP gap.** Backend action endpoints are 100% built+tested; this issue is
web + one small read endpoint (now built). Plan = the #616 issue body (architect-reviewed).

## Where I am

- **Worktree:** `~/Dev/kuruma-616-order-mgmt`, branch `feat/616-order-mgmt`, off `origin/marketplace-pivot`
  (trunk = `marketplace-pivot`, **NEVER** `main`). Base was `0f31c51`.
- **#616 claimed:** assigned `@me` + claim comment posted.
- **Slice 1 DONE + committed** (`fe01733`). Slices 2–6 remain.
- `bun install` already run in the worktree.

### Slice 1 (committed `fe01733`) — API `GET /bookings/:id/substitution-candidates`
- `packages/api/src/services/booking.ts` → new `findSubstitutionCandidates(ctx, bookingId)`:
  authorizes via tenant-scoped `bookingRepo.findById` (foreign/missing → `undefined` → route 404),
  then `vehicleRepo.findAll(ctx, {status:'AVAILABLE', limit:200})` filtered to same `pickupLocationId`,
  `!== assignedVehicleId`, and `sameAcrissClass()` (reuses the one-place rule). `findAll` already
  operator-scopes the fleet. Guards optional `this.vehicleRepo` with a DI-wiring throw.
- `packages/api/src/routes/bookings.ts` → new route, gated `isOperatorRole` (403 renter), 404 on null.
- 6 tests in `packages/api/tests/routes/bookings.test.ts` (renter 403, cross-tenant 404, exclude-assigned,
  different-location, different-class, non-AVAILABLE). **All green: api 1232 pass, tsc 0, boundaries OK.**
- **GOTCHA hit:** the new method pushed `booking.ts` past the **800-line HARD cap** (`lint:size`, blocks
  pre-commit). Fixed by extracting the result/input types to **`packages/api/src/services/booking-types.ts`**
  (pure type move: `CreateBookingInput`, `CreateBookingResult`, `BookingVerificationGate`, `SubstituteResult`,
  `StatusTransitionResult`, `CancelResult`). Repointed the 2 importers
  (`document-verification-gate.ts`, `tests/services/booking-thread.test.ts`). `booking.ts` now 769.

## Remaining slices (TDD, RED→GREEN each)

### Slice 2 — web data layer  `packages/web/src/vite/operator-bookings/api.ts`
Mirror the CSRF write pattern in `operator-add-ons/api.ts:48-91`: a `writeJson(path, method, body, csrfToken)`
helper sending `credentials:'include'` + `X-CSRF-Token`; `unwrap` from `@/lib/api-error`; base
`getApiBaseUrl()` from `@/vite/api-base`. In the component grab `useSession().data?.csrfToken ?? ''`
(`useSession` from `@/vite/session`; shape `{ user, csrfToken }`).
Add:
- `useUpdateBookingStatus()` → `PATCH /bookings/:id/status` body `{ status }`.
- `useCancelBooking()` → `POST /bookings/:id/cancel`; response carries `{ data: booking, cancellation }`
  (cancellation = fee tier — `ok(c, booking, 200, { cancellation })`, so it's a top-level envelope field).
- `useSubstituteVehicle()` → `POST /bookings/:id/substitute` body `{ newVehicleId, reason? }`.
- `substitutionCandidatesQueryOptions(bookingId)` → `GET /bookings/:id/substitution-candidates` (Vehicle[]).
- `pendingBookingsCountQueryOptions` → `GET /bookings?status=CONFIRMED&limit=N` (for slice 5).
- **On success invalidate the `['operator-bookings']` queryKey PREFIX** (TanStack prefix-matches list +
  calendar + count) **plus** the detail + events keys. **No optimistic UI** (server CAS 409s a lost race).
- Tests: `packages/web/tests/vite/operator-bookings/api.test.ts`. **RQ v5 gotcha:** mutationFn gets a 2nd
  ctx arg — assert `const [url, init] = fetchMock.mock.calls[0]!`. Verify `X-CSRF-Token` header is sent.

### Slice 3 — `BookingActionsPanel.tsx` (new)
Explicit `actionsFor(status)` — NOT "everything from the transitions map":
- **Status buttons** from `VALID_BOOKING_TRANSITIONS`: `CONFIRMED→[Mark active]`, `ACTIVE→[Mark completed]`.
- **Substitute** shown on CONFIRMED **or** ACTIVE (its own rule, not the map).
- **Cancel** CONFIRMED-only (the `/cancel` endpoint 409s on ACTIVE; ACTIVE-cancel is OUT of scope).
- COMPLETED/CANCELLED → read-only, no actions.
- Each destructive action behind a confirm `Dialog` (`@/components/ui/dialog`); buttons disabled while
  `isPending`; errors inline. Cancel dialog shows the returned `cancellation` tier/fee.
- **⚠️ VERIFY BEFORE CODING:** `VALID_BOOKING_TRANSITIONS` lives in `@kuruma/shared/db/schema` (the Drizzle
  file with `pgEnum`/runtime deps). Importing it into the web bundle may pull Drizzle in. Check whether web
  already imports from `@kuruma/shared/db/schema` safely (e.g. tree-shaken types) or whether there's a
  web-safe re-export. If risky, define a tiny local transitions map web-side and add a test asserting it
  matches the shared one. **Do not assume — confirm the import is clean (web `tsc` + bundle).**

### Slice 4 — `SubstituteVehicleDialog.tsx` (new) + wire route
- Lists candidates from `substitutionCandidatesQueryOptions`; empty state = "no eligible same-class vehicle
  at this location"; submit → `useSubstituteVehicle({ newVehicleId, reason? })`.
- Wire panel + dialog into `packages/web/src/routes/$locale/_business/manage/bookings/$bookingId.tsx`,
  **replacing the `{/* Actions reserved for phase 2 */}` placeholder (~lines 64-67)**. The route already
  loads `detail` (has `status`, `id`, `assignedVehicleId`) + events. Panel is `_business`-only.

### Slice 5 — new-order red-dot badge
- `pendingBookingsCountQueryOptions` (slice 2). Envelope has **no `total`** and caps the array at `limit`,
  so render **`count >= limit ? "{limit}+" : count`** (honest overflow, zero backend change). Hidden at 0;
  `role="status"` + `aria-label`.
- Badge on the **Bookings** item in **Vite** nav: `vite/nav/Navbar.tsx` + `vite/nav/MobileMenu.tsx`, keyed
  off `item.to === '/$locale/manage/bookings'`. Source of truth = `vite/nav/business-nav-items.ts` (8 items).
  **Do NOT touch** `components/nav/*` (frozen Next.js) or `routes/$locale/_business.tsx` (Outlet-only).
- `data-nav-count` test (`tests/vite/nav/Navbar.test.tsx`) counts items — a badge adds no nav item, so it
  should stay green; verify. (Nav-link conflict tax: Navbar + MobileMenu + that test.)
- **Known proxy limitation (document, don't fix):** dot = "open & not-yet-active", not "unseen" — a CONFIRMED
  booking already handled stays lit until ACTIVE/CANCELLED. The principled signal (unread
  `OPERATOR_BOOKING_ALERT` from the notification ledger) is a post-demo follow-up.

### Slice 6 — i18n + verify + PR
- Add `bookings.operator.detail.actions.*` (markActive, markCompleted, substitute, cancel, confirm copy,
  cancellation-tier line, empty-candidates) + a nav badge label to **all three** `messages/{en,ja,zh}.json`
  (existing section: `bookings.operator.detail`, which already has `actions: "Actions"`). **i18n-parity is a
  CI gate.**
- Verify: `bun run --filter @kuruma/api test`, `bun run --filter @kuruma/web test`, web `tsc`, `bun run lint`,
  and remember **`bun run lint` ≠ full CI** — i18n-parity / lint:size / export-drift / db-drift are separate.
  No schema change → db-drift stays green.
- PR base `marketplace-pivot`, body `Closes #616`. Then `/code-review`. Follow-ups: `RESEND_API_KEY` (email
  dispatch is built+inline, just ops config) + the notification-ledger red-dot upgrade.

## Gotchas / workflow notes
- **Pre-commit is slow** (husky + lint-staged: biome + lint:size on staged). Run `git commit` in background
  or expect ~8s. **Biome blocks on:** type-only imports (`import type`) + import sorting → run
  `bunx biome check --write <files>` before committing.
- **800-line HARD cap** on every file except `schema.ts` (grandfathered to 1000). Watch web files near cap.
- `findAll(operatorCtx)` auto-scopes to the operator (`operatorReadScope`); renter ctx → `'none'` → `[]`.
- `BookingService` ctor: `vehicleRepo`/`userRepo`/`vehicleClassRepo` are **optional** args → guard before use.
- No-force-push workflow; never reclaim a foreign worktree; rebase/merge onto `marketplace-pivot` not `main`.

## Resume command
```
cd ~/Dev/kuruma-616-order-mgmt && git status && git log --oneline -3
# then: Slice 2 — TDD operator-bookings/api.ts mutation hooks
```

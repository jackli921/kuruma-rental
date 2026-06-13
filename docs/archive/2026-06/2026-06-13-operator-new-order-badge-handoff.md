# Handoff — Operator in-app new-order red-dot badge (#611)

> **Screenshot step 7** (商家端 接订单 → 后台收到新订单**红点提醒** + 邮件通知).
> The **email alert is done**; the in-app red-dot badge does not exist.
> This needs a **design decision first** (what is "new"?), then a small implementation.
> Lower priority than #610 (email already covers the operator alert).

Date: 2026-06-13 · Issue: #611 · Base: branch off `origin/marketplace-pivot`.

---

## TL;DR

When a renter instant-books, the operator should see a red dot / count on the **Bookings**
nav item until they open the orders list. Email already fires (`OPERATOR_BOOKING_ALERT`).
There is **no unread/seen concept** in the system, so step 0 is choosing how to define
"new" — then build a count source + a `useNewBookingsBadge` hook + the nav badge.

## DESIGN — decide first (the crux of this issue)

`GET /notifications` (`packages/api/src/routes/notifications.ts`) is an **email-delivery
log**, not an inbox — it has no per-operator read/unread state. So "new order" must be
defined. Options:

| Option | How "new" is defined | Pros | Cons |
|---|---|---|---|
| 1. Count active | # of `CONFIRMED` upcoming bookings | trivial, no state | dot never clears until bookings complete — not really "new" ✗ |
| **2. localStorage last-seen** *(recommended)* | bookings with `createdAt > lastSeenAt`; visiting `/manage/bookings` sets `lastSeenAt = now` | no migration, matches "dot until you open orders", per-device | not cross-device; cleared if storage wiped |
| 3. Server last-seen | `bookings_last_seen_at` column on operator/user, set on list visit | robust, cross-device | needs migration + endpoint — heavier |

**Recommendation: Option 2 for MVP** (red dot until the operator opens the orders list),
leave Option 3 as a follow-up if cross-device "seen" is later required. The rest of this
handoff assumes Option 2.

## Scope (Option 2)

1. **Count source.** Confirm the operator bookings list row carries `createdAt`
   (check the `GET /bookings` operator projection / `RawOperatorBooking` in
   `vite/operator-bookings/api.ts`). If absent, either add `createdAt` to the projection
   **or** add a tiny `GET /bookings/new-count?since=<iso>` count endpoint (operator-scoped,
   cheap). Prefer reusing the list if it already returns `createdAt`.
2. **`useNewBookingsBadge()` hook** (`vite/operator-bookings/useNewBookingsBadge.ts`):
   - read `lastSeenAt` from localStorage (default = epoch / now-on-first-load),
   - query the count of bookings with `createdAt > lastSeenAt` (refetch on window focus +
     a light interval; React Query `refetchOnWindowFocus`),
   - expose `{ count }`.
   - A route effect on `/manage/bookings` writes `lastSeenAt = now` and invalidates the
     count query (so the dot clears when the operator opens the list).
3. **Badge render.** Add a red-dot + count to the **Bookings** nav item:
   - `packages/web/src/vite/nav/Navbar.tsx:38` (`{ to: '/$locale/manage/bookings', label: t('bookings') }`)
   - `packages/web/src/vite/nav/MobileMenu.tsx` (mirror)
   - Only in **business** view-mode (not renter). `aria-label` like "N new bookings".
4. **i18n** ×3 for the aria-label / count.
5. **Tests:** count derivation vs `lastSeenAt`, dot shows when count>0 / hidden when 0,
   clears after visiting the list, hidden in renter view-mode.

## ⚠️ Nav-conflict tax (read before touching nav)

Every change to the operator nav touches **three** files that 3-way-conflict with any
concurrent nav change: `Navbar.tsx`, `MobileMenu.tsx`, and the `data-nav-count` test.
This is tracked as **#603** (extract a shared `manageNavItems` array). **Strongly consider
landing #603 first** (or folding a minimal extraction into this PR) so the badge is added
in one place. If you don't, expect to resolve the nav count + both nav files by hand.

## Patterns to copy
- Operator-scoped cookie query: `vite/operator-bookings/api.ts` (`fetchOperatorBookings`).
- View-mode gating in nav: `vite/nav/Navbar.tsx` (the `viewMode === 'business'` branch).
- localStorage UI state: `vite/operator-fleet/useFleetViewMode.ts` (persisted hook pattern).

## Gotchas
- **No server unread state** — don't try to use `/notifications` as an inbox; it's email logs.
- **Don't poll aggressively** — operator portal is low-traffic; `refetchOnWindowFocus` + a
  slow interval (e.g. 60s) is plenty. Avoid a tight loop.
- **Business view only** — a renter in renter view-mode must not see an operator badge.
- **Clear-on-visit must be reliable** — set `lastSeenAt` in a route effect that fires on
  every mount of `/manage/bookings`, not just first navigation.

## Parallel / collision
- **#525** (live worktree) edits `operator-bookings/api.ts` — coordinate if you add a
  count fn there. Nav files are not currently held by another session, but #603 / any new
  `/manage/*` route would conflict — check open PRs first.

## Verification (gates before PR)
- `bun run --filter @kuruma/web test -- --run` green (incl. the `data-nav-count` test)
- `bun run --filter @kuruma/web typecheck` 0 · `bun run lint:i18n-parity` ×3
- pre-commit gate green · PR → `marketplace-pivot`, body `Closes #611`.

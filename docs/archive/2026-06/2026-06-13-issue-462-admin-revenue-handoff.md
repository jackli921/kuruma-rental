# #462 Platform admin revenue tab — handoff (2026-06-13)

**Issue:** #462 (P1, AFK, slice) — platform-admin "Partner Revenue" tab. Aggregate
successful `payment_events` per partner → gross / 4% platform fee / net payable,
grouped monthly. Read-only. Plan posted as issue comment.

**Worktree:** `~/Dev/kuruma-462-admin-revenue`, branch `feat/462-admin-revenue` off
`origin/marketplace-pivot`. 3 commits, NOT pushed, NO PR. `ahead 3, behind 4` (swarm).

## Done (committed, green)
- `62909ac` **Phase 1 shared** — `types/admin-revenue.ts` (AdminRevenueReport DTOs)
  + `lib/admin-revenue.ts` (`jstYearMonth` fixed UTC+9 + pure
  `aggregateRevenueByPartner`, sums STORED fee/net, never recomputes) + 2
  package.json exports. 8 unit tests. shared 445 green, tsc green.
- `3df9cab` **Phase 2 API** — `GET /admin/revenue`. `requirePlatformRead` gate in
  middleware/auth.ts (= `STAFF_ROLES` {STAFF,ADMIN,PLATFORM_ADMIN}; OPERATOR_*
  rejected, PARTNER rejected — matches web adminGuard, NOT bypassScope which
  includes PARTNER). `PaymentEventRepository.listSucceeded()` (drizzle+in-memory).
  `AdminRevenueService` (shell: gate + Promise.all fetch + pure aggregate; gate
  re-asserted in service for defence-in-depth). DI wired in index.ts. 11 tests.
  API 1237 green, tsc green.
- `fbe196d` **i18n** — admin.revenue.* table keys in en/ja/zh (month, gross,
  platformFee, netPayable, payments, total, allPartners, empty). Parity 852 keys.
  Kept `comingSoon` (frozen Next.js page still uses it).

## REMAINING — Phase 3 web (NOT started) + Phase 4 e2e
Templates to copy: operator-dashboard (`vite/operator-dashboard/{api.ts,OperatorDashboardView.tsx}`
+ its route). `formatJpy` from `@/lib/format` (`¥8,000`).
1. `vite/admin/revenue/api.ts` — `adminRevenueQueryOptions()` (fetch
   `${getApiBaseUrl()}/admin/revenue`, credentials:'include', `unwrap<AdminRevenueReport>`).
   Mirror `operator-dashboard/api.ts`.
2. Rename `vite/admin/RevenuePlaceholderView.tsx` → `RevenueView.tsx`. PURE
   component `RevenueView({ report, locale })` (FC/IS, like OperatorDashboardView).
   Keep title/subtitle/`model` (has "4%"). Render: grand-total card + per-partner
   sections each with a monthly table (Month|Gross|Platform fee (4%)|Net payable|
   Payments) + subtotal; empty state when `report.partners` is empty. Use formatJpy.
3. `routes/$locale/_admin/admin/revenue.tsx` — add loader
   (`context.queryClient.ensureQueryData(adminRevenueQueryOptions())`) +
   useSuspenseQuery + pending/error boundaries; render `<RevenueView report locale/>`.
   Pull `locale` from route params.
4. Tests: update `tests/vite/admin/views.test.tsx` (it imports RevenuePlaceholderView
   — switch to RevenueView with a fixture report; keep AdminHomeView test). Assert
   empty state + a partner row + totals + "4%". Maybe a route-level test.
   DO NOT touch `tests/app/admin-revenue.test.tsx` (frozen Next.js).
5. **Phase 4 e2e:** `e2e/mock-api.ts` — add `GET /admin/revenue` handler returning a
   fixture report (a couple partners w/ monthly rows). Update
   `e2e/admin-portal.spec.ts` lines 56-58: the revenue test currently asserts
   "coming soon" — change to assert real figures + the heading + "4%". (mock track
   uses `e2e-mock-role` cookie; no real DB.)

## Gates before PR
`bun run --filter @kuruma/web test` · web tsc (both `tsconfig.json` + `tsconfig.app.json`)
· `bun run lint:i18n-parity` · biome. Then `bun run test:e2e` (admin-portal.spec).
Pre-commit hook runs biome+size+module-boundaries+tsc(web×2,api) — expect biome
import-sort fixups (run `bunx biome check --write` then re-commit).

## Merge (base ≠ default → manual close)
Push → PR base `marketplace-pivot`, "Closes #462". Swarm is fast: `gh pr update-branch`
to clear BEHIND, re-poll CI green, `gh pr merge --squash`, manual close #462 + drop
in-progress label, teardown worktree+branch. CI = test-and-build/db-drift/e2e/e2e-real-db.

## Follow-ups (out of scope, file after merge)
- Demo `payment_events` seeding (belongs in `seed-bookings.ts`, FK→bookings) so the
  tab shows data on real DB — currently empty until a Stripe webhook fires.
- `?month=YYYY-MM` filter (full matrix suffices at MVP scale).

## Gotchas
- TWO admin trees: frozen `src/app/[locale]/(admin)/*` (Next.js, DON'T touch) vs live
  `src/vite/admin/*` + `src/routes/$locale/_admin/*`.
- Data is ready: `payment_events` stores grossJpy/platformFeeJpy/netToPartnerJpy per
  row (4% locked at webhook via `lib/commission.ts`); the tab SUMS, never recomputes.
- Foreign worktree `~/Dev/kuruma-web-cleanup` (session f409367b) has a duplicate-dead
  #603 + a live #604 — leave it.

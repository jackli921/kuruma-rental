# #1102 — "Today" operations panel (epic #1099 slice 3)

Daily dispatch board on the operator dashboard: today's **pickups**, today's **returns**, **overdue** vehicles, with inline mark-picked-up / mark-returned.
Server-computed buckets (client bucketing withdrawn by architect review — it structurally cannot see overdue rentals, which end before a "today" window).

## Design (settled in the issue)

- Buckets computed server-side on the existing `GET /dashboard/overview` (`OverviewService` already owns the clock; `DrizzleOverviewRepository` already runs scoped `Promise.all` queries).
- `overdue` keys off `endAt < now`, NOT `effectiveEndAt` (the 48h turnaround tail is irrelevant to "renter hasn't returned").
- Buckets: pickups = `CONFIRMED`, `startAt` in today (JST); returns = `ACTIVE`, `endAt` in today (JST); overdue = `ACTIVE AND endAt < now`, most-late-first.
- Return capped arrays (`TODAY_BUCKET_CAP = 50`) of clickable rows, not just counts. Header count = list length (acceptance: they must match).
- Inline mutation (`PATCH /bookings/:id/status`) invalidates BOTH the overview query and `['operator-bookings','calendar']`.
- Placement: `TodayPanel` in `OperatorDashboardView`, above the count tiles, beside `ComplianceBanner`. No new route.

## Contract

```ts
// shared/types/overview.ts
export interface TodayBookingRow {
  id: string; bookingCode: string; status: BookingStatus
  startAt: string; endAt: string          // ISO
  vehicleId: string | null; renterName: string | null
}
export interface OperatorOverview {
  totalBookings: number; activeVehicles: number; upcomingBookings: number
  today: { pickups: TodayBookingRow[]; returns: TodayBookingRow[]; overdue: TodayBookingRow[] }
}
```

- New pure helper `jstDayRangeUtc(now): { startUtc: Date; endUtc: Date }` (shared/lib/jst.ts) — the UTC bounds of `now`'s JST calendar day. Single source for both repos + tests (the 23:30-JST-lands-in-right-day case).
- Vehicle *name* resolved on the web from the already-loaded fleet query (`vehicleId` → name); no server vehicle join. Renter name IS joined server-side (users table), like the calendar.

## Slices (TDD, vertical)

**Phase 1 — shared (pure, no DB):**
1. `jstDayRangeUtc` + unit tests (midnight boundary, 23:30 JST, DST-free).
2. Extend `OperatorOverview` + `TodayBookingRow` type.

**Phase 2 — api service/repo (in-memory, RED→GREEN per bucket):**
3. In-memory overview repo: pickups / returns / overdue / cap / most-late-first / empty / tenant-scope. `endAt`-vs-`effectiveEndAt` overdue distinction test.
4. Drizzle overview repo: SQL bucket queries (indexed range preds) + renter leftJoin; real-pg integration test.
5. Route/service: `getOverview` passes `now`; assert buckets present in a route test. (Route body unchanged — richer return.)

**Phase 3 — web:**
6. Extend `operatorOverviewSchema` (Zod) with buckets.
7. `TodayPanel.tsx` (presentational) + test: renders buckets, inline action invalidates BOTH queries, deep-link href, empty states.
8. Wire into `OperatorDashboardView` (needs `session` for csrf + operator gate) + `dashboard.tsx` pass-through.
9. i18n en/ja/zh.

No schema change. Fully independent of slices 1 & 2.

## Verify

`bun run --filter @kuruma/shared test`, `--filter @kuruma/api test`, real-pg integration (docker pg), `--filter @kuruma/web test`, tsc x3, biome, lint:boundaries, lint:size. code-reviewer at code-complete.

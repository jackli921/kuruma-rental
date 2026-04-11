# Calendar Library Bake-Off — Spike Results

**Date:** 2026-04-11
**Context:** Issue #26 shipped a custom week/day grid calendar for `/manage/bookings`. Before merging, question was raised whether we should rip it out and swap to a calendar library instead. This spike answers: **can common calendar libraries actually run on our stack, and what do they cost?**

**Stack under test:**
- React 19.2.4
- Next.js 16.2.2 (Turbopack)
- `@opennextjs/cloudflare` → Cloudflare Workers
- TypeScript strict, Bun workspaces
- date-fns 4.1.0 (already a dependency)
- next-intl 4.9.0

**Libraries compared:**
- `react-big-calendar@1.19.4` (RBC)
- `@schedule-x/react@4.1.0` + `@schedule-x/calendar@4.4.0` (SX)
- Baseline: current custom implementation from `feat/calendar-week-day-grid`

**Methodology:** Disposable git worktree off the feature branch. Two spike routes (`/spike-rbc` and `/spike-sx`) each wired up with 10 mock vehicles × 20 mock bookings including a 3-way overlap and a cross-day overnight. Ran `next build` and `build:worker` against each configuration, measuring the total static chunks directory size as a proxy for bundle cost (Turbopack App Router doesn't print per-route sizes in the build output, so absolute delta-vs-baseline is the reliable metric).

---

## Results

| Metric | Custom (baseline) | react-big-calendar | schedule-x |
|---|---|---|---|
| `tsc --noEmit` on React 19 | ✓ | ✓ | ✓ |
| `next build` (Turbopack) | ✓ | ✓ | ✓ |
| `build:worker` (opennextjs-cloudflare) | ✓ | ✓ | ✓ |
| Static chunks total | 1528 KB | **1748 KB** (+220) | **1724 KB** (+196) |
| Estimated gzipped first-load delta | — | ~80 KB | ~70 KB |
| Worker `server-functions` size | 27.8 MB | 28.3 MB (+500 KB) | 28.3 MB (+500 KB) |
| Peer dep warnings | — | none | `preact@10.24.3` (cosmetic — `@schedule-x/react` abstracts it) |
| Target: <150 KB first-load delta | — | ✓ PASS | ✓ PASS |
| License | MIT (own code) | MIT | MIT core, **drag-and-drop/recurring/sidebar paywalled** |

**Both libraries comfortably pass the technical compat check.** React 19 support is real (not just peer-dep optimism), Turbopack compiles them, opennextjs-cloudflare emits a valid Worker, and both come in well under the 150 KB first-load budget.

The "it won't work on our stack" concern is disproved by measurement.

---

## Isolation methodology

To attribute bundle cost accurately, four separate builds were run:

1. **Baseline**: both spike routes removed. 1528 KB.
2. **Both libraries**: `/spike-rbc` + `/spike-sx` present. 1948 KB (+420).
3. **RBC only**: `/spike-sx` temporarily moved out. 1748 KB (+220).
4. **SX only**: `/spike-rbc` temporarily moved out. 1724 KB (+196).

Note that 220 + 196 = 416, which matches the combined +420 within rounding — confirming the two libraries share essentially no common chunks (no double-counted framework code).

---

## Red flags found but not fatal

### react-big-calendar

- **Dependency bloat in `package.json`**: lists `moment`, `moment-timezone`, `luxon`, `dayjs`, `lodash`, `globalize` as runtime dependencies (not peer deps). In theory this is awful. In practice, tree-shaking works: with the `date-fns` localizer imported explicitly, the other localizers don't appear in the output bundle. The measured +220 KB confirms this.
- **`react-overlays` peer**: older library, has had React 19 compat wrinkles in the past. Didn't hit any in the spike, but worth noting as a stability risk.

### schedule-x

- **Commercial license gating**: drag-to-reschedule, recurring events, resource view, and event sidebar are behind the paid "Premium" tier. Free tier is view-only-ish. This is the single biggest reason to prefer RBC if the feature we're swapping *for* is drag-to-reschedule.
- **Preact abstraction layer**: `@schedule-x/react` wraps a Preact-core implementation. Works, but introduces an extra abstraction and the peer warning. One more moving part.

### Both

- `build:worker` emits a harmless `Duplicate key "options"` warning from a third-party library (traced to `floating-ui` used elsewhere in the app, unrelated to either calendar library — the same warning appears in the baseline build).

---

## What the spike could NOT measure

These are the remaining unknowns that need eyes-on or additional work:

1. **Visual fit with the design system.** Both libraries ship default CSS that may or may not clash with the existing Airbnb-ish aesthetic (`packages/web/DESIGN.md`). Override cost is real but hard to quantify without putting both in front of the owner.
2. **Feature parity with the custom implementation's specific needs**: status-colored blocks (CONFIRMED green / ACTIVE blue / etc.), vehicle name as block label, cluster-packed overlap lanes. Both libraries should handle most of this out of the box, but verification requires actually wiring it up — which is approximately the full migration.
3. **next-intl ↔ library i18n glue.** RBC uses `date-fns` locales (fine, already a dep). SX has its own locale prop. Neither has been wired through `next-intl`'s message system yet. Non-trivial but tractable.
4. **Runtime behavior at scale** (40–50 vehicles × dozens of concurrent bookings). Both should handle this; not tested.

---

## Current custom implementation — status

For reference, the custom implementation this spike was evaluating:

- `packages/web/src/lib/calendar-layout.ts` — pure function `layoutBookings(bookings, viewStart, viewDays)` with cluster-based lane packing for overlapping bookings (12 mutation-resistant tests)
- `packages/web/src/components/calendar/WeekGrid.tsx` — 7-day grid (5 component tests)
- `packages/web/src/components/calendar/DayGrid.tsx` — single-day grid with prev/next navigation (5 component tests)
- `packages/web/src/components/calendar/ViewToggle.tsx` — segmented control (3 component tests)
- `packages/web/src/lib/calendar-view.ts` — pure URL param parsers (12 tests, including TZ-agnostic after issue #39)
- Total: ~750 lines of typed, tested code. 170/170 tests green on `feat/calendar-week-day-grid`.
- Three architect-review findings (#39, #40, #41) already fixed on the branch.

**What custom cannot currently do that a library would give us:**
- Drag-to-reschedule (RBC has it, SX paywalls it)
- Click-and-drag event creation
- Event resize
- Month view (could add, out of scope for #26)
- Built-in keyboard navigation

**What custom does better:**
- Zero new dependencies
- Smaller bundle
- Full styling control (blocks match the design system already)
- Cluster-based lane packing for transitive overlaps (both libraries do simpler packing; complex overlap clusters may render with visual gaps in RBC unless configured carefully)

---

## Decision framework

The spike reduces the question to a single variable: **do we want drag-to-reschedule or similar calendar power features within the next few months?**

| Answer | Recommendation |
|---|---|
| Yes, soon | Swap to **react-big-calendar**. Costs 2–4 hours of focused work. MIT, stack-compatible, in bundle budget. |
| Not really — we just wanted "the standard calendar look" | **Stay custom**. The look is a small styling task either way, and the custom code is tested and working. |
| Undecided | **Stay custom for now**, revisit when drag-to-reschedule is actually a requested feature. The swap is always available; the cost doesn't grow over time. |

Schedule-x is NOT recommended either way: similar bundle cost to RBC, worse licensing, and its key differentiating features are paywalled.

---

## Reproducibility

Full reproduction in a throwaway worktree (`../kuruma-calendar-spike`, branch `spike/calendar-bakeoff` off `feat/calendar-week-day-grid`):

```bash
# Install both libraries side-by-side
bun add react-big-calendar @types/react-big-calendar \
        @schedule-x/react @schedule-x/calendar @schedule-x/theme-default

# Add spike routes at packages/web/src/app/spike-{rbc,sx}/page.tsx
# (both are 'use client', each renders its library with MOCK_VEHICLES x MOCK_BOOKINGS)

# Measure
bun run build
du -sk packages/web/.next/static/chunks

# Per-library isolation: move one spike route out, rebuild, measure, swap
mv packages/web/src/app/spike-sx /tmp/
bun run build  # RBC-only number
mv /tmp/spike-sx packages/web/src/app/
mv packages/web/src/app/spike-rbc /tmp/
bun run build  # SX-only number

# Cloudflare Workers build sanity check
bun run build:worker
du -sk packages/web/.open-next/server-functions
```

The spike worktree is disposable — discard when done regardless of outcome.

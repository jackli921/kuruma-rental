# Path to GA — Feature-Flag Audit (2026-07-04)

## Why this exists

The tracked roadmap is built.
The marketplace MVP epic (#385), the platform-owner dashboard (#1075), and the operator-calendar overhaul (#1099) all have every slice closed.
Most of that finished work is **dark**: complete, merged, and tested, but hidden behind feature flags that are switched **off** in production.

This doc inventories every feature flag, states what is built behind it and why it is still off, and gives a prioritized path to turning it on.
The highest-ROI work available is not building more — it is closing the gaps that keep already-paid-for features from reaching users.

## How a flag resolves (the control plane)

Single source of truth: `packages/shared/src/feature-flags/registry.ts`.

```
effective(key) = override[key] ?? (serverOnly ? serverDefault : buildTimeEnv) ?? false
```

- **Build-time default:** each web flag reads a literal `import.meta.env.VITE_FEATURE_*` (Vite inlines it at build).
- **Runtime override:** a platform admin can flip a `runtimeControlled` flag live via the admin switchboard; it writes a row to the override-only `feature_flags` table (control plane shipped in #1322).
- **serverOnly** flags (only `SHARED_CATALOG` today) carry no web env — they floor to `serverDefault` and are enforced by the API.

### Production reality (verified)

`deploy.yml`'s web build step sets **only** the Sentry `VITE_*` vars — **no `VITE_FEATURE_*`, no `VITE_SEARCH_MAP_ENABLED`**.
The `feature_flags` table is override-only with **no seed rows**.
Therefore, in production today: **every runtime web flag is OFF**, except `SHARED_CATALOG` (serverDefault ON).

**Consequence:** a `runtimeControlled` flag can be turned on **live, with no deploy**, by the platform admin toggling it in the dashboard.
A build-time-only flag needs either a deploy that sets its `VITE_FEATURE_*=true` or the small #1322 migration to make it toggleable.

## The tiers (prioritized)

| Tier | Meaning | Flags |
|------|---------|-------|
| **0** | Already on | `SHARED_CATALOG` |
| **1** | Complete, runtime-controlled — **flip on now, zero code** (a go-live decision, not engineering) | `REVIEWS`, `CANCELLATION`, `OPERATOR_BLOCKS`, `OPERATOR_TEAM`, `OPERATOR_SETTINGS`, `MULTI_CURRENCY`, `OPERATOR_MANUAL_BOOKING` (polish-later) |
| **2** | Complete but **build-time only** — ~2h migration to the runtime hook (#1322), then flip | `OPERATOR_TODAY`, `CALENDAR_QUICKVIEW` |
| **3** | Complete, last engineering gate **cleared** (PR #1469 merged) — now flip-ready, joins Tier 1 | `FLEET_TIMELINE` (was → #1349 a11y) |
| **4** | **Product decision or larger build** before it can go on | `RENTER_DOCUMENTS`, `MESSAGING`, `VITE_SEARCH_MAP_ENABLED` |

## Per-flag detail

### Tier 0 — already on

**`SHARED_CATALOG`** (serverOnly, serverDefault ON) — platform kill-switch for the shared add-on template catalog (#1437).
Fully wired: web floors to `serverDefault`, API enforces the picker + create paths, tests cover the flooring.
No work.

### Tier 1 — flip on now (zero code)

Each is complete end-to-end (UI + API + tests + i18n en/ja/zh) and read via `useFeatureFlag(...)`, so the admin switchboard turns it on live.

- **`REVIEWS`** — Reviews & ratings. Post-trip prompt, operator rate-renter, public rating badges + review lists, double-blind reveal, moderation queue. Eligibility guards are server-side. No gate. (#1067/#1083/#1085/#1086/#1449/#1448 closed.)
- **`CANCELLATION`** — Self-service cancellation with tiered fee settlement, renter + operator flows. Pre-GA authz gaps (#1367/#1363) closed. No gate. (#868 closed.)
- **`OPERATOR_BLOCKS`** — Maintenance blocks on the calendar: create/detail/delete, scope-gated, overlap 409, admin read-only preview. Fully migrated to the runtime hook. No gate. (#1101 closed.)
- **`OPERATOR_TEAM`** — Staff invite/revoke, member roles, deactivation; tenant-scoped writes. No gate. (#904 closed.)
- **`OPERATOR_SETTINGS`** — Operator name + pre-auth payment-handoff URL; owner-only write, audit-logged. No gate. (#903/#914 closed.)
- **`MULTI_CURRENCY`** — Indicative "≈ $X" display beneath JPY. **Display-only** — the Stripe path is provably JPY-only, and missing FX rates degrade to JPY, never block. No gate. (#1070 closed.)
- **`OPERATOR_MANUAL_BOOKING`** — Walk-in + existing-customer manual booking (discriminated `renterId` XOR `walkInCustomer`). Functional; docs note "polish open" (UX refinement per operator trial), **not** a blocker. Flip on, then iterate. (#589/#876/#901 closed.)

> Caveat: "no engineering gate" ≠ "should be on." Some may be held off for **business/sequencing** reasons (e.g. do not surface reviews before any exist). See Open Questions.

### Tier 2 — small migration, then flip

Both are complete and correct but read a **build-time** function, so an admin toggle is a no-op until migrated (#1322 batch).

- **`OPERATOR_TODAY`** — Today's pickups/returns/overdue dispatch panel (server-bucketed). Swap `isOperatorTodayEnabled()` → `useFeatureFlag('OPERATOR_TODAY')` in `OperatorDashboardView.tsx`, flip `runtimeControlled: true`, add a toggle test. ~2h, low risk. (#1102 closed; #1322 open.)
- **`CALENDAR_QUICKVIEW`** — Hover/click booking quick-view on the calendar. Swap the build-time reader → hook in 2 places (`BookingsCalendar.tsx`, bookings route index). ~2h, low risk. (#1282/#1329 closed; #1322 open.)

### Tier 3 — last engineering gate cleared (now flip-ready)

- **`FLEET_TIMELINE`** — Vehicle-row planning board (the fleet-ops centerpiece). Fully built and code-split.
  **Former gate: #1349.** The board is built on a pinned pre-release `react-calendar-timeline@0.30.0-beta.18` whose bars were **mouse-only** — no keyboard nav, no ARIA. There is no React-19-compatible stable upgrade (#1330).
  Two documented paths existed (`docs/2026-07-02-fleet-timeline-lib-pin.md`): (1) add keyboard + ARIA to the bars, or (2) document the quick-view calendar (#1282) as the accessible fallback.
  **Gate cleared:** a session took path (1) — **PR #1469 merged** to develop (`3a812c88`, #1349 closed), adding keyboard + ARIA to the bars. `FLEET_TIMELINE` now has no engineering gate and joins **Tier 1** (flip-on, zero code). Follow-ups #1470 (roving tabindex) / #1471 (focus-on-date-nav) are polish, not gates.

### Tier 4 — product decision or larger build

- **`RENTER_DOCUMENTS`** — ID/passport upload + staff verification (R2-backed). Complete, but **orphaned**: it was built to gate booking on document verification (#459), and instant-book (#511) removed that gate, so the UI has no place in the critical path. **Product decision needed:** re-integrate verification into the GA booking flow, or deprecate the feature.
- **`MESSAGING`** — Renter↔operator messaging. **Renter side shipped** (threads, inbox, translation). **Operator side NOT built** — no operator inbox, no operator-scoped thread reads (the guard rejects operator callers), no operator notifications. Design doc exists: `docs/plans/2026-06-27-messaging-un-gate-design.md` (4 slices: schema → API → web → notifications). Security-critical (cross-tenant PII scope). ~5–7 days. (#1205 design closed; renter side #1032 closed.)
- **`VITE_SEARCH_MAP_ENABLED`** (build-time only, not in the registry) — Search results map+list view. Complete and dark-launched. **Deliberately off in beta** as a post-MVP/post-contract premium feature (`docs/2026-06-17-issue-885-slice3-handoff.md`); paid builds opt in by setting the build var. No blocker — a business decision. (#885 closed.)

## Recommended sequence

1. **Tier 1 go-live** — the owner decides which complete features to switch on (admin switchboard, no deploy). Optional: a smoke pass per feature before flipping. Biggest ROI by far — up to 7 finished features light up.
2. **Tier 2 migrations** — fold `OPERATOR_TODAY` + `CALENDAR_QUICKVIEW` into the #1322 build-time→runtime batch (~half a day total), then flip.
3. **Tier 3 — done.** #1349 shipped (**PR #1469 merged**, keyboard + ARIA on the bars); `FLEET_TIMELINE` is now flip-ready and folds into the Tier 1 go-live decision. No remaining work.
4. **Tier 4** — resolve `RENTER_DOCUMENTS` (product call) and scope `MESSAGING` operator side if wanted; treat `SEARCH_MAP` as a build-config decision for paid tiers.

## Open questions for the owner

1. Of the Tier-1 features, which are held off for **business/sequencing** reasons vs simply "not turned on yet"? (Determines whether go-live is one toggle session or staged.)
2. **`RENTER_DOCUMENTS`:** is document verification required for GA bookings, or is instant-book the permanent flow (deprecate)?
3. **`MESSAGING`:** is the operator side in scope for GA, or does renter↔operator messaging stay renter-only / off?
4. **Go-live gating:** should turning a flag on require a QA smoke checklist per feature, or is the existing test coverage sufficient to flip directly?

## Provenance

- Flag registry: `packages/shared/src/feature-flags/registry.ts`; web resolver: `packages/web/src/vite/config/feature-flags-runtime.ts`.
- Control-plane design: `docs/plans/2026-06-30-runtime-feature-flags.md` (#1322).
- Prod defaults verified against `.github/workflows/deploy.yml` (web build env) — no `VITE_FEATURE_*` set.
- Per-flag built-state + gates gathered by a 4-way parallel read-only sweep of `packages/{web,api,shared}` and the GitHub issue history, 2026-07-04.

# Runtime Feature Flags — "toggle features from the platform-admin dashboard, no rebuild"

- **Date:** 2026-06-30
- **Status:** Proposed (design only — no code yet; owner reviews before build)
- **Owner ask (2026-06-30):** a platform-admin dashboard UI that toggles each feature on/off at the click of a switch, live, without a redeploy.
- **Relates to:** `docs/plans/2026-06-26-mvp-feature-gating-design.md` (the build-time gating this extends — read it first), `packages/web/src/vite/config/features.ts` (current flags), Epic #1075 (platform-admin console), Epic #385 (marketplace MVP).
- **Extends, does not replace:** the build-time flag system and the admin-bypass visibility rule (`isVisibleToViewer`) stay exactly as they are. This adds a runtime override layer on top.

---

## 1. Problem

Every feature flag today is **build-time**: `import.meta.env.VITE_FEATURE_*`, read through `isFeatureXEnabled()` in `features.ts` and inlined into the bundle by Vite at build.
The only way to change one is to bake a new env value and redeploy through CI.

The owner wants to flip features from a dashboard button on the live site.
A button cannot change a value that was inlined into the JS at build time.
So a dashboard toggle needs a **runtime** source of truth the browser reads after boot, not a compile-time constant.

This is a genuinely new capability. The #1075 platform-dashboard epic listed "replacing role gating with feature flags" as a non-goal, and the gating design (§9) scoped out per-operator/per-renter flags as YAGNI.
This design does neither of those: it keeps one **global** owner-controlled switchboard, which is exactly the ask.

## 2. Decision

**Add a DB-backed runtime override layer; keep the build-time env as the per-build default.**

- A `feature_flags` table is the source of truth for **overrides** the owner sets from the dashboard.
- The build-time env stays the **default** for a build (beta bakes none, so defaults stay OFF, exactly as gating design §5).
- The effective value is a two-line rule:

  ```
  effective(key) = dbOverride[key] ?? buildTimeDefault[key] ?? false
  ```

A flag with no DB row behaves **exactly as today** (backward compatible), so this is additive and fail-safe: absent override + absent env default = OFF.
Setting an override flips a flag live; clearing it reverts to the build default.

### 2.1 Still a product-visibility gate, NOT a security boundary

Unchanged from gating design §2.1. These flags decide **what the UI advertises**, not what the API allows.
The API keeps enforcing its own per-participant/role authorization; a runtime flag being ON never grants access, and OFF never revokes it.
The admin-bypass rule (`isVisibleToViewer(effective, role)`) still layers on top so the owner previews a feature even when its effective value is OFF.
Consequence: the read endpoint that serves flags can be public without leaking anything a curious user could not already read from the bundle.

### 2.2 Rejected alternatives

- **Move all defaults server-side (drop build-time env).** Bigger change, and it breaks the existing "beta build bakes no vars → OFF, full build bakes `true`" distinction (gating §5). Keeping env as the default preserves that for free.
- **Per-operator / per-renter flags.** Still YAGNI (gating §9). One global control plane matches the owner-only requirement; targeting/rollout percentages are out of scope (§9 here).
- **WebSocket / push invalidation for instant propagation.** A toggle taking effect on the next flags refetch is fine for an owner-driven switchboard (§8). No realtime channel needed.

## 3. Data model

New bounded-context module `packages/shared/src/db/feature-flags.ts` + one `export *` line in `db/schema.ts` (the #725 convention), then a generated migration.

| Column | Type | Notes |
|---|---|---|
| `key` | `text` PRIMARY KEY | Matches a key in the shared flag registry (§4). Unknown keys rejected at the API, never written. |
| `enabled` | `boolean NOT NULL` | The override value. Presence of the row **is** the override; `enabled` is what it forces. |
| `updatedAt` | `timestamptz NOT NULL DEFAULT now()` | Audit. |
| `updatedBy` | `text` | User id of the platform admin who last set it (audit trail; nullable for a seeded row). |

Global, single-row-per-key. No `operatorId` — this is a platform control plane, not tenant data.
"Revert to default" = delete the row (optional dashboard affordance; see §6).

## 4. Shared flag registry (single source of truth for keys)

Today the key set is implicit: one `isFeatureXEnabled()` function per flag, each reading a differently-named `VITE_FEATURE_*` var.
Promote it to one explicit registry in `@kuruma/shared` so the API, the web, and the DB agree on the exact key set and its defaults, and neither side can drift.

```ts
// packages/shared/src/feature-flags/registry.ts  (NEW, no runtime deps — shared-safe)
export const FEATURE_FLAGS = {
  REVIEWS:        { env: 'VITE_FEATURE_REVIEWS',        label: 'Reviews & ratings' },
  FLEET_TIMELINE: { env: 'VITE_FEATURE_FLEET_TIMELINE', label: 'Fleet timeline board' },
  MULTI_CURRENCY: { env: 'VITE_FEATURE_MULTI_CURRENCY', label: 'Multi-currency display' },
  CANCELLATION:   { env: 'VITE_FEATURE_CANCELLATION',   label: 'Self-service cancellation' },
  // ...one row per existing VITE_FEATURE_* flag. MESSAGING / OPERATOR_BLOCKS carry
  // admin-bypass semantics and are visibility-only; they can join later (§8).
} as const

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]
```

`features.ts`' per-flag functions become thin reads over this registry (build-time default resolution), so nothing about the current call sites changes yet — the registry is introduced first, consumers migrate later (§7).
A parity unit test asserts every `VITE_FEATURE_*` in `vite-env.d.ts` has a registry entry and vice versa (mutation-resistant: a new flag that skips the registry fails CI).

## 5. API

Mirrors the MVC + DI conventions (routes -> services -> repositories, wired only in the composition root) and the `ok()/fail()/parseBody()` helpers.

- **`GET /feature-flags`** -> `{ overrides: Record<FeatureFlagKey, boolean> }` (sparse: only keys with a DB row).
  **Public read** (no `requireAuth`) — the web needs flags before login, and per §2.1 the values are not secret.
  The web merges these over its own build-time defaults (§6); the server does not need to know the build's env.
- **`PATCH /admin/feature-flags/:key`** body `{ enabled: boolean }` -> the updated override.
  Mounted under `/admin/*`, so it inherits the structural `requirePlatformMember()` read-floor; the handler additionally calls `requirePlatformAdmin(ctx)` (write gate), matching `admin-operators.ts`.
  Validates `:key` against `FEATURE_FLAG_KEYS` (unknown -> 400) and the body via a new Zod schema in `packages/shared/src/validators/feature-flags.ts`.
  Upserts the row, stamps `updatedBy = ctx.userId`, `updatedAt = now()`.
- **`DELETE /admin/feature-flags/:key`** (optional, §6) -> clears an override, reverting to the build default.

New `FeatureFlagsService` (business rule: key validation, upsert, effective-map assembly) over a `FeatureFlagRepository` port with Drizzle + in-memory implementations, constructed in `index.ts` and passed to `createFeatureFlagsRoutes(...)`.
The GET route is a thin read; it may DI the repository interface directly per the sanctioned thin-read carve-out (AGENTS.md), but since the PATCH path already needs a service, one `FeatureFlagsService` serves both.

## 6. Web — runtime read with build-time fallback

The runtime read mirrors the session pattern (`vite/session.ts`: `sessionQueryOptions()` + envelope validation at the HTTP boundary).

```ts
// packages/web/src/vite/config/feature-flags-runtime.ts  (NEW)
export function featureFlagsQueryOptions() {
  return queryOptions({
    queryKey: ['feature-flags'],
    queryFn: fetchFeatureFlagOverrides,   // GET /feature-flags, validated
    staleTime: 60_000,
    initialData: {},                      // no override until the server answers
  })
}
```

- A `FeatureFlagsProvider` near the app root subscribes to that query and exposes a **synchronous** `useFeatureFlag(key)` via context:

  ```ts
  // effective = server override ?? build-time default ?? false
  const effective = overrides[key] ?? isBuildTimeEnabled(key)
  ```

- `initialData: {}` + the build-time default means **first paint uses the build default** (no flash, no async gate on boot), then reconciles to the DB override when the query resolves.
  This is why keeping env as the default matters: the UI is never blank waiting on the network, and a beta build with no overrides behaves identically to today.
- The admin page's PATCH `onSuccess` invalidates `['feature-flags']`, so the owner's own client updates immediately; other clients pick it up on their next refetch (`staleTime`/navigation). Acceptable for an owner-driven switchboard (§2.2).

## 7. Migration ripple (the main cost — call it out honestly)

The existing `isFeatureXEnabled()` are **synchronous module functions**. Runtime values live in React context, so a consumer that must honor a runtime override has to read a **hook** (`useFeatureFlag('X')`) instead.
That is the real work of this project, and it is per-call-site.

Strategy — **incremental, one flag at a time, fallback-safe:**

1. Land the control plane first (registry + table + API + admin page). At this point overrides are stored and toggleable but **no consumer reads them yet** — the web still reads build-time env, so behavior is unchanged and nothing can break.
2. Migrate flags one vertical slice each: swap that flag's consumers from `isFeatureXEnabled()` to `useFeatureFlag('X')`. Because `useFeatureFlag` falls back to the build-time default, a half-migrated app is always correct.
3. `isVisibleToViewer(effective, role)` is unchanged; only its first argument now comes from the hook instead of the module function.

Recommended first migrated flag: **MULTI_CURRENCY** (just gated, small surface, public renter pages) as the end-to-end proof that a dashboard toggle changes the live UI.
Non-hook call sites (route `beforeLoad`, plain modules) read the effective value from `ensureQueryData(featureFlagsQueryOptions())`, same as those guards already read the session.

## 8. Vertical slices / PRs

Each slice is independently shippable and demo-able.

- **Slice 1 — control plane + one real toggle.** Shared registry + parity test; `feature_flags` table + migration; `GET /feature-flags` + `PATCH /admin/feature-flags/:key` + service + repos (Drizzle + in-memory) + validator; the `FeatureFlagsProvider` + `useFeatureFlag`; migrate **MULTI_CURRENCY** as the proof; admin page (§ below) reading/writing. End state: the owner flips multi-currency from `/admin/feature-flags` and sees it change live.
- **Slice 2..n — migrate remaining flags**, one small slice each (REVIEWS, FLEET_TIMELINE, CANCELLATION, ...). Messaging / operator-blocks last, since they add the admin-bypass wrinkle.
- **Admin page** (part of slice 1): route `packages/web/src/routes/$locale/_admin/admin/feature-flags/index.tsx` + module `packages/web/src/vite/admin/feature-flags/` (`api.ts` + `FeatureFlagsView.tsx`), a row per registry flag showing label, effective state, whether an override is active, and a switch. Uses `useQuery(featureFlagsQueryOptions())` + `useMutation` PATCH (+ optional DELETE reset), CSRF token from the session. Add a `Feature flags` entry to `AdminSidebar.SIDEBAR_ITEMS`. Needs a shadcn `Switch` (`bunx shadcn@latest add switch -c packages/web` — not currently present).

## 9. Testing (TDD, mutation-resistant)

- **Registry parity** — every `VITE_FEATURE_*` in `vite-env.d.ts` has a `FEATURE_FLAGS` entry and vice versa (a flag that skips the registry fails CI).
- **Effective-value precedence** — `override=true` wins over env=false; `override=false` wins over env=true; no override falls through to env; neither present = false.
- **API authz** — `PATCH /admin/feature-flags/:key` is 403 for a non-`PLATFORM_ADMIN`, 400 for an unknown key, and upserts + stamps `updatedBy` for an admin. `GET /feature-flags` is reachable without a session.
- **Repository** — in-memory and Drizzle both round-trip an upsert and a sparse read (integration/real-pg for Drizzle).
- **Web hook** — `useFeatureFlag` returns the build default with no query data, and the override once the query resolves; `FeatureFlagsProvider` re-renders consumers on invalidation.
- **Admin page** — toggling a switch fires the PATCH with `{ enabled }` and invalidates `['feature-flags']`.

## 10. Out of scope

- Per-operator / per-renter flags, targeting, percentage rollouts (§2.2; still YAGNI).
- API-side enforcement / forbidding endpoints — visibility only (§2.1), unchanged.
- Realtime push of toggles to other open clients (next-refetch propagation is enough, §6).
- Migrating **every** flag in one PR — that is slices 2..n, each on its own.
- Audit history beyond `updatedBy`/`updatedAt` (a full change log is a later nicety).

## 11. Open questions for the owner

1. **Propagation latency** — is "the owner's client updates instantly, others on next page load (~1 min stale)" acceptable, or is instant cross-client needed (which adds realtime infra)? Recommend: next-refetch is fine.
2. **Reset affordance** — do we want a "revert to build default" (DELETE) button, or is an explicit ON/OFF toggle enough? Recommend: include DELETE; the distinction between "defaulted" and "overridden" is useful on the dashboard.
3. **Should the read be public?** Recommend yes (matches build-time bundle exposure, needed pre-login). If the owner wants flags hidden from anonymous users, gate `GET /feature-flags` behind `requireAuth()` — but the values still ship in the bundle as defaults, so it buys little.

## 12. Principles

- **Additive & fail-safe** — the DB is an override on top of unchanged build defaults; absent everything = OFF. A flag with no row behaves exactly as before.
- **Single source of truth** — one registry defines the key set for API, web, and DB; one `effective()` rule; no drift.
- **Functional Core / Imperative Shell** — `effective(override, default)` and `isVisibleToViewer` are pure decisions; the provider/route shells consume them.
- **Open/Closed** — a new flag adds a registry row; the resolution rule, the table, and the endpoints never change per feature.
- **Incremental & fallback-safe** — every intermediate state (control plane live, half the flags migrated) is correct because the hook falls back to the build default.

# MVP Feature Gating — "release only the agreed MVP to beta; owner previews everything"

- **Date:** 2026-06-26
- **Status:** Proposed (design only — no code yet)
- **Owner decision captured:** single-beta + admin-bypass; hide **in-app messaging** and **operator scheduled blocks**
- **Relates to:** Epic #385 (marketplace MVP), `docs/plans/2026-05-25-marketplace-mvp-proposal.md` (scope source of truth), `packages/web/src/vite/config/features.ts` (existing flag system)

---

## 1. Problem

`develop` is **58 commits ahead of beta** and has accumulated features beyond the contracted MVP (in-app messaging, class-deal search, platform-admin console, operator scheduled blocks, payment-anomaly review, …). We want to promote `develop → beta` to ship the MVP, **without exposing beyond-MVP features to renters and operators**, while the **owner can still preview every feature on the live beta site** to evaluate it.

Two needs, one deployment:
1. **Public beta** shows only the agreed MVP.
2. **Owner** sees all features — on the same live beta URL, not a separate build.

## 2. Decision

**Single beta deployment + admin bypass.** Each post-MVP feature is hidden behind a build-time flag (OFF in beta), with one exception: a viewer whose role is `PLATFORM_ADMIN` always sees it. The owner logs into beta as a platform admin and sees everything; everyone else sees the MVP.

Rejected alternative — **two builds / preview URL** (beta build strips post-MVP code; owner previews on localhost or a separate preview deploy). Cleaner bundle and no role logic, but the owner would preview on a *different URL* than real beta with different data. The owner explicitly wants to evaluate on live beta, so admin-bypass wins. Trade-off accepted: post-MVP JS still ships in the public bundle (gated, not tree-shaken out) — negligible for a beta demo.

### 2.1 This is a product-visibility gate, NOT a security boundary

The gate hides **UI entry points** (nav links, routes). It does **not** harden the API. The messaging endpoints stay authorized per-participant/role on the server exactly as today; a curious user who calls the API directly is still bound by that authz. We are choosing what to *advertise*, not adding an access-control layer. (Mirrors the existing Navbar invariant: "view state is not authorization state.") If a feature ever needs to be *forbidden* (not just hidden) in beta, that is a separate API-side change and out of scope here.

## 3. The MVP cut line (this revision)

| Recently-merged feature | Beta visibility | Mechanism |
|---|---|---|
| In-app renter↔operator **messaging** | **Hidden** (owner-only) | `VITE_FEATURE_MESSAGING` + admin bypass |
| Operator **scheduled vehicle blocks** | **Hidden** (owner-only) | `VITE_FEATURE_OPERATOR_BLOCKS` + admin bypass — *backend-only today; UI born gated when built* |
| Class-deal (CLASS_COMBO) **search cards** | **Not visible in default beta** — *not additionally gated here* | Governed by the existing `VITE_SEARCH_MAP_ENABLED` flag, not this design. See §3.1. |
| Operator **assign vehicle to combo float** | Visible | — (in MVP; operator bookings calendar, not flag-gated) |
| **Platform-admin console** (`/admin/*`) | Owner-only already | Existing `PLATFORM_ADMIN` role gate (`_admin.tsx`) — no change |
| Cancellation, operator team/settings, renter documents | Already gated OFF | Existing `VITE_FEATURE_*` flags (`features.ts`) — no change |

The table is the single place to read "what beta shows." Adding/removing a row is the whole change for a future cut-line tweak.

### 3.1 Class-combo cards are governed by the search-map flag, not this design

This design hides exactly **two** features (messaging, scheduled blocks). It does **not** touch class-combo card visibility — but "Visible" would be misleading, because class-combo cards only render inside the unified **map+list** results view, and `isSearchMapEnabled()` (`vite/search/flags.ts`) is the *single source of truth* for which results view mounts: ON → map+list (renders `SearchResultRow` → `ComboRow`), OFF → store grid (no `ComboRow`). Default beta sets no `VITE_SEARCH_MAP_ENABLED`, so it ships the **store grid** and class-combo cards do **not** appear — regardless of this design.

Consequence: the cut line "only messaging + scheduled blocks hidden" is accurate *for the entry points this design owns*. Class-combo's beta visibility is inherited from the search-map flag and is **off by default**. To actually surface class-combo cards in beta, the owner would separately set `VITE_SEARCH_MAP_ENABLED=true` at build — a distinct decision that also turns on the whole premium map+list view (superseding the #885 post-MVP framing). That decision is **out of scope here** and is not assumed.

## 4. Mechanism

Two orthogonal axes, combined by one helper:

- **Build-time flag** — *does this build include the feature?* Existing strict-string pattern in `features.ts` (`value === 'true'`, fail-safe OFF). Beta sets none → all post-MVP flags OFF.
- **Runtime role** — *can this viewer preview it anyway?* `isPlatformAdmin(role)` from `@/lib/platform-roles` (re-exports `PLATFORM_ROLES` from `@kuruma/shared/auth/roles`; pure data, Edge-safe).

```ts
// packages/web/src/vite/config/features.ts  — additions (mirror isRenterDocumentsEnabled)
export function isMessagingEnabled(): boolean {
  return isEnabled(import.meta.env.VITE_FEATURE_MESSAGING)
}
export function isOperatorBlocksEnabled(): boolean {
  return isEnabled(import.meta.env.VITE_FEATURE_OPERATOR_BLOCKS)
}

// packages/web/src/vite/config/feature-visibility.ts  — NEW: the admin-bypass rule, one place
import { isPlatformAdmin } from '@/lib/platform-roles'

/**
 * A post-MVP feature is hidden in beta (flag OFF) but always visible to the
 * platform admin so the owner can preview it on the live site. Visibility only —
 * the API still enforces its own authorization (see design §2.1).
 */
export function isVisibleToViewer(flagEnabled: boolean, role: string | undefined): boolean {
  return flagEnabled || isPlatformAdmin(role)
}
```

### 4.1 Application points (messaging — the only post-MVP UI live today)

- **Nav link** — `packages/web/src/vite/nav/Navbar.tsx:40`. Today `renterNavItems` is built **only when `role === 'RENTER'`**, so a naive "wrap the Messages item" would still hide it from a `PLATFORM_ADMIN` owner (the admin isn't a RENTER, so the whole list is empty). The fix is to **split the renter-view items by their real gate**, not lump them under `isRenter`:
  - `My Bookings` → **stays renter-only** (`isRenter`) — personal "my data"; an admin/operator in renter view must not see it (view state ≠ authorization, per the existing Navbar invariant).
  - `Messages` → gated by **`isVisibleToViewer(isMessagingEnabled(), role)`**, independent of `isRenter`, so the admin-bypass actually lands. It renders in the **renter-view** nav list, so the owner previews Messages by being in renter view.
  - `Documents` → unchanged, stays behind `isRenterDocumentsEnabled()` (and renter-only).

  Sketch:
  ```ts
  const isRenter = role === 'RENTER'
  const showMessages = isVisibleToViewer(isMessagingEnabled(), role)
  const renterNavItems: NavItem[] = [
    ...(isRenter ? [{ to: '/$locale/bookings', label: t('myBookings') }] : []),
    ...(showMessages ? [{ to: '/$locale/messages', label: t('messages'), ...badge }] : []),
    ...(isRenterDocumentsEnabled() && isRenter ? [{ to: '/$locale/documents', label: t('documents') }] : []),
  ]
  ```
  `MobileMenu` renders Navbar's already-filtered `navItems`, so it is covered by this one edit. The `useUnreadBadge` hook stays called unconditionally with `enabled: isRenter` (hooks rule; the admin is not a thread participant, so no count — the link shows without a badge).
- **Route guard** — `packages/web/src/routes/$locale/_renter/messages.tsx`. Add a `beforeLoad` that reads the session via `ensureQueryData(sessionQueryOptions())` and `throw redirect({ to: '/$locale' })` unless `isVisibleToViewer(isMessagingEnabled(), session?.user.role)`. This blocks direct-URL access, not just the nav entry. Pattern mirrors `routes/$locale/_admin.tsx`.

### 4.2 Scheduled blocks

Backend-only today (#1101 shipped table/repo/availability/routes; no web UI). We reserve `VITE_FEATURE_OPERATOR_BLOCKS` + its env type now so that whatever operator UI lands is *born* behind `isVisibleToViewer(...)`. No entry point to gate yet → no further work this slice.

### 4.3 Env type declaration

`packages/web/src/vite/vite-env.d.ts` — add `readonly VITE_FEATURE_MESSAGING?: string` and `readonly VITE_FEATURE_OPERATOR_BLOCKS?: string` to the `ImportMetaEnv` interface, matching the existing `VITE_FEATURE_*` entries.

## 5. Why beta hides these with zero deploy/CI change

Flags fail-safe to OFF and `deploy.yml`'s "Build web" step bakes **no** `VITE_FEATURE_*` var (only Sentry placeholders). So a build with no env override → `isMessagingEnabled() === false` → hidden for every non-admin. Nothing to change in `deploy.yml`, `ci.yml`, or wrangler config. A future "full/paid" build opts a feature in by baking the matching var to `'true'`, exactly like the existing flags.

## 6. Prerequisite for the owner to preview on beta

Admin-bypass needs the owner's beta session to carry `role === 'PLATFORM_ADMIN'`. The deploy pipeline never seeds, so this is a one-time DB action against the beta database. The bootstrap that promotes the allowlist lives in `packages/shared/src/db/seed.ts:119` (the `db:seed` CLI entry point is `scripts/seed.ts`):

- `PLATFORM_ADMIN_EMAILS=<owner-email> DATABASE_URL=<beta> bun run db:seed` (idempotent upsert), **or**
- `UPDATE users SET role='PLATFORM_ADMIN', "operatorId"=NULL WHERE email='<owner-email>'`.

Without this, the bypass has no one to bypass for and beta shows MVP-only to everyone, including the owner.

## 7. Extensibility — adding the next post-MVP feature to the gate

1. Add `isFeatureXEnabled()` to `features.ts` (one line).
2. Add `readonly VITE_FEATURE_X?: string` to `vite-env.d.ts`.
3. Wrap the feature's nav item / route `beforeLoad` in `isVisibleToViewer(isFeatureXEnabled(), role)`.
4. Add the row to the §3 table.

No new abstraction per feature — the visibility rule lives in exactly one function.

## 8. Testing (TDD, mutation-resistant)

- **Unit** — `isVisibleToViewer` truth table: `(false, 'RENTER') → false`, `(false, 'PLATFORM_ADMIN') → true`, `(false, 'OPERATOR_OWNER') → false`, `(false, undefined) → false`, `(true, 'RENTER') → true`.
- **Component** — Navbar: with the flag OFF, a `PLATFORM_ADMIN` session renders the "Messages" link; a `RENTER` session does not. With the flag ON, `RENTER` does. **Set `kuruma-view=renter` in the admin test** — Messages lives in the renter-view nav, so the admin must be in renter view to see it (otherwise the test is asserting the wrong view, and we are *not* adding Messages to the business nav). Also assert `My Bookings` is **absent** for the admin (it stays renter-only — this is what proves we split the items rather than ungating the whole renter list).
- **Route guard** — `/messages` `beforeLoad` redirects a `RENTER` to `/$locale` when the flag is OFF, and admits a `PLATFORM_ADMIN`.

## 9. Out of scope

- API-side enforcement / forbidding endpoints (§2.1) — visibility only.
- Tree-shaking post-MVP code out of the public bundle (that is the rejected two-build approach).
- The `develop → beta` promotion PR itself (separate, owner's call) and the beta admin-seed action (§6, operational).
- Per-operator or per-renter feature flags (YAGNI — owner-only preview is the requirement).

## 10. Vertical slice / PR

One slice, ~6 files: `features.ts`, new `feature-visibility.ts`, `vite-env.d.ts`, `Navbar.tsx`, `messages.tsx`, tests. Branch `feat/mvp-gate-messaging`, worktree `../kuruma-mvp-gate`, PR body `Refs #385, #1161`. Beta is unaffected until the next promotion.

## 11. Principles

- **Functional Core / Imperative Shell** — `isVisibleToViewer` is a pure decision; the Navbar/route shells just consume it.
- **Open/Closed** — a new gated feature adds a row + a one-line flag, never edits the rule.
- **Single source of truth** — the §3 table is the human-readable cut line; `isVisibleToViewer` is the one machine rule. No drift between "what we say beta shows" and "what the code shows."

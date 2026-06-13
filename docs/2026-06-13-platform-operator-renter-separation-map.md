# Map: Platform / Operator / Renter view separation (+ the #487 cleanup surface)

- **Date:** 2026-06-13
- **Code mapped:** `origin/marketplace-pivot` @ `6f4d2fd` (read-mappable at `~/Dev/kuruma-marketplace-pivot`, @ `4888441` — the role/guard/shell wiring below is unchanged since then)
- **Purpose:** document how the three audience tiers stay separate today, and pinpoint exactly what #487 ("revoke legacy STAFF/ADMIN platform-admin access") must change for a clean three-way split.

## TL;DR
The three-way separation already exists and is enforced in **two layers** — web UX guards (cosmetic) and API authz (the real boundary). The whole thing reduces to a handful of **role-set constants** mirrored between web and API. "Clean separation" is **not new infrastructure** — it is tightening those constants (#487). The one real smell: the API overloads a single `STAFF_ROLES` set for *both* "platform-admin tier" *and* "the base of the business-management tier", so #487 can't tighten the platform tier without also touching business management unless the sets are split first.

## 1. The three shells (web, TanStack Router file-route layouts)
Under `packages/web/src/routes/$locale/`:

| Shell | Layout file | `beforeLoad` guard | Chrome | Audience |
|-------|-------------|--------------------|--------|----------|
| Renter | `_renter.tsx` | `renterGuard` — any signed-in session, else login | global Navbar | renters |
| Operator | `_business.tsx` | `businessGuard` — `BUSINESS_ROLES`, else landing | business nav | operators (+ bypass roles, read-only) |
| Platform | `_admin.tsx` | `adminGuard` — `PLATFORM_ADMIN_ROLES`, else landing | `AdminSidebar`, global nav suppressed | platform admin |

Guards are **pure** (`vite/guards.ts`, FC/IS); each layout's `beforeLoad` turns a `GuardResult` (`allow` / `login` / `forbidden`) into a typed redirect. Guards are **UX-only** — they prevent a wrong-role user from *seeing* a shell; the API independently enforces every data operation.

## 2. Role model (one enum, two orthogonal axes)
`UserRole` (`api/middleware/auth.ts`): `RENTER · STAFF · ADMIN · OPERATOR_OWNER · OPERATOR_STAFF · PLATFORM_ADMIN`. (`PARTNER` = API-key callers only, not a DB role.)

- **Tenant scope:** `OPERATOR_*` carry an `operatorId` (tenant-scoped). Everyone else is unscoped.
- **Privilege:** `PLATFORM_ADMIN` is the sanctioned cross-tenant super-admin; legacy `STAFF`/`ADMIN` are **transitional** platform-admin equivalents (schema note: "no new users get them").

## 3. The constants that ARE the separation
Web (UX) mirrors API (enforcement):

| Concept | Web constant (file) | API constant (`auth.ts`) | Members |
|---|---|---|---|
| **Platform tier** | `PLATFORM_ADMIN_ROLES` (`lib/platform-roles.ts`) | `STAFF_ROLES` | PLATFORM_ADMIN, STAFF, ADMIN |
| **Business tier** | `BUSINESS_ROLES` (`lib/business-roles.ts`) | `FLEET_WRITE_ROLES` / `MANAGEMENT_READ_ROLES` (= `STAFF_ROLES` ∪ OPERATOR_*) | + OPERATOR_OWNER, OPERATOR_STAFF |
| **Cross-tenant read bypass** | (inferred from `operatorId` absence) | `SCOPE_BYPASS_ROLES` | STAFF, ADMIN, PLATFORM_ADMIN |

API gate functions:
- `requirePlatformRead(ctx)` — `STAFF_ROLES` only. Gates `/admin/revenue` + other platform endpoints.
- `requireManagementRead(ctx)` — `MANAGEMENT_READ_ROLES`. Operator-portal reads.
- `operatorReadScope(ctx)` — `OPERATOR_*` → `{kind:'operator', operatorId}`; every other role *including RENTER* → `{kind:'all'}` (catalog is public). This is read **scope**, NOT a privilege bypass.
- Write resolver — admits an operator session, OR a bypass role that supplies an **explicit** `operatorId`. (`isOperatorSession` in `guards.ts` is deliberately stricter — gates the operator-portal write affordances since those forms carry no operator picker.)

## 4. Worked example: where the revenue tab lands
`/<locale>/admin/revenue` → `_admin` shell → `adminGuard` (`PLATFORM_ADMIN_ROLES`) → `GET /admin/revenue` → `requirePlatformRead` (`STAFF_ROLES`). The service's `paymentEvents.listSucceeded()` is **unscoped** → aggregates across ALL operators → one row per operator + grand totals + the 4% platform fee. Inherently cross-tenant ⇒ platform shell. An operator's own numbers are a *different* screen (`_business` dashboard, #524, operator-scoped).

## 5. The #487 cleanup surface (the "make it clean" edit)
"Revoke legacy STAFF/ADMIN platform-admin access" = remove `STAFF`, `ADMIN` from:
1. `api/auth.ts` `SCOPE_BYPASS_ROLES`
2. `api/auth.ts` `STAFF_ROLES` ← but see §6
3. `web/lib/platform-roles.ts` `PLATFORM_ADMIN_ROLES`
4. `web/lib/business-roles.ts` `BUSINESS_ROLES` (only if STAFF/ADMIN are also retired from the *business* tier)

Both web files literally say: "Tightening to PLATFORM_ADMIN-only later is one edit to this constant."

## 6. Open architectural questions (for the review)
1. **`STAFF_ROLES` is overloaded.** It is both (a) the platform-admin tier (`requirePlatformRead`) AND (b) the base of `FLEET_WRITE_ROLES`/`MANAGEMENT_READ_ROLES`. Removing STAFF/ADMIN from it to tighten the **platform** tier *also* strips them from **business** management in the same edit — the two tiers cannot move independently. Should there be a distinct `PLATFORM_ROLES = {PLATFORM_ADMIN}` separate from a `STAFF_ROLES` (or rename it) so #487 tightens platform without entangling business?
2. **Retirement semantics.** Are STAFF/ADMIN being *deleted* or kept as no-op legacy? If deleted, do existing user rows migrate to PLATFORM_ADMIN vs OPERATOR_*? (Data migration + a seed/back-compat story.)
3. **Mirror drift.** The separation lives in 4 constants across 3 files (2 web, 1 api) that must stay in sync. A web set that admits someone the API forbids = the exact #387 bug class. Worth a single shared source in `packages/shared`?
4. **`SCOPE_BYPASS_ROLES` vs `STAFF_ROLES` divergence.** They happen to have identical members today but mean different things (cross-tenant *read* vs platform *privilege*). Post-#487 should both collapse to `{PLATFORM_ADMIN}`, or do they diverge?

---

## Review outcome (architect agent, 2026-06-13)

Verdict: **conceptually right, enforcement layer materially undercounted.** Corrections verified against trunk `6f4d2fd`:

### Map errors fixed
- **MISSED a 5th role set: `PRIVILEGED_ROLES`** (`auth.ts:129`) = `{STAFF, ADMIN, PARTNER, PLATFORM_ADMIN}`. Gates cross-tenant reads in `repositories/drizzle/message.ts` (3 sites), `thread.ts` (3 sites) + in-memory variants. **§5 omitting this means a #487 that edits only the 4 listed constants leaves legacy admins reading every operator's messages/threads.**
- **`SCOPE_BYPASS_ROLES` also includes `PARTNER`** (Trip.com), not just STAFF/ADMIN/PLATFORM_ADMIN. So §6 Q4 is wrong: post-#487 the sets do NOT collapse to `{PLATFORM_ADMIN}` — `SCOPE_BYPASS_ROLES`/`PRIVILEGED_ROLES` keep `PARTNER`; only `PLATFORM_ROLES` → `{PLATFORM_ADMIN}`.
- **Second web enforcement path omitted:** Next edge middleware (`middleware.ts` → `lib/route-helpers.ts` `classifyRoute`/`decideAdminAccess`) re-derives access by path prefix. Shares the same constants (so #487 covers it) but `route-helpers.test.ts` pins STAFF/ADMIN and will go red.
- **NOT a bug (agent read stale `4888441`):** the agent flagged the revenue web tab as a placeholder. On `6f4d2fd` (post-#628) it is the live `RevenueView`. Ignore.

### Corrected #487 revocation surface (~7 sites, not 4)
1. `api/auth.ts` `SCOPE_BYPASS_ROLES` — drop STAFF/ADMIN, **keep PARTNER**
2. `api/auth.ts` **`PRIVILEGED_ROLES`** — drop STAFF/ADMIN, **keep PARTNER**  ← was missing
3. `api/auth.ts` `STAFF_ROLES` — entangled, see prep PR below
4. `web/lib/platform-roles.ts` `PLATFORM_ADMIN_ROLES`
5. `web/lib/business-roles.ts` `BUSINESS_ROLES` (only if retiring from business tier too)
6. Tests pinning STAFF/ADMIN: `guards.test.ts`, `platform-roles.test.ts`, `route-helpers.test.ts`, `tenancy.test.ts`, `booking.test.ts`, `stats.test.ts`
7. **`api/tests/helpers/auth.ts` default `role: 'ADMIN'`** — silent baseline flip across the suite

### Recommended sequence
- **Prep PR (behavior-preserving, land BEFORE #487):**
  - Split the overloaded `STAFF_ROLES` → `PLATFORM_ROLES` (platform tier, used by `requirePlatformRead`) + `MANAGEMENT_BASE_ROLES` (business base for FLEET_WRITE/MANAGEMENT_READ). Identical members today ⇒ zero behavior change, zero test churn. Makes #487 a one-line edit on `PLATFORM_ROLES`. *(SRP: one constant answered two policy questions.)*
  - Move the membership **sets** (not the throw-based guard fns) into `packages/shared/src/auth/roles.ts` — pure data, stays dep-free + edge-safe. Web re-exports them. Kills the web↔api mirror-drift (#387 bug class).
- **#487 itself:** drop STAFF/ADMIN from `PLATFORM_ROLES` + both bypass sets (keep PARTNER); keep the enum values as tombstones (`schema.ts:35`); optional `UPDATE users SET role='PLATFORM_ADMIN' WHERE role IN ('STAFF','ADMIN')` gated on a small prod row-count check; flip the test-helper default.
- **Later (cleanup, #378 scope):** the legacy App-Router `(admin)`/`(business)/layout.tsx` are a third live copy of the guard logic.

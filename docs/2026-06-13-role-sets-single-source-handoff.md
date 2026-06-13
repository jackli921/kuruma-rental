# Handoff — single-source authz role sets (#487 prep PR)

## State
- **Worktree:** `~/Dev/kuruma-role-sets` · **branch** `refactor/role-sets-single-source` off `marketplace-pivot@95cc40d` · **commit `03d74ae`** (Phase 1). NOT pushed, no PR, no issue yet.
- **Goal:** behavior-preserving prep so #487 ("revoke legacy STAFF/ADMIN platform-admin access") is a clean one-line edit. Two wins: (1) de-overload `STAFF_ROLES` → `PLATFORM_ROLES` (platform tier = #487 target) vs `MANAGEMENT_BASE_ROLES` (business base); (2) single-source role sets in `packages/shared` to kill the web↔api mirror-drift (#387 bug class).
- **Context docs:** the design map + architect review at `/Users/jack/Dev/kuruma-rental/docs/2026-06-13-platform-operator-renter-separation-map.md` (read its "Review outcome" section — it lists the FULL #487 surface incl `PRIVILEGED_ROLES`, the PARTNER nuance, and the `tests/helpers/auth.ts` default-role landmine).

## Phase 1 — DONE (committed 03d74ae, 6/6 tests green, typecheck 0)
`packages/shared/src/auth/roles.ts` — pure, ZERO-import, edge-safe. Exports `UserRole` + sets: `ALL_ROLES`, `OPERATOR_ROLES`, `PLATFORM_ROLES`, `MANAGEMENT_BASE_ROLES` (separate instance, identical members), `BUSINESS_ROLES` (= base ∪ operators), `SCOPE_BYPASS_ROLES`, `PRIVILEGED_ROLES` (both = platform ∪ PARTNER). Subpath `"./auth/roles"` added to `package.json` exports. Test: `packages/shared/tests/auth/roles.test.ts`. Additive only — no consumer rewired yet.

## Phase 2 — TODO: rewire `packages/api/src/middleware/auth.ts`
Import the sets from `@kuruma/shared/auth/roles`, DELETE the local literals, keep the SAME exported names so the ~25 consumers don't change:
- `export type { UserRole } from '@kuruma/shared/auth/roles'` (replaces local union).
- `requirePlatformRead` → uses `PLATFORM_ROLES` (was `STAFF_ROLES`).
- `export const STAFF_ROLES = PLATFORM_ROLES` — alias; the 10 route consumers (customers, documents, availability, maintenance-logs, bookings, vehicle-photos, renter-document×2, error-handlers, repositories/types) stay unchanged and now cleanly mean "platform-staff tier".
- `export const FLEET_WRITE_ROLES = BUSINESS_ROLES`; `export const MANAGEMENT_READ_ROLES = BUSINESS_ROLES` (8 + 7 consumers unchanged).
- Re-export `OPERATOR_ROLES`, `SCOPE_BYPASS_ROLES`, `PRIVILEGED_ROLES` (7 consumers), `ALL_ROLES` — keep full export surface (tests import several).
- `isOperatorRole` / `toCallerContext` / `isValidRole` now reference the imported sets.
- **PROOF (behavior-preserving):** `bun run --filter @kuruma/api test` must stay ALL green (~1250) + `bun run --filter @kuruma/api typecheck`. No test should need editing — if one breaks, a member changed = bug.

## Phase 3 — TODO: web re-export (edge-safety critical)
- `packages/web/src/lib/platform-roles.ts` → `export { PLATFORM_ROLES as PLATFORM_ADMIN_ROLES } from '@kuruma/shared/auth/roles'`, keep `isPlatformAdmin`.
- `packages/web/src/lib/business-roles.ts` → `export { BUSINESS_ROLES } from '@kuruma/shared/auth/roles'`, keep `isBusinessRole`.
- These feed the **Next edge middleware** (`middleware.ts` → `lib/route-helpers.ts`), which today imports NOTHING from `@kuruma/shared`. **VERIFY edge-safety:** `bun build` a tiny probe entry that imports only `@kuruma/shared/auth/roles` and grep the output for `drizzle`/`postgres`/`pg` (must be ABSENT — the subpath must not drag the barrel). Then `bun run --filter @kuruma/web test` + `typecheck`.
- **Fallback (if the edge bundle leaks drizzle):** keep the web literals as-is and instead add a parity contract test (`packages/web/tests/lib/role-parity.test.ts`) asserting web sets === shared sets. Still kills drift, zero edge risk.

## Finish line
Full api+web suites + `bun run lint` + per-pkg typecheck → `/code-review` → create issue ("refactor(auth): single-source role sets, split platform tier — #487 prep") → `git push -u` → PR `--base marketplace-pivot` (body: BEHAVIOR-PRESERVING, no #487 policy change; references #487) → `gh pr update-branch` if behind (NO rebase) → CI 4/4 → squash → close issue → teardown.

## Watch-outs
- **Behavior-preserving is the contract.** Do NOT change any set's members in this PR. #487 is the separate follow-up that edits `PLATFORM_ROLES` (+ the bypass sets, keeping PARTNER) + the test-helper default.
- **Swarm tears down worktrees mid-flight** (the #628 worktree vanished this session). **Push as soon as Phase 2 is green** to preserve work. Remote branch deletion is rejected by the repo ruleset (expected — it lingers).
- `origin/marketplace-pivot` moves fast (18bb94e → 6f4d2fd → 95cc40d this session). Before pushing, `git log HEAD..origin/marketplace-pivot` for any role/auth collision.

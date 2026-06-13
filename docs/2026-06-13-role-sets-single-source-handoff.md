# Handoff — single-source authz role sets (#487 prep PR)

## STATUS: BUILT + REVIEWED, NOT pushed (user is reviewing before any outward step)
- Worktree `~/Dev/kuruma-role-sets` · branch `refactor/role-sets-single-source` off `marketplace-pivot`. **6 commits ahead** of `origin/marketplace-pivot`, **1 behind** (`f62cfe5`, e2e-only — no auth collision; `gh pr update-branch` absorbs it). Working tree clean.
- **Phases 1-3 DONE.** Reviews: code-reviewer **SHIP** + architect **SOUND** (zero CRITICAL/HIGH). Verified green: **API 1267/1267, web 1103/1103**, both typecheck 0, full lint pass, edge bundle **811 B / zero** drizzle·postgres·jose·`node:`. Behavior-preserving — **no existing test edited**.
- Goal: single-source the role sets in `@kuruma/shared` (kills web↔api drift #387) and de-overload the platform tier from the business base so **#487** ("revoke legacy STAFF/ADMIN platform-admin access") is a near-one-line edit.

## Commits (oldest → newest, all unpushed)
| sha | what |
|-----|------|
| `03d74ae` | feat(shared) Phase 1 — `packages/shared/src/auth/roles.ts` (pure, ZERO-import, edge-safe) + `roles.test.ts`; subpath `"./auth/roles"` in package.json. |
| `7c9635d` | docs — this handoff. |
| `8518fe8` | refactor(api) Phase 2 — `middleware/auth.ts` imports + re-exports the shared sets. `STAFF_ROLES = PLATFORM_ROLES`; `FLEET_WRITE_ROLES = MANAGEMENT_READ_ROLES = BUSINESS_ROLES`; `requirePlatformRead` → `PLATFORM_ROLES` directly. File 464→415 lines. |
| `fc92a03` | refactor(web) Phase 3 — `lib/platform-roles.ts` + `business-roles.ts` re-export from shared (edge-safe; both feed Next edge middleware). |
| `c5c61d1` | docs(api) — code-review LOW: "do NOT harmonize" guard comment on the management aliases. |
| `8578255` | test(api) — architect rec: `tests/middleware/role-aliases.test.ts` pins alias identities + business-tier-wider-than-platform tripwire. |

## What REMAINS — all OUTWARD-FACING (user stopped here to review)
`issue (refs #487, behavior-preserving)` → `git push -u` → `PR --base marketplace-pivot` → `gh pr update-branch` (NO rebase) → CI 4/4 → squash-merge → close issue → teardown worktree+branch.
Suggested title: **`refactor(auth): single-source role sets, split platform tier — #487 prep`**. PR body: BEHAVIOR-PRESERVING, no #487 policy change; references #487.

## Deferred follow-ups (architect review — NOT this PR)
- **[edge guard — highest value]** Pin the zero-import invariant of `shared/auth/roles.ts` with a bundle-size / forbidden-import assertion (or fold into `lint:boundaries`). Today it's only a comment; a future `import { roleEnum } from '../db/schema'` would drag Drizzle into the CF Pages **edge** bundle and fail at request time, not build time.
- **[two-model seatbelt]** Add a test asserting DB `roleEnum` (6) ⊆ authz `UserRole` (7), with `PARTNER` the only authz-extra. Catches authz↔persistence drift (the quieter drift this PR did not address).
- **[auth.ts SRP]** `auth.ts` is ~418 lines / 5 responsibilities (role re-exports, error types, repo guards, JWT mint/verify, cookie mapping); past the 400 soft-warn. A split needs a migrate-first PR (`modules.md` grandfather policy).

## #487 itself — NOT a one-liner (warn the next session)
- **≥3 set edits** in `shared/auth/roles.ts`: `PLATFORM_ROLES → {PLATFORM_ADMIN}`, AND drop STAFF/ADMIN from `SCOPE_BYPASS_ROLES` + `PRIVILEGED_ROLES` (**KEEP PARTNER** — Trip.com). They are deliberately SEPARATE instances (`roles.test.ts` pins `.not.toBe`), so the `PLATFORM_ROLES` edit does NOT cascade — that independence is the point, and it's why #487 must touch each.
- Plus the web `BUSINESS_ROLES` policy call, plus **`packages/api/tests/helpers/auth.ts:21` default `role:'ADMIN'`** (and `signTestJwt` default) — the single highest-risk site: changing it silently moves baseline access across the whole suite.
- `requirePlatformRead` already points at `PLATFORM_ROLES`, so the platform gate + web `_admin` portal narrow automatically. Comments that spell out "STAFF / ADMIN / PLATFORM_ADMIN today" will go stale — grep + update at #487.
- Full design map + both review writeups: `docs/2026-06-13-platform-operator-renter-separation-map.md`.

## Watch-outs
- **Behavior-preserving is the contract** — do NOT change any set's membership in THIS PR.
- Swarm tears down worktrees mid-flight; **commits survive** teardown, uncommitted work does not. Remote branch deletion is ruleset-rejected (lingers — expected).
- Before pushing, `git log HEAD..origin/marketplace-pivot` for auth collisions (last check: only `f62cfe5`, e2e-only).

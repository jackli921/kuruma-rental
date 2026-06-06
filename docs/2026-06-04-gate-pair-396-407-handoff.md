# Gate pair #396 + #407 — Session Handoff (2026-06-04)

> Written so you can `/clear` and resume cold. The real progress signal is the
> **worktree git logs + PR #426**, not this doc.

## What this work is
The two "hard gates before operator #2" from the MVP backlog triage (see
`docs/2026-06-02-marketplace-handoff-next.md` + milestone **MVP Demo / #2**):
- **#396** operator-scope UserRepository — *tenant-isolation*
- **#407** GET /operators + web operator picker — *the 422 has no UI affordance yet*

Both branch off **`origin/marketplace-pivot`** (local `main` predates the pivot —
do NOT read marketplace code from the main checkout; it will look "missing").

## Status

| Issue | State | Where |
|---|---|---|
| **#396** | ✅ **DONE — in review** | PR **#426** → `marketplace-pivot` (2 commits). Worktree `/Users/jack/Dev/kuruma-396-users`, branch `feature/396-operator-scope-users`. |
| **#407** | ⬜ **NOT STARTED** | Worktree already exists: `/Users/jack/Dev/kuruma-operator-picker`, branch `feat/operator-picker`, has an **untracked plan doc** `docs/plans/2026-06-04-operator-picker.md` (honor it). No code yet. |

### #396 — what shipped (decision: minimal fail-closed, NOT a retrofit)
Investigation showed **no `OPERATOR_*` path reaches `UserRepository`** today, so
this slice **proves + locks the closures** instead of threading `CallerContext`.
Renters are **shared marketplace customers** (`users.operatorId` nullable) — do
NOT filter users by operator. Real per-operator customer access = **slice 6**.
- `tests/routes/operator-user-isolation.test.ts` — 6 regression locks
- `repositories/types.ts` — documenting comment on `UserRepository`
- Review fix (`c22a6af`): `/users` was resolving thread co-participants for any
  non-privileged caller via a synthetic `RENTER` context → an operator sharing a
  thread could resolve another user. Now **operators are self-only before the
  thread lookup** (`routes/users.ts`, `isOperatorRole` guard). Fail-closed until
  operator messaging (slice 7).
- **On merge: close #396 manually** (targets non-default branch → `Closes` won't fire).

## #407 — scope (from the issue body; bring to AFK depth before coding)
- `GET /operators` API route — list operators (bypass roles see all; `OPERATOR_*`
  sees only its own). Returns id + name + slug. (Operators route/repo already
  exist on trunk — `routes/operators.ts`, `repositories/drizzle/operator.ts`,
  `OperatorRepository.findById/findBySlug/findSoleId`.)
- Web: operator **picker** on vehicle-create + class-create forms; send chosen
  `operatorId` in POST body. **Hidden when exactly one operator exists** (keep
  today's one-click flow).
- Map the **422 `OperatorRequiredError`** to an **inline form error** (not a raw
  toast) prompting operator selection.
- Retire sole-operator inference once op #2 exists (require explicit `operatorId`
  for non-operator writes — closes the LOW TOCTOU from #401 review).
- (optional) Observability log when `findSoleId()` is null/ambiguous.
- **Find first:** `resolveOperatorIdForWrite` / `findSoleId` call site (the write
  resolver). `OperatorRequiredError` lives in `packages/api/src/middleware/auth.ts`
  (→ 422). `tenancy.ts` does NOT exist as a file — the resolver is elsewhere; grep.
- Sequencing: independent of #396 (no shared files) → can PR in parallel.

## How to resume after /clear
1. `gh pr view 426` — is #396 merged? If yes, `gh issue close 396` + clean worktree.
2. `git -C /Users/jack/Dev/kuruma-operator-picker log --oneline origin/marketplace-pivot..HEAD` — #407 progress (none yet).
3. Read `docs/plans/2026-06-04-operator-picker.md` in that worktree.
4. `git -C /Users/jack/Dev/kuruma-operator-picker fetch origin && git -C ... rebase origin/marketplace-pivot` (trunk moves fast — slice 4a/4b already merged).
5. Fresh worktree → `bun install` + `bunx tsc --noEmit` before coding.

## Per-slice merge gate (run IN the worktree, all green)
`bun run --filter @kuruma/api test` · `bun run lint` (whole repo, not file-scoped)
· `bun run --filter @kuruma/api lint:boundaries` · `bun run lint:modules` ·
`db:verify` only if `schema.ts`/`drizzle/` changed (#407 likely no schema change).

## Gotchas hit this session
- **Wrong-branch trap:** an Explore agent read `main` and reported the entire
  marketplace foundation as "missing." Always explore in a worktree off
  `origin/marketplace-pivot`.
- Test harness: `createApp({ ...inMemoryRepos })` + JWT via `SignJWT` (issuer
  `kuruma-web`, aud `kuruma-api`, `TEST_AUTH_SECRET`); `testAuthMiddleware(id,
  role, operatorId)` for direct-mount route tests. Pattern: `tests/routes/
  operator-user-isolation.test.ts`, `tenancy-context.test.ts`, `manual-booking.test.ts`.
- `db:seed` is **Neon-HTTP only** (can't target docker pg).
- Other live worktrees — do NOT touch: `kuruma-fees`, `kuruma-insurance`,
  `kuruma-pricing` (slices 4b/4a/4c), `kuruma-operator-picker` (#407, yours next).

## GitHub bookkeeping done
- Milestones created: **MVP Demo (#2)** (17 open / 4 done), **Pre-launch (#3)**.
- Triage ordering: `docs/2026-06-02-marketplace-handoff-next.md` + chat. Of the
  non-slice issues, the only **must-do-before-demo** were #407 + #396.

# #521 Handoff — PR #550 review fixed; merge-base conflicts to resolve, then merge

**Date:** 2026-06-12
**Branch:** `feat/521-provider-login` @ **`e6cab0a`** · PUSHED · **PR #550 → `marketplace-pivot`** (non-default base)
**Worktree:** `~/Dev/kuruma-521-provider-login` · **DB:** docker `kuruma-521-login-pg` :5442 (`DATABASE_URL=postgres://kuruma:kuruma@localhost:5442/kuruma_test`)
**Plan (source of truth):** `docs/plans/2026-06-10-issue-521-provider-login-operator-access.md` (now committed ON the branch)

---

## State

All slices + review fixes are **committed and pushed**. 21 commits. Branch is **behind 2** vs `marketplace-pivot` (base advanced mid-session) → `mergeable=CONFLICTING / mergeStateStatus=DIRTY`. **Must merge base in before the PR can merge.**

- **Slices A–D** done (provider login + invite-backed operator access). See `docs/2026-06-12-issue-521-slice-c-complete-handoff.md` for A–C detail; Slice D = not-authorized panels + renter regression + i18n.
- **Review round 1 (4 findings) FIXED** (`ed792c0`): [P1] shared export `./validators/provider-invite`; [P1] locale-free invite-link 404 → unprefixed `/provider/invite/$token` redirect route (+ `detectBrowserLocale` shell); [P2] provider slug-fail bailed AFTER `mintSessionToken` → moved before (denied = no session); [P3] committed the plan doc.
- **CI blocker + race FIXED** (`e6cab0a`): `lint:fk-indexes` was red — added FK indexes on `provider_invites.{operatorId,invitedByUserId,acceptedByUserId}` (schema + migration **0049**, CREATE INDEX only). While verifying, the postgres concurrent-double-accept integration test flaked → found a real race in `OperatorGrantService` (loser whose invite was consumed by the winner returned `invite_invalid`); fixed by re-reading the winner's membership on a non-PENDING invite. Deterministic unit test added.

**Last green gate (at `e6cab0a`, pre-merge):** web **786** · api **1149** · integration **201** (stable 3×) · shared **414** · typecheck 0 · `lint:fk-indexes` pass · `db:verify` 4/4 (50 migrations) · export-drift pass · boundaries OK · i18n 777 · biome clean · vite build 0.

**CI note:** `gh pr checks 550` reported "no checks reported" while DIRTY — checks likely can't compute on a conflicting merge-ref. Re-verify after resolving.

---

## REMAINING — do in order

### 1. Merge `origin/marketplace-pivot` in (NOT rebase — branch is pushed, force-push is DENIED [[no-force-push]])
```
git fetch origin marketplace-pivot
git merge origin/marketplace-pivot
```
The 2 base commits: **#541** admin portal → Vite (PR #552, `1cd08e4`) and **#445** real-DB e2e gate (PR #547, `a8cd5bb`).

**3 conflicts — exact resolutions (verified this session):**

- **`packages/web/src/vite/guards.ts`** — both added a guard. **Keep BOTH:** my `manageGuard` (#521) AND their `adminGuard` (#541). Imports auto-merge to include both `isBusinessRole` + `isPlatformAdmin` (`import type { Session }`).
- **`packages/web/tests/vite/guards.test.ts`** — combine import to `import { adminGuard, businessGuard, manageGuard, renterGuard } from '@/vite/guards'`; **keep BOTH** `describe('manageGuard')` and `describe('adminGuard')` blocks complete (the conflict splits them mid-block — make each self-closing).
- **`packages/shared/src/db/seed.ts`** — ONE region, the imports (lines 1–6). HEAD = `import { createHash, randomBytes } from 'node:crypto'` + `import { getDb } from './index'` (VALUE); base = `import type { getDb } from './index'`. **Keep the crypto import** (Slice A invite-token seed needs it) and reconcile `getDb`: grep `getDb(` in the merged file — if it is **called**, value import; if only used as a type, `import type`. (Likely value, from the env-driven demo-invite seed.) Typecheck will tell you (`import type` + a call = error).

After resolving: `git add` the 3 files. **`routeTree.gen.ts` auto-merges**, but run `bun run --filter @kuruma/web build` to regen it and **`git add`** it (gotcha). Then `git commit` (merge commit — fine; the PR squashes).

### 2. Re-run the full gate (the merge pulls in #541 web + #445 ci)
```
bun run --filter @kuruma/web test        # expect 786 + #541's tests
bun run --filter @kuruma/api test         # 1149
DATABASE_URL=postgres://kuruma:kuruma@localhost:5442/kuruma_test bun run --filter @kuruma/api test:integration   # 201
bun run --filter @kuruma/web typecheck && bun run --filter @kuruma/api typecheck
bun run lint:fk-indexes && bun run lint:i18n-parity && bun run lint:modules
DATABASE_URL=...:5442/kuruma_test bun run db:verify     # 4 green
```
⚠️ Run web/api vitest from the package (`--filter`) — `bunx vitest run <file>` from repo root drops the `@/` alias and falsely fails.

### 3. Push + merge + close
```
git push                       # fast-forward (merge commit on top), NO force
gh pr checks 550               # wait for test-and-build + db-drift + e2e green
gh pr merge 550 --squash       # CLI works even on non-default base (per #511 note)
gh issue close 521 -c "Merged via #550 (squash to marketplace-pivot)."   # Closes won't auto-fire on non-default base
```

### 4. Cleanup
- `git worktree remove ~/Dev/kuruma-521-provider-login` (from main repo) after merge.
- `docker rm -f kuruma-521-login-pg` (the :5442 container).
- Remote branch deletion is blocked by the repo ruleset — leave it.
- Drop the `in-progress` label on #521 if set.
- Then `/code-review` (user-triggered/billed — I can't launch it).

---

## Gotchas (carried)
- API tests = **vitest** (`import from 'vitest'`), not `bun:test`. Pre-commit runs biome+size+boundaries+tsc but NOT suites → run them per commit.
- biome import-sort = `bunx biome check --write <file>`.
- Adding/removing a route file → `vite build` regen `routeTree.gen.ts` BEFORE typecheck + STAGE it.
- `operatorSlug` = STORED `operators.slug`. `runInTransaction` (index.ts) is the fixed 8-repo booking bundle — grant uses raw `runTx`.
- `lint:i18n-parity`, `lint:fk-indexes`, `lint:modules`, `lint:export-drift` are ROOT scripts.
- The flaky concurrent-accept fix is in `OperatorGrantService.resolve` step-4 (non-PENDING invite → re-read membership). Don't "simplify" it back into the single step-4 conditional or the race returns.

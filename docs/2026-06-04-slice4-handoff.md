# Slice 4 (Insurance + Fees) — Session Handoff

**Date:** 2026-06-04
**Epic:** #385 · **Index:** #389 · **Plan:** `docs/plans/2026-06-02-slice4-insurance-pricing-fees.md`
**Staging trunk:** `marketplace-pivot` (NOT `main` — see gotcha #1).

---

## TL;DR — resume point

| Sub-slice | Status |
|---|---|
| **4a insurance (#404)** | ✅ **DONE** — merged to `marketplace-pivot` via PR #421 (squash `c439883`). #404 closed, `in-progress` label removed. |
| **4b fees (#405)** | ⏳ **Built, reviewed, fixed, all-green — needs REBASE + PR.** Squashed to ONE clean commit `e71e332` on branch `feature/389b-fees` (worktree `/Users/jack/Dev/kuruma-fees`). I attempted the rebase, resolved most conflicts, then **aborted to leave a clean state** — redo via the recipe below. |
| **4c pricing (#406)** | ⏸ **Deferred to another session** (user's call). Now unblocked (slice 3 #388 merged). |

**Immediate next action:** execute the "4b rebase recipe" below, then open PR `Closes #405`.

---

## Repo state

- `origin/marketplace-pivot` tip = `c439883` (slice 4a). Contains slices 1, 2, 3, 4a.
- `feature/389b-fees` @ `e71e332` = the entire 4b implementation squashed into one commit, **on the old base `3a6a5c0`** (pre-slice-3/4a). Pre-commit hooks passed on it. Includes ALL review fixes (FK→400, DRY enums, schema comment).
- Worktrees:
  - `/Users/jack/Dev/kuruma-insurance` — `feature/389a-insurance` (MERGED; safe to `git worktree remove ../kuruma-insurance`).
  - `/Users/jack/Dev/kuruma-fees` — `feature/389b-fees` @ `e71e332` (clean). **Work here.**
  - `kuruma-acriss` (#388, merged), `kuruma-knip`, `kuruma-smoke414` — pre-existing, not part of slice 4.
- Test DB: docker container `kuruma-test-pg` on `localhost:5432`, user/pass `kuruma`/`kuruma`. Per-worktree DBs: `kuruma_test_insurance` (4a), `kuruma_test_fees` (4b). Recreate fresh before each integration run.

---

## 4b rebase recipe (lands #405)

```bash
cd /Users/jack/Dev/kuruma-fees
git fetch origin
git rebase origin/marketplace-pivot      # conflicts expected (4a's parallel additions vs 4b's)
```

Resolve conflicts (4a is now in the base; 4b added parallel siblings → mostly "keep both"):

1. **drizzle migration (collision: slice-3 `0030_acriss`, 4a `0031_insurance`, 4b wants `0030_fees`):**
   ```bash
   git rm -f drizzle/0030_add_fee_schedules.sql
   git checkout --ours -- drizzle/meta/_journal.json drizzle/meta/0030_snapshot.json
   ```
   (Regenerate as `0032` AFTER the rebase — step 6. Never hand-edit `_journal.json`.)

2. **`packages/api/src/middleware/auth.ts` — SILENT DUPLICATE:** git auto-merges (no conflict markers) but keeps BOTH copies of `MANAGEMENT_READ_ROLES` + `requireManagementRead` (4a + 4b added them identically). Delete the SECOND copy. Verify:
   ```bash
   rg -c "export function requireManagementRead" packages/api/src/middleware/auth.ts   # MUST be 1
   ```

3. **Keep-both unions — safe to marker-strip** (each hunk is distinct single lines, ours then theirs):
   `packages/api/src/index.ts`, `repositories/drizzle/index.ts`, `repositories/in-memory/index.ts`, `repositories/types.ts`, `packages/web/src/components/nav/BusinessSidebar.tsx`.
   ```bash
   perl -i -ne 'print unless /^(<<<<<<<|=======|>>>>>>>)/' <file>
   ```

4. **Shared-tail unions — MANUAL** (both blocks share a trailing `status/createdAt/updatedAt/}` or closing `}`; a blind strip merges them into one broken block — give each block its OWN closing):
   - `packages/api/src/stores.ts` — `InsuranceOption` + `FeeSchedule` interfaces (each full).
   - `packages/api/src/repositories/drizzle/shared.ts` — 5 hunks: schema import + type import (strip-safe); `insuranceOptionColumns` + `feeScheduleColumns` objects, `InsuranceOptionRow`/`FeeScheduleRow` aliases (strip-safe), `toInsuranceOption` + `toFeeSchedule` mappers (manual — close each fn).
   - `packages/shared/src/db/schema.ts` — keep BOTH full tables: `insuranceOptions` (from base) and `feeSchedules` (4b: 3 enums `fee_type`/`fee_unit`/`fee_schedule_status`, the no-DB-coherence-CHECK comment above `feeType`, composite FK `fee_schedules_operator_class_fk`, 2 partial unique indexes).
   - `packages/web/messages/{en,ja,zh}.json` — keep BOTH `business.insurance` + `business.fees` blocks AND `nav.insurance` + `nav.fees`. Mind JSON commas. (en structure: `business.fees` has `type{}`, `unit{}`, `form{}`, `row{}` + the archive/list keys.)

5. `git add -A && git rebase --continue`

6. **Regenerate fee migration as 0032:**
   ```bash
   bun run db:generate --name add_fee_schedules     # -> drizzle/0032_add_fee_schedules.sql (fee DDL only)
   git add drizzle && git commit -m "chore: regenerate fee migration as 0032 (rebased onto 4a)"
   ```

7. **Fresh DB + verify (33 migrations, monotonic):**
   ```bash
   docker exec kuruma-test-pg psql -U kuruma -d postgres -c 'DROP DATABASE IF EXISTS kuruma_test_fees WITH (FORCE);'
   docker exec kuruma-test-pg psql -U kuruma -d postgres -c 'CREATE DATABASE kuruma_test_fees;'
   export DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test_fees
   bun run db:migrate && bun run db:verify
   ```

8. **Full merge gate (all green):**
   ```bash
   bun run test
   bun run lint                                   # only the 4 pre-existing lint:size WARNs are OK
   bun run --filter @kuruma/api lint:boundaries
   bun run lint:modules
   bun run --filter @kuruma/shared typecheck && bun run --filter @kuruma/api typecheck && bun run --filter @kuruma/web typecheck
   DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_test_fees bun run --filter @kuruma/api test:integration fee-schedule   # expect 15/15
   ```
   If lint flags a `seed.ts`-style multi-line import format, run `bunx biome check --write <file>` and re-commit.

9. **Push + PR:**
   ```bash
   git push -u origin feature/389b-fees
   gh pr create --base marketplace-pivot --head feature/389b-fees \
     --title "feat(marketplace): slice 4b — fee schedules (per-operator, optional per-class) (#405)" \
     --body "...Closes #405..."
   ```

10. **After CI green (db-drift + test-and-build + e2e), merge + close manually:**
    ```bash
    gh pr merge <PR#> --squash
    gh issue close 405 --comment "Landed via PR #<PR#> (squash -> marketplace-pivot)."
    gh issue edit 405 --remove-label in-progress
    ```

---

## Gotchas learned this session (IMPORTANT)

1. **Non-default base = NO auto-close.** PRs merged into `marketplace-pivot` do NOT auto-close `Closes #N` (GitHub only auto-closes on merge to the default branch `main`). **Always manually `gh issue close` + remove `in-progress` after merge.** → This is why **#388 is still OPEN** despite PR #418 being merged — **close #388 too.**
2. **3-way migration `0030` collision.** slice-3 = `0030_add_acriss_code`, 4a = `0031_add_insurance_options`, 4b = `0032_add_fee_schedules` (after rebase). Always regenerate the migration after a rebase; `db:verify` (journal-count vs applied-count) is the real signal, not the migrate "success" line.
3. **`requireManagementRead` duplicates silently on the 4b rebase** (both slices add the identical symbol; git keeps both with no conflict marker). Dedup + verify count == 1.
4. **`bun run test` = unit only** (no DB). Drizzle integration is `test:integration` and needs `DATABASE_URL` → the docker `kuruma-test-pg`.
5. **`db:seed` is Neon-only** (pre-existing project gotcha) — don't run it against the docker test DB.

---

## Reviews (for the record — both slices passed)

- **4a:** code-reviewer APPROVE (no Crit/High/Med-blocking); architect "ship-ready".
- **4b:** code-reviewer (1 MEDIUM — DRY `FeeType`/`FeeUnit`, FIXED); architect (1 HIGH — FK violation → 500, FIXED to **400 + `INVALID_VEHICLE_CLASS`** via `FEE_SCHEDULES_CLASS_FK` constraint-name match in `FeeScheduleService`, user-approved status choice). Both otherwise clean. All fixes are baked into `e71e332`.

## 4b contents (in `e71e332`)
schema (3 enums + `fee_schedules` table, composite FK, 2 partial active-unique indexes, amount check) · validators (`fee-schedule.ts`, coherence superRefine) · repos drizzle+in-memory (requireManagementRead before operatorReadScope) · service (merge-then-validate coherence + active-uniqueness + FK→400) · routes `/fee-schedules` (bypass-precedence, code surfaced via `fail` extras) · DI in `index.ts` · web `modules/fees/*` + flat `manage/fees/page.tsx` + sidebar + i18n `business.fees.*` · tests at every layer.

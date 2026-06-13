# #496 — neon CI lane: handoff for next session

## Status: PR #588 OPEN → `marketplace-pivot` (Closes #496). Code-review done + fixes pushed. NOT merged.

- Worktree: `~/Dev/kuruma-496-ci-neon`, branch `chore/496-ci-neon-lane` (off mp, rebased clean).
- Tip: `aaa1ef8` (review fixes) on top of `8ef8c1e` (initial impl). 2 commits.
- **First CI pass (commit before review fixes): all 5/5 green** (test-and-build, db-drift, e2e, e2e-real-db, neon-tx). The review-fix push triggered a re-run — **verify it's green before merge** (`gh pr checks 588`).

## What this PR does
Wires the #493 self-skipping `packages/api/tests/neon` lane into CI **without using Neon** (user constraint: free-tier branch cap). A local `postgres:16` + `local-neon-http-proxy` (digest-pinned) exercises the real `runTx` (neon-serverless WS `/v2`) + `getDb` (neon-http `/sql`) path. Zero Neon usage, no new secrets — same ethos as #445's `e2e-real-db`.

## Files (6)
- `.github/workflows/ci-neon.yml` (NEW) — separate path-filtered workflow; trunk push + scoped PRs (`db/**`, `repositories/drizzle/**`, `tests/neon/**`, `drizzle.config.ts`, `**/package.json`, `bun.lock`). Has `concurrency` cancel-in-progress. **Not a required check** by design (path-filter + required = stuck-PR gotcha).
- `packages/api/tests/neon/docker-compose.ci.yml` (NEW) — `postgres:16` + proxy pinned `@sha256:cd2ae14…`. Ports env-overridable (`NEON_PG_PORT`/`NEON_PROXY_PORT`; CI uses 5432/4444).
- `packages/api/tests/neon/interactive-tx.test.ts` (EDIT) — `localhost` host flips `neonConfig` into local-proxy mode via `NEON_PROXY_PORT`; real-Neon path untouched; documents the un-guarded pooled-endpoint requirement.
- `scripts/test-neon-local.ts` + `test:neon:local` (NEW) — one-shot local run (free ports 5455/4455).
- `docs/plans/2026-06-12-issue-496-ci-neon-lane.md` — plan (architect-review folded in).

## Code-review (code-reviewer agent) — all actioned
Applied: concurrency block; `pull_request.branches`; `drizzle.config.ts` in filter; reorder migrate-before-proxy-wait; single try/finally so a partial `up` can't leak containers; `URL`→`DB_URL`; `AbortSignal.timeout` on the probe; `--remove-orphans`; logs-on-any-failure.
**Rejected (with reason):** swapping the CI TCP readiness check for `curl -fsS POST /sql` — an empty POST 4xx's and `-f` would loop until timeout. TCP check + `depends_on: service_healthy` is correct.

## Verification done
- `bun run test:neon:local` → **1 passed** (real tx via proxy, not skipped), teardown ran. Re-verified after the review-fix restructure.
- `bun run --filter @kuruma/api test:neon` (no env) → **1 skipped**, exit 0 (default lane unaffected).
- biome clean; `@kuruma/api` typecheck 0; compose config valid; workflow YAML parses (concurrency + pr.branches confirmed).

## GOTCHAS
- Proxy image healthcheck is `null` → `--wait` only guarantees "running"; the `:4444` poll is required.
- A fresh worktree needs `bun install` (the `drizzle-kit` binary is per-worktree).

## NEXT (for whoever picks this up)
1. `gh pr checks 588` — confirm the re-run is green.
2. Merge squash (auto-merge is OFF on this repo; if "require up-to-date" trips, `gh pr update-branch` → re-wait CI → squash).
3. **Manual close #496 + drop `in-progress` label** (base ≠ default branch, so `Closes` won't auto-fire).
4. Teardown: `git worktree remove ~/Dev/kuruma-496-ci-neon` (remote branch lingers per ruleset — fine).

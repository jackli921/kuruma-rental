## Implementation Plan — CI-gate the neon real-driver lane (no Neon usage)

### Context
The `#493` fix added `packages/api/tests/neon/interactive-tx.test.ts`, which exercises an **interactive transaction through the production `getDb()` / `runTx` (neon-serverless) wiring** — the exact path the renter booking-submit hits (`POST /bookings -> ensureThread -> DrizzleThreadRepository.create -> db.transaction`). The neon-**http** driver throws `No transactions support` at runtime; `runTx` (neon-**serverless**) fixes it. That regression currently has **no automated guard**: the lane `describe.skipIf(!NEON_TEST_DATABASE_URL)` self-skips, and CI never sets that env.

### Decision (revised from the original "real Neon branch" framing)
Do **not** spin Neon branches in CI. The Neon free tier caps branches, and an ephemeral-branch-per-run scheme would *increase* Neon usage and race under this repo's heavy parallel-PR load. Instead, run the lane against a **local Postgres fronted by a local Neon proxy** — the `@neondatabase/serverless` driver supports this via `neonConfig`. This exercises the driver's **interactive-transaction code path** (the thing the test asserts) with **zero Neon usage and no new secrets**, consistent with how `#445` moved `e2e-real-db` onto a disposable `postgres:16`.

What we keep: the neon-serverless transaction semantics (`runTx` opens a real session tx and commits atomically).
What we knowingly give up: fidelity to Neon's *cloud* proxy/network behaviour — which this test does not assert.

### Changes (all in isolated files — no overlap with the in-flight `vite/*` operator work)

1. **NEW `packages/api/tests/neon/docker-compose.ci.yml`**
   - `postgres:16` (`kuruma`/`kuruma`/`kuruma_neon`, healthcheck).
   - `ghcr.io/timowilhelm/local-neon-http-proxy` **pinned by `@sha256:` digest** (not the mutable `:main` tag — reproducibility + supply-chain) on `:4444`, `PG_CONNECTION_STRING` → the postgres service; `depends_on` postgres healthy. This proxy serves both the HTTP `/sql` endpoint (neon-http reads) and the WebSocket `/v2` endpoint (neon-serverless transactions); neon's own `wsproxy` only does WS, so it can't drive `getDb()`'s reads.

2. **EDIT `packages/api/tests/neon/interactive-tx.test.ts`**
   - Add a local-proxy `neonConfig` block that activates **only** when `new URL(NEON_TEST_DATABASE_URL).hostname === 'localhost'` — no external DNS dependency (was `db.localtest.me`, a public wildcard; we control resolution in CI, so use `localhost` directly):
     ```ts
     neonConfig.useSecureWebSocket = false
     neonConfig.wsProxy = (host) => `${host}:4444/v2`
     neonConfig.fetchEndpoint = (host) => `http://${host}:4444/sql`
     ```
   - The real-Neon path (secure WS, any other host) and the `skipIf(!NEON_TEST_DATABASE_URL)` guard are unchanged.
   - Add a comment noting the local lane does **not** reproduce prod's pooled-endpoint (`-pooler`) requirement — that is an operational guard, not the driver code-path #493 protects.

3. **NEW `.github/workflows/ci-neon.yml`** (separate workflow so the path filter scopes only this lane; `ci.yml` untouched)
   - Triggers: `push` to `marketplace-pivot`/`main`; `pull_request` filtered to `packages/shared/src/db/**` (where `runTx`/`getDb` live), `packages/api/src/repositories/drizzle/**`, `packages/api/tests/neon/**`, **`**/package.json` + `bun.lock`** (a `@neondatabase/serverless` bump is exactly the #493 regression class and must trigger the guard), and the workflow file itself.
   - Steps: checkout → setup-bun → `bun install --frozen-lockfile` → `docker compose -f packages/api/tests/neon/docker-compose.ci.yml up -d --wait` (postgres healthcheck) → **host-side readiness poll on `:4444`** (`until` loop, the proxy image has no shell for a container healthcheck) → `bun run db:migrate` (`DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_neon`, direct) → `bun run --filter @kuruma/api test:neon` (`NEON_TEST_DATABASE_URL=postgres://kuruma:kuruma@localhost:5432/kuruma_neon`) → **`docker compose logs` on `if: failure()`** → `docker compose down -v` with `if: always()`.

4. **NEW `test:neon:local` script** + short note in `docs/runbooks/2026-demo-runbook.md` documenting the one-command local run.

### Verification (real, before pushing)
Run the compose stack + `db:migrate` + `test:neon` **locally** and confirm the single `interactive transaction` test passes (not skipped). This proves the wiring end-to-end against the local proxy rather than relying on a first CI run. Also confirm `test:neon` with no env still self-skips green (no breakage to the default lane).

### Out of scope / follow-ups
- **Not** marking `ci-neon` a required branch-protection check: a path-filtered + required check leaves PRs that don't touch the paths stuck on "Expected — waiting for status". Can be revisited if we want it blocking.
- No schema change, no migration, no new GitHub Secrets, no Neon API key.

### Acceptance criteria
- [ ] `ci-neon` workflow runs on trunk push and on PRs touching the tx wiring, and goes **green** with the `interactive transaction` test **executed** (not skipped).
- [ ] No Neon branch is created and no Neon credentials are referenced anywhere in CI.
- [ ] The real-Neon local path (developer with a real `NEON_TEST_DATABASE_URL`) still works unchanged.
- [ ] `bun run test:neon` with no env continues to self-skip (exit 0).
- [ ] A `@neondatabase/serverless` version bump (touches `package.json`/`bun.lock`) triggers the PR lane.

### Revisions after architect review (2026-06-12)
Folded in: (1) drop the `db.localtest.me` external DNS dependency → trigger on `localhost`; (2) add `**/package.json` + `bun.lock` to the path filter so driver bumps trigger the guard (closing a blind spot at the lane's own purpose); (3) pin the third-party proxy image by `@sha256:` digest, not `:main`; (4) add a host-side `:4444` readiness poll (no flake) + `docker compose logs` on failure; (5) drop the dead `packages/api/src/db/**` filter entry; (6) document the un-guarded pooled-endpoint requirement in the test comment.

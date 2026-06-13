# #521 Provider Login — Slice B grant engine handoff (2026-06-12)

## TL;DR
Backend grant engine **B1–B5 is DONE, committed, and fully green** on
`feat/521-provider-login` (worktree `~/Dev/kuruma-521-provider-login`, tip
`e0fe0b1`, **11 commits LOCAL, not pushed**). NEXT = **B6** (OAuth `google.ts`
helpers), then B7–B9, then web C/D. Everything below B5 is untouched.

## Decision context (unchanged)
- **Option A reconciled**: `feat/521-provider-login` is the carried-forward base;
  `feat/521-provider-auth` (@ `efab42f`) is **REFERENCE ONLY** — port from it, never
  merge it, never touch its worktree. Doc: `docs/2026-06-11-issue-521-two-branch-reconciliation.md`.
- **Cross-session deconfliction (this session):** the provider-auth session
  confirmed it is **standing down** and will stay off the provider-login worktree +
  `project_521-provider-login.md`. It verified `efab42f` green (unit 1097 / int 203).
  We proceed solo on provider-login.
- **Plan = source of truth:** `docs/plans/2026-06-10-issue-521-provider-login-operator-access.md`.

## DONE this session (3 new commits, all LOCAL)
- `67831ca` **B3** — `RunOperatorGrant` port + `OperatorGrantRepos` bundle
  (`memberships.create` / `users.setOperatorAccess` / `invites.markAccepted`) in
  `repositories/types.ts`; `createDrizzleOperatorGrant(runTx)` in
  `repositories/drizzle/operator-grant-transaction.ts` (mirrors
  `createDrizzleTransaction`); barrel export. **Plumbing only** — the Drizzle factory
  is real-tx-only (integration-tested in B5). **index.ts wiring DEFERRED to B8** (no
  consumer until the callback route → would be a dangling unused local; biome
  `noUnusedVariables=warn`). Note: `repositories/drizzle/` is **biome-ignored**, so the
  factory file isn't linted (same as the existing `transaction.ts`).
- `34e1a24` **B4** — `OperatorGrantService` (`services/operator-grant.ts`). Depends on
  the **`runGrant` port** (NOT raw `runTx`). The plan §11 literally said "raw runTx",
  but the reconciled reference port is architecturally cleaner: the service stays off
  concrete Drizzle classes + `@kuruma/shared/db` ("services import interfaces only").
  3-state decision: active membership short-circuit → no-token = `access_not_found` →
  email absent/unverified = `access_not_found` → invite not PENDING / expired
  (`expiresAt.getTime() <= Date.now()`) / email-mismatch (both lowercased) =
  `invite_invalid` → accept via `runGrant` (`create status:'ACTIVE'` + `setOperatorAccess`
  + `markAccepted(invite.id, userId)`); on `pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION`
  → re-read `findActiveByUserId` winner → grant from WINNER, else rethrow (Check-Then-Act,
  mirrors #497 resolveUser race). Extracted `sha256Hex` → `auth/token-hash.ts` (shared by
  issue + redeem; `provider-invite.ts` refactored to import it). **10 unit tests** via REAL
  in-memory repos (in-memory membership `create` already throws 23505 → the race is
  unit-testable). api suite **1110**.
- `e0fe0b1` **B5** — grant integration **appended to** `tests/integration/provider-access.test.ts`
  (same file = sequential → dodges that file's broad invite-cleanup race). postgres-js
  `RunTx = (fn) => txDb.transaction(fn)` (REAL rollback, unlike the in-memory passthrough)
  → `createDrizzleOperatorGrant`. Two tests: (1) valid accept atomically commits all three
  writes; (2) `Promise.all` same-user double-submit → both granted, exactly ONE ACTIVE
  membership (proves the losing tx genuinely rolls back + re-reads the winner). Full
  integration lane **201 green** (docker `kuruma-521-login-pg` postgres:16 :5442).

## Prior (already on branch at session start)
- `cc47c5a` B1 `operatorRoleToUserRole` typed map (`src/auth/operator-role.ts`, lives in api).
- `64d11a5` B2a `ProviderInviteRepository.markAccepted(id, acceptedByUserId)`.
- `3cf78e7` B2b `UserRepository.setOperatorAccess(userId, {role, operatorId})`.
- Plus Slice A: `d105ab7` ProviderInviteService, `0eaf73f` `POST /admin/provider-invites` + demo seed.

## NEXT — Slice B remaining, in order
**B6 — `auth/google.ts` helpers (purely additive; I already diffed the reference).**
Port from `git show feat/521-provider-auth:packages/api/src/auth/google.ts`:
1. `GoogleProfile`: add `readonly email_verified?: boolean`.
2. `getUserInfo` passthrough — `auth/fetch-google-oauth-provider.ts:~48` currently maps
   `...(p.email !== undefined ? { email: p.email } : {})`; add the sibling line
   `...(p.email_verified !== undefined ? { email_verified: p.email_verified } : {})`
   (reference has this at its line 50). Cover with a fake-fetch unit test if one exists
   for the provider; otherwise it's exercised in B8 callback tests.
3. Cookie constants: `OAUTH_INTENT_COOKIE='kuruma_oauth_intent'`, `OAUTH_INVITE_COOKIE='kuruma_oauth_invite'`.
4. `OAUTH_INTENTS = ['renter','provider'] as const` + `OAuthIntent` type + **`parseOAuthIntent`**
   (anything but `'provider'` → `'renter'`).
5. `INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/` + **`safeInviteToken`** (syntactic gate only).
6. `WEB_LOCALES = ['en','ja','zh'] as const` + `FALLBACK_LOCALE='en'` + **`localeFromReturnPath`**
   (first segment if a known locale, else fallback).
The 3 bold functions are pure → TDD them first (RED→GREEN). Field + constants are declarations.

**B7** `/auth/google/start` — thread `intent` + `invite` into the round-trip cookies (read
query, `parseOAuthIntent`/`safeInviteToken`, set `OAUTH_INTENT_COOKIE`/`OAUTH_INVITE_COOKIE`
with the state cookie's TTL/SameSite=Lax). Reference: `routes/auth.ts` start handler.

**B8** callback wiring. The biggest sub-slice — verified specifics (all confirmed 2026-06-12):
- **`index.ts` does NOT yet declare `operatorMembershipRepo`** (only `providerInviteRepo` exists).
  B8 must (a) add `let operatorMembershipRepo: OperatorMembershipRepository`, (b) construct it in
  ALL 3 branches — `new InMemoryOperatorMembershipRepository()` (override + in-memory),
  `new DrizzleOperatorMembershipRepository(db)` (DATABASE_URL), (c) add `operatorMembershipRepo?`
  to the overrides interface, (d) import both classes. Mirror exactly how `providerInviteRepo` is
  threaded (lines ~213/270/295/372/460).
- Then wire `runOperatorGrant` in the same 3 branches: DB branch =
  `createDrizzleOperatorGrant(runTx)`; override + in-memory = `(fn) => fn({ memberships:
  operatorMembershipRepo, users: userRepo, invites: providerInviteRepo })` (duplicated inline, like
  the existing `runInTransaction` passthrough at index.ts ~235/348). Construct
  `createOperatorGrantService({ memberships: operatorMembershipRepo, invites: providerInviteRepo,
  runGrant: runOperatorGrant })` and pass it to the auth routes.
- **JWT mint site = `routes/auth.ts:121` `mintSessionToken({ sub, role, operatorId? })`** (imported
  from `middleware/auth`). B8 extends the session payload + `mintSessionToken` + `verifySessionCookie`
  in `middleware/auth.ts` to carry `operatorSlug`. Single mint path — `operatorSlug` derived whenever
  `operatorId` is set, on every intent. `operatorRoleToUserRole` (B1) maps the OperatorRole→UserRole
  at mint.
- **`operatorSlug` source = `services/slug.ts` `slugify(name)`** (generated from the operator NAME,
  kebab ASCII ≤32 — NOT a stored column as of now; double-check `operators` has no `slug` column).
  So the callback must look up the operator (`operatorRepo.findById(operatorId)`) to get the name,
  then `slugify`. Confirm against the reference callback, which already does this end-to-end.
- Callback flow: read intent + invite cookies → `service.resolve({ userId, email, emailVerified,
  inviteToken })` → branch (granted → mint with slug, redirect `/<locale>/manage/<slug>/dashboard`
  via `localeFromReturnPath`; access_not_found / invite_invalid → redirect
  `/<locale>/provider/login?error=...`). Delete the intent/invite cookies after reading.
- Also: `GET /auth/session` returns the session incl. `operatorSlug`; web `session.ts` surfaces it.
- **Reference (READ-ONLY):** `git show feat/521-provider-auth:packages/api/src/routes/auth.ts`
  (full start + callback) and its callback tests at `6bc422f`. Adapt to login's richer schema.

**B9** `GET /provider-invites/:token/preview` — public, returns `{ operatorName, expiresAt, valid }`
ONLY (never the invited email — leak/phish guard). Inside the IP rate limiter. 404/expired = `valid:false`.

Then **C** (web `provider/login` + `provider/invite/$token` pages, `/manage/$operatorSlug` guard),
**D** (not-authorized panels + i18n `auth.provider.*` en/ja/zh + renter-login regression).

## Reference to port from (READ-ONLY: `git show feat/521-provider-auth:<path>`)
- `services/provider-access.ts` — 3-state `resolve` + runGrant + loser-re-reads-winner
  (ALREADY ported as B4; adapt done).
- `auth/google.ts` — full helpers (B6).
- `routes/auth.ts` — start (B7) + callback (B8).
- Adapt everything to login's RICHER schema: `findByTokenHash` + service-side
  status/expiry/email checks, `findActiveByUserId`, `markAccepted(id, userId)`, invite
  `status`/`acceptedByUserId`, membership `status:'ACTIVE'`.

## Gotchas (cost time; honor these)
- **API tests run under VITEST, not bun:test** — `import { describe, it, expect } from 'vitest'`.
  A `bun:test` import passes `bun test <file>` but FAILS the real `vitest run` gate.
- **Pre-commit hook runs biome + lint:size + boundaries + web/api tsc, but NOT the test suite**
  → run `bun run --filter @kuruma/api test` manually each commit.
- **biome import-sort is an ASSIST** → `bunx biome check --write <file>` (NOT `bun run format`);
  pre-commit rejects unsorted imports. Use the correct path `packages/api/src/...` (running with
  `src/...` from the worktree root silently matches 0 files).
- **`repositories/drizzle/` is biome-ignored** (the `drizzle` ignore glob also catches it) — new
  factory files there won't be linted; rely on tsc.
- **`index.ts` grant wiring is deferred to B8** (consumer-driven, avoids unused-local warnings).
- DB = docker `kuruma-521-login-pg` postgres:16 **:5442**, migrated to **0048**.
  Integration: `DATABASE_URL=postgres://kuruma:kuruma@localhost:5442/kuruma_test bun run --filter @kuruma/api test:integration`.
  Single file: `cd packages/api && DATABASE_URL=... bunx vitest run --config vitest.integration.config.ts tests/integration/provider-access.test.ts`.
  (A "close timed out / Vite server won't exit" line after a green run is just the postgres-js
  pool teardown — not a failure.)

## Branch / rebase / merge
- **behind 2 / ahead 11** vs `origin/marketplace-pivot`. The 2 behind = `163e4a2` (docs #540) +
  `d3a899f` (web #538) — **docs/web only, NO schema/migration touch → rebase will be clean, 0048 safe.**
- Rebase onto `origin/marketplace-pivot` before pushing (especially before any web C/D work).
- **Non-default base** → `Closes #521` won't auto-fire; close #521 manually on merge.

## Gate commands (run each commit)
```
bun run --filter @kuruma/api typecheck
bun run --filter @kuruma/api test            # vitest, expect 1110+
bunx biome check packages/api/src/<files>
DATABASE_URL=postgres://kuruma:kuruma@localhost:5442/kuruma_test bun run --filter @kuruma/api test:integration
```

Memory `project_521-provider-login.md` + this doc are synced to tip `e0fe0b1`. Clean stop point.

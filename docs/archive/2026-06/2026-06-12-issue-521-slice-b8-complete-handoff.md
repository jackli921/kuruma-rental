# #521 Provider Login — Slice B (grant engine + OAuth) COMPLETE handoff (2026-06-12)

> **HANDOFF — read this first if you are a fresh session picking up #521.**

## Start here (fresh session)
You are continuing **#521 (provider login + invite-backed operator access)**. The
backend is DONE and green through **B8**; your job is the remaining slices, **in order**:
1. **B9** — public `GET /provider-invites/:token/preview` (last backend piece).
2. **C** — web provider/login + invite pages + `/manage/$operatorSlug` guard.
3. **D** — not-authorized panels + i18n + renter-login regression.

**Orientation steps:**
- Worktree: `~/Dev/kuruma-521-provider-login` on `feat/521-provider-login` (tip `8f43564`,
  16 commits LOCAL — **not pushed**, ahead 16 / behind 2 vs `origin/marketplace-pivot`).
- Read the **plan (source of truth)**: `docs/plans/2026-06-10-issue-521-provider-login-operator-access.md`
  (§7 = B9 API surface, §8 = web C/D, §6 = callback logic already implemented).
- Read the prior grant-engine handoff for B1–B5 context:
  `docs/2026-06-12-issue-521-slice-b-grant-engine-handoff.md`.
- Confirm green before you touch anything: run the gate commands at the bottom.
- **Rebase onto `origin/marketplace-pivot` first** (behind 2 is docs/web only → clean, 0048 safe).
- TDD each sub-slice, one commit each; **close #521 manually** on merge (non-default base).

The rest of this doc = exactly what changed (so you can trust the green baseline) and the
detailed spec + file anchors for B9 / C / D.

## TL;DR
**Backend is DONE through B8 and fully green.** The whole operator-grant engine is
wired end-to-end: `/auth/google/start` threads intent+invite → callback resolves
the grant → mints a session carrying `operatorSlug` → redirects to the operator
dashboard. On `feat/521-provider-login` (worktree `~/Dev/kuruma-521-provider-login`,
tip **`8f43564`**, **16 commits LOCAL, not pushed**, ahead 16 / behind 2 vs
`origin/marketplace-pivot`). NEXT = **B9** (public invite-preview endpoint), then
web **C** + **D**. Gates green: api unit **1141**, integration **201**, typecheck +
biome clean.

## DONE this session (5 new commits, all LOCAL, all green)
- `e0c3f56` **B6** — `auth/google.ts` helpers (purely additive port from the
  reference): `GoogleProfile.email_verified?` + passthrough in
  `fetch-google-oauth-provider.ts`; `OAUTH_INTENT_COOKIE`/`OAUTH_INVITE_COOKIE`;
  pure `parseOAuthIntent` (unknown→renter), `safeInviteToken` (base64url gate),
  `localeFromReturnPath` (known locale or `FALLBACK_LOCALE`). 19 unit tests
  (`tests/auth/google-helpers.test.ts`), TDD'd first.
- `da5d1aa` **B7** — `/auth/google/start` reads `?intent` + `?invite`, binds them
  to the same HttpOnly/Secure/Lax round-trip cookies as state/return (set-when-valid,
  erase-otherwise so a stale value can't leak forward). Extracted
  `OAUTH_FLOW_COOKIE_OPTS` (state/return/intent/invite share one posture) and
  extended `clearOAuthFlowCookies` to drop all four. 5 new start-handler tests.
- `ab27d5c` **B8a** — `mintSessionToken` + `verifyAndMap` round-trip an optional
  `operatorSlug` claim on `VerifiedSession` (sibling of `csrf` — session metadata,
  NOT an authz field; authz stays role + operatorId on `user`). 2 round-trip tests
  (`tests/middleware/session-token.test.ts`).
- `22389d3` **B8b** — `createAuthRoutes` gains injected `providerAccess`
  (`OperatorGrantService`) + `findOperatorSlug`. Callback reads intent/invite cookies →
  on provider intent calls `service.resolve(...)`; granted upgrades the grant, else
  302 to `/<locale>/provider/login?error=...` **minting NO session**. `operatorSlug`
  ALWAYS derived from the resolved operatorId (every intent). Provider intent →
  `/<locale>/manage/<slug>/dashboard` (server-derived slug, can't be steered by
  returnTo); renter intent unchanged. `GET /auth/session` now exposes
  operatorId + operatorSlug. `providerLoginErrorUrl` helper. 4 new callback tests +
  renter regression intact.
- `8f43564` **B8c** — `index.ts` composition root: declares `operatorMembershipRepo`
  (overrides interface + `let` + all 3 branches, mirroring `providerInviteRepo`) and
  `runOperatorGrant` (DB branch = `createDrizzleOperatorGrant(runTx)`; override/in-memory
  = inline passthrough over the in-memory repos). Builds `createOperatorGrantService`
  + `findOperatorSlug = operatorRepo.findById(id)?.slug`, passes both to
  `createAuthRoutes`. **Composition proof test** (`auth-google-runtime-wiring.test.ts`):
  seeded operator + PENDING invite → provider-door callback → granted OPERATOR_OWNER
  session + operatorId + operatorSlug + `/en/manage/acme-cars/dashboard`.

## ⚠️ Correction folded in (deviation from the prior B5→B6 handoff)
The prior handoff said *"operatorSlug source = `services/slug.ts` `slugify(name)` —
operators has NO slug column; double-check."* **That is wrong.** `operators.slug`
**IS a stored, NOT NULL, unique column** (`shared/src/db/schema.ts:52`), and the
plan §6 is correct: derive the slug from the **stored** `operators.slug` via
`findOperatorSlug = (id) => operatorRepo.findById(id)?.slug`. Re-deriving with
`slugify(name)` would diverge from the stored slug (collision suffixes like `acme-2`,
or post-creation name edits) and the web `/manage/$slug` route is mounted from the
**stored** slug — they must match. B8b/B8c implement the stored-slug path. No
`slugify` at mint time.

## NEXT — B9 (last backend slice), then web C + D

**B9 — public `GET /provider-invites/:token/preview`** (plan §7, §14.1; architect MED).
Returns **`{ operatorName, expiresAt, valid }` ONLY — never the invited `email`**
(a leaked invite URL must not disclose the target address / aid a phish). `valid` =
invite exists AND `status==='PENDING'` AND `expiresAt > now`; 404/expired/used →
`{ valid: false }` (decide: 200-with-valid:false vs 404 — reference returns the body
with `valid:false`, keep that for clean web UX). **Inside the IP rate limiter** and
**public** (no `requireAuth`).
- Surface choice: add a `preview(token)` method to `ProviderInviteService`
  (`src/services/provider-invite.ts`, currently only `createInvite`). It needs the
  operator NAME, so inject `operatorRepo` (or an `OperatorRepository`-Pick) into the
  service and look up `operatorRepo.findById(invite.operatorId)?.name`. Hash the token
  with the shared `sha256Hex` (`auth/token-hash.ts`) → `findByTokenHash`.
- Route: a new `createProviderInviteRoutes(providerInviteService, limiter)` mounted as
  a **public** route. **Verify the public-mount pattern**: see how `createStorefrontRoutes`
  / `createFlatSearchRoutes` stay public (they take `publicCatalogLimiter` and mount at
  `index.ts:675/681`). The IP limiter wrapper pattern is at `index.ts:533`
  (`rateLimit(rateLimiter, (c)=>c.req.header('cf-connecting-ip') ?? '')`). Confirm
  whether the global `requireAuth` is app-level (and how public routes opt out) before
  mounting — grep `requireAuth` in `index.ts`.
- TDD: valid PENDING → `{operatorName, expiresAt, valid:true}` (assert NO `email` key);
  expired → `valid:false`; ACCEPTED → `valid:false`; unknown token → `valid:false`;
  rate-limiter coverage if testable.
- Reference (READ-ONLY): `git show feat/521-provider-auth:packages/api/src/routes/auth.ts`
  has a `provider-invites/:token/preview` handler near the bottom; adapt to login's
  richer schema (`findByTokenHash`, service-side status/expiry checks).

**C — web click-throughs** (Vite + TanStack, `packages/web/src/vite/*` + routes under
`packages/web/src/routes/$locale/`). Plan §8.
- `routes/$locale/provider/login.tsx` — provider-branded `LoginCard` variant; Google
  button action `/auth/google/start?intent=provider&returnTo=/<locale>/manage`. Renders
  `error=access_not_found|invite_invalid` panel (sign out + mailto request-access).
- `routes/$locale/provider/invite/$token.tsx` — invite card; preview fetch
  (`GET /provider-invites/:token/preview`); Google button
  `/auth/google/start?intent=provider&invite=<token>&returnTo=…`.
- `routes/$locale/manage/$operatorSlug/` — a **layout route at the `$operatorSlug`
  segment** owns the guard in `beforeLoad` (a pathless `_manage` can't read the param):
  `businessGuard` AND `params.operatorSlug === session.user.operatorSlug` (fail-closed →
  forbidden). Child `dashboard.tsx` = minimal landing (#512 fills it). PLATFORM_ADMIN/
  STAFF lack `operatorSlug` → excluded (intended; they use #462 admin portal).
- `vite/session.ts` — add `operatorId?: string`, `operatorSlug?: string` to the session
  user type (the API already returns them from `GET /auth/session` — B8b).
- **Remember**: adding a route file requires `vite build` to regen `routeTree.gen.ts`
  BEFORE typecheck; STAGE `routeTree.gen.ts` in the commit (see CLAUDE/memory gotcha).

**D — not-authorized + renter regression + i18n** (web). Plan §8.
- `access_not_found` / `invite_invalid` panels (sign out + mailto request-access).
- Renter-login regression intact.
- New `auth.provider.*` keys (signInTitle/subtitle, continueAsProvider, invite.title,
  invite.expired, accessNotFound, requestAccess) in `en`, `ja`, `zh` — keep parity
  (`lint:i18n-parity`).

## Gotchas (honor these)
- **API tests run under VITEST, not bun:test** — `import { describe, it, expect } from 'vitest'`.
- **Pre-commit runs biome + lint:size + boundaries + web/api tsc, but NOT the test
  suite** → run `bun run --filter @kuruma/api test` manually each commit.
- **biome import-sort is an ASSIST** → `bunx biome check --write packages/api/src/<file>`
  (NOT `bun run format`); use the full `packages/api/src/...` path. (Biome will re-split
  multi-name imports onto separate lines — re-read after if you Edit again.)
- **`repositories/drizzle/` is biome-ignored.**
- **Single test file:** `bunx vitest run --config packages/api/vitest.config.ts <path>`.
- DB = docker `kuruma-521-login-pg` postgres:16 **:5442**, migrated to **0048**.
- **behind 2** = `163e4a2` (docs #540) + `d3a899f` (web #538), docs/web only → **rebase
  clean, 0048 safe.** Rebase onto `origin/marketplace-pivot` before any web C/D work.
- **Non-default base** → `Closes #521` won't auto-fire; **close #521 manually** on merge.

## Gate commands (run each commit)
```
bun run --filter @kuruma/api typecheck
bun run --filter @kuruma/api test            # vitest, expect 1141+
bunx biome check packages/api/src/<files>
DATABASE_URL=postgres://kuruma:kuruma@localhost:5442/kuruma_test bun run --filter @kuruma/api test:integration
```
(For web C/D add: `bun run --filter @kuruma/web test`, `vite build`, `lint:i18n-parity`.)

Memory `project_521-provider-login.md` + this doc are synced to tip `8f43564`.
Clean stop point — B8 complete, all gates green, nothing half-written.

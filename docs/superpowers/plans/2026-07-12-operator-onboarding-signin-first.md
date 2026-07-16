# Operator Onboarding Sign-In-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the copy-and-send invite-link operator onboarding with sign-in-first — a prospective operator signs in with Google (as a RENTER), applies from inside their account, and admin approval promotes that same account directly to `OPERATOR_OWNER`, learned automatically on the applicant's next session read.

**Architecture:** Two coupled mechanisms. (1) A **session reconcile** at `GET /auth/session`: the JWT becomes a cache, the `users` row stays authoritative; for a non-operator token the handler re-reads `(role, operatorId)` and re-mints the `kuruma_session` cookie when they differ (operators never reconcile — the preserved `#957` revoke→401 path already guarantees a non-revoked operator token matches the DB, so gating reconcile on `!isOperatorRole(token.role)` costs operators zero new reads). (2) A **direct-promotion approval**: `approve()` stops minting an OWNER invite and instead writes an `OPERATOR_OWNER` membership + `users.setOperatorAccess` for the application's linked `applicantUserId`, inside the existing approval transaction. Notifications go out best-effort through the injectable `EmailSender` port (not the booking `notificationDispatcher`). The invite-acceptance machinery stays intact for STAFF and the manual admin OWNER escape hatch.

**Tech Stack:** Bun workspace monorepo. `packages/api` = Hono on CF Workers (layered routes → services → repositories + DI composition root in `index.ts`). `packages/shared` = Drizzle schema + Zod validators. `packages/web` = Vite + TanStack Router SPA (no direct DB access). `jose` JWT sessions. Vitest (unit + real-pg `test:integration`/`test:neon`). Playwright real-db e2e.

**Source spec:** `docs/superpowers/specs/2026-07-12-operator-onboarding-signin-first-design.md` (verified against develop `ba518625`; all line numbers below re-verified on that tip).

**Issue / branch:** Implement on `feat/operator-onboarding-signin-first` (worktree `../kuruma-operator-onboarding`). PR references the onboarding epic with `Refs #<epic>` (NOT `Closes`) unless the owner confirms this fully closes an issue. Ship dark-safe: no user-facing entry-point CTA is enabled until the owner opts in (§6.1 / Task 14 gates the "Become an operator" CTA on session, harmless if the route is simply not linked).

**Global conventions (apply to every task):**
- TDD, one behavior per RED→GREEN cycle. Mutation-resistant assertions (specific role/operatorId/status/constraint-name/header checks, never truthiness).
- After each task: `bun run --filter @kuruma/api typecheck` (and `--filter @kuruma/web` for web tasks) must pass before committing. Commit per task.
- Never touch another worktree's branch. No force-push. Conventional-commit messages (`feat:`, `test:`, `refactor:`).
- Re-read a file immediately before editing it (context may be stale).

---

## File Structure

**Created:**
- `packages/api/drizzle/0109_link_operator_application_to_applicant.sql` (generated) + `packages/shared/src/db/migrations` snapshot — the `applicantUserId` column.
- `packages/api/src/services/email/templates/operator-application-approved.ts` — approved email template.
- `packages/api/src/services/email/templates/operator-application-rejected.ts` — rejected email template (renders the captured reason).
- `packages/api/tests/neon/operator-application-promotion-tx.test.ts` — real-pg atomic-promotion integration test (may replace the invite-shaped `operator-approval-tx.test.ts`).
- `packages/web/src/routes/$locale/operator/welcome.tsx` — session-invalidating welcome landing route.
- `packages/web/src/routes/$locale/_renter/account/application-status.tsx` (or nearest renter-scoped location) — applicant status surface.
- New client fns in `packages/web/src/vite/operator-registration/api.ts` — `getMyApplication`.

**Modified (server):**
- `packages/shared/src/db/operator-applications.ts` — add `applicantUserId` column + FK + covering index.
- `packages/shared/src/validators/operator-application.ts` — submit input no longer carries a client `contactEmail`.
- `packages/api/src/middleware/auth.ts` — add `provideIdentityResolver` + `resolveCurrentIdentity` (mirrors the revoke-check injection); export nothing new beyond these.
- `packages/api/src/routes/auth.ts` — `GET /auth/session` reconcile-and-remint + `Cache-Control: no-store`.
- `packages/api/src/repositories/types-transactions.ts` — widen `OperatorApprovalRepos` (add `memberships.create`, `users.setOperatorAccess`; narrow `invites`).
- `packages/api/src/repositories/drizzle/operator-approval-transaction.ts` + `packages/api/src/composition/repositories.ts` — construct the widened repos (both back-ends already bind all repos, so this is type-narrowing only, no new construction).
- `packages/api/src/services/operator-application.ts` — `approve()` promotes directly; `submit()` links `applicantUserId` + already-operator 409; add `findByApplicantUserId`; delete `remintInvite()`; inject `EmailSender`; drop invite-mint imports + `ProviderInviteAuditEvent` union member.
- `packages/api/src/routes/operator-applications.ts` — submit requires auth, derives email from session; add `GET /operator-applications/me`.
- `packages/api/src/routes/admin-operator-applications.ts` — approve returns operator identity only; delete the remint route.
- `packages/api/src/repositories/types.ts` (+ drizzle/in-memory operator-application repos) — add `findByApplicantUserId`.
- `packages/api/src/index.ts` — inject `provideIdentityResolver` + `EmailSender` into `OperatorApplicationService`.
- `packages/api/src/services/email/templates/messages/index.ts` — add strings for the two new templates.

**Modified (web):**
- `packages/web/src/routes/$locale/business/register.tsx` + `vite/operator-registration/*` — sign-in-first, locked email.
- `packages/web/src/vite/operator-registration/api.ts` — submit uses `credentials: 'include'`, drops `contactEmail`; add `getMyApplication`.
- `packages/web/src/routes/$locale/_admin/admin/operator-applications.tsx` + `vite/admin/operator-applications/{api.ts,ApplicationReviewCard.tsx}` — drop invite-link/copy/remint UI + DTO fields.
- `packages/web/messages/{en,ja,zh}.json` — add welcome/status keys; remove dead invite-link keys.

**Untouched (P1a — regression-guarded, do NOT edit):**
- `packages/web/src/routes/$locale/provider/invite/$token.tsx`, `packages/api/src/services/operator-grant.ts`, `packages/api/src/services/provider-invite*.ts`, `POST /admin/provider-invites`, `POST /admin/operators`, `POST /operators/me/invites`, `packages/api/src/services/invite-mint.ts` (still used by the manual + STAFF invite paths).

---

## Phase 0 — Data model

### Task 1: Link applications to the applicant's account

**Files:**
- Modify: `packages/shared/src/db/operator-applications.ts:29-73`
- Generated: `packages/api/drizzle/0109_*.sql` + drizzle meta snapshot

- [ ] **Step 1: Add the column + FK + covering index**

In `operator-applications.ts`, inside the `pgTable` column block (after `reviewedByUserId`, before the timestamps), add:

```typescript
    // Sign-in-first onboarding (§8): the authenticated applicant this application
    // belongs to. Approval promotes THIS user id directly to OPERATOR_OWNER. text
    // (not uuid) to FK users.id (text PK, crypto.randomUUID default). onDelete:
    // 'restrict' mirrors operatorId — a live application must not be orphaned by a
    // user delete, and the promotion targets exactly this id.
    applicantUserId: text('applicantUserId').references(() => users.id, { onDelete: 'restrict' }),
```

In the index array `(t) => [ ... ]` (alongside the other `idx_operator_applications_*` entries), add the covering index `lint:fk-indexes` requires:

```typescript
    index('idx_operator_applications_applicantUserId').on(t.applicantUserId),
```

Leave the column **nullable in DB** (§8: no backfill needed on beta; new rows always set it, approval requires it for the direct-promotion branch). Confirm `users` is already imported in this file (it is — `reviewedByUserId` references it).

- [ ] **Step 2: Generate + migrate + verify**

Run:
```bash
bun run db:generate --name link_operator_application_to_applicant
bun run db:migrate
bun run db:verify
```
Expected: a new `drizzle/0109_*.sql` with `ALTER TABLE "operator_applications" ADD COLUMN "applicantUserId" text` + FK + `CREATE INDEX "idx_operator_applications_applicantUserId"`; `db:verify` shows 3 green checks.

> Gotcha (from CLAUDE.md / prior slices): local `db:migrate` can exit 1 on darwin (single-tx rollback quirk). If it does, apply the generated `drizzle/0109_*.sql` via `docker exec -i <pg> psql` against the local test DB; CI migrates cleanly on Linux. Do NOT hand-rename the migration file — if the number collides with a sibling branch, `git merge origin/develop` then drop + regenerate.

- [ ] **Step 3: Confirm the FK-index lint passes**

Run: `bun run lint:fk-indexes`
Expected: PASS (the new FK column is the leading column of `idx_operator_applications_applicantUserId`).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/db/operator-applications.ts packages/api/drizzle
git commit -m "feat(onboarding): link operator applications to applicant account"
```

---

## Phase 1 — Session reconcile at GET /auth/session

> This phase is independently shippable and dark-safe: for a token whose DB projection matches (every session today), the reconcile is a pure no-op — same response, no `Set-Cookie`. It only changes behavior once a promotion (Phase 2) makes a token's role diverge from its `users` row.

### Task 2: `resolveCurrentIdentity` context injection

**Files:**
- Modify: `packages/api/src/middleware/auth.ts:72-102`
- Test: `packages/api/tests/middleware/identity-resolver.test.ts` (new)

- [ ] **Step 1: Write the failing test**

`packages/api/tests/middleware/identity-resolver.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'
import type { AuthUser } from '../../src/auth/roles'
import { provideIdentityResolver, resolveCurrentIdentity } from '../../src/middleware/auth'

function ctx(store: Record<string, unknown>) {
  return { get: (k: string) => store[k], set: (k: string, v: unknown) => { store[k] = v } }
}

const renter: AuthUser = { id: 'user_1', role: 'RENTER' }

describe('resolveCurrentIdentity', () => {
  test('returns undefined when no resolver is registered (fail-open)', async () => {
    expect(await resolveCurrentIdentity(ctx({}), renter)).toBeUndefined()
  })

  test('returns the identity the registered resolver produces', async () => {
    const store: Record<string, unknown> = {}
    const mw = provideIdentityResolver(async (u) =>
      u.id === 'user_1' ? { role: 'OPERATOR_OWNER', operatorId: 'op_9' } : undefined,
    )
    await mw(ctx(store) as never, async () => {})
    expect(await resolveCurrentIdentity(ctx(store), renter)).toEqual({
      role: 'OPERATOR_OWNER',
      operatorId: 'op_9',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @kuruma/api test -- tests/middleware/identity-resolver.test.ts`
Expected: FAIL — `provideIdentityResolver`/`resolveCurrentIdentity` not exported.

- [ ] **Step 3: Implement the injection (mirror the revoke check)**

In `packages/api/src/middleware/auth.ts`, immediately after the `isOperatorSessionRevoked` block (line ~102), add:

```typescript
const IDENTITY_RESOLVER = 'currentIdentityResolver'

/** The DB-authoritative identity for a user id: current role + operator tenant.
 *  operatorId is omitted for non-operator roles (mirrors AuthUser). */
export interface CurrentIdentity {
  readonly role: UserRole
  readonly operatorId?: string
}

/** Injected DB read for the session reconcile (§5.1). Returns undefined when the
 *  user id no longer resolves (deleted). Registered app-wide in the composition
 *  root next to provideOperatorSessionRevocation. */
export type CurrentIdentityResolver = (user: AuthUser) => Promise<CurrentIdentity | undefined>

export function provideIdentityResolver(resolve: CurrentIdentityResolver): MiddlewareHandler {
  return async (c: Context, next) => {
    c.set(IDENTITY_RESOLVER, resolve)
    return next()
  }
}

/** Read the context-supplied identity resolver. Fail-open (undefined) when none is
 *  registered — unit apps that don't wire it fall through to a no-op reconcile. */
export async function resolveCurrentIdentity(
  c: { get: (key: string) => unknown },
  user: AuthUser,
): Promise<CurrentIdentity | undefined> {
  const resolve = c.get(IDENTITY_RESOLVER)
  return typeof resolve === 'function' ? resolve(user) : undefined
}
```

`UserRole`, `AuthUser`, `MiddlewareHandler`, `Context` are already imported in this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @kuruma/api test -- tests/middleware/identity-resolver.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/middleware/auth.ts packages/api/tests/middleware/identity-resolver.test.ts
git commit -m "feat(auth): inject current-identity resolver for session reconcile"
```

### Task 3: Reconcile-and-remint in GET /auth/session

**Files:**
- Modify: `packages/api/src/routes/auth.ts:249-278`
- Test: `packages/api/tests/routes/auth-session.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to the `describe('GET /auth/session', ...)` block in `packages/api/tests/routes/auth-session.test.ts`. Reuse the existing `signSession(payload, secret)` helper (lines 24-37) and the app builder the file already uses. Register a fake identity resolver on the app via `provideIdentityResolver` (import it) before mounting the auth routes, or drive it through `createApp` overrides if the file uses `createApp`. Concretely, build a minimal Hono app that wires the resolver, then mounts `createAuthRoutes(...)`:

```typescript
import { provideIdentityResolver } from '../../src/middleware/auth'
import { parse as parseCookie } from 'cookie' // if not present, read Set-Cookie via res.headers

function appWithIdentity(identity: (id: string) => { role: string; operatorId?: string } | undefined) {
  const app = new Hono()
  app.use('*', provideIdentityResolver(async (u) => identity(u.id) as never))
  app.route('/', createAuthRoutes(googleConfigStub, googleRuntimeStub, operatorGrantStub, async () => 'acme'))
  return app
}

test('re-mints RENTER→OWNER: returns fresh operatorId/slug + a new Set-Cookie', async () => {
  const cookie = await signSession({ sub: 'user_1', role: 'RENTER', csrf: 'csrf-a' })
  const app = appWithIdentity((id) => (id === 'user_1' ? { role: 'OPERATOR_OWNER', operatorId: 'op_9' } : undefined))
  const res = await app.request('/auth/session', { headers: { cookie: `kuruma_session=${cookie}` } })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.data.user).toMatchObject({ id: 'user_1', role: 'OPERATOR_OWNER', operatorId: 'op_9', operatorSlug: 'acme' })
  expect(res.headers.get('set-cookie')).toContain('kuruma_session=')
  expect(res.headers.get('cache-control')).toBe('no-store')
})

test('re-mint preserves the display profile (C1)', async () => {
  const cookie = await signSession({ sub: 'user_1', role: 'RENTER', csrf: 'csrf-a', name: 'Ada', email: 'ada@x.io', image: 'https://img/a.png' })
  const app = appWithIdentity(() => ({ role: 'OPERATOR_OWNER', operatorId: 'op_9' }))
  const res = await app.request('/auth/session', { headers: { cookie: `kuruma_session=${cookie}` } })
  const body = await res.json()
  expect(body.data.user).toMatchObject({ name: 'Ada', email: 'ada@x.io', image: 'https://img/a.png' })
})

test('no change → no re-mint, same csrf, no Set-Cookie', async () => {
  const cookie = await signSession({ sub: 'user_1', role: 'RENTER', csrf: 'csrf-a' })
  const app = appWithIdentity(() => ({ role: 'RENTER' }))
  const res = await app.request('/auth/session', { headers: { cookie: `kuruma_session=${cookie}` } })
  const body = await res.json()
  expect(body.data.csrfToken).toBe('csrf-a')
  expect(res.headers.get('set-cookie')).toBeNull()
})
```

(The `#957` revoked-operator 401 and the demotion-out→401 behaviors are pinned at the `createApp` level in Task 4 / `session-revocation-app.test.ts`, where the real revoke check runs. Here the fake resolver is only reached for non-operator tokens.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @kuruma/api test -- tests/routes/auth-session.test.ts`
Expected: FAIL — no re-mint; `role` stays `RENTER`, no `Set-Cookie`, no `Cache-Control`.

- [ ] **Step 3: Implement the reconcile**

In `packages/api/src/routes/auth.ts`: add imports at the top-of-file import group — `isOperatorRole` from `../auth/roles`, and `resolveCurrentIdentity` from `../middleware/auth` (extend the existing `../middleware/auth` import). Then replace the response-building tail of the `.get('/auth/session', ...)` handler (lines 263-277, everything after the revoke short-circuit) with:

```typescript
      // Reconcile-and-remint (§5.1). Operators never reconcile: the revoke check
      // above 401s any operator token whose projection diverged, so a token that
      // reaches here with an operator role provably still matches the DB — zero
      // extra reads for operators. Non-operator tokens (a just-promoted renter) get
      // one indexed read and a re-mint when their role/operatorId changed.
      if (!isOperatorRole(session.user.role)) {
        const current = await resolveCurrentIdentity(c, session.user)
        if (current && identityChanged(session.user, current)) {
          const secret = process.env.AUTH_SECRET
          if (!secret) return fail(c, 'Server auth is not configured', 500)
          const slug = current.operatorId ? await findOperatorSlug(current.operatorId) : undefined
          const csrf = randomToken()
          const reminted = await mintSessionToken(
            {
              sub: session.user.id,
              role: current.role,
              csrf,
              ...(current.operatorId !== undefined ? { operatorId: current.operatorId } : {}),
              ...(slug !== undefined ? { operatorSlug: slug } : {}),
              // C1: carry the EXISTING display profile forward — the DB read has none.
              ...(session.profile ?? {}),
            },
            secret,
          )
          setSessionCookie(c, reminted)
          // Set-Cookie on a GET → forbid any edge/browser cache from serving a stale
          // identity/cookie pair (M3).
          c.header('Cache-Control', 'no-store')
          return ok(c, {
            user: {
              id: session.user.id,
              role: current.role,
              ...(current.operatorId !== undefined ? { operatorId: current.operatorId } : {}),
              ...(slug !== undefined ? { operatorSlug: slug } : {}),
              ...session.profile,
            },
            csrfToken: csrf,
          })
        }
      }

      // No change (or operator token): return the token identity unchanged.
      return ok(c, {
        user: {
          id: session.user.id,
          role: session.user.role,
          ...(session.user.operatorId !== undefined ? { operatorId: session.user.operatorId } : {}),
          ...(session.operatorSlug !== undefined ? { operatorSlug: session.operatorSlug } : {}),
          ...session.profile,
        },
        csrfToken: session.csrf,
      })
```

Add a small pure helper near the top of the file (below the `SESSION_TTL_SECONDS` const):

```typescript
/** True when the DB-authoritative identity diverges from the token's claims. */
function identityChanged(
  claim: { role: string; operatorId?: string },
  current: { role: string; operatorId?: string },
): boolean {
  return claim.role !== current.role || claim.operatorId !== current.operatorId
}
```

`mintSessionToken`, `SESSION_COOKIE`, `verifySessionCookie`, `isOperatorSessionRevoked` are already imported; `randomToken` is already imported from `../auth/google`; `setSessionCookie` is defined in-file; `findOperatorSlug` is a handler-closure parameter of `createAuthRoutes`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @kuruma/api test -- tests/routes/auth-session.test.ts`
Expected: PASS — the 6 original tests + 3 new reconcile tests. Then run the full auth suite: `bun run --filter @kuruma/api test -- tests/routes/auth-session.test.ts tests/middleware/csrf.test.ts` — all green (profile-spread + csrf paths unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/auth.ts packages/api/tests/routes/auth-session.test.ts
git commit -m "feat(auth): reconcile-and-remint session on role change at GET /auth/session"
```

### Task 4: Wire the resolver in the composition root + pin end-to-end

**Files:**
- Modify: `packages/api/src/index.ts:352-369` (add a sibling `provideIdentityResolver`)
- Test: `packages/api/tests/routes/session-revocation-app.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Extend `session-revocation-app.test.ts` (it already builds a real `createApp` with fake repos and has `sessionCookie`, `activeOperatorRow`, `clearOperatorAccess`-style helpers). Add, inside the existing describe:

```typescript
it('re-mints a RENTER session to OWNER once the users projection flips (promotion)', async () => {
  // user starts RENTER; the fake userRepo.findByIds returns whatever the row holds.
  const userId = 'user_promote'
  setUserRow(userId, { id: userId, role: 'RENTER' }) // helper the file uses to seed the fake repo
  const cookie = await sessionCookie({ sub: userId, role: 'RENTER', csrf: 'csrf-p' })
  const app = createApp(fakeRepos)

  const before = await app.request('/auth/session', { headers: { cookie } })
  expect((await before.json()).data.user).toMatchObject({ id: userId, role: 'RENTER' })

  // admin approval elsewhere promotes the row
  setUserRow(userId, { id: userId, role: 'OPERATOR_OWNER', operatorId: 'op_x' })
  setOperatorRow('op_x', { id: 'op_x', slug: 'promoted-co', deactivatedAt: null })

  const after = await app.request('/auth/session', { headers: { cookie } })
  const body = await after.json()
  expect(body.data.user).toMatchObject({ id: userId, role: 'OPERATOR_OWNER', operatorId: 'op_x', operatorSlug: 'promoted-co' })
  expect(after.headers.get('set-cookie')).toContain('kuruma_session=')
})
```

Match the file's actual seed helpers (read the top of `session-revocation-app.test.ts` first; adapt `setUserRow`/`setOperatorRow` to whatever fake-repo setter it exposes — e.g. a `userStore.set(...)` map). Keep the existing `#957` revoked-operator and renter-untouched tests unchanged (they still pass — a renter with a matching projection re-mints nothing).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @kuruma/api test -- tests/routes/session-revocation-app.test.ts`
Expected: FAIL — the second read still returns `RENTER` (no resolver wired in `createApp`).

- [ ] **Step 3: Wire the resolver**

In `packages/api/src/index.ts`, immediately after the `provideOperatorSessionRevocation(...)` middleware (closes at line 369), add a sibling registration that reuses the SAME `userRepo` projection read:

```typescript
  // §5.1 session reconcile: expose the DB-authoritative identity so GET /auth/session
  // can re-mint a promoted (RENTER→OWNER) token without re-login. Reuses the users
  // projection (findByIds selects operatorId, drizzle/user.ts) — one indexed read,
  // and only for non-operator tokens (the handler gates on !isOperatorRole).
  app.use(
    '*',
    provideIdentityResolver(async (user) => {
      const projection = (await userRepo.findByIds([user.id]))[0]
      if (!projection) return undefined
      return projection.operatorId != null
        ? { role: projection.role, operatorId: projection.operatorId }
        : { role: projection.role }
    }),
  )
```

Add `provideIdentityResolver` to the existing import from `./middleware/auth` (or the `composition/*` barrel that re-exports `provideOperatorSessionRevocation` — match how that symbol is imported at index.ts line 21).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @kuruma/api test -- tests/routes/session-revocation-app.test.ts`
Expected: PASS — promotion re-mints; all pre-existing `#957`/`#1088` revocation tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/index.ts packages/api/tests/routes/session-revocation-app.test.ts
git commit -m "feat(auth): wire identity resolver into createApp for promotion reconcile"
```

---

## Phase 2 — Direct-promotion approval

### Task 5: Widen `OperatorApprovalRepos`

**Files:**
- Modify: `packages/api/src/repositories/types-transactions.ts:90-96`
- Modify: `packages/api/src/repositories/drizzle/operator-approval-transaction.ts:15-26` (verify — likely no change) + `packages/api/src/composition/repositories.ts:331-338` (verify — likely no change)

- [ ] **Step 1: Widen the interface**

Replace the `OperatorApprovalRepos` interface with:

```typescript
export interface OperatorApprovalRepos {
  users: Pick<UserRepository, 'findByEmail' | 'setOperatorAccess'>
  memberships: Pick<OperatorMembershipRepository, 'findActiveByUserId' | 'create'>
  // Kept only for assertEmailUnclaimed's cross-aggregate live-invite guard (§6.2).
  invites: Pick<ProviderInviteRepository, 'findPendingByEmail'>
  operators: Pick<OperatorRepository, 'create' | 'existsBySlug'>
  applications: Pick<OperatorApplicationRepository, 'markApprovedIfPending'>
}
```

(`invites.create`/`revoke` drop out — no approval-path consumer remains once `remintInvite` and invite-minting are gone. If the type-checker later flags `assertEmailUnclaimed` still needs `findPendingByEmail`, that stays as shown.)

- [ ] **Step 2: Verify both tx factories still satisfy the type**

Run: `bun run --filter @kuruma/api typecheck`
Expected: PASS. Both factories already construct full `DrizzleUserRepository`/`DrizzleOperatorMembershipRepository` (drizzle) and pass the singletons (in-memory), so `setOperatorAccess`/`create` are already present — this is a pure narrowing of the required surface. No factory edit needed. If tsc flags anything, add the missing method to the factory's constructed repo object.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/repositories/types-transactions.ts
git commit -m "refactor(onboarding): widen OperatorApprovalRepos for direct promotion"
```

### Task 6: `approve()` promotes the applicant's account directly

**Files:**
- Modify: `packages/api/src/services/operator-application.ts` (approve/provision/imports/audit union)
- Test: `packages/api/src/services/operator-application.test.ts` (rewrite approval assertions)

- [ ] **Step 1: Write the failing tests**

In `operator-application.test.ts`, rewrite the approval suite. The service now needs the application to carry `applicantUserId` and needs the fake `runApproval` repos to expose `memberships.create` + `users.setOperatorAccess`. Replace the invite-shaped assertions:

```typescript
it('promotes the applicant account: creates an OWNER membership + sets users projection', async () => {
  const repos = makeApprovalRepos() // fake in-memory approval repos (extend the file's existing builder)
  const app = seedApplication(repos, { id: 'app_1', status: 'PENDING', applicantUserId: 'user_7', contactEmail: 'a@x.io', businessName: 'Acme' })
  const service = new OperatorApplicationService(repos.applicationRepo, noopAudit, repos.runApproval, { webBaseUrl: 'https://web' }, fakeEmailSender)

  const r = await service.approve('app_1', 'admin_1')

  expect(r).toEqual({ operatorId: expect.any(String), operatorSlug: 'acme' })
  expect(r).not.toHaveProperty('inviteUrl')
  const membership = repos.membershipStore.findActiveByUserId('user_7')
  expect(membership).toMatchObject({ userId: 'user_7', operatorId: r.operatorId, role: 'OPERATOR_OWNER', status: 'ACTIVE' })
  expect(repos.userStore.get('user_7')).toMatchObject({ role: 'OPERATOR_OWNER', operatorId: r.operatorId })
})

it('is idempotency-safe: a second approve on the same id throws 409 and creates no second membership', async () => {
  // seed as above, approve once, approve again → ConflictError('application already reviewed')
  // assert repos.membershipStore has exactly one membership for user_7
})

it('blocks approval when the applicant email already has an active operator (assertEmailUnclaimed)', async () => {
  // seed a user with an active membership under email a@x.io, then approve → ConflictError('this email already has an operator')
})
```

Delete the entire `describe('remintInvite (#1370)', ...)` block (lines ~368-486) and any assertion referencing `inviteUrl`, `inviteStore`, or `PROVIDER_INVITE_CREATED` audit from the approval tests. Extend the file's fake approval-repo builder so `runApproval` provides `memberships.create`/`findActiveByUserId` and `users.setOperatorAccess`/`findByEmail`, backed by in-test maps (`membershipStore`, `userStore`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @kuruma/api test -- src/services/operator-application.test.ts`
Expected: FAIL — `approve()` still returns `inviteUrl` and writes an invite, not a membership.

- [ ] **Step 3: Rewrite `approve()` + `provision()`**

In `operator-application.ts`:
- Remove imports: `{ type MintedInvite, mintInvite }` from `./invite-mint`, `{ buildProviderInviteRecord }` from `./provider-invite-record`, `type { ProviderInviteAuditEvent }` from `./provider-invite`, and `PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT` from `../pg-errors` (verify no remaining use before deleting each).
- Change the audit union (lines 45-57) to drop `ProviderInviteAuditEvent`:

```typescript
export type OperatorApplicationAuditEvent =
  | OperatorApplicationApprovedAuditEvent
  | OperatorApplicationRejectedAuditEvent
```

- Rewrite `approve()` (drop the `minted` and the invite return):

```typescript
  async approve(
    id: string,
    reviewerUserId: string,
  ): Promise<{ operatorId: string; operatorSlug: string }> {
    const application = await this.repo.findById(id)
    if (!application) throw new NotFoundError('no application with that id')
    if (application.status !== 'PENDING') throw new ConflictError('application already reviewed')
    if (!application.applicantUserId) {
      // Sign-in-first invariant (§8): a PENDING row always carries its applicant.
      // A legacy anonymous row is handled via the admin escape hatch, not this path.
      throw new ConflictError('application is not linked to an account; use the manual invite')
    }
    const outcome = await this.provisionApproval(id, application, reviewerUserId)
    for (const e of outcome.events) this.recordAudit(e)
    // Best-effort notify (§6.4); post-commit, never rolls back the decision.
    await this.notifyApproved(application, outcome)
    return { operatorId: outcome.operatorId, operatorSlug: outcome.operatorSlug }
  }
```

- Update `provisionApproval` + `provision` signatures to drop the `minted: MintedInvite` param, and rewrite `provision()`'s body to promote instead of invite:

```typescript
  private async provision(
    repos: OperatorApprovalRepos,
    id: string,
    application: OperatorApplication,
    reviewerUserId: string,
  ): Promise<ApprovalOutcome> {
    await assertEmailUnclaimed(repos, application.contactEmail)
    const slug = await resolveUniqueSlug(slugify(application.businessName), (s) =>
      repos.operators.existsBySlug(s),
    )
    const operator = await repos.operators.create({
      name: application.businessName,
      slug,
      preAuthHandoffUrl: null,
    })
    // Direct promotion (§6.2): same membership + users-projection writes
    // operator-grant.resolve() does, minus the token lookup + email match.
    // applicantUserId is non-null (guarded in approve()).
    const applicantUserId = application.applicantUserId as string
    await repos.memberships.create({
      userId: applicantUserId,
      operatorId: operator.id,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    await repos.users.setOperatorAccess(applicantUserId, {
      role: 'OPERATOR_OWNER',
      operatorId: operator.id,
    })
    // Atomic claim + race fence: the throw rolls back operator + membership + projection.
    const claimed = await repos.applications.markApprovedIfPending(id, operator.id, reviewerUserId, new Date())
    if (!claimed) throw new ConflictError('application already reviewed')
    return {
      operatorId: operator.id,
      operatorSlug: slug,
      events: [
        { type: 'OPERATOR_APPLICATION_APPROVED', actorUserId: reviewerUserId, operatorId: operator.id, applicationId: id },
      ],
    }
  }
```

- In `provisionApproval`, remove the `PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT` catch branch (lines 167-169) — no invite is written, so that constraint can't fire here. Keep the `OPERATORS_SLUG_CONSTRAINT` retry.
- Leave `notifyApproved`/`fakeEmailSender`/`this.deps.emailSender` as a stub for now if Phase 4 lands after; to keep this task self-contained, add a private `notifyApproved` that is a no-op returning `Promise.resolve()` and fill it in Task 12. (Simpler: defer the `notifyApproved` call + the emailSender ctor arg to Task 12 and DON'T reference them here. Choose one: implement approval promotion WITHOUT the email call in this task, add the email in Task 12. The test in Step 1 must then NOT pass `fakeEmailSender` — keep the 4-arg constructor until Task 12.)

> Decision: implement Task 6 with the **existing 4-arg constructor** (no email). Drop the `notifyApproved` line from `approve()` here; add it in Task 12 alongside the constructor change. This keeps each task's diff minimal and its tests focused.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @kuruma/api test -- src/services/operator-application.test.ts`
Expected: PASS. Then `bun run --filter @kuruma/api typecheck` — PASS (confirms no dangling `mintInvite`/`ProviderInviteAuditEvent` references).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/operator-application.ts packages/api/src/services/operator-application.test.ts
git commit -m "feat(onboarding): approval promotes the applicant account directly"
```

### Task 7: Real-pg atomic-promotion integration test

**Files:**
- Create: `packages/api/tests/neon/operator-application-promotion-tx.test.ts` (replaces the invite assertions in `operator-approval-tx.test.ts`)
- Modify/delete: `packages/api/tests/neon/operator-approval-tx.test.ts`

- [ ] **Step 1: Write the failing test**

Mirror the existing `operator-approval-tx.test.ts` seed skeleton (create a real user + a PENDING application via the drizzle repos, construct the service with `createDrizzleOperatorApproval(runTx)`), then assert promotion instead of invites:

```typescript
it('commits operator + OWNER membership + users projection atomically (positive control)', async () => {
  const db = getDb()
  const userId = await seedUser(db, { email: `owner-${uniq()}@x.io`, role: 'RENTER' })
  const app = await seedApplication(db, { applicantUserId: userId, contactEmail: `owner-${uniq()}@x.io`, businessName: `Acme ${uniq()}` })
  const service = buildService(db) // OperatorApplicationService with drizzle approval runner

  const r = await service.approve(app.id, adminId)

  const [operator] = await db.select().from(operators).where(eq(operators.id, r.operatorId))
  expect(operator?.slug).toBe(r.operatorSlug)
  const memberships = await db.select().from(operatorMemberships).where(eq(operatorMemberships.operatorId, r.operatorId))
  expect(memberships).toHaveLength(1)
  expect(memberships[0]).toMatchObject({ userId, role: 'OPERATOR_OWNER', status: 'ACTIVE' })
  const [promoted] = await db.select().from(users).where(eq(users.id, userId))
  expect(promoted).toMatchObject({ role: 'OPERATOR_OWNER', operatorId: r.operatorId })
  const [appRow] = await db.select().from(operatorApplications).where(eq(operatorApplications.id, app.id))
  expect(appRow?.status).toBe('APPROVED')
})

it('rolls back operator + membership + projection when the in-tx claim fails (concurrent approve)', async () => {
  // seed as above; pre-mark the application APPROVED (so markApprovedIfPending returns undefined)
  // then approve → ConflictError; assert NO orphan operator, NO membership, users row still RENTER.
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @kuruma/api test:neon -- tests/neon/operator-application-promotion-tx.test.ts`
Expected: FAIL first because the old file may still assert invite rows; once written against the new `approve()`, the positive control passes and the rollback case proves atomicity. (Requires a real PG — locally `bun run test:e2e:real-db:local` provisions one, or point `NEON_TEST_DATABASE_URL`/the neon config at a branch. CI runs it.)

- [ ] **Step 3: Delete the obsolete invite-shaped assertions**

Remove `operator-approval-tx.test.ts` (fully superseded) OR gut its two `it(...)` cases and fold them into the new file. Ensure no remaining `provider_invites` assertion in the approval tx suite.

- [ ] **Step 4: Run the neon suite**

Run: `bun run --filter @kuruma/api test:neon`
Expected: PASS (promotion positive control + rollback; no invite assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/api/tests/neon
git commit -m "test(onboarding): real-pg atomic promotion on approval (membership + users projection)"
```

### Task 8: Delete `remintInvite` (service + route + web + tests)

**Files:**
- Modify: `packages/api/src/services/operator-application.ts` (delete `remintInvite`, lines ~224-285)
- Modify: `packages/api/src/routes/admin-operator-applications.ts:93-104` (delete the remint route) + `:78-92` (approve returns identity only)
- Modify: `packages/api/tests/routes/admin-operator-applications.test.ts` (delete remint tests; fix approve response shape)

- [ ] **Step 1: Update the failing route tests first**

In `admin-operator-applications.test.ts`:
- Change the approve test (lines ~283-305) to assert `data` is `{ operatorId }` only — assert `data.inviteUrl` is `undefined` and `expiresAt` is `undefined`:
```typescript
expect(data).toEqual({ operatorId: expect.any(String) })
expect(data).not.toHaveProperty('inviteUrl')
```
- Delete the entire `describe('POST /admin/operator-applications/:id/remint-invite', ...)` block (lines ~375-440).
- The C1 test (lines ~352-372) that seeds a pending invite: keep it only if `assertEmailUnclaimed` still guards live invites; since approval no longer mints invites but `assertEmailUnclaimed` still checks `findPendingByEmail`, keep it as a cross-aggregate guard test (a manually-minted OWNER invite for the same email should still block approval).

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @kuruma/api test -- tests/routes/admin-operator-applications.test.ts`
Expected: FAIL — approve still returns `inviteUrl`; remint route still exists.

- [ ] **Step 3: Delete the code**

- In `operator-application.ts`: delete the whole `remintInvite(...)` method (lines ~224-285) and its doc comment. Run typecheck to surface any now-unused import (`mintInvite` already removed in Task 6; ensure nothing else references it).
- In `admin-operator-applications.ts`: delete the `.post('/admin/operator-applications/:id/remint-invite', ...)` chain (lines 93-104). Change the approve handler's response to:
```typescript
      const result = await service.approve(idr.id, user.id)
      return ok(c, { operatorId: result.operatorId })
```
Update the file's top doc comment (lines 28-30) to describe direct promotion instead of "provisions the operator + OWNER invite and returns the one-time invite link".

- [ ] **Step 4: Run to verify pass**

Run: `bun run --filter @kuruma/api test -- tests/routes/admin-operator-applications.test.ts src/services/operator-application.test.ts` and `bun run --filter @kuruma/api typecheck`
Expected: PASS across all three; no unused-symbol errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/operator-application.ts packages/api/src/routes/admin-operator-applications.ts packages/api/tests/routes/admin-operator-applications.test.ts
git commit -m "feat(onboarding): remove invite reminting from application approval"
```

---

## Phase 3 — Sign-in-first application

### Task 9: Authed submit with server-derived email + already-operator guard

**Files:**
- Modify: `packages/shared/src/validators/operator-application.ts:10-39`
- Modify: `packages/api/src/routes/operator-applications.ts`
- Modify: `packages/api/src/services/operator-application.ts` (`submit` links applicantUserId + 409)
- Test: `packages/api/tests/routes/operator-applications.test.ts` (+ service test)

- [ ] **Step 1: Write the failing tests**

Route test — submit now requires auth and ignores any client `contactEmail`:

```typescript
it('requires authentication (401 without a session)', async () => {
  const res = await app.request('/operator-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validForm) })
  expect(res.status).toBe(401)
})

it('derives contactEmail + applicantUserId from the session, not the request body', async () => {
  const res = await postAuthed('/operator-applications', { ...validForm, contactEmail: 'attacker@evil.io' }, { userId: 'user_7', email: 'real@x.io' })
  expect(res.status).toBe(201)
  const stored = service.lastSubmitted()
  expect(stored).toMatchObject({ contactEmail: 'real@x.io', applicantUserId: 'user_7' })
})

it('409s when the caller already owns/staffs an operator', async () => {
  seedActiveMembership('user_7')
  const res = await postAuthed('/operator-applications', validForm, { userId: 'user_7', email: 'real@x.io' })
  expect(res.status).toBe(409)
})
```

Service test — `submit` sets `applicantUserId` and throws on an existing membership:

```typescript
it('links the application to applicantUserId', async () => {
  const r = await service.submit({ ...domainFields, applicantUserId: 'user_7', contactEmail: 'real@x.io' })
  expect(repo.lastCreated).toMatchObject({ applicantUserId: 'user_7', contactEmail: 'real@x.io' })
})
it('throws ConflictError when the caller already has an active membership', async () => {
  seedActiveMembership('user_7')
  await expect(service.submit({ ...domainFields, applicantUserId: 'user_7', contactEmail: 'real@x.io' })).rejects.toThrow('you already belong to an operator')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @kuruma/api test -- tests/routes/operator-applications.test.ts src/services/operator-application.test.ts`
Expected: FAIL — route is public, `submit` has no `applicantUserId`/membership guard.

- [ ] **Step 3: Implement**

Validator (`operator-application.ts`): remove `contactEmail` from `operatorApplicationSchema` (the server derives it). Keep the rest. Export a separate type if the web still needs the field name for display; the API input type becomes the schema minus email. (Confirm downstream `SubmitInput` in the service is realigned to include a server-provided `contactEmail` + `applicantUserId` rather than reading them from the parsed body.)

Route (`routes/operator-applications.ts`): wrap the submit route with `requireAuth()` and derive identity:

```typescript
export function createOperatorApplicationRoutes(
  service: OperatorApplicationService,
  limiter?: RateLimitBinding,
) {
  const app = new Hono()
  app.use('/operator-applications', requireAuth())
  if (limiter) app.use('/operator-applications', rateLimitByIp(limiter))
  return app.post('/operator-applications', async (c) => {
    const user = requireUser(c)
    const parsed = await parseBody(c, operatorApplicationSchema)
    if (!parsed.ok) return parsed.response
    const { honeypot, consent: _c, ...data } = parsed.data
    if (honeypot) return ok(c, { id: crypto.randomUUID(), status: 'PENDING' }, 201)
    // Email + applicant come from the authenticated account, never the request body
    // (§6.1 invariant: applicantUserId ↔ contactEmail derived from one session).
    const email = requireUserEmail(user) // helper: the account email; 400 if the token has none
    const result = await service.submit({ ...data, applicantUserId: user.id, contactEmail: email })
    return ok(c, result, 201)
  })
}
```

Import `requireAuth`, `requireUser` from `../middleware/auth`. For the account email: the session token carries `email` in its profile claims (§5.1); expose it on `AuthUser` if not already, or read it from the verified session. If `AuthUser` does not carry email, derive it inside the service via `repos.users.findById(user.id)` instead — pick whichever keeps the route off the repo layer. Preferred: pass `user.id` only and have `submit()` resolve the account email from the users repo (server-authoritative, avoids trusting the token's display email). Adjust the test accordingly (seed the user's email in the fake users repo).

Service (`operator-application.ts`): change `submit` to require `applicantUserId`, resolve the authoritative email + membership guard, then create:

```typescript
  async submit(input: SubmitInput & { applicantUserId: string }): Promise<Pick<OperatorApplication, 'id' | 'status'>> {
    // Already-operator guard (§6.1) — a NET-NEW check, distinct from the live-email
    // unique index 409 below.
    const membership = await this.members.findActiveByUserId(input.applicantUserId)
    if (membership) throw new ConflictError('you already belong to an operator')
    const account = await this.users.findById(input.applicantUserId)
    if (!account?.email) throw new ConflictError('your account has no email on file')
    try {
      const app = await this.repo.create({
        businessName: input.businessName,
        contactName: input.contactName,
        contactEmail: account.email,
        applicantUserId: input.applicantUserId,
        contactPhone: input.contactPhone,
        serviceArea: input.serviceArea,
        estimatedFleetSize: input.estimatedFleetSize,
        website: input.website ?? null,
        businessLicenseNumber: input.businessLicenseNumber ?? null,
        businessType: input.businessType ?? null,
        message: input.message ?? null,
        submittedLocale: input.submittedLocale,
      })
      return { id: app.id, status: app.status }
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION && pgConstraintName(err) === OPERATOR_APPLICATION_EMAIL_CONSTRAINT) {
        throw new ConflictError('an application or account already exists for this email')
      }
      throw err
    }
  }
```

This needs two new constructor deps on `OperatorApplicationService`: a `members: Pick<OperatorMembershipRepository, 'findActiveByUserId'>` and a `users: Pick<UserRepository, 'findById'>` (non-tx reads, injected from the composition root's singletons). Add them to the constructor and wire in `index.ts` (line 269). Update `operator-application.test.ts` and any other constructor call site (grep `new OperatorApplicationService`) — expect 1 prod call site (index.ts) + test builders. Also update the `operatorApplications.applicantUserId`/`contactEmail` type on the repo `create` input (`repositories/types.ts` + drizzle + in-memory operator-application repos).

> Learn: `Primitive Obsession` / call-site sweep — a constructor-signature change must grep every `new OperatorApplicationService(` (prod + `scripts/**` + `tests/**`, which tsc excludes). Heuristic: interface/ctor change → grep call sites, not just method names.

- [ ] **Step 4: Run to verify pass**

Run: `bun run --filter @kuruma/api test -- tests/routes/operator-applications.test.ts src/services/operator-application.test.ts` then `bun run --filter @kuruma/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validators/operator-application.ts packages/api/src/routes/operator-applications.ts packages/api/src/services/operator-application.ts packages/api/src/repositories packages/api/src/index.ts packages/api/tests
git commit -m "feat(onboarding): sign-in-first application submit with server-derived email"
```

### Task 10: `GET /operator-applications/me` self-read

**Files:**
- Modify: `packages/api/src/repositories/types.ts` + `drizzle/operator-application.ts` + `in-memory/operator-application.ts` (add `findByApplicantUserId`)
- Modify: `packages/api/src/services/operator-application.ts` (add `findMine`)
- Modify: `packages/api/src/routes/operator-applications.ts` (add the GET)
- Test: `packages/api/tests/routes/operator-applications.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('GET /operator-applications/me returns the caller’s own application', async () => {
  const created = await postAuthed('/operator-applications', validForm, { userId: 'user_7', email: 'real@x.io' })
  const res = await getAuthed('/operator-applications/me', { userId: 'user_7' })
  expect(res.status).toBe(200)
  expect((await res.json()).data).toMatchObject({ status: 'PENDING', applicantUserId: 'user_7' })
})
it('GET /operator-applications/me returns 404 when the caller has none', async () => {
  const res = await getAuthed('/operator-applications/me', { userId: 'user_none' })
  expect(res.status).toBe(404)
})
it('another user cannot read someone else’s application', async () => {
  await postAuthed('/operator-applications', validForm, { userId: 'user_7', email: 'real@x.io' })
  const res = await getAuthed('/operator-applications/me', { userId: 'user_other' })
  expect(res.status).toBe(404)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @kuruma/api test -- tests/routes/operator-applications.test.ts`
Expected: FAIL — route + repo method missing.

- [ ] **Step 3: Implement**

- Repo interface (`types.ts`): `findByApplicantUserId(userId: string): Promise<OperatorApplication | undefined>`. Drizzle: `select().from(operatorApplications).where(eq(operatorApplications.applicantUserId, userId)).orderBy(desc(createdAt)).limit(1)`. In-memory: filter the array by `applicantUserId`, return the newest.
- Service: `async findMine(userId: string) { return this.repo.findByApplicantUserId(userId) }`.
- Route (add before the existing POST, still under `requireAuth`):
```typescript
    .get('/operator-applications/me', async (c) => {
      const user = requireUser(c)
      const mine = await service.findMine(user.id)
      if (!mine) return fail(c, 'no application found', 404)
      return ok(c, mine)
    })
```
Import `fail` (already imported via helpers in most route files — add if absent).

- [ ] **Step 4: Run to verify pass**

Run: `bun run --filter @kuruma/api test -- tests/routes/operator-applications.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories packages/api/src/services/operator-application.ts packages/api/src/routes/operator-applications.ts packages/api/tests
git commit -m "feat(onboarding): add renter-scoped GET /operator-applications/me self-read"
```

---

## Phase 4 — Notifications (email via `emailSender`)

### Task 11: Approved + rejected email templates

**Files:**
- Create: `packages/api/src/services/email/templates/operator-application-approved.ts`, `...-rejected.ts`
- Modify: `packages/api/src/services/email/templates/messages/index.ts` (add strings)
- Test: `packages/api/src/services/email/templates/operator-application-emails.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from 'vitest'
import { renderOperatorApplicationApproved } from './operator-application-approved'
import { renderOperatorApplicationRejected } from './operator-application-rejected'

describe('operator application emails', () => {
  test('approved: subject names the business, body links the welcome route', () => {
    const email = renderOperatorApplicationApproved({ businessName: 'Acme', welcomeUrl: 'https://web/en/operator/welcome' }, 'en')
    expect(email.subject).toContain('Acme')
    expect(email.html).toContain('https://web/en/operator/welcome')
    expect(email.text).toContain('https://web/en/operator/welcome')
  })
  test('rejected: body renders the captured reason', () => {
    const email = renderOperatorApplicationRejected({ businessName: 'Acme', reason: 'Incomplete license number' }, 'en')
    expect(email.subject).toContain('Acme')
    expect(email.html).toContain('Incomplete license number')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @kuruma/api test -- src/services/email/templates/operator-application-emails.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement (mirror `renter-cancellation.ts` shape)**

`operator-application-approved.ts`:

```typescript
import type { RenderedEmail } from './layout'
import { renderRowsEmail } from './layout'
import { emailStrings } from './messages'

export interface OperatorApplicationApprovedData {
  businessName: string
  welcomeUrl: string
}

export function renderOperatorApplicationApproved(
  data: OperatorApplicationApprovedData,
  locale: string,
): RenderedEmail {
  const m = emailStrings(locale)
  const rows: Array<[string, string]> = [
    [m.operatorApplicationBusinessLabel, data.businessName],
    [m.operatorApplicationWelcomeLabel, data.welcomeUrl],
  ]
  return {
    subject: `${m.operatorApplicationApprovedSubject} ${data.businessName}`,
    ...renderRowsEmail(m.operatorApplicationApprovedHeading, rows),
  }
}
```

`operator-application-rejected.ts` mirrors it with a `reason` row and `...RejectedSubject`/`...RejectedHeading`.

In `messages/index.ts`, add the six keys to each locale's `EmailStrings` object (en/ja/zh) — `operatorApplicationApprovedSubject`, `operatorApplicationApprovedHeading`, `operatorApplicationRejectedSubject`, `operatorApplicationRejectedHeading`, `operatorApplicationBusinessLabel`, `operatorApplicationWelcomeLabel`, plus a reason label. Follow the existing structure of `EmailStrings` (add the fields to the interface + every locale map so tsc enforces completeness).

- [ ] **Step 4: Run to verify pass**

Run: `bun run --filter @kuruma/api test -- src/services/email/templates/operator-application-emails.test.ts` and `bun run --filter @kuruma/api typecheck`
Expected: PASS (typecheck confirms all three locale maps carry the new keys).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/email/templates
git commit -m "feat(onboarding): add operator application approved/rejected email templates"
```

### Task 12: Best-effort send from approve()/reject()

**Files:**
- Modify: `packages/api/src/services/operator-application.ts` (inject `EmailSender`, add `notifyApproved`/`notifyRejected`, call post-commit)
- Modify: `packages/api/src/index.ts:269-274` (inject `emailSender` + `webBaseUrl` already present)
- Test: `packages/api/src/services/operator-application.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
it('approve() sends the approved email to the applicant account (best-effort)', async () => {
  const sender = { send: vi.fn(async () => ({ providerMessageId: 'm1' })) }
  const service = buildService({ emailSender: sender })
  await service.approve('app_1', 'admin_1')
  expect(sender.send).toHaveBeenCalledTimes(1)
  expect(sender.send.mock.calls[0][0]).toMatchObject({ to: 'real@x.io', subject: expect.stringContaining('Acme') })
})
it('reject() sends the rejected email with the reason', async () => {
  const sender = { send: vi.fn(async () => ({ providerMessageId: 'm1' })) }
  const service = buildService({ emailSender: sender })
  await service.reject('app_1', 'admin_1', 'Incomplete license number')
  expect(sender.send.mock.calls[0][0].html).toContain('Incomplete license number')
})
it('a send failure does not throw or roll back the decision', async () => {
  const sender = { send: vi.fn(async () => { throw new Error('smtp down') }) }
  const service = buildService({ emailSender: sender })
  const r = await service.approve('app_1', 'admin_1') // must resolve
  expect(r.operatorId).toBeDefined()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @kuruma/api test -- src/services/operator-application.test.ts`
Expected: FAIL — no `emailSender` ctor arg / no send.

- [ ] **Step 3: Implement**

Add `emailSender: EmailSender` as a constructor dep (import the type from `./email/email-sender`). In `approve()` after the commit + audit, call `await this.notifyApproved(application, outcome)`; in `reject()` after the audit, call `await this.notifyRejected(row)`. Each helper is best-effort (mirror `compliance-digest.ts:142-151`):

```typescript
  private async notifyApproved(application: OperatorApplication, outcome: ApprovalOutcome): Promise<void> {
    try {
      const welcomeUrl = `${this.config.webBaseUrl}/${application.submittedLocale}/operator/welcome`
      const email = renderOperatorApplicationApproved({ businessName: application.businessName, welcomeUrl }, application.submittedLocale)
      await this.emailSender.send({ to: application.contactEmail, from: resolveFromAddress(), subject: email.subject, html: email.html, text: email.text })
    } catch (err) {
      console.error('[operator-application] approved email failed', { applicationId: application.id, err })
    }
  }
```

`notifyRejected` mirrors it with `renderOperatorApplicationRejected({ businessName, reason: row.rejectionReason ?? '' }, row.submittedLocale)`. Use the same `from`/config the other templates use (grep how `resolveNotificationDispatcher` builds its `from` — reuse `resolveEmailConfig()`); pass the needed config into `OperatorApplicationServiceConfig` (add a `fromAddress` field) rather than hardcoding.

Wire in `index.ts` (line 269): add `emailSender` as the new last constructor arg and extend the config object with the from address (reuse `resolveEmailConfig()`).

- [ ] **Step 4: Run to verify pass**

Run: `bun run --filter @kuruma/api test -- src/services/operator-application.test.ts` and `bun run --filter @kuruma/api typecheck` — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/operator-application.ts packages/api/src/index.ts packages/api/tests packages/api/src/services/operator-application.test.ts
git commit -m "feat(onboarding): best-effort approve/reject applicant emails"
```

---

## Phase 5 — Web

> All web tasks: `bun run --filter @kuruma/web test -- <path>` for the RED/GREEN cycle; `bun run --filter @kuruma/web typecheck` before commit. Adding a route requires `bun run --filter @kuruma/web build` to regenerate `routeTree.gen.ts` before typecheck.

### Task 13: Welcome landing route (session-invalidation trigger)

**Files:**
- Create: `packages/web/src/routes/$locale/operator/welcome.tsx`
- Test: `packages/web/src/routes/$locale/operator/welcome.test.tsx` (or the file-route test pattern the repo uses)

- [ ] **Step 1: Write the failing test**

A test that mounts the route with a `QueryClient` pre-seeded with a stale RENTER `['session']` entry and a fetch mock that returns an OWNER session; assert the loader invalidates `['session']` (forcing a refetch) and that a just-approved user lands on the portal rather than the forbidden redirect. Mirror an existing route test (grep `createFileRoute` tests under `packages/web/src`). Assert:

```typescript
// after loader runs, the session query is refetched (fetchSession called) and
// the redirect target is the operator dashboard, not /$locale
expect(fetchSessionSpy).toHaveBeenCalled()
expect(redirectTarget).toContain('/manage')
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run --filter @kuruma/web test -- src/routes/$locale/operator/welcome.test.tsx`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { sessionQueryOptions } from '@/vite/session'

export const Route = createFileRoute('/$locale/operator/welcome')({
  beforeLoad: async ({ context, params }) => {
    // H1 / §5.4: the server reconcile is a silent no-op unless the client asks
    // /auth/session AGAIN. ensureQueryData would return the stale cached RENTER,
    // so invalidate first, then read the fresh (re-minted) session.
    await context.queryClient.invalidateQueries({ queryKey: ['session'] })
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (session?.user.operatorSlug) {
      throw redirect({ to: '/$locale/manage/$slug', params: { locale: params.locale, slug: session.user.operatorSlug } })
    }
    // Still pending / not approved yet: fall through to a friendly holding page.
  },
  component: OperatorWelcomePending,
})
```

`OperatorWelcomePending` renders a "we're still reviewing / check back" message (i18n `operator.welcome.*`). Match the real dashboard route path (`/$locale/manage/$slug` or whatever `_business` mounts — verify against `routeTree.gen.ts`).

- [ ] **Step 4: Run to verify pass** + `bun run --filter @kuruma/web build` then `typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes/$locale/operator packages/web/messages
git commit -m "feat(onboarding): welcome route invalidates session to auto-promote"
```

### Task 14: Sign-in-first register form + locked email

**Files:**
- Modify: `packages/web/src/routes/$locale/business/register.tsx`
- Modify: `packages/web/src/vite/operator-registration/{api.ts,OperatorRegistrationForm.tsx}`
- Test: the existing register/form tests + new gating test

- [ ] **Step 1: Write the failing test**

Assert: (a) a signed-out visitor to `/business/register` is redirected to Google sign-in with `returnTo` = the form; (b) a signed-in renter sees their account email locked (read-only, prefilled from session), and the submit payload does NOT include a client-entered email; (c) submit calls the API with `credentials: 'include'`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

- `register.tsx`: add a `beforeLoad` that reads the session (`ensureQueryData(sessionQueryOptions())`); if signed-out, `redirect` to `/$locale/login` with `returnTo` = the register path; if signed-in, pass the session email into the form as a locked value. If already an operator, redirect to the portal (defense-in-depth; the API 409s too).
- `OperatorRegistrationForm.tsx`: render the contact email field as read-only, value = the session email (remove it from the editable/validated set, or set `readOnly` + omit from the submit payload). Keep the other fields.
- `api.ts` `submitOperatorApplication`: change `credentials: 'omit'` → `credentials: 'include'`, drop `contactEmail` from the request body, and send the CSRF token header (the endpoint is now authed + non-GET → the global csrf guard applies). Read the csrf token from `useSession().csrfToken` and thread it into the mutation (mirror how `remintInvite`/`approveApplication` pass `X-CSRF-Token` in `admin/operator-applications/api.ts`).

- [ ] **Step 4: Run to verify pass** + web build + typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes/$locale/business packages/web/src/vite/operator-registration
git commit -m "feat(onboarding): sign-in-first operator registration form with locked email"
```

### Task 15: Applicant status surface

**Files:**
- Create: `packages/web/src/routes/$locale/_renter/account/application-status.tsx` (verify the renter route group + a good home for it)
- Modify: `packages/web/src/vite/operator-registration/api.ts` (`getMyApplication` + query options)
- Test: new route test

- [ ] **Step 1: Write the failing test**

Assert the page renders PENDING / APPROVED (with a portal CTA) / REJECTED (with the reason) based on the `GET /operator-applications/me` response; 404/empty → an "apply now" prompt.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`api.ts`:
```typescript
export async function getMyApplication(): Promise<MyApplication | null> {
  const res = await fetch(`${getApiBaseUrl()}/operator-applications/me`, { credentials: 'include' })
  if (res.status === 404) return null
  return unwrap(res, myApplicationSchema)
}
export function myApplicationQueryOptions() {
  return queryOptions({ queryKey: ['operator-applications', 'me'], queryFn: getMyApplication })
}
```
`myApplicationSchema` parses `{ id, status: 'PENDING'|'APPROVED'|'REJECTED', rejectionReason: string | null, operatorId: string | null, businessName }`. The status page reads it via `useQuery(myApplicationQueryOptions())` and branches. i18n `operator.applicationStatus.*`.

- [ ] **Step 4: Run to verify pass** + web build + typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes packages/web/src/vite/operator-registration packages/web/messages
git commit -m "feat(onboarding): applicant application-status surface"
```

### Task 16: Drop the admin invite-link/remint UI

**Files:**
- Modify: `packages/web/src/vite/admin/operator-applications/api.ts` (`approveResultDtoSchema`, delete `remintInvite`/`RemintResultDto`)
- Modify: `packages/web/src/vite/admin/operator-applications/ApplicationReviewCard.tsx:162-199`
- Modify: `packages/web/src/routes/$locale/_admin/admin/operator-applications.tsx:51-65`
- Modify: `packages/web/messages/{en,ja,zh}.json` (remove dead invite keys)
- Test: `packages/web/src/vite/admin/operator-applications/api.test.ts` + card test

- [ ] **Step 1: Update the failing tests first**

In `api.test.ts`: change the `approveApplication` mock/response to `{ operatorId }` only and assert the parsed result equals `{ operatorId }`; delete the entire `describe('remintInvite', ...)` block (lines ~133-165). Update the card test to assert the invite-link `<output>` block and the copy/regenerate buttons are gone and that an approved card shows a plain "Approved" confirmation.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

- `api.ts`: `approveResultDtoSchema = z.object({ operatorId: z.string() })`; delete `remintResultDtoSchema`, `RemintResultDto`, and the `remintInvite` fn.
- `ApplicationReviewCard.tsx`: delete the `{inviteUrl !== null ? (<output>...) : (...)}` conditional (lines 162-199); on approved, render a simple confirmation (`t('approved')`) and drop the `onRemint`/`inviteUrl` props.
- `operator-applications.tsx`: delete `remintMutation` (lines 60-65), drop the `onSuccess` that stored `result.inviteUrl` from `approveMutation` (lines 51-58), and remove the `approvedInvites` state + `onRemint` prop threading.
- Remove dead i18n keys from all three locale files: `inviteReadyLabel`, `inviteReadyHint`, `copy`, `copied`, `regenerate`, `regenerating`, `regenerateUnavailable`, `regenerateFailed` under `admin.applications`.

- [ ] **Step 4: Run to verify pass** + web build + typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite/admin/operator-applications packages/web/src/routes/$locale/_admin packages/web/messages
git commit -m "feat(onboarding): admin approval confirms promotion, drop invite-link UI"
```

---

## Phase 6 — E2E, regression, and final verification

### Task 17: Rewrite the onboarding e2e

**Files:**
- Rewrite: `e2e/real-db/operator-onboarding.auth.spec.ts` (currently untracked, tests the OLD flow)

- [ ] **Step 1: Rewrite the journey**

New journey (apply → approve → auto-promote), mirroring the `*.auth.spec.ts` harness (`e2e/real-db/mint-session.ts`, `locations.auth.spec.ts` template):
1. Mint a RENTER session for a fresh applicant; visit `/business/register`; submit the form (email locked to the account).
2. Assert DB: a PENDING `operator_applications` row with `applicantUserId` = the applicant's id.
3. Mint a PLATFORM_ADMIN session; visit `/admin/operator-applications`; click Approve; assert the card shows the plain "Approved" confirmation (no invite-link field).
4. Assert DB: application APPROVED + a `operator_memberships` row `(applicantUserId, OPERATOR_OWNER, ACTIVE)` + `users.role=OPERATOR_OWNER`/`operatorId` set. Assert NO `provider_invites` row was created for this application.
5. As the applicant (same session cookie), navigate to `/operator/welcome`; assert the reconcile lands them on the operator portal (dashboard visible) with no re-login.

Remove all invite-link/`/provider/invite/` assertions.

- [ ] **Step 2: Run the e2e**

Run: `bun run test:e2e:real-db:local` (provisions docker PG + Vite + API) then the spec, or `bun run test:e2e:real-db` against a seeded branch.
Expected: PASS. Sabotage-check: neuter the `setOperatorAccess` write in `provision()` → step 5 (portal load) fails.

- [ ] **Step 3: Commit**

```bash
git add e2e/real-db/operator-onboarding.auth.spec.ts
git commit -m "test(e2e): sign-in-first onboarding apply→approve→auto-promote"
```

### Task 18: Invite-acceptance regression (P1a)

**Files:**
- Test: extend an existing provider-invite integration/route test (`packages/api/tests/routes/provider-invites.test.ts` and/or a neon acceptance test)

- [ ] **Step 1: Write the regression test**

Prove BOTH paths still redeem end to end after application-approval invite-minting was removed:
- a STAFF invite minted via `POST /operators/me/invites` → redeemed via `operator-grant.resolve()` → membership created;
- a manually-minted OWNER invite via `POST /admin/provider-invites` → redeemed → `OPERATOR_OWNER` membership + `users.setOperatorAccess`.

Assert the operator-grant path is byte-for-byte intact (it was never touched). This is the guard that would fail if someone later edits `operator-grant.ts`/`invite-mint.ts`.

- [ ] **Step 2: Run to verify pass**

Run: `bun run --filter @kuruma/api test -- tests/routes/provider-invites.test.ts` (+ the neon acceptance test if added).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/api/tests
git commit -m "test(onboarding): guard STAFF + manual-OWNER invite acceptance survives (P1a)"
```

### Task 19: Full-suite verification + docs

**Files:**
- Verify only; optionally add a short note under `docs/` linking spec ↔ plan.

- [ ] **Step 1: Run every gate**

```bash
bun run --filter @kuruma/api typecheck
bun run --filter @kuruma/web typecheck
bun run --filter @kuruma/api test
bun run --filter @kuruma/api test:integration
bun run --filter @kuruma/api test:neon
bun run --filter @kuruma/web test
bun run --filter @kuruma/api lint:boundaries
bun run lint:fk-indexes
bun run lint:modules
bun run db:verify
bun run test:e2e:real-db   # or :local
```
Expected: all green. Investigate any red before proceeding — no known-failing gates.

- [ ] **Step 2: i18n parity**

Run the repo's i18n parity check (the script `lint:*`/`i18n` used elsewhere — grep `package.json` for `i18n`). Expected: en/ja/zh key sets match after the add/remove in Tasks 13-16.

- [ ] **Step 3: Self-review against the spec**

Re-read spec §5.1 (profile C1, Cache-Control M3, csrf L2), §5.5 (revoke-ordering H2/H3), §6.2 (widening M1), §6.4 (email best-effort), §7 (removed vs kept), §11 (every test present). Confirm each has a landed task. Fix gaps inline.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/operator-onboarding-signin-first
gh pr create --base develop --title "Sign-in-first operator onboarding" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-07-12-operator-onboarding-signin-first-design.md.
Refs #<onboarding-epic>  (NOT Closes — confirm scope with owner)

## What
- Session reconcile at GET /auth/session (re-mint on RENTER→OWNER, operators unchanged).
- Direct-promotion approval (membership + users projection), invite-minting removed from approval.
- Sign-in-first application (authed submit, locked email, applicant status surface, welcome route).
- Best-effort approve/reject emails via EmailSender.
- P1a: STAFF + manual-OWNER invite acceptance untouched + regression-guarded.

## Test plan
- api unit + test:integration + test:neon green; web test green; e2e real-db green.
- typecheck x2, lint:boundaries, lint:fk-indexes, lint:modules, db:verify green.
EOF
)"
```

Merge: strict up-to-date, squash, NO force-push. If behind, `gh pr update-branch` (server-side, force-free), re-watch CI, then `gh pr merge --squash`.

---

## Self-Review (author checklist — completed at plan-write time)

**Spec coverage:** §5.1 reconcile → Tasks 2-4; §5.4 welcome route → Task 13; §5.5 revoke ordering → Task 4 (pins #957 + promotion); §6.1 sign-in-first submit + already-operator guard → Task 9; §6.2 direct promotion + M1 widening → Tasks 5-6; §6.4 email + in-app status → Tasks 11-12 (email) + 15 (status) + 10 (self-read); §7 removed (invite-mint, remint, anonymous form) → Tasks 6/8/14, kept (P1a acceptance) → Task 18; §8 data model → Task 1; §9 file map → all; §11 tests → each behavior has a RED step; §12 out-of-scope (no GA flip, no bell/inbox, no session_epoch) → honored.

**Placeholder scan:** No "TBD"/"add validation"/"handle edge cases". Two deliberate verify-in-place notes (account-email source in Task 9; exact dashboard route path in Task 13) are flagged as "verify against X" with the concrete fallback given, not open placeholders.

**Type consistency:** `resolveCurrentIdentity`/`provideIdentityResolver`/`CurrentIdentity` (Task 2) reused verbatim in Tasks 3-4. `approve()` returns `{ operatorId, operatorSlug }` in Tasks 6/8 and web Task 16. `applicantUserId` (text) consistent across Tasks 1/6/7/9/10/17. `OperatorApprovalRepos` widened shape (Task 5) matches the writes in Task 6.

# Team Picker (Epic #1230 Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `PLATFORM_ADMIN` read and manage a *picked* operator's team (invite / revoke / deactivate) as that operator, closing the last gap in the operator-context picker (`/operators/me/*` was self-scoped and had no foreign-id surface).

**Architecture:** One seam. Replace the service's private `requireOwnOperator(ctx)` with a pure `resolveTeamOperatorId(ctx, inputOperatorId?)` in `tenancy.ts` (allowlist: operator role → own id, input ignored; `PRIVILEGED_ROLES` → the input id, honored only here; else → 403). Thread an optional `?operatorId=` query param through the five routes and the web. No schema, no migration, no new authorization gate. The web moves the two scoped team reads + all dialog state into a keyed child so all-mode fires no read and a tenant switch resets intent.

**Tech Stack:** Hono (CF Workers) API, Vite + TanStack Router SPA, TanStack Query, Drizzle, Zod, use-intl, Vitest.

**PR / branch:** One PR, `Refs #1230` — do NOT close the epic. Implement in a fresh worktree branched off `origin/develop` (`~/Dev/kuruma-1230-team`, branch `feat/1230-team-picker`); `bun install` + `bun run db:migrate` + `bunx tsc --noEmit` after creating it.

**Design source:** `docs/superpowers/specs/2026-07-02-team-picker-design.md` (5 review rounds; verdict ready-to-plan).

---

## Ground truth (verified against the code, 2026-07-02)

- **`CallerContext`** = `{ userId: string; role: UserRole; operatorId?: string; bypassScope?: boolean }`.
- **Web `Session`** = `{ user: { id: string; role: string; operatorId?: string }; csrfToken: string }`.
- **`tenancy.ts`** already imports `CallerContext, ForbiddenError, OperatorRequiredError, PRIVILEGED_ROLES, isOperatorRole` from `./middleware/auth` — the resolver needs no new imports.
- **`isOperatorRole`** is true only for `OPERATOR_OWNER`/`OPERATOR_STAFF`. **`PRIVILEGED_ROLES`** = `{PLATFORM_ADMIN}`.
- **Resolver unit tests** live in `packages/api/tests/tenancy.test.ts` (where `resolveOperatorIdForWrite` is tested).
- **`c.req.query('operatorId')`** returns `string | undefined`; empty string is falsy → the 422 "specify an operator" path, consistent with `resolveOperatorIdForWrite`.
- Service reads use `requireOperatorScope` + `requireOwnOperator`; writes use `requireOperatorOwnerWrite` + `requireOwnOperator`. `requireOperatorOwnerWrite` already admits `PLATFORM_ADMIN` (it is in `OPERATOR_OWNER_WRITE_ROLES`).
- **Test harnesses:** service — in-memory repos + literal `CallerContext` (`tests/services/operator-team.test.ts`); route — `mountFor(role, operatorId?)` + `testAuthMiddleware` + `app.request(url)` (`tests/routes/operator-team.test.ts`); web route render — mock `useSession`/`useOperatorContext`/`useSuspenseQuery`, wrap in `QueryClientProvider`+`IntlProvider` (`tests/vite/operator-fees/OperatorFeesRoute.test.tsx`).

## File Structure

**API — modify:**
- `packages/api/src/tenancy.ts` — add `resolveTeamOperatorId` (Task 1).
- `packages/api/src/services/operator-team.ts` — thread `inputOperatorId`; delete `requireOwnOperator` (Tasks 2, 5).
- `packages/api/src/routes/operator-team.ts` — read `c.req.query('operatorId')` on all five handlers (Tasks 3, 6).
- `packages/api/src/services/provider-invite.ts` — `OperatorNotFoundError extends NotFoundError` (Task 4).

**API — test:** `tests/tenancy.test.ts` (T1), `tests/services/operator-team.test.ts` (T2, T5), `tests/routes/operator-team.test.ts` (T3, T6), `tests/services/provider-invite.test.ts` (T4), `tests/integration/` team invite/deactivate under a picked operator (T6).

**Web — modify:**
- `packages/web/src/vite/operator-team/api.ts` — fetch/mutation `operatorId` + folded query keys (Task 7).
- `packages/web/src/vite/operator-team/{InviteStaffDialog,RevokeInviteDialog,DeactivateMemberDialog}.tsx` — `operatorId` prop (Task 8).
- `packages/web/src/vite/operator-context/operator-context.ts` — register the team route (Task 9).
- `packages/web/messages/{en,ja,zh}.json` — `business.team.pickOperatorPrompt` (Task 9).
- `packages/web/src/routes/$locale/_business/manage/team.tsx` — parent resolves capability-gated `operatorId`; new keyed `OperatorTeamData` child (Task 10).

**Web — test:** `tests/vite/operator-team-api.test.ts` (T7), `tests/vite/operator-team/{RevokeInviteDialog,DeactivateMemberDialog,InviteStaffDialog}.test.tsx` (T8), `tests/vite/operator-team/team.route.test.ts` + a new render test (T10).

---

# Slice 1 — API read scope + resolver

### Task 1: `resolveTeamOperatorId` resolver

**Files:**
- Modify: `packages/api/src/tenancy.ts`
- Test: `packages/api/tests/tenancy.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `packages/api/tests/tenancy.test.ts`. Add `resolveTeamOperatorId` to the existing import from `../src/tenancy`, and `ForbiddenError` is already imported from `../src/middleware/auth`.

```ts
describe('resolveTeamOperatorId (#1230 slice 6)', () => {
  const owner: CallerContext = { userId: 'u', role: 'OPERATOR_OWNER', operatorId: 'op-self' }
  const admin: CallerContext = { userId: 'a', role: 'PLATFORM_ADMIN', bypassScope: true }

  it('returns an operator its own id and IGNORES a foreign input (no cross-tenant)', () => {
    expect(resolveTeamOperatorId(owner)).toBe('op-self')
    expect(resolveTeamOperatorId(owner, 'op-other')).toBe('op-self')
  })

  it('fails closed for an operator that lost its operatorId claim', () => {
    const noOp: CallerContext = { userId: 'u', role: 'OPERATOR_STAFF' }
    expect(() => resolveTeamOperatorId(noOp, 'op-x')).toThrow(ForbiddenError)
  })

  it('returns the input id for a PLATFORM_ADMIN (honored ONLY here)', () => {
    expect(resolveTeamOperatorId(admin, 'op-target')).toBe('op-target')
  })

  it('throws OperatorRequiredError (422) for a PLATFORM_ADMIN with no pick — no merged team view', () => {
    expect(() => resolveTeamOperatorId(admin)).toThrow(OperatorRequiredError)
    expect(() => resolveTeamOperatorId(admin, '')).toThrow(OperatorRequiredError)
  })

  it('denies renter / partner / legacy STAFF·ADMIN outright (403) — team is owner-tier internal', () => {
    const renter: CallerContext = { userId: 'r', role: 'RENTER' }
    const partner: CallerContext = { userId: 't', role: 'PARTNER', bypassScope: true }
    const legacyStaff: CallerContext = { userId: 's', role: 'STAFF', bypassScope: false }
    const legacyAdmin: CallerContext = { userId: 'a2', role: 'ADMIN', bypassScope: false }
    for (const ctx of [renter, partner, legacyStaff, legacyAdmin]) {
      expect(() => resolveTeamOperatorId(ctx, 'op-target')).toThrow(ForbiddenError)
    }
  })
})
```

- [ ] **Step 2: Run it, verify it fails.** `bun run --filter @kuruma/api test tenancy` → FAIL: `resolveTeamOperatorId is not a function` (or import error).

- [ ] **Step 3: Implement the resolver.** Append to `packages/api/src/tenancy.ts` (below `resolveOperatorIdForWrite`):

```ts
/**
 * Resolve the operator whose TEAM the caller may read/manage (#1230 slice 6).
 *
 * Deliberately STRICTER than {@link resolveOperatorIdForWrite}: team data is
 * operator-internal, owner-tier, so a foreign operatorId is honored ONLY for
 * PRIVILEGED_ROLES (PLATFORM_ADMIN). It is an allowlist, not a bypass-first
 * denylist — operator role OR PRIVILEGED_ROLES pass; everyone else (renter,
 * PARTNER, legacy STAFF/ADMIN) falls into `else` and is denied, which is why no
 * explicit PARTNER branch is needed. Do NOT collapse this onto the write
 * resolver: it keys on `!isOperatorRole` and would honor legacy STAFF/ADMIN,
 * silently opening a cross-tenant team write (pinned by a route test).
 */
export function resolveTeamOperatorId(ctx: CallerContext, inputOperatorId?: string): string {
  if (isOperatorRole(ctx.role)) {
    if (!ctx.operatorId) throw new ForbiddenError('operator scope required')
    return ctx.operatorId // input IGNORED — an operator cannot act cross-tenant
  }
  if (PRIVILEGED_ROLES.has(ctx.role)) {
    if (inputOperatorId) return inputOperatorId // the `all` tier — honored ONLY here
    throw new OperatorRequiredError('operatorId is required: specify a target operator')
  }
  throw new ForbiddenError('operator scope required') // renter / partner / legacy
}
```

- [ ] **Step 4: Run it, verify it passes.** `bun run --filter @kuruma/api test tenancy` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/tenancy.ts packages/api/tests/tenancy.test.ts
git commit -m "feat(#1230): resolveTeamOperatorId resolver (team picker slice 6)"
```

### Task 2: Service reads accept a picked operatorId

**Files:**
- Modify: `packages/api/src/services/operator-team.ts`
- Test: `packages/api/tests/services/operator-team.test.ts`

- [ ] **Step 1: Write/UPDATE the failing tests.** In `tests/services/operator-team.test.ts`:
  1. Add `OperatorRequiredError` to the import from `../../src/auth/guards`.
  2. Change the two existing no-operatorId read expectations from `ForbiddenError` to `OperatorRequiredError` (the resolver now denies a no-pick admin with 422, not 403):
     - `listInvites` describe: `await expect(service.listInvites(ADMIN_CTX)).rejects.toThrow(OperatorRequiredError)`
     - `listMembers` describe: `await expect(service.listMembers(ADMIN_CTX)).rejects.toThrow(OperatorRequiredError)`
  3. Add these new tests (picked-id read + foreign-input-ignored):

```ts
describe('OperatorTeamService reads as a picked operator (#1230)', () => {
  it('listInvites: a PLATFORM_ADMIN with a picked operatorId reads THAT tenant', async () => {
    await inviteRepo.create({
      email: 'theirs@x.com', operatorId: 'op_2', role: 'OPERATOR_STAFF', tokenHash: 'h_2',
      status: 'PENDING', expiresAt: FUTURE, invitedByUserId: 'u_other', acceptedByUserId: null,
    })
    const invites = await service.listInvites(ADMIN_CTX, 'op_2')
    expect(invites).toHaveLength(1)
    expect(invites[0]?.email).toBe('theirs@x.com')
  })

  it('listMembers: an operator IGNORES a foreign picked id and reads its own tenant', async () => {
    await membershipRepo.create({ userId: 'u_owner', operatorId: 'op_1', role: 'OPERATOR_OWNER', status: 'ACTIVE' })
    await membershipRepo.create({ userId: 'u_other', operatorId: 'op_2', role: 'OPERATOR_OWNER', status: 'ACTIVE' })
    const members = await service.listMembers(OWNER_CTX, 'op_2')
    expect(members.map((m) => m.userId)).toEqual(['u_owner'])
  })
})
```

- [ ] **Step 2: Run it, verify it fails.** `bun run --filter @kuruma/api test operator-team` (service) → FAIL: `listInvites` takes no 2nd arg / still throws `ForbiddenError`.

- [ ] **Step 3: Implement.** In `packages/api/src/services/operator-team.ts`:
  1. Add the import: `import { resolveTeamOperatorId } from '../tenancy'`.
  2. Remove `requireOperatorScope` from the `../auth/guards` import (reads no longer use it; keep `ConflictError, ForbiddenError, NotFoundError, requireOperatorOwnerWrite`).
  3. Rewrite the two read methods:

```ts
  async listInvites(ctx: CallerContext, inputOperatorId?: string): Promise<OperatorInviteData[]> {
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    const rows = await this.invites.listByOperator(operatorId)
    return rows.map(toOperatorInviteData)
  }

  async listMembers(ctx: CallerContext, inputOperatorId?: string): Promise<OperatorMemberData[]> {
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    const memberships = await this.memberships.findActiveByOperator(operatorId)
    const usersById = new Map(
      (await this.users.findByIds(memberships.map((m) => m.userId))).map((u) => [u.id, u]),
    )
    return memberships.map((m) => toOperatorMemberData(m, usersById.get(m.userId)))
  }
```

(Leave `requireOwnOperator` in place for now — the three writes still call it; it is deleted in Task 5.)

- [ ] **Step 4: Run it, verify it passes.** `bun run --filter @kuruma/api test operator-team` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/services/operator-team.ts packages/api/tests/services/operator-team.test.ts
git commit -m "feat(#1230): thread picked operatorId into team reads"
```

### Task 3: Read routes thread `?operatorId=`

**Files:**
- Modify: `packages/api/src/routes/operator-team.ts`
- Test: `packages/api/tests/routes/operator-team.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `tests/routes/operator-team.test.ts`:

```ts
describe('read routes thread ?operatorId= for a picker-admin', () => {
  it('GET /operators/me/members?operatorId=op_2 returns op_2 members for a PLATFORM_ADMIN', async () => {
    await membershipRepo.create({ userId: 'u_b', operatorId: 'op_2', role: 'OPERATOR_OWNER', status: 'ACTIVE' })
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/me/members?operatorId=op_2')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.map((m: { userId: string }) => m.userId)).toEqual(['u_b'])
  })

  it('GET /operators/me/members with NO pick is 422 for a PLATFORM_ADMIN (no merged view)', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/me/members')
    expect(res.status).toBe(422)
  })

  it('a RENTER is 403 even with ?operatorId= (team is owner-tier internal)', async () => {
    const res = await mountFor('RENTER').request('/operators/me/members?operatorId=op_1')
    expect(res.status).toBe(403)
  })

  it('an operator IGNORES a foreign ?operatorId= and reads its own tenant', async () => {
    await membershipRepo.create({ userId: 'u_owner', operatorId: 'op_1', role: 'OPERATOR_OWNER', status: 'ACTIVE' })
    await membershipRepo.create({ userId: 'u_b', operatorId: 'op_2', role: 'OPERATOR_OWNER', status: 'ACTIVE' })
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request('/operators/me/members?operatorId=op_2')
    const { data } = await res.json()
    expect(data.map((m: { userId: string }) => m.userId)).toEqual(['u_owner'])
  })
})
```

- [ ] **Step 2: Run it, verify it fails.** `bun run --filter @kuruma/api test operator-team` (route) → FAIL: 422/403 cases return 403/403 (old `requireOwnOperator`) or 200 for the admin pick.

- [ ] **Step 3: Implement.** In `packages/api/src/routes/operator-team.ts`, pass the query param into the two read handlers:

```ts
    .get('/operators/me/invites', async (c) => {
      const invites = await service.listInvites(toCallerContext(requireUser(c)), c.req.query('operatorId'))
      return ok(c, invites)
    })
    .get('/operators/me/members', async (c) => {
      const members = await service.listMembers(toCallerContext(requireUser(c)), c.req.query('operatorId'))
      return ok(c, members)
    })
```

- [ ] **Step 4: Run it, verify it passes.** `bun run --filter @kuruma/api test operator-team` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/routes/operator-team.ts packages/api/tests/routes/operator-team.test.ts
git commit -m "feat(#1230): thread ?operatorId= into team read routes"
```

---

# Slice 2 — API writes + c1 error mapping

### Task 4: `OperatorNotFoundError extends NotFoundError` (c1)

**Files:**
- Modify: `packages/api/src/services/provider-invite.ts`
- Test: `packages/api/tests/services/provider-invite.test.ts`

- [ ] **Step 1: Write the failing test.** In `tests/services/provider-invite.test.ts` add `NotFoundError` to the `../../src/auth/guards` import (or import it) and add:

```ts
it('OperatorNotFoundError is a NotFoundError so the global handler maps it to 404, not 500 (c1)', () => {
  const err = new OperatorNotFoundError('op_missing')
  expect(err).toBeInstanceOf(NotFoundError)
  expect(err.operatorId).toBe('op_missing')
})
```

- [ ] **Step 2: Run it, verify it fails.** `bun run --filter @kuruma/api test provider-invite` → FAIL: `expected OperatorNotFoundError to be an instance of NotFoundError` (it extends `Error`).

- [ ] **Step 3: Implement.** In `packages/api/src/services/provider-invite.ts`:
  1. Import `NotFoundError`: change `import { ConflictError } from '../auth/guards'` → `import { ConflictError, NotFoundError } from '../auth/guards'`.
  2. Change the class (field-override for `name` — the parent declares `readonly name`, so assigning in the constructor would not compile):

```ts
/** Raised when an invite is minted against an operatorId with no matching row.
 *  Extends NotFoundError so the global handler maps it to 404 (#563, #1230 c1);
 *  the platform-admin team path can now supply an arbitrary operatorId, so this
 *  is reachable for the first time. The admin.ts:47 local catch is KEPT — it pins
 *  the suffix-free 'Operator not found' message provider-invites.test.ts asserts. */
export class OperatorNotFoundError extends NotFoundError {
  override readonly name = 'OperatorNotFoundError'
  constructor(readonly operatorId: string) {
    super(`Operator not found: ${operatorId}`)
  }
}
```

- [ ] **Step 4: Run it, verify it passes AND nothing regressed.** `bun run --filter @kuruma/api test provider-invite` → PASS. Then `bun run --filter @kuruma/api test admin` and confirm `provider-invites.test.ts` (the `'Operator not found'` 404 assertion) is still green — the `routes/admin.ts:47` local catch is untouched. If tsc flags `override`, keep it (the base has the member); if it flags an unused `NotFoundError`, the import was already present — recheck step 3.1.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/services/provider-invite.ts packages/api/tests/services/provider-invite.test.ts
git commit -m "fix(#1230): OperatorNotFoundError extends NotFoundError (map to 404, c1)"
```

### Task 5: Service writes accept a picked operatorId; delete `requireOwnOperator`

**Files:**
- Modify: `packages/api/src/services/operator-team.ts`
- Test: `packages/api/tests/services/operator-team.test.ts`

- [ ] **Step 1: Write/UPDATE the failing tests.** In `tests/services/operator-team.test.ts`:
  1. Change the three existing no-operatorId WRITE expectations from `ForbiddenError` to `OperatorRequiredError`:
     - `inviteStaff` describe — "refuses a caller with no operatorId (e.g. PLATFORM_ADMIN)": `rejects.toThrow(OperatorRequiredError)`.
     - `deactivateMember` describe — "refuses a caller with no operatorId (e.g. PLATFORM_ADMIN) (403)": `rejects.toThrow(OperatorRequiredError)`.
     - Add the same for `revokeInvite(ADMIN_CTX, id)` if present (it currently asserts `ForbiddenError`): → `OperatorRequiredError`.
  2. Add write-as-picked-operator tests:

```ts
describe('OperatorTeamService writes as a picked operator (#1230)', () => {
  it('inviteStaff: a PLATFORM_ADMIN mints under the PICKED operator, stamping the admin as inviter', async () => {
    await service.inviteStaff(ADMIN_CTX, { email: 'new@op2.com' }, 'op_2')
    const stored = await inviteRepo.listByOperator('op_2')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.operatorId).toBe('op_2')
    expect(stored[0]?.invitedByUserId).toBe('u_admin')
  })

  it('deactivateMember: a PLATFORM_ADMIN deactivates within the picked tenant and the audit names the picked operator + admin actor', async () => {
    await membershipRepo.create({ userId: 'u_owner', operatorId: 'op_2', role: 'OPERATOR_OWNER', status: 'ACTIVE' })
    const staff = await membershipRepo.create({ userId: 'u_staffm', operatorId: 'op_2', role: 'OPERATOR_STAFF', status: 'ACTIVE' })
    await service.deactivateMember(ADMIN_CTX, staff.id, 'op_2')
    expect(recordedAudits).toEqual([
      { type: 'OPERATOR_MEMBER_DEACTIVATED', operatorId: 'op_2', actorUserId: 'u_admin', targetUserId: 'u_staffm' },
    ])
  })
})
```

- [ ] **Step 2: Run it, verify it fails.** `bun run --filter @kuruma/api test operator-team` (service) → FAIL.

- [ ] **Step 3: Implement.** In `packages/api/src/services/operator-team.ts`:
  1. Rewrite the three writes to keep the owner-tier gate and swap the tenant derivation:

```ts
  async inviteStaff(
    ctx: CallerContext,
    input: { email: string },
    inputOperatorId?: string,
  ): Promise<CreatedInvite> {
    requireOperatorOwnerWrite(ctx)
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    return this.inviteService.createInvite(
      { email: input.email, operatorId, role: 'OPERATOR_STAFF' },
      ctx.userId,
    )
  }

  async revokeInvite(ctx: CallerContext, id: string, inputOperatorId?: string): Promise<void> {
    requireOperatorOwnerWrite(ctx)
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    const revoked = await this.invites.revoke(id, operatorId)
    if (!revoked) throw new NotFoundError('invite not found')
  }

  async deactivateMember(ctx: CallerContext, id: string, inputOperatorId?: string): Promise<void> {
    requireOperatorOwnerWrite(ctx)
    const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)
    const members = await this.memberships.findActiveByOperator(operatorId)
    const target = members.find((m) => m.id === id)
    if (!target) throw new NotFoundError('member not found')
    if (
      target.role === 'OPERATOR_OWNER' &&
      members.filter((m) => m.role === 'OPERATOR_OWNER').length === 1
    ) {
      throw new ConflictError('cannot deactivate the last operator owner')
    }
    await this.users.clearOperatorAccess(target.userId)
    const deactivated = await this.memberships.deactivate(id, operatorId)
    if (deactivated) {
      this.recordAudit({
        type: 'OPERATOR_MEMBER_DEACTIVATED',
        operatorId,
        actorUserId: ctx.userId,
        targetUserId: target.userId,
      })
    }
  }
```

  2. Delete the now-dead private `requireOwnOperator` method (all five callers replaced).
  3. Remove `ForbiddenError` from the `../auth/guards` import (only `requireOwnOperator` used it). Final import: `import { ConflictError, NotFoundError, requireOperatorOwnerWrite } from '../auth/guards'`.

- [ ] **Step 4: Run it, verify it passes.** `bun run --filter @kuruma/api test operator-team` → PASS. `bunx tsc --noEmit` in `packages/api` → no unused-import / no-such-method errors.

- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/services/operator-team.ts packages/api/tests/services/operator-team.test.ts
git commit -m "feat(#1230): thread picked operatorId into team writes; drop requireOwnOperator"
```

### Task 6: Write routes thread `?operatorId=` + integration + the two pins

**Files:**
- Modify: `packages/api/src/routes/operator-team.ts`
- Test: `packages/api/tests/routes/operator-team.test.ts`, `packages/api/tests/integration/operator-team-picker.test.ts` (new)

- [ ] **Step 1: Write the failing route tests.** Append to `tests/routes/operator-team.test.ts`:

```ts
describe('write routes as a picked operator (#1230)', () => {
  it('POST /operators/me/invites?operatorId=op_2 mints under op_2 for a PLATFORM_ADMIN (201)', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/me/invites?operatorId=op_2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@op2.com' }),
    })
    expect(res.status).toBe(201)
    expect(await inviteRepo.listByOperator('op_2')).toHaveLength(1)
  })

  it('POST invite with NO pick is 422 for a PLATFORM_ADMIN', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/me/invites', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@x.com' }),
    })
    expect(res.status).toBe(422)
  })

  it('a bogus ?operatorId= on invite is 404 (c1), not 500', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/me/invites?operatorId=op_ghost', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@x.com' }),
    })
    expect(res.status).toBe(404)
  })

  // G6a: a legacy STAFF/ADMIN passes requireOperatorOwnerWrite but the RESOLVER
  // denies it (403). This pins that the resolver, not the gate, is the deny point —
  // collapsing team onto resolveOperatorIdForWrite (which honors legacy admins)
  // would flip this to a cross-tenant 201 and fail here.
  it('denies a legacy STAFF write-with-?operatorId= at the resolver (403)', async () => {
    const res = await mountFor('STAFF').request('/operators/me/invites?operatorId=op_2', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@op2.com' }),
    })
    expect(res.status).toBe(403)
    expect(await inviteRepo.listByOperator('op_2')).toHaveLength(0)
  })

  it('still forbids an OPERATOR_STAFF write even with a valid ?operatorId= (owner-tier gate)', async () => {
    const res = await mountFor('OPERATOR_STAFF', 'op_1').request('/operators/me/invites?operatorId=op_1', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@op1.com' }),
    })
    expect(res.status).toBe(403)
  })
})
```

  **CSRF pin (G6b).** The route test harness does not mount the global CSRF middleware, so assert CSRF at the seam that owns it. Add to `tests/vite/operator-team-api.test.ts` in Task 7 a case that a 403 CSRF rejection still throws (the query param cannot mask an absent token) — the existing "throws on a CSRF rejection (403)" test already covers this shape; extend it to pass an `operatorId` and confirm it still rejects. (Documented here so the pin is not lost; implemented in Task 7.)

- [ ] **Step 2: Run it, verify it fails.** `bun run --filter @kuruma/api test operator-team` (route) → FAIL: admin pick returns 403 (routes don't pass the param yet).

- [ ] **Step 3: Implement.** In `packages/api/src/routes/operator-team.ts`, thread the query param into the three write handlers:

```ts
    .post('/operators/me/invites', async (c) => {
      const user = requireUser(c)
      const parsed = await parseBody(c, inviteStaffSchema)
      if (!parsed.ok) return parsed.response
      const created = await service.inviteStaff(toCallerContext(user), parsed.data, c.req.query('operatorId'))
      return ok(c, { inviteUrl: created.inviteUrl, expiresAt: created.expiresAt }, 201)
    })
    // ...
    .post('/operators/me/invites/:id/revoke', async (c) => {
      const id = c.req.param('id')
      await service.revokeInvite(toCallerContext(requireUser(c)), id, c.req.query('operatorId'))
      return ok(c, { id })
    })
    // ...
    .post('/operators/me/members/:id/deactivate', async (c) => {
      const id = c.req.param('id')
      await service.deactivateMember(toCallerContext(requireUser(c)), id, c.req.query('operatorId'))
      return ok(c, { id })
    })
```

- [ ] **Step 4: Run route tests, verify they pass.** `bun run --filter @kuruma/api test operator-team` → PASS.

- [ ] **Step 5: Write the real-pg integration test.** Create `packages/api/tests/integration/operator-team-picker.test.ts`, mirroring the harness in a sibling integration test (`tests/integration/tenancy-isolation.test.ts` for the DB-backed app + seeded operators/users). Assert against real Postgres: (a) `POST /operators/me/invites?operatorId=X` for a `PLATFORM_ADMIN` writes a pending invite under X (not the admin's absent tenant); (b) deactivating a member of Y via `?operatorId=X` is 404 (member id belongs to Y, not the picked X); (c) deactivating X's last owner is 409; (d) the `OPERATOR_MEMBER_DEACTIVATED` audit row carries `operatorId = X`. Run: `bun run --filter @kuruma/api test:integration operator-team-picker` (needs docker `DATABASE_URL`).

- [ ] **Step 6: Run the FULL integration suite** (contract change to existing methods — a separate vitest config): `bun run --filter @kuruma/api test:integration`. Grep for other integration callers of `inviteStaff`/`revokeInvite`/`deactivateMember`/`listInvites`/`listMembers` first; the added trailing optional arg is source-compatible, but confirm nothing constructed positional args past the new one.

- [ ] **Step 7: Commit.**

```bash
git add packages/api/src/routes/operator-team.ts packages/api/tests/routes/operator-team.test.ts packages/api/tests/integration/operator-team-picker.test.ts
git commit -m "feat(#1230): thread ?operatorId= into team write routes + integration + resolver-over-gate pin"
```

---

# Slice 3 — Web wiring

### Task 7: `api.ts` threads `operatorId` + folds query keys

**Files:**
- Modify: `packages/web/src/vite/operator-team/api.ts`
- Test: `packages/web/tests/vite/operator-team-api.test.ts`

- [ ] **Step 1: Write/UPDATE the failing tests.** In `tests/vite/operator-team-api.test.ts`:
  1. `inviteStaff` test — call `inviteStaff({ email: 'new@x.com' }, 'csrf-1', 'op_1')` and add `expect(url).toContain('operatorId=op_1')`.
  2. Extend the CSRF-rejection test (G6b pin) to pass an operatorId: `await expect(inviteStaff({ email: 'x@x.com' }, 'stale', 'op_1')).rejects.toThrow()`.
  3. `revokeInvite` — call `revokeInvite('i1', 'csrf-1', 'op_1')`, assert `url` contains both `/operators/me/invites/i1/revoke` and `operatorId=op_1`.
  4. `deactivateMember` — call `deactivateMember('m1', 'csrf-1', 'op_1')`, assert `url` contains `operatorId=op_1`.
  5. `fetchTeamMembers`/`fetchTeamInvites` — call with `('op_1')`, assert the fetch url contains `operatorId=op_1`.
  6. Add a query-key fold test:

```ts
import { teamInvitesQueryOptions, teamMembersQueryOptions } from '@/vite/operator-team/api'

describe('query keys fold in the operatorId', () => {
  it('keys team reads on the operator so a tenant switch refetches', () => {
    expect(teamMembersQueryOptions('op_1').queryKey).toEqual(['operator-team', 'members', 'op_1'])
    expect(teamInvitesQueryOptions('op_2').queryKey).toEqual(['operator-team', 'invites', 'op_2'])
  })
})
```

- [ ] **Step 2: Run it, verify it fails.** `bun run --filter @kuruma/web test operator-team-api` → FAIL (functions take no operatorId / keys are 2-element).

- [ ] **Step 3: Implement.** Rewrite the seams in `packages/web/src/vite/operator-team/api.ts` (keep `TEAM_INVITES_QUERY_KEY`/`TEAM_MEMBERS_QUERY_KEY` exported as the 2-element prefix — the dialogs invalidate that prefix):

```ts
export async function fetchTeamInvites(operatorId: string): Promise<OperatorInviteData[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/operators/me/invites?operatorId=${encodeURIComponent(operatorId)}`,
    { credentials: 'include' },
  )
  return unwrap(res, inviteSchema.array())
}

export async function fetchTeamMembers(operatorId: string): Promise<OperatorMemberData[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/operators/me/members?operatorId=${encodeURIComponent(operatorId)}`,
    { credentials: 'include' },
  )
  return unwrap(res, memberSchema.array())
}

export function teamInvitesQueryOptions(operatorId: string) {
  return queryOptions({
    queryKey: [...TEAM_INVITES_QUERY_KEY, operatorId],
    queryFn: () => fetchTeamInvites(operatorId),
  })
}

export function teamMembersQueryOptions(operatorId: string) {
  return queryOptions({
    queryKey: [...TEAM_MEMBERS_QUERY_KEY, operatorId],
    queryFn: () => fetchTeamMembers(operatorId),
  })
}

export async function inviteStaff(
  input: InviteStaffInput,
  csrfToken: string,
  operatorId: string,
): Promise<CreatedInviteResult> {
  const res = await fetch(
    `${getApiBaseUrl()}/operators/me/invites?operatorId=${encodeURIComponent(operatorId)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(input),
    },
  )
  return unwrap(res, createdInviteSchema)
}

export async function revokeInvite(id: string, csrfToken: string, operatorId: string): Promise<void> {
  const res = await fetch(
    `${getApiBaseUrl()}/operators/me/invites/${id}/revoke?operatorId=${encodeURIComponent(operatorId)}`,
    { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken } },
  )
  await unwrap(res, mutatedEntitySchema)
}

export async function deactivateMember(id: string, csrfToken: string, operatorId: string): Promise<void> {
  const res = await fetch(
    `${getApiBaseUrl()}/operators/me/members/${id}/deactivate?operatorId=${encodeURIComponent(operatorId)}`,
    { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken } },
  )
  await unwrap(res, mutatedEntitySchema)
}
```

- [ ] **Step 4: Run it, verify it passes.** `bun run --filter @kuruma/web test operator-team-api` → PASS. (`tsc` will now flag the dialogs + route that call these with the old arity — fixed in Tasks 8, 10.)

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/vite/operator-team/api.ts packages/web/tests/vite/operator-team-api.test.ts
git commit -m "feat(#1230): web team api threads operatorId + folds query keys"
```

### Task 8: Dialogs take an `operatorId` prop

**Files:**
- Modify: `packages/web/src/vite/operator-team/{InviteStaffDialog,RevokeInviteDialog,DeactivateMemberDialog}.tsx`
- Test: `packages/web/tests/vite/operator-team/{RevokeInviteDialog,DeactivateMemberDialog,InviteStaffDialog}.test.tsx`

- [ ] **Step 1: Write/UPDATE the failing tests.** In `RevokeInviteDialog.test.tsx` and `DeactivateMemberDialog.test.tsx`, add the new `operatorId` prop to the rendered component and mock the api module to assert it is forwarded. Pattern (Revoke shown; mirror for Deactivate and Invite):

```ts
vi.mock('@/vite/operator-team/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-team/api')>()
  return { ...actual, revokeInvite: vi.fn(async () => {}) }
})
// ...render <RevokeInviteDialog invite={invite} onOpenChange={() => {}} csrfToken="csrf" operatorId="op_1" />,
// click confirm, then:
expect(revokeInvite).toHaveBeenCalledWith(invite.id, 'csrf', 'op_1')
```

  Create `InviteStaffDialog.test.tsx` (none exists today — invite is the path that reaches the c1 mapping). Render the dialog open, type an email, submit, and assert `inviteStaff` was called with `({ email }, 'csrf', 'op_1')`.

- [ ] **Step 2: Run it, verify it fails.** `bun run --filter @kuruma/web test operator-team/` → FAIL (prop unknown / api called with 2 args).

- [ ] **Step 3: Implement.** Add `operatorId: string` to each dialog's props interface and thread it into the api call:
  - `InviteStaffDialog.tsx`: props gain `operatorId: string`; `mutationFn: (value: string) => inviteStaff({ email: value }, csrfToken, operatorId)`.
  - `RevokeInviteDialog.tsx`: props gain `operatorId: string`; `mutationFn: (id: string) => revokeInvite(id, csrfToken, operatorId)`.
  - `DeactivateMemberDialog.tsx`: props gain `operatorId: string`; `mutationFn: (id: string) => deactivateMember(id, csrfToken, operatorId)`.
  Leave the `invalidateQueries({ queryKey: TEAM_*_QUERY_KEY })` prefix invalidation unchanged (prefix-matches the folded keys).

- [ ] **Step 4: Run it, verify it passes.** `bun run --filter @kuruma/web test operator-team/` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/vite/operator-team/InviteStaffDialog.tsx packages/web/src/vite/operator-team/RevokeInviteDialog.tsx packages/web/src/vite/operator-team/DeactivateMemberDialog.tsx packages/web/tests/vite/operator-team/
git commit -m "feat(#1230): team dialogs thread operatorId into writes"
```

### Task 9: Register the team route in the picker + i18n key

**Files:**
- Modify: `packages/web/src/vite/operator-context/operator-context.ts`
- Modify: `packages/web/messages/{en,ja,zh}.json`
- Test: (covered by Task 10 render tests; the route-id set has no direct unit test)

- [ ] **Step 1: Register the route.** In `operator-context.ts`, add the team route to `OPERATOR_CONTEXT_ROUTE_IDS` (after the `settings` entry):

```ts
  '/$locale/_business/manage/settings', // slice 2 — picker honored on settings
  '/$locale/_business/manage/team', // slice 6 — picker honored on team management
```

- [ ] **Step 2: Add the i18n key** to the `business.team` block in each messages file, right after `noOperatorContext` (modeled on `business.settings.pickOperatorPrompt`):
  - `en.json`: `"pickOperatorPrompt": "Select an operator from the picker above to view and manage its team.",`
  - `ja.json`: `"pickOperatorPrompt": "上部の選択メニューから事業者を選ぶと、そのチームを表示・管理できます。",`
  - `zh.json`: `"pickOperatorPrompt": "请从上方的选择器中选择一个运营商，以查看并管理其团队。",`

- [ ] **Step 3: Verify i18n parity.** `bun run --filter @kuruma/web test` includes the message-parity check (or run the i18n key-parity test directly). Confirm all three files have the new key and no other key was dropped.

- [ ] **Step 4: Commit.**

```bash
git add packages/web/src/vite/operator-context/operator-context.ts packages/web/messages/en.json packages/web/messages/ja.json packages/web/messages/zh.json
git commit -m "feat(#1230): register team route in picker + pickOperatorPrompt i18n"
```

### Task 10: `team.tsx` — capability-gated resolution + keyed `OperatorTeamData` child

**Files:**
- Modify: `packages/web/src/routes/$locale/_business/manage/team.tsx`
- Test: `packages/web/tests/vite/operator-team/TeamRoute.test.tsx` (new render test), existing `team.route.test.ts` (unchanged — the flag guard still holds)

- [ ] **Step 1: Write the failing render tests.** Create `packages/web/tests/vite/operator-team/TeamRoute.test.tsx`, mirroring the harness in `tests/vite/operator-fees/OperatorFeesRoute.test.tsx` (mock `@/vite/session` `useSession` and `@/vite/operator-context` `useOperatorContext`; wrap in `QueryClientProvider` + `IntlProvider`). Do NOT globally stub `useSuspenseQuery` — instead stub `fetch` so the P1 "no read fires" assertion is real. Cover the three pins:

```ts
// P1 — all-mode fires NO team read (the operatorId-gated child never mounts).
it('a PLATFORM_ADMIN with no pick shows the pick-prompt and issues no /operators/me/* read', async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
  vi.stubGlobal('fetch', fetchMock)
  useSessionMock.mockReturnValue({ data: { user: { id: 'a', role: 'PLATFORM_ADMIN' }, csrfToken: 'c' } })
  useOperatorContextMock.mockReturnValue({ pickedOperatorId: undefined })
  renderRoute()
  expect(screen.getByText(en.pickOperatorPrompt)).toBeInTheDocument()
  const calledTeam = fetchMock.mock.calls.some(([u]) => String(u).includes('/operators/me/'))
  expect(calledTeam).toBe(false)
})

// P2a — a legacy STAFF/ADMIN with a retained ?operator= is NOT a picker: prompt, no read.
it('a legacy STAFF session with a retained pickedOperatorId shows the no-context prompt and fires no team read', async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
  vi.stubGlobal('fetch', fetchMock)
  useSessionMock.mockReturnValue({ data: { user: { id: 's', role: 'STAFF' }, csrfToken: 'c' } })
  useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_2' })
  renderRoute()
  expect(screen.getByText(en.noOperatorContext)).toBeInTheDocument()
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/operators/me/'))).toBe(false)
})

// Picked mode — the scoped read fires with the picked id.
it('a PLATFORM_ADMIN with a pick fires the scoped team read with ?operatorId=', async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
  vi.stubGlobal('fetch', fetchMock)
  useSessionMock.mockReturnValue({ data: { user: { id: 'a', role: 'PLATFORM_ADMIN' }, csrfToken: 'c' } })
  useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_2' })
  renderRoute()
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/operators/me/members?operatorId=op_2'))).toBe(true),
  )
})
```

  Add a P2b assertion (dialog/selection reset on tenant switch) by re-rendering the wrapper with a changed `pickedOperatorId` and asserting the child remounted (e.g. a member selected under `op_2` is cleared when switched to `op_3`) — the `key={operatorId}` remount. (Reference #1264's `VehicleDetailRoute.test.tsx` for the mutation-verified render style.)

- [ ] **Step 2: Run it, verify it fails.** `bun run --filter @kuruma/web test TeamRoute` → FAIL (route still fires reads at top level in all-mode; no pick-prompt).

- [ ] **Step 3: Implement the rewrite.** Replace `packages/web/src/routes/$locale/_business/manage/team.tsx`. Keep the `beforeLoad` flag guard verbatim. New imports: `canPickOperatorContext, canWriteAsOperatorOwner` from `@/vite/guards`; `OperatorBadge, operatorsQueryOptions, useOperatorContext` from `@/vite/operator-context`; `useQuery` from `@tanstack/react-query`. Body:

```tsx
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: async ({ context, deps }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    // Capability-gated: a retained ?operator= is honored only for a picker-admin,
    // never a legacy STAFF/ADMIN (whose team read would 403). Search params are
    // input, not permission — derive from session capability first.
    const picked = canPickOperatorContext(session ?? null) ? deps.operator : undefined
    const operatorId = session?.user.operatorId ?? picked
    if (operatorId) {
      await Promise.all([
        context.queryClient.ensureQueryData(teamMembersQueryOptions(operatorId)),
        context.queryClient.ensureQueryData(teamInvitesQueryOptions(operatorId)),
      ])
    }
  },
  pendingComponent: PageSkeleton,
  errorComponent: OperatorTeamError,
  component: OperatorTeamRoute,
})

export function OperatorTeamRoute() {
  const t = useTranslations('business.team')
  const { data: session } = useSuspenseQuery(sessionQueryOptions())
  const { pickedOperatorId } = useOperatorContext()
  const canPick = canPickOperatorContext(session ?? null)
  // Mirror the loader — must stay in lockstep. A legacy admin's retained param drops.
  const picked = canPick ? pickedOperatorId : undefined
  const operatorId = session?.user.operatorId ?? picked
  const canManage = canWriteAsOperatorOwner(session ?? null, pickedOperatorId)

  // Badge label: team reads carry only the user's name, so source the operator name
  // from the operators list (already cached by BusinessLayout's picker on this route).
  // operatorNameById from useOperatorScope is empty when a pick is active — do not use it.
  const { data: operators } = useQuery({
    ...operatorsQueryOptions(),
    enabled: canPick && Boolean(pickedOperatorId),
  })
  const pickedName = operators?.find((o) => o.id === pickedOperatorId)?.name

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
            <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
          </div>
          {canPick && Boolean(pickedOperatorId) && <OperatorBadge name={pickedName} />}
        </header>

        {session && operatorId ? (
          <OperatorTeamData
            key={operatorId}
            operatorId={operatorId}
            canManage={canManage}
            csrfToken={session.csrfToken}
          />
        ) : (
          <p className="text-muted-foreground">
            {canPick ? t('pickOperatorPrompt') : t('noOperatorContext')}
          </p>
        )}
      </div>
    </main>
  )
}

function OperatorTeamData({
  operatorId,
  canManage,
  csrfToken,
}: {
  operatorId: string
  canManage: boolean
  csrfToken: string
}) {
  const t = useTranslations('business.team')
  const { data: members } = useSuspenseQuery(teamMembersQueryOptions(operatorId))
  const { data: invites } = useSuspenseQuery(teamInvitesQueryOptions(operatorId))
  const [inviteOpen, setInviteOpen] = useState(false)
  const [selectedInvite, setSelectedInvite] = useState<OperatorInviteData | null>(null)
  const [selectedMember, setSelectedMember] = useState<OperatorMemberData | null>(null)

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        {!canManage ? (
          <p className="text-sm text-muted-foreground">{t('staffNotice')}</p>
        ) : (
          <span />
        )}
        {canManage && (
          <Button onClick={() => setInviteOpen(true)} className="shrink-0">
            <UserPlus className="size-4" />
            {t('invite')}
          </Button>
        )}
      </div>

      <TeamView
        members={members}
        invites={invites}
        canManage={canManage}
        onRevokeInvite={setSelectedInvite}
        onDeactivateMember={setSelectedMember}
      />

      {canManage && (
        <>
          <InviteStaffDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            csrfToken={csrfToken}
            operatorId={operatorId}
          />
          <RevokeInviteDialog
            invite={selectedInvite}
            onOpenChange={(open) => !open && setSelectedInvite(null)}
            csrfToken={csrfToken}
            operatorId={operatorId}
          />
          <DeactivateMemberDialog
            member={selectedMember}
            onOpenChange={(open) => !open && setSelectedMember(null)}
            csrfToken={csrfToken}
            operatorId={operatorId}
          />
        </>
      )}
    </>
  )
}
```

  Keep `OperatorTeamError` unchanged. The invite Button + `inviteOpen` now live in the child (B2) so a tenant switch resets them via `key={operatorId}`.

- [ ] **Step 4: Run it, verify it passes.** `bun run --filter @kuruma/web test TeamRoute` → PASS; `bun run --filter @kuruma/web test team.route` (flag guard) still PASS; `bunx tsc --noEmit` in `packages/web` clean.

- [ ] **Step 5: Regenerate the route tree + typecheck the web build.** `bun run --filter @kuruma/web build` (regenerates `routeTree.gen.ts`; no route path changed, but the loaderDeps signature did). Confirm build is clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/web/src/routes/\$locale/_business/manage/team.tsx packages/web/tests/vite/operator-team/TeamRoute.test.tsx
git commit -m "feat(#1230): team page picks operator via keyed OperatorTeamData child (render gate)"
```

---

## Final verification (before PR)

- [ ] `bun run --filter @kuruma/api test` (unit) + `bun run --filter @kuruma/api test:integration` (docker DB) green.
- [ ] `bun run --filter @kuruma/web test` green (incl. i18n parity).
- [ ] `bunx tsc --noEmit` clean in `packages/api` and `packages/web`.
- [ ] `bun run --filter @kuruma/api lint:boundaries` (routes import services only; resolver in tenancy) + `bun run lint:modules` + `bun run lint:size` exit 0.
- [ ] `bun run format` / biome clean; re-read edited files if biome reordered imports.
- [ ] Manual smoke (optional, flag on): as a `PLATFORM_ADMIN`, `/manage/team` with no pick shows the prompt; pick an operator → its team loads, badge names it, invite/revoke/deactivate land on the picked operator; switch operators → dialogs reset.
- [ ] Open the PR with `Refs #1230` (NOT `Closes`). Link the design spec.

## Self-review notes (spec coverage)

- Resolver (spec §API.1) → Task 1. Service reads/writes (§API.2) → Tasks 2, 5. Routes (§API.3) → Tasks 3, 6. c1 (§API.2 bug) → Task 4. Web api.ts + folded keys (§Web) → Task 7. Dialogs b3 → Task 8. Route registration + i18n c2 → Task 9. Capability gate P2a + loader G2 + render-gate child P1/P2b + badge G1 → Task 10. Testing pins (unit truth table, G6a resolver-over-gate, G6b CSRF, P1/P2a/P2b, integration) → distributed across Tasks 1, 6, 7, 10.
- Non-goals honored: no route-path migration, no merged roster, no session-revocation change, no new write-authz surface.
- Type consistency: `resolveTeamOperatorId(ctx, inputOperatorId?)` sync `string`; service methods add a trailing `inputOperatorId?: string`; web fns add a trailing required `operatorId: string`; dialogs add `operatorId: string`; `teamMembersQueryOptions(operatorId)` / `teamInvitesQueryOptions(operatorId)` require the arg. `TEAM_*_QUERY_KEY` stay 2-element prefixes.

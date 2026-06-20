# Design: Immediate operator-privilege revocation on staff deactivation (#939)

> Status: proposed · Author: session 2026-06-17 · Branch: `feat/939-session-revocation` · Closes #939
> Follow-up to #904 slice 2 (PR #938). The deactivation code comment in
> `services/operator-team.ts:87` explicitly names this work.

## 1. Problem

Deactivating a staff member (`POST /operators/me/members/:id/deactivate`) already:

- revokes the membership ledger row (`operator_memberships.status` → `REVOKED`), and
- clears the `users` operator projection (`clearOperatorAccess`).

But it does **not** revoke the member's already-issued session JWT. The token still
carries `role: OPERATOR_STAFF` + `operatorId`, and verification trusts those claims
verbatim:

- `verifyAndMap` (`packages/api/src/auth/jwt.ts:61`) maps claims → caller; **never reads the DB**.
- `requireAuth` (`packages/api/src/middleware/auth.ts:65`) sets `c.set('user', …)` straight from the verified token.

Net: a deactivated staffer keeps operator-scoped access until the token expires —
up to the **7-day TTL** (`SESSION_TTL`, `jwt.ts:107`).

## 2. Threat model & scope

Operator privilege is conferred **only** by `role ∈ OPERATOR_ROLES` + `operatorId`,
surfaced to every repo-layer guard through `toCallerContext`
(`packages/api/src/auth/context.ts:15`). Guards (`requireFleetWriteScope`,
`requireManagementRead`, `requireOperatorOwnerWrite`, `operatorReadScope`, …) are
pure functions over that context.

Therefore: a stale operator token reverting to a plain **RENTER** identity is
**fully safe** — the user keeps exactly the renter access they are entitled to, and
every operator-scoped guard now denies them. We do not need to invalidate the whole
session, only strip the now-revoked operator grant.

- **In scope:** operator-scoped reads/writes (fleet, classes, locations, fees,
  insurance, add-ons, `/operators/*`, staff verify, dashboard overview, customers).
- **Out of scope:** renter-level access (correct to retain); PARTNER/PLATFORM_ADMIN
  (not membership-backed; revoked by other means).

## 3. Chosen design — membership-freshness re-check + downgrade

When an authenticated caller's role is in `OPERATOR_ROLES`, re-derive their operator
grant from the **ledger** (the source of truth deactivation already mutates):

```
membership = memberships.findActiveByUserId(user.id)      // already exists, indexed
fresh = membership !== undefined
     && membership.operatorId === user.operatorId
     && membership.role === user.role
if (!fresh) → downgrade caller to { id, role: 'RENTER' }   // strip operatorId
```

`findActiveByUserId` (`repositories/types.ts:244`) is served by the partial-unique
active index (one ACTIVE membership per user, #521). After deactivation it returns
`undefined` → the caller is downgraded → operator guards 403 within one request,
**not 7 days**.

### Why downgrade, not deny (401)?

- The person still has a valid account; only their operator role was revoked.
- Downgrade is the minimal-blast-radius semantic — no forced full re-login, no
  special error code, existing guards do the denying.
- An owner re-granting the member (next provider login) restores access normally.

### Why this re-check covers all three claim fields

We compare `operatorId` and `role` too, not just existence, so the check also
catches a future tenant transfer or role change — not only hard deactivation — for
free, with no extra query.

## 4. Options rejected (from the issue)

| Option | Verdict | Reason |
|--------|---------|--------|
| 2 — denylist table keyed `userId`+`operatorId` | rejected | New table + GC + write on deactivate. The ledger row revocation **already is** the denylist; consulting it needs no new state. |
| 3 — token `epoch`/`version` claim, bumped on deactivate | rejected | New `users` column + bump-on-deactivate write + per-request read-and-compare. Strictly more moving parts than reading the ledger we already write. |
| 4 — shorten operator JWT TTL | rejected | Partial mitigation only (issue says so); does not give "within seconds". |

Chosen approach = the issue's **Option 1**, scoped to OPERATOR_* callers and reusing
the existing indexed query, so it carries none of option 1's "read per request"
cost for the common (renter/public/partner) traffic.

## 5. Wiring — inject the check into `requireAuth` (the chokepoint)

`requireAuth()` (`middleware/auth.ts:65`) is the single place that establishes the
caller for **every** protected route (~25 mount sites). Putting the downgrade here
guarantees **total, fail-closed coverage** — no operator surface can forget the
check. This matches the codebase's stated ethos (guards.ts: "defence against a route
forgetting its gate").

### Signature change

```ts
// before
export function requireAuth(): MiddlewareHandler

// after — optional dep; omitted ⇒ no freshness check (back-compat for tests)
type OperatorFreshnessCheck =
  (user: AuthUser) => Promise<AuthUser>   // returns same user, or a downgraded one
export function requireAuth(opts?: { freshenOperator?: OperatorFreshnessCheck }): MiddlewareHandler
```

- After each successful `verifyJwt`/cookie path sets the user, if `opts?.freshenOperator`
  is present **and** `OPERATOR_ROLES.has(user.role)`, replace the user with its result
  before `c.set('user', …)`.
- The check is a thin function built in the composition root from
  `operatorMembershipRepo` (already in scope, `index.ts:342`) — keeps `middleware/auth`
  free of repository imports (layering: middleware imports an injected fn, not a repo).

### Coverage = every operator-reachable `requireAuth()` call passes the check

Composition root (`index.ts`, 12 calls — repo in scope) gets it directly. The route
factories that mount their own `requireAuth()` (operators, operator-team, locations,
add-ons, fee-schedules, insurance-options, vehicle-classes, overview,
payment-anomalies, admin-revenue, notifications) each take the check via their
factory signature (called from `index.ts` where the repo is in scope). Renter-only
public paths may keep the bare `requireAuth()` — there is no operator privilege to
revoke there, and the check would no-op anyway.

> Implementation note: middleware ordering for factory-self-gated sub-apps
> (`/operators/me/*`) must be verified by the slice-2 integration test — the check
> must run *after* the user is set, which is intrinsic since it lives inside
> `requireAuth` itself.

## 6. TDD slices

1. **Pure freshness logic** — `freshenOperatorAccess(memberships)(user)`:
   active+matching → same user; missing/mismatched operatorId/role → `{id, role:'RENTER'}`;
   non-operator role → returned untouched **without** a repo call (assert the spy was not called).
2. **`requireAuth` integration** (InMemory repo): stale operator cookie/Bearer → context
   role is RENTER and an operator-guarded call 403s; active operator → unchanged;
   renter token → zero `findActiveByUserId` calls.
3. **Composition-root wiring** — build the check from `operatorMembershipRepo`; thread
   through the operator route factories; `tsc --noEmit` + `lint:boundaries` green.
4. **Real-DB e2e** (`e2e/real-db/…`): owner deactivates a staff member, then the
   staffer's existing session immediately gets 403 on an operator route (fee-schedule
   write or `GET /operators/me/members`), while still succeeding on a renter route.

## 7. Test assertions (mutation-resistant)

- Downgraded caller: `ctx.role === 'RENTER'` **and** `ctx.operatorId === undefined`
  (not just "denied") — proves the grant was stripped, not merely a 403 from elsewhere.
- Active case: `findActiveByUserId` called exactly once; role/operatorId preserved.
- Non-operator case: `findActiveByUserId` **not** called (no latency regression).

## 8. Acceptance criteria (from #939)

- [x] Deactivated member denied operator-scoped routes within seconds (next request),
      not days → freshness re-check downgrades the stale token.
- [x] No measurable per-request latency for the still-active common case other than
      operators themselves → check fires only for `OPERATOR_ROLES`; one indexed read.

## 9. Risks & non-goals

- **Per-operator-request read:** one indexed `findActiveByUserId` per OPERATOR_* request.
  Operators are a handful of users with low request volume; acceptable. A short-TTL
  cache (issue's optional mitigation) is **deferred (YAGNI)** — Workers are stateless
  per request and operator traffic is tiny.
- **Non-goal:** revoking renter sessions or platform/partner tokens — out of scope.
- **Non-goal:** refresh-token rotation or a global logout-all — separate concern.
- **Danger zones touched:** none in `packages/shared/db` or `drizzle/` (no schema
  change). `middleware/auth.ts` signature change is back-compatible (optional arg).

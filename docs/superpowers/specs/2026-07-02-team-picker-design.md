# Picker slice 6 — team management as the picked operator

Date: 2026-07-02
Epic: #1230 (admin operator-context picker)
Prior spec: `docs/superpowers/specs/2026-06-26-admin-operator-context-picker-design.md`
Sibling slices: settings (slice 2, PR #903 pattern), fleet (slice 4, PR #1368), booking writes (slice 5b, `docs/superpowers/specs/2026-07-01-picker-5b-booking-writes-design.md`)

Slice 6 is the last and heaviest epic slice: it is the only one that requires an **API change**, because the team surface is `/operators/me/*` — self-scoped by design, with no foreign-id surface for a picker-admin to reach.

## Problem

A `PLATFORM_ADMIN` can pick an operator context (slices 0-5) but cannot manage that operator's **team**.
The team API is `/operators/me/*` (`routes/operator-team.ts`), and every method funnels through `OperatorTeamService.requireOwnOperator(ctx)` (`services/operator-team.ts:142-145`), which throws `ForbiddenError` when `ctx.operatorId` is absent.
A picker-admin has `operatorId: null`, so it is rejected at the service boundary today.

The goal of slice 6: let a picker-admin **read and manage** (invite, revoke, deactivate) a picked operator's team *as that operator*, with the owner-tier write gate, while every hazard of team mutation (wrong-tenant deactivate, invite to the wrong inbox, corrupted audit actor/target, `/me` read leak) stays closed.

## Owner decisions (brainstorm, 2026-07-02)

1. **Transport — keep `/operators/me/*`, thread the picked id.**
   Do *not* migrate to `/operators/:operatorId/team/*`.
   Rationale: lowest churn/regression risk on shipped access-control code (#904); the write resolver stays DRY with the other picker slices; an operator session structurally cannot name a foreign id, so the foreign-id attack surface is limited to the platform tier.
   The rejected alternative (foreign-id path, matching the settings `/operators/:id` shape) was cleaner REST but rewrote every shipped #904 route/web/test URL for aesthetic gain.

2. **All-mode UX — a "pick an operator" prompt, not a merged roster.**
   When a picker-admin is in "All operators" mode (no pick), the team page shows an empty state ("Select an operator to manage its team"), mirroring the settings slice.
   No cross-operator merged read is built.
   Rationale: team management is inherently single-tenant (every invite/revoke/deactivate targets one operator); a merged read-only roster is non-actionable and would add a `findAllActiveMembers`/`listAllInvites` cross-tenant leak surface for no user value.

## Key insight — one seam, not a rewrite

Every blocker is the single `requireOwnOperator(ctx)` call.
`requireOperatorScope` and `requireOperatorOwnerWrite` **already admit a platform admin**:

- `requireOperatorScope(ctx)` throws only when `OPERATOR_ROLES.has(ctx.role) && !ctx.operatorId`. `PLATFORM_ADMIN` is not an `OPERATOR_ROLE`, so it passes.
- `requireOperatorOwnerWrite(ctx)` gates on `OPERATOR_OWNER_WRITE_ROLES = {STAFF, ADMIN, PLATFORM_ADMIN, OPERATOR_OWNER}` (excludes `OPERATOR_STAFF`) then calls `requireOperatorScope`, which likewise passes a platform admin.

So the entire slice is: replace `requireOwnOperator(ctx)` with a resolver that also accepts a picked id from the platform tier, and thread that id through the routes and web. No schema, no migration, no new authorization gate.

## Transport — a uniform `?operatorId=` query param

All five team endpoints take an optional `?operatorId=<picked>` query param.
An operator session omits it (the server auto-scopes to its own tenant); only a picker-admin sends it.
It is **scope context, not payload**, so write bodies (`{email}`) are untouched — zero validator churn — and CSRF still guards writes via the double-submit header.
Threading uniformly on reads *and* writes (rather than body on writes, query on reads) keeps one resolution shape across the surface.

## API design

### 1. The resolver — `resolveTeamOperatorId` (new, in `tenancy.ts`)

A pure function beside `resolveOperatorIdForWrite`, imported directly by the service (services already import tenancy helpers, e.g. `add-on.ts`):

```
resolveTeamOperatorId(ctx, inputOperatorId?): string
  isOperatorRole(ctx.role):
    ctx.operatorId ? return ctx.operatorId   // input IGNORED — cannot act cross-tenant
                   : throw ForbiddenError     // fail-closed (lost tenant claim)
  PLATFORM_ROLES.has(ctx.role):               // the `all` tier — PLATFORM_ADMIN only
    inputOperatorId ? return inputOperatorId   // honored ONLY here (epic hard invariant)
                    : throw OperatorRequiredError  // -> 422, "specify a target operator"
  else: throw ForbiddenError                  // -> 403 (renter / partner / legacy)
```

Three properties that satisfy the epic hard invariant and the hazards:

- The input `operatorId` is honored in **exactly one branch** (the platform `all` tier). An operator's own id always wins and any input it passes is dropped, so it can never reach another tenant.
- Renter / PARTNER / legacy `STAFF`/`ADMIN` are denied outright — team is operator-internal, owner-tier data, so unlike the public catalog they must never read or thread an id here.
- Strict, unlike the lenient `resolveReadOperatorTarget` helper (#1373, `routes/helpers.ts`): a platform admin with no pick is a `422`, **not** an unscoped read-all, because there is no merged team view. This is the API mirror of the "pick an operator" prompt.

### 2. Service — `OperatorTeamService` (`services/operator-team.ts`)

Each method gains an `inputOperatorId?: string` parameter and swaps its tenant derivation:

- Reads (`listMembers`, `listInvites`): replace `requireOperatorScope(ctx)` + `requireOwnOperator(ctx)` with `const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)`. The resolver *is* the read gate now (stricter and correct: it denies renter/partner that `requireOperatorScope` used to let fall through to the old `requireOwnOperator` 403).
- Writes (`inviteStaff`, `revokeInvite`, `deactivateMember`): keep `requireOperatorOwnerWrite(ctx)` (still excludes `OPERATOR_STAFF`), then `const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)`.

Everything downstream already keys off the resolved `operatorId`, so the hazards close for free:

- `inviteService.createInvite({ operatorId, ... })` mints the token under the **picked** tenant — never the admin's absent tenant, never a wrong inbox.
- `invites.revoke(id, operatorId)` and `memberships.findActiveByOperator(operatorId)` are tenant-scoped reads: a foreign invite/member id under the picked scope resolves to `undefined` -> `NotFoundError` (404), preserving the no-existence-oracle seal.
- Last-owner-lockout (`:116-121`) counts owners **within the picked tenant** — a picker-admin cannot deactivate operator X's last owner.
- The `OPERATOR_MEMBER_DEACTIVATED` audit event stamps `operatorId` (picked tenant) + `actorUserId` (the admin) + `targetUserId` — a correct, attributable trail.

### 3. Routes — `routes/operator-team.ts`

Each handler reads the query param and passes it through. Reuse the centralized transport parse where it fits: `parseCrossOperatorRead(c).operatorId` (#1373) yields the optional `operatorId` (team ignores its `includeAll`), or a direct `c.req.query('operatorId')` — team has no `includeAll` semantics. Routes stay HTTP-only; the resolver's throws map via the global handler (403 / 422 / 404 / 409).

## Web design

### `operator-team/api.ts`

- `fetchTeamMembers(operatorId?)` / `fetchTeamInvites(operatorId?)`: append `?operatorId=` when a pick is present (operator sessions pass `undefined` and omit it).
- Query keys fold in the id: `['operator-team','members', operatorId ?? 'self']` so switching tenants refetches instead of serving a stale roster.
- `inviteStaff` / `revokeInvite` / `deactivateMember`: accept `operatorId?` and append the same query param; bodies/headers unchanged.

### `routes/$locale/_business/manage/team.tsx`

- Register `/$locale/_business/manage/team` in `OPERATOR_CONTEXT_ROUTE_IDS` (`operator-context.ts`) so the picker chip shows on this page.
- Keep the `OPERATOR_TEAM` feature-flag `beforeLoad` gate unchanged.
- Resolve `operatorId = session.user.operatorId ?? pickedOperatorId` (mirrors settings `OperatorSettingsRoute`; loader + component in lockstep).
- **All-mode** (a picker-admin with no pick, i.e. `isCrossOperatorReader(session) && !pickedOperatorId`): render the pick-prompt empty state; fire **no** team read.
- **Own / picked mode**: render `TeamView` with reads threaded by the resolved id, a picked-operator `OperatorBadge` (shown when `canPick && Boolean(pickedOperatorId)`, mirroring settings' `showOperatorBadge`), and every write affordance gated on `canWriteAsOperatorOwner(session, pickedOperatorId)` (already exists, `guards.ts:70-78`) instead of the current owner-session-only gate.
- `TeamView` + the invite/revoke/deactivate dialogs thread `operatorId` into their mutation calls and take the owner-tier gate as a prop.

## Testing

TDD, vertical, per slice. Mutation-resistant assertions.

- **Unit** (`tests/tenancy.test.ts`): `resolveTeamOperatorId` truth table — operator returns own id and ignores a foreign input; operator-without-id throws `ForbiddenError`; platform admin + id returns the id; platform admin without id throws `OperatorRequiredError`; renter / partner / legacy throw `ForbiddenError`.
- **Routes** (`tests/routes/operator-team.test.ts`): each read/write threads `?operatorId=`; admin-no-pick -> 422; renter/partner -> 403; an operator's foreign `?operatorId=` is ignored (auto-scoped to own); owner-tier gate still 403s `OPERATOR_STAFF` writes.
- **Integration, real-pg** (`tests/integration/`): admin picks operator X — invite/deactivate land on X (not the admin's absent tenant); a member id belonging to Y under the picked X scope -> 404; X's last-owner deactivate -> 409; the audit event carries `operatorId = X`.
- **Conformance:** extend the cross-operator read-scope suite (`tests/routes/tenancy-context.test.ts` / `tests/integration/tenancy-isolation.test.ts`) with the two team read endpoints — a picker-admin honors `?operatorId=`, a non-privileged caller cannot.
- **Web** (`tests/vite/.../team...test.tsx`): all-mode renders the prompt and fires no fetch; picked mode threads the id into fetch + mutations and refetches on tenant switch (query-key change); write affordances hidden for a non-owner / no-pick; mutation-verified (mirror #1264's `VehicleDetailRoute.test.tsx`).

## Slices (one PR, `Refs #1230` — do NOT close the epic)

1. **API read scope + resolver.** Add `resolveTeamOperatorId`; thread the id into `listMembers`/`listInvites` and the two read routes; unit + route + conformance tests.
2. **API writes.** Thread the id into `inviteStaff`/`revokeInvite`/`deactivateMember` via the resolver, owner-tier gate + last-owner + audit under the picked operator; route + real-pg integration tests.
3. **Web wiring.** `api.ts` threading + query keys; route registration in `OPERATOR_CONTEXT_ROUTE_IDS`; pick-prompt all-mode; owner-tier affordance gating + picked-operator badge; route/component tests.

## Non-goals

1. **No route-path migration** — `/operators/me/*` stays; the id rides as a query param.
2. **No merged cross-operator roster** — all-mode is a pick-prompt; no `findAllActiveMembers`/`listAllInvites` read is built.
3. **No session-revocation change** — a deactivated member keeps access until token expiry (the #904 follow-up, unchanged).
4. **No new write-authorization surface** — the owner-tier gate + the resolver are the whole authorization story; the resolved `operatorId` is itself the scoping key for every downstream repo read (no separate `assertBookingWriteWithinOperator`-style binding is needed, because there is no raw-id `findById` that could hand over a foreign row).

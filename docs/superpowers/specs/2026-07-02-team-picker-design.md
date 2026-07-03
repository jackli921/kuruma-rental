# Picker slice 6 — team management as the picked operator

Date: 2026-07-02
Epic: #1230 (admin operator-context picker)
Prior design: `docs/plans/2026-06-04-operator-picker.md` (operator-context picker origin) + epic #1230
Sibling slices: settings (slice 2, PR #903 pattern), fleet (slice 4, PR #1368), booking writes (slice 5b, `docs/superpowers/specs/2026-07-01-picker-5b-booking-writes-design.md`)

Slice 6 is the last and heaviest epic slice: it is the only one that requires an **API change**, because the team surface is `/operators/me/*` — self-scoped by design, with no foreign-id surface for a picker-admin to reach.

Revision 2 (2026-07-02): folds in architect-review findings — verdict sound-with-changes, no security hole. Anchors the `all` tier on `PRIVILEGED_ROLES`; documents the deliberate divergence from `resolveOperatorIdForWrite`; spells out the loader rework (G2) and the OperatorBadge label source (G1); cites slice 5b as the query-on-POST precedent; adds the resolver-asymmetry + CSRF test pins.

Revision 3 (2026-07-02): second-review pass — verdict needs-minor-edits. Fixes the real bug (c1: `OperatorNotFoundError` maps to 500, not 404, on the team route → map it in `error-handlers.ts`); adds the missing i18n key (c2); pins the `operatorsQueryOptions` import to disambiguate the name collision (c3); mandates the 2-element invalidation prefix (c4); corrects the TeamView-vs-dialogs mutation-site claim (b3).

Revision 4 (2026-07-02): human-review pass (web scope gating + stale state). P1 — the all-mode "no read" guarantee needs a render gate (scoped child), not just a loader guard, because `useSuspenseQuery` fetches at component top level. P2a — capability-gate the `?operator=` param (`canPickOperatorContext`) so a retained param can't 403 a legacy STAFF/ADMIN. P2b — key the team child on `operatorId` to reset dialog intent on tenant switch. P3 — fix the dead prior-design link. No API authz hole found.

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
  PRIVILEGED_ROLES.has(ctx.role):             // the `all` tier — PLATFORM_ADMIN only
    inputOperatorId ? return inputOperatorId   // honored ONLY here (epic hard invariant)
                    : throw OperatorRequiredError  // -> 422, "specify a target operator"
  else: throw ForbiddenError                  // -> 403 (renter / partner / legacy)
```

It is an **allowlist**, not a bypass-first denylist: `isOperatorRole` OR `PRIVILEGED_ROLES` pass; everything else throws. That shape is why it needs no explicit PARTNER branch (unlike `bookingReadScope`/`threadReadScope`, which are bypass-first and must special-case PARTNER) — PARTNER simply falls into the `else`.

Key the `all` tier on `PRIVILEGED_ROLES` (`= {PLATFORM_ADMIN}`, `shared/src/auth/roles.ts`), **not** `PLATFORM_ROLES`. They are identical today, but `PRIVILEGED_ROLES` is the codebase's semantic set for cross-tenant PRIVATE reads (it anchors `threadReadScope`, `tenancy.ts:194`); team data is private/owner-tier, so this is the correct anchor and future-proofs against `PLATFORM_ROLES` widening for a non-private reason.

Three properties that satisfy the epic hard invariant and the hazards:

- The input `operatorId` is honored in **exactly one branch** (the privileged `all` tier). An operator's own id always wins and any input it passes is dropped, so it can never reach another tenant.
- Renter / PARTNER / legacy `STAFF`/`ADMIN` are denied outright — team is operator-internal, owner-tier data, so unlike the public catalog they must never read or thread an id here. This is **not** a behavior change: today all three already get a 403 (via `requireOwnOperator` on reads; via `requireOwnOperator`/`requireOperatorOwnerWrite` on writes).
- Strict, unlike the lenient `resolveReadOperatorTarget` helper (#1373, `routes/helpers.ts`): a platform admin with no pick is a `422`, **not** an unscoped read-all, because there is no merged team view. This is the API mirror of the "pick an operator" prompt.

**Divergence to guard (do NOT "harmonize"):** `resolveTeamOperatorId` sits beside `resolveOperatorIdForWrite` (`tenancy.ts:311-321`) but is deliberately stricter — the write resolver honors a legacy `STAFF`/`ADMIN` `inputOperatorId` (it keys on `!isOperatorRole`), whereas team keys on `PRIVILEGED_ROLES` and denies legacy admins. On writes this surfaces as a gate/resolver asymmetry: a legacy `STAFF`/`ADMIN` *passes* `requireOperatorOwnerWrite` (it is in `OPERATOR_OWNER_WRITE_ROLES`) and is stopped only by the resolver's `else` → 403. A refactor that collapses team onto `resolveOperatorIdForWrite` would silently open a cross-tenant team write, so a route test pins this denial (see Testing).

### 2. Service — `OperatorTeamService` (`services/operator-team.ts`)

Each method gains an `inputOperatorId?: string` parameter and swaps its tenant derivation:

- Reads (`listMembers`, `listInvites`): replace `requireOperatorScope(ctx)` + `requireOwnOperator(ctx)` with `const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)`. The resolver *is* the read gate now (stricter and correct: it denies renter/partner that `requireOperatorScope` used to let fall through to the old `requireOwnOperator` 403).
- Writes (`inviteStaff`, `revokeInvite`, `deactivateMember`): keep `requireOperatorOwnerWrite(ctx)` (still excludes `OPERATOR_STAFF`), then `const operatorId = resolveTeamOperatorId(ctx, inputOperatorId)`.

Everything downstream already keys off the resolved `operatorId`, so the hazards close for free:

- `inviteService.createInvite({ operatorId, ... })` mints the token under the **picked** tenant — never the admin's absent tenant, never a wrong inbox.
- `invites.revoke(id, operatorId)` and `memberships.findActiveByOperator(operatorId)` are tenant-scoped reads: a foreign invite/member id under the picked scope resolves to `undefined` -> `NotFoundError` (404), preserving the no-existence-oracle seal.
- Last-owner-lockout (`:116-121`) counts owners **within the picked tenant** — a picker-admin cannot deactivate operator X's last owner.
- The `OPERATOR_MEMBER_DEACTIVATED` audit event stamps `operatorId` (picked tenant) + `actorUserId` (the admin) + `targetUserId` — a correct, attributable trail.

The no-existence-oracle seal above governs *member/invite* ids (a foreign one is indistinguishable from a missing one). A bogus *operator* id is a different matter: reads return an empty 200; `inviteStaff` calls `inviteService.createInvite`, which throws `OperatorNotFoundError` (`provider-invite.ts:20,73`) for an unknown operator.

**Bug to fix in slice 2 (c1):** `OperatorNotFoundError extends Error`, NOT `NotFoundError`, and the global handler (`error-handlers.ts`) has no branch for it — the only 404 mapping is a *local* catch in `routes/admin.ts:47`. Today the team path never reaches it (an operator's own id always exists), but this design makes it reachable for the first time (a picker-admin can supply an arbitrary `?operatorId=`), so it would currently 500. Slice 2 must map it: add an `instanceof OperatorNotFoundError -> 404` branch to `error-handlers.ts` (which also DRYs the `routes/admin.ts:47` local catch) — or make `OperatorNotFoundError extends NotFoundError` — with a route/integration test asserting a bogus `?operatorId=` on invite is 404, not 500.

With that mapping in place, the operator-id oracle (empty-200 reads / 404 invite) is acceptable — a picker-admin's legitimate pick source is the `/operators` list it can already enumerate, so no id is revealed that it could not already see.

### 3. Routes — `routes/operator-team.ts`

Each handler reads the picked id with a direct `c.req.query('operatorId')` and passes it through. An empty-string `?operatorId=` reads as no-pick (falsy), so a picker-admin gets the 422 "specify a target operator" — consistent with `resolveOperatorIdForWrite`'s `if (inputOperatorId)` truthiness check. This is the picker's newest write transport precedent — booking writes (slice 5b) thread the same `?operatorId=` on state-changing POSTs (`routes/bookings.ts:255,302`), so team matches it rather than inventing a shape. Do **not** reuse `parseCrossOperatorRead(c)` here — that is a *read*-scope helper carrying an unused `includeAll` (team has no merged view). Routes stay HTTP-only; the resolver's throws map via the global handler (403 / 422 / 404 / 409).

Note the transport is deliberately query, not body: the codebase already has three write-operatorId transports — path (`operators.ts:60` settings/profile), body (`parseScopedCreate`, `helpers.ts`), and query (booking writes 5b). Query is chosen to match 5b and to leave the invite body validator (`{email}`) untouched.

## Web design

### `operator-team/api.ts`

- `fetchTeamMembers(operatorId?)` / `fetchTeamInvites(operatorId?)`: append `?operatorId=` when a pick is present (operator sessions pass `undefined` and omit it).
- Query keys fold in the id: `teamMembersQueryOptions(operatorId)` / `teamInvitesQueryOptions(operatorId)` gain the arg (they take none today) and key on `[...TEAM_MEMBERS_QUERY_KEY, operatorId ?? 'self']` so switching tenants refetches instead of serving a stale roster.
- **Invalidation rule (c4):** keep the exported `TEAM_INVITES_QUERY_KEY` / `TEAM_MEMBERS_QUERY_KEY` as the **2-element prefix**; the dialogs keep invalidating that prefix. React Query prefix-matches, so a prefix invalidation still hits every folded `[...prefix, operatorId]` key (safe over-invalidation). Do NOT convert the dialogs to invalidate a specific `[...prefix, id]` — that can invalidate `'self'` while a pick is active and leave a stale roster.
- `inviteStaff` / `revokeInvite` / `deactivateMember`: accept a trailing `operatorId?` and append the same query param; bodies/headers unchanged.

### `routes/$locale/_business/manage/team.tsx`

- Register `/$locale/_business/manage/team` in `OPERATOR_CONTEXT_ROUTE_IDS` (`operator-context.ts`) so the picker chip shows on this page. This also makes `BusinessLayout`'s picker fetch `operatorsQueryOptions()` on the team route for a picker-admin (`BusinessLayout.tsx:32`, `enabled: showPicker`), so the operators list is in cache here — see the badge below.
- Keep the `OPERATOR_TEAM` feature-flag `beforeLoad` gate unchanged. Note for QA: the flag gates the page for a picker-admin too — in the beta demo (flag off) the admin also cannot reach `/manage/team`; that is expected, not a bug.
- **Effective-operator resolution — capability-gated (P2a).** The `?operator=` param is retained globally by the `_business` layout, so it can be present for ANY business role, but only `PLATFORM_ADMIN` may pick. Deriving `operatorId = session.user.operatorId ?? deps.operator` unguarded would honor a retained param for a legacy `STAFF`/`ADMIN` (a cross-operator reader that is NOT a picker), resolve to it, and fire team reads that 403 — instead of the intended no-context prompt. So gate the param on capability, in **both** loader and component:
  `const picked = canPickOperatorContext(session) ? deps.operator /* or pickedOperatorId */ : undefined;`
  `const operatorId = session?.user.operatorId ?? picked`.
  (`canPickOperatorContext` from `@/vite/guards:46`; `session.user.operatorId?: string` exists, `session.ts:15`.) A real operator gets its own id; a picker-admin gets own ?? picked; a legacy admin gets `undefined` → prompt, no illegal read. (Search params are input, not permission: derive the target from session capability first, then URL state. Note: `settings.tsx:47` shares the un-gated pattern — a latent follow-up, out of scope here.)
- **Loader rework (G2).** The current loader (`team.tsx:40-46`) unconditionally prefetches members + invites with no `loaderDeps`. Rework it to mirror `settings.tsx:40-47`:
  - add `loaderDeps: ({ search }) => ({ operator: search.operator })`;
  - resolve `operatorId` via the capability-gated rule above;
  - guard `if (operatorId) { prefetch }` — no-FOUC prefetch only when scoped;
  - parameterize `teamMembersQueryOptions(operatorId)` / `teamInvitesQueryOptions(operatorId)` (their keys now fold in the id, per the api.ts change above).
  The loader guard prevents a wasteful prefetch, but is **not** the all-mode read guarantee — that is the render gate below (P1).
- **Component gate swap.** Replace the current `hasOperator = isOperatorSession(session)` / `canManage = isOperatorOwnerSession(session)` derivations (`team.tsx:63,66`) with `hasOperator = Boolean(operatorId)` (the resolved id) and `canManage = canWriteAsOperatorOwner(session, pickedOperatorId)` (`guards.ts:70-78`), mirroring `settings.tsx:73,79`. This is what opens the write affordances for a picker-admin.
- **All-mode** (a picker-admin with no pick — `hasOperator` false): render the pick-prompt empty state; no team read fires because the `operatorId`-gated child (P1, below) never mounts. The empty state uses `canPick ? t('pickOperatorPrompt') : t('noOperatorContext')` (mirroring `settings.tsx:84`).
- **New i18n key (c2).** Add `business.team.pickOperatorPrompt` to `messages/{en,ja,zh}.json` (team block, ~line 879 — today it has only `noOperatorContext`). Model the copy on the shipped `business.settings.pickOperatorPrompt`. The badge needs no new key (`OperatorBadge` reuses `business.operatorContext.badge`).
- **Render gate — a scoped, keyed child `OperatorTeamData` (P1 + P2b).** The current route calls `useSuspenseQuery(teamMembersQueryOptions())` + invites at the component *top level* (`team.tsx:55-56`). A loader prefetch guard does NOT stop that — `useSuspenseQuery` fetches on render if uncached — so in all-mode it would still issue the illegal `/operators/me/*` reads. The two team queries (and the invite/revoke/deactivate dialog open+selected state, `team.tsx:57-59`) must move into a child rendered **only when `operatorId` exists**:
  - `OperatorTeamRoute` (parent) keeps the always-legal `useSuspenseQuery(sessionQueryOptions())`, resolves the capability-gated `operatorId`, computes `canManage = canWriteAsOperatorOwner(session, pickedOperatorId)`, and renders either the all-mode prompt or `<OperatorTeamData operatorId={operatorId} canManage={canManage} csrfToken={...} key={operatorId} />`.
  - `OperatorTeamData` (new child) holds `useSuspenseQuery(teamMembersQueryOptions(operatorId))` + invites, the three dialogs' open/selected state, `TeamView`, and the dialogs.
  - The **`key={operatorId}`** (mirroring `settings.tsx:76`) remounts the child on a tenant switch — which both resets stale dialog/form intent (P2b: an open deactivate must not submit under the newly-picked operator) and re-fires the scoped reads. This is the render gate that makes "all-mode fires no team read" true, not the loader guard.
- **Mutation call sites (b3):** only the three dialogs mutate — `InviteStaffDialog.tsx:34`, `RevokeInviteDialog.tsx:29`, `DeactivateMemberDialog.tsx:33` — each gains an `operatorId` prop threaded from `OperatorTeamData` into its api call. `TeamView` has no mutation (it only fires `onRevokeInvite`/`onDeactivateMember` callbacks); it takes `canManage` only, not `operatorId`.
- **Picked-operator badge (G1 — label source).** Show an `OperatorBadge` (in the parent header) when `canPick && Boolean(pickedOperatorId)`. Unlike settings (which labels from its own `operator.name` profile read), team reads carry only the *user's* name, not the operator's. Source the label from the operators list — already in cache from `BusinessLayout`'s picker on this route — via `useQuery(operatorsQueryOptions(), { enabled: canPick && Boolean(pickedOperatorId) })` reading `operatorNameById.get(pickedOperatorId)`. **Import `operatorsQueryOptions` from `@/vite/operator-context`** (c3) — NOT the same-named `@/vite/admin/operators` export (different key `['admin-operators']` + shape; wrong import breaks the cache-hit and fires an extra request). `OperatorBadge` returns `null` on an undefined name, so a cold direct-nav is a graceful late-pop, not a crash (c5); optionally `ensureQueryData(operatorsQueryOptions())` in the loader when `canPick && operatorId` for parity. (`useOperatorScope`'s own operators fetch stays all-mode-only — do not widen it.)

## Testing

TDD, vertical, per slice. Mutation-resistant assertions.

- **Unit** (`tests/tenancy.test.ts`): `resolveTeamOperatorId` truth table — operator returns own id and ignores a foreign input; operator-without-id throws `ForbiddenError`; platform admin + id returns the id; platform admin without id throws `OperatorRequiredError`; renter / partner / legacy throw `ForbiddenError`.
- **Routes** (`tests/routes/operator-team.test.ts`): each read/write threads `?operatorId=`; admin-no-pick -> 422; renter/partner -> 403; an operator's foreign `?operatorId=` is ignored (auto-scoped to own); owner-tier gate still 403s `OPERATOR_STAFF` writes.
  - **Pin the resolver-over-gate asymmetry (G6a):** a legacy `STAFF`/`ADMIN` write with `?operatorId=` is **denied (403)** even though it passes `requireOperatorOwnerWrite` — this pins that the resolver, not the gate, is the deny point, so collapsing team onto `resolveOperatorIdForWrite` (which would honor legacy admins) fails the test.
  - **Pin CSRF (G6b):** a threaded POST with the `?operatorId=` param but a missing/invalid `X-CSRF-Token` is still rejected — the query param can never mask an absent token.
- **Integration, real-pg** (`tests/integration/`): admin picks operator X — invite/deactivate land on X (not the admin's absent tenant); a member id belonging to Y under the picked X scope -> 404; X's last-owner deactivate -> 409; the audit event carries `operatorId = X`.
- **Conformance:** extend the cross-operator read-scope suite (`tests/routes/tenancy-context.test.ts` / `tests/integration/tenancy-isolation.test.ts`) with the two team read endpoints — a picker-admin honors `?operatorId=`, a non-privileged caller cannot.
- **Web** (`tests/vite/.../team...test.tsx`): picked mode threads the id into fetch + mutations and refetches on tenant switch (query-key change); write affordances hidden for a non-owner / no-pick; mutation-verified (mirror #1264's `VehicleDetailRoute.test.tsx`). Plus the three review pins:
  - **P1 render gate:** render the route for a picker-admin with NO pick and assert **no** `/operators/me/members` or `/invites` request is issued (not just that the loader skipped it) — the query hook lives behind the `operatorId`-gated child.
  - **P2a capability gate:** a legacy `STAFF`/`ADMIN` session arriving with `?operator=X` renders the no-context prompt and fires no team read (the param is dropped because `canPickOperatorContext` is false).
  - **P2b scoped-intent reset:** open a dialog (or select a member/invite), switch `operatorId`, assert the dialog/selection is reset (the `key={operatorId}` remount) — no stale intent can submit under the new scope.
  - **Must-update existing seam tests (c6):** `tests/vite/operator-team-api.test.ts` (fetch/mutation signatures + folded query keys), plus `RevokeInviteDialog.test.tsx`, `DeactivateMemberDialog.test.tsx`, `TeamView.test.tsx` (new `operatorId`/`canManage` props). There is no `InviteStaffDialog.test.tsx` today — add one, since invite is the path that reaches the c1 error mapping.

## Slices (one PR, `Refs #1230` — do NOT close the epic)

1. **API read scope + resolver.** Add `resolveTeamOperatorId`; thread the id into `listMembers`/`listInvites` and the two read routes; unit + route + conformance tests.
2. **API writes.** Thread the id into `inviteStaff`/`revokeInvite`/`deactivateMember` via the resolver, owner-tier gate + last-owner + audit under the picked operator; map `OperatorNotFoundError -> 404` in `error-handlers.ts` (c1); route + real-pg integration tests (incl. bogus-`operatorId` invite -> 404).
3. **Web wiring.** `api.ts` threading + folded query keys (2-element invalidation prefix kept); route registration in `OPERATOR_CONTEXT_ROUTE_IDS`; capability-gated `operatorId` resolution (loader + component); loader rework; component gate swap; scoped keyed `OperatorTeamData` render-gate child (holds the team queries + dialog state); pick-prompt all-mode + `business.team.pickOperatorPrompt` in en/ja/zh; picked-operator badge; route/component tests (incl. the P1/P2a/P2b pins) + the must-update seam tests.

## Non-goals

1. **No route-path migration** — `/operators/me/*` stays; the id rides as a query param.
2. **No merged cross-operator roster** — all-mode is a pick-prompt; no `findAllActiveMembers`/`listAllInvites` read is built.
3. **No session-revocation change** — a deactivated member keeps access until token expiry (the #904 follow-up, unchanged).
4. **No new write-authorization surface** — the owner-tier gate + the resolver are the whole authorization story; the resolved `operatorId` is itself the scoping key for every downstream repo read (no separate `assertBookingWriteWithinOperator`-style binding is needed, because there is no raw-id `findById` that could hand over a foreign row).

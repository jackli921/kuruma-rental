# Issue #904 — Operator self-service staff invites + membership management

Part of epic #902 (operator cold-start). Branches off `marketplace-pivot` (tip `80a96e37`, includes #903/#915).

## Goal (from #904)
An operator **owner** invites and manages their own staff entirely through the portal — no platform-admin, no DB/curl — with every write scoped to their own operatorId. Today provider invites are PLATFORM_ADMIN-only (`POST /admin/provider-invites`).

## What already exists (reuse, do not rebuild)
- Tables: `provider_invites` (enum `PENDING|ACCEPTED`), `operator_memberships` (enum `ACTIVE|REVOKED`, single-active partial-unique on `userId`) — `packages/shared/src/db/provider-access.ts`.
- Service: `ProviderInviteService.createInvite(input, invitedByUserId)`, `.preview(token)` — `packages/api/src/services/provider-invite.ts`. Mints sha256 token, 7d TTL, returns plaintext + URL once.
- Repos: `ProviderInviteRepository {create, findByTokenHash, markAccepted}`, `OperatorMembershipRepository {findActiveByUserId, create}` — `packages/api/src/repositories/{types.ts,drizzle/*,inmemory/*}`.
- Route surface + scoping: `packages/api/src/routes/operators.ts` (`requireAuth()` + service `scopeToCaller(ctx, …)` load-then-authorize → 404 on foreign id, never 403-leak).
- Guards: `requireOperatorOwnerWrite(ctx)`, `requireOperatorScope(ctx)` — `packages/api/src/auth/guards.ts`. Shared role sets in `packages/shared/src/auth/roles.ts`.
- Web (Vite/TanStack on mp): template page `routes/$locale/_business/manage/locations.tsx` (list + add/edit/archive dialogs), `vite/operator-locations/api.ts` (`unwrap(res, zodSchema)`, `queryOptions`, CSRF-header writes), nav `vite/nav/business-nav-items.ts`, guards `vite/guards.ts` (`isOperatorSession`, `isOperatorOwnerSession`), accept page `routes/$locale/provider/invite/$token.tsx`.

## Design decisions
- **Endpoint scoping = `/operators/me/*`** — derive operatorId from session (`ctx.operatorId`), never a path id. Avoids foreign-id surface entirely; reads cleaner than reusing `/operators/:id`.
- **Minted role hard-coded `OPERATOR_STAFF`** — owners invite staff. No client role control (no privilege escalation). OPERATOR_OWNER invites stay platform-admin-only for now.
- **Write gate = `requireOperatorOwnerWrite(ctx)`** (owner-only: invite/revoke/deactivate). **Read gate = `requireOperatorScope(ctx)`** (any operator member can view their own team).
- **Invite revoke = add `REVOKED` to `providerInviteStatusEnum`** (terminal state, consistent with #681 persist-don't-delete + existing audit columns) rather than hard-delete. Membership deactivate reuses existing `REVOKED`.
- **Lockout invariant:** `deactivateMember` refuses to deactivate the last ACTIVE `OPERATOR_OWNER` (would orphan the operator) → 409. Covers self-deactivation lockout too.

## Slicing (2 vertical slices, each shippable)

### Slice 1 — Invite + view team (NO schema change)
DB→API→Web→E2E, mint + read only.
- **Repo:** add `ProviderInviteRepository.listByOperator(operatorId)`; `OperatorMembershipRepository.listByOperator(operatorId)` (+ user join for name/email in Drizzle). InMemory + Drizzle.
- **Service:** new `OperatorTeamService` (or extend ProviderInviteService) taking `CallerContext`:
  - `inviteStaff(ctx, {email})` → `requireOperatorOwnerWrite`, calls `createInvite({email, operatorId: ctx.operatorId, role:'OPERATOR_STAFF'}, ctx.userId)`.
  - `listInvites(ctx)` → `requireOperatorScope`, pending invites for `ctx.operatorId`.
  - `listMembers(ctx)` → `requireOperatorScope`, memberships for `ctx.operatorId`.
- **Routes** (extend `operators.ts` or new `operator-team.ts`): `POST /operators/me/invites`, `GET /operators/me/invites`, `GET /operators/me/members`.
- **Wire/shared DTOs:** `OperatorMemberData`, `OperatorInviteData` (drizzle-free, ISO dates, no tokenHash) in `@kuruma/shared`; web schemas `satisfies z.ZodType<T>`.
- **Web:** `routes/$locale/_business/manage/team.tsx` + `vite/operator-team/api.ts` + `TeamView`/invite form. Nav item `{to:'/$locale/manage/team', labelKey:'team'}`. Owner-only invite form via `isOperatorOwnerSession`. i18n `nav.team` + `business.team.*` in en/ja/zh. Regen `routeTree.gen.ts`.
- **Tests:** API unit — A can't invite into B (404 scope); staff can't invite (403); invite minted role=OPERATOR_STAFF + operatorId=ctx; list returns only own. Web vite — render members + pending, invite calls API. E2E real-db — owner invites email, pending row appears.

### Slice 2 — Revoke invite + deactivate member (schema change)
- **Schema:** add `REVOKED` to `providerInviteStatusEnum`. `db:generate --name add_provider_invite_revoked` → migrate → verify (5/5). Update `schema.test.ts` enumValues tripwire. Run **all** packages (#681 lesson: pgEnum change trips shared schema test).
- **Repo:** `ProviderInviteRepository.revoke(id, operatorId)` (scoped, PENDING→REVOKED); `OperatorMembershipRepository.deactivate(id, operatorId)` (ACTIVE→REVOKED, scoped) + `countActiveOwners(operatorId)` for the lockout guard.
- **Service:** `revokeInvite(ctx, id)`, `deactivateMember(ctx, id)` — both `requireOperatorOwnerWrite`; deactivate enforces last-owner lockout (409).
- **Routes:** `POST /operators/me/invites/:id/revoke`, `POST /operators/me/members/:id/deactivate`.
- **Web:** row actions + confirm dialogs (mirror locations archive dialog), owner-only. Cache update via `queryClient.setQueryData`.
- **Tests:** revoke flips status + scoped (A can't revoke B's invite); deactivate flips + scoped; last-owner deactivate → 409; web row-action calls.

## Gotchas to honor
- Vitest skips typecheck → run `bun run --filter @kuruma/<pkg> typecheck` separately + `lint:boundaries`.
- New TanStack route → regen `routeTree.gen.ts` (router-generator headless, no dev server).
- Verify all i18n keys across en/ja/zh after edits (merge drops keys).
- E2E real-db needs `kuruma-e2e-pg` container up (port 5433) or rely on CI `e2e-real-db` lane.
- Worktree: `../kuruma-904-team` branch `feat/904-operator-staff-invites` off `origin/marketplace-pivot`; `bun install` + `tsc --noEmit` in fresh worktree.

## DoD
Owner invites + manages staff through the portal, all writes operator-scoped, covered by unit + web + E2E tests. PR base `marketplace-pivot`, `Closes #904` (manual close since base≠default).

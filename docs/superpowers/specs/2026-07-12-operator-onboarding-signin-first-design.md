# Operator Onboarding Redesign — Sign-In-First (Option C)

- Date: 2026-07-12
- Status: DESIGN (owner-approved in brainstorming; spec under review)
- Author: brainstorming session (kuruma-rental)
- Related: go-live checklist `docs/plans/2026-07-11-go-live-checklist.md`; supersedes the invite-link onboarding half of the current operator flow.
- Verified against: `origin/develop` @ `91034edb`.

## 1. Problem

Today a prospective operator onboards through an anonymous, invite-link flow:

1. Anonymous public form at `/$locale/business/register` submits to `POST /operator-applications`, creating a PENDING `operator_applications` row keyed on a free-typed `contactEmail`.
2. A platform admin approves at `/admin/operator-applications`; `approve()` (services/operator-application.ts:120) creates the operator and **mints a one-time OWNER invite token**, returning an `inviteUrl` the admin must **copy and send** out-of-band.
3. The prospective owner opens `/$locale/provider/invite/$token`, signs in with Google (`intent=provider&invite=<token>`), and the OAuth callback (routes/auth.ts:179) redeems the invite via `operator-grant.resolve()` — that redemption is what promotes them to `OPERATOR_OWNER`.

The owner wants this collapsed to: "they submit their info, we approve it, that's it."
The copy-and-send invite link is the friction to remove.

## 2. Goal

Replace the invite-link owner flow with **sign-in-first**:

- A prospective operator signs in with Google (becoming a normal `RENTER`) and applies from inside their account.
- Admin approval promotes **that same account** directly to `OPERATOR_OWNER` — no invite token, no link to copy.
- The applicant's browser learns about the promotion automatically on its next session read, with no re-login.

## 3. Locked decisions

These were settled with the owner during brainstorming (owner picked the recommended option each time).

1. **Entry point = sign-in required to apply.**
   "Become an operator" routes a signed-out user through Google sign-in (renter intent → a normal `RENTER` account), then to the application form.
   No anonymous applications.
2. **Session refresh = auto, re-read role from the DB on session load.**
   `GET /auth/session` re-reads the caller's current `(role, operatorId)` from the DB so an approval takes effect on the applicant's next page load.
   Today the role is baked into the `jose` JWT (`kuruma_session`; auth/jwt.ts + middleware/auth.ts). Making role a live DB read on session-check is the core architectural change.
3. **Notify applicant = email + in-app** on both approve and reject (the reject reason is already captured).
   Refined after review (see §6.4): the existing `notificationDispatcher` is booking-shaped and cannot carry an application notification (`notification_log.bookingId`/`operatorId` are `NOT NULL`, and a reject has no operator), so it is NOT reused. **Email** goes directly through the injectable `emailSender` port (compliance-digest precedent). **In-app** = an applicant-facing application-status surface (PENDING / APPROVED / REJECTED+reason) plus the welcome route — not a bell/inbox (none exists in the product). Real in-app notifications are deferred (§12).
4. **Manual fallback = keep the admin escape hatch.**
   Approval promotes the applicant's account directly. The existing admin-only `POST /admin/operators` (admin.ts:24) and `POST /admin/provider-invites` (admin.ts:36) stay untouched as the manual, off-platform onboarding path.
   No new admin surface is built.

## 4. Two findings that shape the design

Re-reading the code surfaced two facts that make this redesign smaller and cleaner than a naive reading suggests.

**Finding 1 — the DB-read-on-session hook already exists.**
`GET /auth/session` (routes/auth.ts:249) is *not* pure crypto today.
After verifying the cookie it calls `isOperatorSessionRevoked(c, session.user)` (auth.ts:261), a context-injected DB check (middleware/auth.ts:95, #957) that runs **only for operator roles** — renters/admins/partners do zero extra work.
Decision #2 is a natural *generalization* of this existing hook, not a new mechanism.

**Finding 2 — the manual escape hatch already exists and is independent.**
`POST /admin/operators` creates an operator (operatorService.create); `POST /admin/provider-invites` mints an OWNER/STAFF invite for any email.
Both are platform-admin routes that never touch the application flow, so decision #4 is zero new work.
STAFF and OWNER invites share the *entire* `provider-invite` + `operator-grant` + `provider_invites` code path (only the `role` argument differs), so removing the OWNER-invite path means removing invite-minting **only from `approve()`** while leaving the machinery intact for STAFF.

## 5. Core approach: session refresh

Decision #2 requires that a freshly-approved account learns it is now an `OPERATOR_OWNER` without re-login.
Three ways to realize "re-read role from the DB on load":

- **A — Reconcile-and-remint at `GET /auth/session` (chosen).**
  Session-check reads the token, reads the user's current `(role, operatorId)` from the DB, and if they differ from the token, re-mints the `kuruma_session` cookie (Set-Cookie) and returns the fresh session.
  One coherent mechanism; the revoked-operator → signed-out behavior (#957) is preserved as a short-circuit.
- **B — One-time re-auth link in the approval email.** Rejected: only refreshes when *that* link is clicked; a session open in another tab stays stale. Not "auto."
- **C — Force re-login on promotion.** Rejected: logs the user out; decision #2 explicitly ruled this out.

### 5.1 Chosen mechanism (A)

`GET /auth/session` becomes: verify cookie → (revoke short-circuit) → resolve current identity from the DB → reconcile.

```
token = verifySessionCookie(cookie)          // crypto, as today; token also carries the display profile
if !token: 401
if isOperatorSessionRevoked(token.user): 401 // PRESERVED (#957) — revoked/deactivated operator stays signed out
current = resolveCurrentIdentity(token.user.id)   // NEW injected DB read: { role, operatorId? } from users projection
if current differs from (token.user.role, token.user.operatorId):
    slug = current.operatorId ? findOperatorSlug(current.operatorId) : undefined
    reminted = mintSessionToken({
        sub: token.user.id,
        role: current.role, operatorId: current.operatorId, operatorSlug: slug,
        csrf: newCsrf(),
        ...token.profile,        // C1: carry the EXISTING token profile forward (flat name/email/image
    }, secret)                   //     claims) — the DB has no profile to reconstruct from
    setSessionCookie(reminted)                // Set-Cookie on the response
    return session(current, slug, newCsrf, token.profile)  // + Cache-Control: no-store (M3)
return session(token.user, token.operatorSlug, token.csrf, token.profile)  // no re-mint, csrf + profile stable
```

- **Profile source (C1).** The display profile (`name`/`email`/`image`) originates from the Google id_token at sign-in (auth.ts:219) and round-trips through the JWT (jwt.ts:83, surfaced as `session.profile` at auth.ts:274). It is NOT in the DB read. The re-mint MUST thread `token.profile` (from `verifySessionCookie`) into `mintSessionToken`'s FLAT `name`/`email`/`image` claims (jwt.ts:114-124 takes flat keys, not a nested `profile`). `resolveCurrentIdentity` returns identity only, never profile.
- **`resolveCurrentIdentity` shares one projection (H3/L3).** It reads the SAME users projection the revoke check and the JWT mint already agree on (`userRepo.findById`/`findByIds`, which deliberately select `operatorId` — drizzle/user.ts:16-20). Its correctness depends on the revoke short-circuit running first to filter out members of a soft-deactivated operator (the revoke check does the extra `operatorRepo.findById` for `operatorDeactivatedAt`, index.ts:355-363; the users row stays intact by design). To avoid a third read on the operator path, fold `resolveCurrentIdentity` into the same context-injected read as the revoke check (have it return the projection it already fetched) — net zero new reads for operators, one indexed read for renters.
- The re-mint reuses `mintSessionToken` (auth/jwt.ts:114) and `findOperatorSlug`, keeping the session contract (iss/aud/TTL) in one place.
- **Cache-Control (M3).** The reconcile makes `/auth/session` emit `Set-Cookie` on a GET. The response MUST carry `Cache-Control: no-store` so no CF edge or browser cache serves a stale identity / cached `Set-Cookie` pair.
- **CSRF rotation is safe (L2).** A new CSRF token is generated only on re-mint (a rare event — an actual role change). The csrf guard compares the request header against the csrf claim INSIDE the presented cookie (csrf.ts:40-44), not a server-stored value, and the web re-reads the new cookie + `csrfToken` from the SAME `/auth/session` response (session.ts:60). A stale in-flight mutation carries old-cookie + old-header, which still match each other → passes. No broken in-flight requests. The common no-change path leaves cookie + csrf untouched.

### 5.2 Applicant timeline

1. User signs in (renter intent) → cookie says `RENTER`.
2. User submits an application → still `RENTER`, now with a PENDING application linked to their account.
3. Admin approves → DB now has an `OPERATOR_OWNER` membership + `users.role=OPERATOR_OWNER` + `users.operatorId`.
4. User follows the approval email deep-link to the **welcome landing route** (§5.4), which invalidates the client's `['session']` query and forces a fresh `/auth/session` read → the server reconcile re-mints the cookie `OPERATOR_OWNER` + operatorId + operatorSlug → the route then redirects into the portal, where the `_business` guard now reads the fresh OWNER session → the portal loads.

Between step 3 and the next session read, the user's *data* calls still carry the `RENTER` token, so operator data routes correctly 403.
This is safe: the welcome route refreshes the session cookie *before* redirecting into the portal, so the portal's data calls go out with the refreshed cookie.

### 5.3 Web trigger — why the server reconcile alone is not enough (H1)

The server reconcile is a no-op unless the client actually *asks* `/auth/session` again.
The web `_business` guard resolves the session with `ensureQueryData(sessionQueryOptions())` (_business.tsx:12), and the session query sets no `staleTime` (session.ts:80) while the app `QueryClient` sets no defaults (query-client.ts) — so the default `staleTime: 0` applies.
The trap: `ensureQueryData` returns the **cached** value without refetching when a cached entry exists (it only fetches an empty cache); `staleTime: 0` makes *mounted observers* refetch on mount/focus, but the guard is not an observer mount.
A signed-in RENTER already has a cached `['session']` entry (navbar, renter guard, application form all read it), so a naive deep-link straight to `/manage/*` would let `businessGuard` see the **stale cached RENTER** and redirect to the landing — no `/auth/session` call, no reconcile.

So the design needs an explicit invalidation trigger, not reliance on the guard.
Chosen: a dedicated welcome landing route (§5.4) that invalidates `['session']` before reading it.
The secondary path (a user sitting in the app who refocuses the tab) is handled by mounted `useSession` refetching on focus under `staleTime: 0` — good enough, non-deterministic, and not the promise-path.
We deliberately do NOT convert the `_business` guard to a forced `fetchQuery` on every portal navigation — that would add a blocking round-trip to the hot path; the one-time promotion is handled at the landing route instead.

### 5.4 The welcome landing route

- The approval email deep-links to `/$locale/operator/welcome` (name TBD in the plan).
- Its loader/`beforeLoad`: `await queryClient.invalidateQueries({ queryKey: ['session'] })` (or `router.invalidate()`), then read the fresh session; on an `OPERATOR_OWNER` session redirect to the dashboard, otherwise show a "still pending / not approved yet" state.
- This makes the promotion deterministic on the click-through path and doubles as a friendly "welcome, you're an operator" moment.

### 5.5 Reconcile vs revocation ordering (H2/H3)

The `isOperatorSessionRevoked → 401` short-circuit runs BEFORE the reconcile and is PRESERVED verbatim (#957).
Correct behavior, stated explicitly so the spec does not over-claim:

- **RENTER → OPERATOR promotion** (this feature): the token claims `RENTER`, so `isOperatorSessionRevoked` short-circuits to `false` (it early-returns for non-operator claims, middleware/auth.ts:99) → control reaches the reconcile → graceful re-mint. This path is fully handled.
- **Operator lateral change that stays an operator role** (e.g. OWNER↔STAFF, operatorId change): revoke check fires (the projection no longer matches the token), returning 401 → the user is signed out and must re-login. The fresh OAuth callback then reads the current role. This is NOT a graceful reconcile.
- **Demotion OUT of an operator role** (operator → RENTER, e.g. a future resign/deactivate): same as above — revoke check fires → 401 → re-login. Graceful reconcile does NOT cover this.

The reconcile therefore covers **promotion into an operator role and no-op reads**; the existing revoke→401→re-login path covers **any change that starts from an operator token**.
That division is intentional and matches #957's tested behavior; the plan pins it with tests rather than asserting "all role changes reconcile."

### 5.6 Security and performance (decision #2 "design for security + perf")

**Security — improves for the promotion path.**
The token becomes a cache; the DB stays authoritative.
A user *promoted into* an operator role is corrected on the next session read; changes that start from an operator token are handled by the preserved revoke → 401 → re-login path (§5.5), not by graceful reconcile — the spec does not claim otherwise.
The re-mint preserves issuer/audience/TTL via `mintSessionToken`, and threads the existing token profile forward (§5.1 C1); data-route middleware (`requireAuth`) is unchanged and still fails closed on an invalid/absent token plus the operator-revocation check.
The revoke → 401 short-circuit is kept verbatim, so #957's tested behavior does not regress (a revoked/deactivated operator is signed out, never silently converted to a renter session).

**Performance — zero new reads on the operator path, one indexed read for renters.**
Operators already pay two reads on every `/auth/session` (the revoke check's `findByIds` + `operatorRepo.findById`, index.ts:355-363); `resolveCurrentIdentity` must REUSE that projection rather than re-read `users` (§5.1 H3/L3), so operators gain nothing.
Renters gain one indexed `users`-by-id read, where they previously did zero extra work.
The cost is bounded because session reads are client-cached by TanStack Query (`sessionQueryOptions`, web/src/vite/session.ts:80) and fire on mount/window-focus, not per request.
Data-route latency is unchanged (those still read only the token plus the operator-only revoke check).
If this ever shows up in profiling, a later optimization is a monotonically-increasing `users.session_epoch` that the token carries and the read compares — deferred as YAGNI.

## 6. The flow, end to end

### 6.1 Entry & application (sign-in-first)

- "Become an operator" CTA: signed-out → Google sign-in with renter intent and `returnTo` = the application form; signed-in renter → straight to the form.
- The application form's contact email is **read from the authenticated account and locked** (not free-typed). Because the promotion targets a user id (not an email match), there is no invite email to mismatch. The `applicantUserId ↔ contact_email` invariant (§8) must hold at submit time: both come from the same session, so the route derives `contactEmail` from that session's account, never from request input.
- Submit creates a PENDING `operator_applications` row linked to `applicantUserId`.
- Guards (two distinct checks):
  - **New guard — already an operator:** before insert, `submit()` reads the caller's active membership by `applicantUserId` and 409s if one exists. This is a NET-NEW check (`submit()` has none today) with its own test — it is NOT the email-index conflict.
  - **Existing guard — duplicate application:** the partial unique index `operator_applications_live_email_unique` (`contactEmail WHERE status IN ('PENDING','APPROVED')`, operator-applications.ts:69) still maps a 23505 to the existing `ConflictError('an application or account already exists for this email')` (operator-application.ts:304).
- After submit, the CTA/status reflects "Application pending".

### 6.2 Approval = direct promotion (server)

`approve()` (services/operator-application.ts) stops minting an invite.
In one transaction it:

1. creates the operator (existing slug allocation + retry logic unchanged),
2. creates an `OPERATOR_OWNER` membership for `applicantUserId`,
3. sets `users.setOperatorAccess(role=OPERATOR_OWNER, operatorId)`,
4. marks the application APPROVED (the existing `markApprovedIfPending` atomic fence stays as the concurrent-approval race guard).

Steps 2–3 apply the same membership + users-projection writes `operator-grant.resolve()` does (operator-grant.ts:104-113), minus the token lookup and email match.

**This is a WIDENING of `OperatorApprovalRepos`, not a "minus" (M1).**
Today `OperatorApprovalRepos.invites` is `Pick<..., 'create'>` and `.memberships` is `Pick<..., 'findActiveByUserId'>` with no `users.setOperatorAccess` (types-transactions.ts:90-96). The redesign:
- ADDS `memberships.create` and `users.setOperatorAccess` to `OperatorApprovalRepos`; both the Drizzle and in-memory approval transaction factories must construct repos carrying these.
- REMOVES the invite writes from `provision()`: `mintInvite` / `MintedInvite` threading (operator-application.ts:134), `buildProviderInviteRecord` (:193), `invites.create` (:199), and the `PROVIDER_INVITE_PENDING_EMAIL_CONSTRAINT` catch in `provisionApproval` (:167).
- DROPS `ProviderInviteAuditEvent` from `OperatorApplicationAuditEvent` (operator-application.ts:47-50) — `PROVIDER_INVITE_CREATED` is no longer emitted by approval (STAFF invites still emit it, but through `ProviderInviteService`, index.ts:263, not this union).
- NARROWS `OperatorApprovalRepos.invites` — after `remintInvite` is deleted (§7), `invites.revoke` and `invites.findPendingByEmail` lose their only approval-path consumers; keep only what `assertEmailUnclaimed` still needs, or drop the invites Pick entirely if the cross-aggregate guard is re-keyed (§8).

The `assertEmailUnclaimed` cross-aggregate guard (operator-application.ts:78) is kept (see §8 for whether it re-keys on `applicantUserId`).
`approve()`'s return type drops `inviteUrl`/`expiresAt` → `{ operatorId, operatorSlug }` only.

### 6.3 Session refresh

Approach A, as specified in §5.

### 6.4 Notifications (email via `emailSender`, in-app via a status surface)

The booking `notificationDispatcher` cannot carry these notifications: `notification_log` has `bookingId` and `operatorId` as `NOT NULL` FKs and a booking/message-only `kind` enum (notification.ts:54-62), and a *rejected* application has no operator at all.
Reusing it would mean inventing a fake booking — a leaky abstraction we reject.

**Email — direct `emailSender`.**
`approve()` and `reject()` send through the injectable `EmailSender` port (services/email/email-sender.ts), the same direct-send pattern `compliance-digest.ts:143` already uses outside the booking dispatcher.
Two new templates: application-approved and application-rejected (the latter renders the captured reason).
The `EmailSender` is injected into `OperatorApplicationService` (composition root already constructs `emailSender`, index.ts:225).
Sends are best-effort and fired after the approval/reject commit (never inside the tx); a send failure is logged/Sentry-captured, never rolls back the decision.
The approve email deep-links to the welcome landing route (§5.4) and is the primary "you're in" trigger.

**In-app — the application-status surface.**
The applicant, now a signed-in account, gets a status surface reachable from their account: PENDING → APPROVED (with a CTA into the portal) → REJECTED (with the reason, and free to re-apply since a REJECTED row leaves the live-email unique set, operator-applications.ts:67).
This needs a renter-scoped `GET /operator-applications/me` (returns the caller's own application by `applicantUserId`, or 404/empty) — the applicant-facing read that does not exist today — and a small status page.
No live polling — the welcome route + status surface + email cover it.

This delivers decision #3's "email + in-app" without the leaky dispatcher or a `notification_log` widen; a true bell/inbox is deferred (§12).

## 7. What is removed vs kept

**Removed:**

- invite-minting inside `approve()` (operator-application.ts:134, :193–199) and its `inviteUrl` return — the *application-approval* path no longer mints an OWNER invite; it promotes the applicant's account directly,
- `remintInvite()` (service) + `POST /admin/operator-applications/:id/remint-invite` (route) + the admin UI regenerate/copy affordance — these existed only to re-mint the application-approval OWNER invite, which no longer exists,
- the anonymous public application form (replaced by the signed-in form).

**Kept intact (P1a — the invite-acceptance path stays for BOTH manual OWNER and STAFF):**

- the entire `provider-invite` + `operator-grant` + `provider_invites` acceptance machinery, INCLUDING the web accept/preview route `/$locale/provider/invite/$token` and the OAuth `intent=provider` redemption. This path is NOT owner-specific: `POST /admin/provider-invites` can mint an `OPERATOR_OWNER` invite (createProviderInviteSchema admits owner/staff; `OPERATOR_ROLES` includes owner, enums.ts:138), and that manually-minted OWNER invite is redeemable ONLY through this path (operator-grant.ts:104 applies `invite.role`). Removing it would break the decision-#4 escape hatch. So the acceptance path is untouched; only *application approval* stops minting invites.
- the admin escape hatch: `POST /admin/operators` + `POST /admin/provider-invites` (decision #4) — mints an operator + an OWNER (or STAFF) invite that the recipient redeems through the acceptance path above.

## 8. Data model & migration

- Add `operatorApplications.applicantUserId: text('applicantUserId').references(() => users.id, { onDelete: 'restrict' })` (M4/P1b). **Type is `text`, not `uuid`** — `users.id` is `text('id')` with a `crypto.randomUUID()` default (auth.ts:39), and every FK on this table is camelCase `text` (`operatorId`, `reviewedByUserId`, operator-applications.ts:50-51). A `uuid` column would not FK a `text` PK. `onDelete: 'restrict'` mirrors the `operatorId` FK — a pending/approved application must not be orphaned by a user delete, and the promotion targets exactly this id.
- Add the covering index `idx_operator_applications_applicantUserId` — every FK on this table already carries one and `lint:fk-indexes` enforces it (operator-applications.ts:61).
- Required for new rows (the sign-in-first path always has it). Nullable-in-DB + app-required is acceptable if any legacy anonymous row must remain insertable, but new inserts always set it.
- `contactEmail` stays and is the account email (still the live-email uniqueness key). **Invariant (M4):** `applicantUserId`'s account email equals `contactEmail`; enforced at submit by deriving both from the same session, so `assertEmailUnclaimed(contactEmail)` and the user-id promotion can never target different people.
- **`assertEmailUnclaimed` keying (M4):** it currently guards by email (operator-application.ts:78). Given the invariant, email-keying stays correct; the plan may additionally assert by `applicantUserId` for defense-in-depth, but must not introduce a path where the email guard and the promoted user id diverge.
- Beta has effectively no in-flight anonymous applications, so no backfill is required. New rows carry `applicantUserId`; approval requires its presence for the direct-promotion branch. A legacy anonymous row (if any) is handled via the admin escape hatch, not this path — the plan asserts this rather than assuming it.
- Migration authored via `bun run db:generate --name link_operator_application_to_applicant`; then migrate + `db:verify`.

## 9. File-level change map (for the plan phase)

Server:
- `packages/shared/src/db/operator-applications.ts` — add `applicantUserId` column + FK (`onDelete: restrict`) + covering index (§8).
- `packages/shared/src/validators/operator-application.ts` — submit input no longer carries a free `contactEmail`; email is server-derived from the session.
- `packages/api/src/repositories/types-transactions.ts` — WIDEN `OperatorApprovalRepos`: add `memberships.create` + `users.setOperatorAccess`; narrow/drop the `invites` Pick once `remintInvite` is gone (§6.2, M1).
- `packages/api/src/repositories/**/*transaction*` (Drizzle + in-memory approval tx factories) — construct the widened repos so both back-ends carry `memberships.create` + `users.setOperatorAccess`.
- `packages/api/src/services/operator-application.ts` — `submit()` links `applicantUserId` + new already-operator 409 guard; `approve()` promotes directly (drops invite mint, `MintedInvite`, `buildProviderInviteRecord`, the invite audit-union member, `inviteUrl` return); `reject()` unchanged in logic; both `approve()`/`reject()` fire a best-effort email via an injected `EmailSender` (post-commit); add `findByApplicantUserId` for the applicant self-read; delete `remintInvite()`.
- NEW `packages/api/src/services/email/templates/operator-application-approved.ts` + `...-rejected.ts` — two templates (approved with welcome-link; rejected with reason), mirroring the existing `email/templates/*` shape.
- `packages/api/src/routes/operator-applications.ts` — submit requires auth (renter), derives email from the session; NEW `GET /operator-applications/me` (renter-scoped, returns the caller's own application by `applicantUserId` or 404).
- `packages/api/src/routes/admin-operator-applications.ts` — approve returns operator identity only; delete the remint route.
- `packages/api/src/routes/auth.ts` — `GET /auth/session` reconcile-and-remint (§5.1) + `Cache-Control: no-store`.
- `packages/api/src/middleware/auth.ts` / `session-freshness.ts` — reuse the revoke check's projection for `resolveCurrentIdentity`; no change to `requireAuth` token trust.
- `packages/api/src/index.ts` (composition root) — inject `resolveCurrentIdentity` (reusing the revoke projection) + inject the existing `emailSender` (index.ts:225) into `OperatorApplicationService`; `approve()` no longer needs `webBaseUrl` for owner invites.

Web:
- `packages/web/src/routes/$locale/business/register.tsx` + `vite/operator-registration/*` — signed-in form, locked email, pending-state CTA; the CTA gates on session.
- NEW applicant application-status surface (§6.4): a route/page that reads `GET /operator-applications/me` and renders PENDING / APPROVED (portal CTA) / REJECTED+reason, plus a `getMyApplication` client in `vite/operator-registration/api.ts`.
- NEW `packages/web/src/routes/$locale/operator/welcome.tsx` (name TBD) — invalidate `['session']` then redirect to the portal (§5.4).
- `packages/web/src/routes/$locale/_admin/admin/operator-applications.tsx` + `vite/admin/operator-applications/*` — drop the invite-link/copy/remint UI; approve just confirms promotion.
- `packages/web/src/vite/admin/operator-applications/api.ts` (L1) — `approveResultDtoSchema` drops `inviteUrl`/`expiresAt`; delete the remint request fn + `RemintResultDto`.
- `packages/web/src/routes/$locale/provider/invite/$token.tsx` — UNCHANGED (P1a). The accept/preview route stays for manual OWNER invites (admin escape hatch) and STAFF invites alike; no owner-specific code to retire here.

Tests (tsc-excluded, so stale refs surface only at test-run — enumerate now):
- `packages/api/src/services/operator-application.test.ts` — the ~10 `.inviteUrl` / `/provider/invite/` assertions become promotion assertions; remint tests deleted.
- admin route + web admin tests referencing `inviteUrl`/remint.

## 10. Risks & caveats

- **Shared invite acceptance path (P1a).** `/provider/invite/$token` + `operator-grant.resolve()` serve manual OWNER *and* STAFF invites and are NOT removed — only application-approval invite-minting is. The plan verifies the STAFF accept path AND a manually-minted OWNER invite both still redeem end to end (a regression test that would fail if this path were touched).
- **Renter session cost.** §5.6 — accepted, bounded by client caching; operators gain zero reads (projection reuse); revisit only if profiling shows it.
- **Client cache trap (H1).** The server reconcile is a silent no-op unless the client invalidates the `['session']` query; the `_business` guard's `ensureQueryData` reads cache. The welcome landing route (§5.4) is the deterministic trigger — the plan must not rely on the guard forcing a fresh read.
- **Ordering.** A promoted user's data calls stay `RENTER` until the next session read re-mints; the welcome route refreshes the cookie before redirecting into the portal, so no operator data call precedes the reconcile.
- **E2E rewrite.** `e2e/real-db/operator-onboarding.auth.spec.ts` (currently untracked, green for the *old* flow) must be rewritten for apply → approve → auto-promote. The Google-OAuth invite-accept step disappears, making the test more automatable.
- **Go-live findings (unchanged, tracked separately).** geocoder reachability + `GEOCODE_CACHE` KV binding; invite-URL base — still relevant, since the admin escape hatch and STAFF invites keep minting invite links via `webBaseUrl` (only application-approval invites go away).

## 11. Testing strategy

- **Real-pg integration:** approval atomically promotes the linked user (membership + users projection + application APPROVED) in one tx; a re-approve is idempotent; `assertEmailUnclaimed` still blocks a double-claim; the widened `OperatorApprovalRepos` writes both membership + users projection (mutation-check: neuter one write → test red).
- **`/auth/session` reconcile (real-pg + unit):**
  - re-mints on RENTER → OWNER and returns fresh operatorId/slug/csrf + `Set-Cookie`;
  - **profile preserved (C1):** the re-minted session still returns the same `name`/`email`/`image` (mutation-check: drop `token.profile` from the mint → test red);
  - no re-mint and stable csrf + profile when nothing changed;
  - revoked/deactivated operator still 401 (no #957 regression);
  - demotion out of an operator role hits 401, not a graceful renter reconcile (§5.5) — pins the intended behavior;
  - response carries `Cache-Control: no-store` (M3).
- **Web (H1):** the welcome landing route invalidates `['session']` and lands a just-approved user on the portal (not the forbidden redirect) — a test that would FAIL if it relied on `ensureQueryData` alone.
- **Unit:** `resolveCurrentIdentity`; submit guards (already-operator 409 as a distinct check from the email-index 409, email locked to the account, auth required).
- **Notifications (§6.4):** `approve()`/`reject()` call `emailSender.send` with the right recipient + template (mutation-check via a mock/fake sender — asserts the recipient address and that approved vs rejected pick the right template with the reason); a send failure does not roll back or throw out of the commit.
- **Applicant self-read:** `GET /operator-applications/me` returns the caller's own application by `applicantUserId` and 404s (or empty) when they have none; another user cannot read it (tenant/self scope).
- **Invite-acceptance regression (P1a):** BOTH a STAFF invite and a manually-minted OWNER invite (via `POST /admin/provider-invites`) still redeem end to end through `/provider/invite/$token` → operator-grant after application-approval invite-minting is removed.
- **E2E:** rewrite `e2e/real-db/operator-onboarding.auth.spec.ts` to apply → admin approve → applicant session auto-promotes to the portal (the Google-OAuth invite-accept step disappears).
- Assertions are mutation-resistant (specific role/operatorId/status/constraint-name checks, not truthiness).

## 12. Out of scope

- No changes to STAFF onboarding or the invite-acceptance path (P1a — untouched).
- No GA flag flip (this is onboarding plumbing, not a gated feature; ship dark-safe and let the owner enable the operator sign-up entry point when ready).
- The optional `users.session_epoch` optimization (§5.6) is deferred.
- Live polling on the pending page is deferred.
- **Real in-app notifications** (a bell/inbox, or widening `notification_log` for application kinds) are deferred — decision #3's in-app half is met by the application-status surface (§6.4), not a notification feed. A follow-up if the product later grows a general notification center.

# Plan: #521 — provider login entry + invite-backed operator access

- **Issue:** #521 (P0) — `feat(auth): add provider login entry and invite-backed operator access`
- **Parent:** refines #510 (renter login, **shipped**); part of #509 (demo-ready Vite integration) and epic #385.
- **Trunk:** `marketplace-pivot` (worktree `/Users/jack/Dev/kuruma-marketplace-pivot`). Web = Vite + TanStack Router (`packages/web/src/vite/*`, routes under `packages/web/src/routes/`). API = Hono (`packages/api/src`). Schema/validators = `packages/shared/src`.
- **Status:** APPROVED 2026-06-11 — architect-reviewed (two passes; pass 2 caught **C1** = raw `runTx` in an `OperatorGrantService`, not `runInTransaction` — now fixed across §2/§6/§7/§9/§11; see §16). Cleared for implementation.

---

## 1. Problem (restated)

One Google OAuth engine serves everyone. First-time Google users have no `users` row, so the backend cannot infer renter vs operator from login alone. We need **separate UI entry points with shared authentication**, where *Google proves identity but our database grants authority*. Provider access must never be granted by UI intent alone — only by an existing operator membership or an active, email-matched invite.

## 2. Current state (verified against `marketplace-pivot`)

| Area | Today | File |
|------|-------|------|
| Renter login | Real (#510): `/$locale/login` → `LoginCard` POSTs `/auth/google/start?returnTo=…` | `routes/$locale/login.tsx`, `vite/auth/LoginCard.tsx` |
| OAuth start | Sets `kuruma_oauth_state` + `kuruma_oauth_return` HttpOnly cookies; `safeReturnPath` validates returnTo. **No intent/token plumbing.** | `api/src/routes/auth.ts:62-94` |
| OAuth callback | Validates state → exchange code → profile → `resolveUser(profile)` → mint JWT (`sub`,`role`,`operatorId?`,`csrf`) → redirect returnTo | `api/src/routes/auth.ts:96-149` |
| resolveUser | get→create(`role=RENTER`,`operatorId=NULL`)→link; #497 race fix; re-reads `role`/`operatorId` from `users` | `api/src/auth/drizzle-oauth-account-store.ts:36-103` |
| Google profile | `GoogleProfile { sub, email?, name?, picture? }` — **no `email_verified`** captured; `email` is optional | `api/src/auth/google.ts:10` |
| Google provider | `GoogleOAuthProvider` is a port (`exchangeCode`/`getUserInfo`) — injectable test seam | `api/src/auth/google.ts:22-26` |
| Users schema | `role` enum (RENTER/STAFF/ADMIN/OPERATOR_OWNER/OPERATOR_STAFF/PLATFORM_ADMIN); nullable `operatorId` FK | `shared/src/db/schema.ts:35-82` |
| Operators | `operators(id, slug unique, name, preAuthHandoffUrl)`. **No memberships, no invites tables.** | `shared/src/db/schema.ts:47-58` |
| Operator scoping | Derived from JWT `operatorId`+`role` | `api/src/tenancy.ts` |
| Transactions | **`runTx`** = raw interactive runner (`shared/src/db/index.ts:54`), injected directly (`new DrizzleThreadRepository(db, runTx)`). **`runInTransaction`** (`index.ts:272`) is a *different* thing — a FIXED 8-repo booking bundle (`repositories/types.ts:544-555`), NOT a general runner. | `index.ts:2,272,276` |
| Platform-admin routes | `admin.ts` gates `/admin/*` with `requirePlatformAdmin`; e.g. `POST /admin/operators` | `api/src/routes/admin.ts:7-30` |
| Web session | `{ user: { id, role, name?, email?, image? }, csrfToken }` — **no operatorId/slug** | `vite/session.ts:7-10` |
| Guards | `renterGuard` (any session), `businessGuard` (role ∈ BUSINESS_ROLES incl. OPERATOR_*). No slug/operatorId check. | `vite/guards.ts`, `lib/business-roles.ts` |
| Routes | `_business` guard layout + `_business/dashboard` stub. **No `/manage`, `/provider` routes.** | `routes/$locale/_business*` |
| i18n | `auth` namespace (login/logout/google/signInTitle/signInSubtitle/continueWithGoogle). No provider keys. | `web/messages/{en,ja,zh}.json` |
| returnTo guard | `safeReturnPath(raw)` — root-relative only, blocks `//`, `\`, control chars, ≤512 | `shared/src/lib/return-path.ts:16` |

## 3. Decisions (locked with reviewer 2026-06-10)

1. **Membership model = B.** Add an `operator_memberships` table as the authoritative grant ledger (with lifecycle status). For MVP keep **one active membership per user** and **project** the active membership onto `users.role` + `users.operatorId` so `tenancy.ts`, JWT minting, and all existing scoping stay **unchanged**. Membership row = source of truth + audit; `users` columns = its single-active projection that the JWT reads.
2. **Dashboard target = `/manage/$operatorSlug/dashboard`.** Introduce the slug-shaped guarded route shell now (minimal landing; the real operator booking view is #512).
3. **Invite source = platform-admin create-invite endpoint + seed.** Add a minimal `PLATFORM_ADMIN`-only endpoint to mint invites, plus a seeded demo invite for the runbook.

> Trade-off acknowledged (Decision 1): membership row + projected `users` columns is a deliberate denormalization to avoid rewriting `tenancy.ts`/JWT. Both are written in **one transaction** at the single grant path. Follow-up (post-MVP): mint operator JWT claims directly from `operator_memberships` and drop the projection. Filed as a follow-up, not done here.

## 4. Data model (new)

**Enum** `operator_role` = `('OPERATOR_OWNER','OPERATOR_STAFF')` — narrow, prevents bad rows; maps 1:1 onto matching `role` enum strings when projecting.

> **Typed projection (not a string coincidence):** add `operatorRoleToUserRole(r: OperatorRole): UserRole` in shared, backed by a `satisfies Record<OperatorRole, UserRole>` table, and have the `users.role` projection write go through it. A future rename of a `role` enum member then becomes a compile error, not a silent bad row. (Architect LOW.)

**`operator_memberships`**
- `id` text PK (uuid)
- `userId` text NOT NULL → `users.id` (on delete cascade)
- `operatorId` text NOT NULL → `operators.id`
- `role` `operator_role` NOT NULL
- `status` enum `('ACTIVE','REVOKED')` NOT NULL default `ACTIVE` — REVOKED has **no write path in this issue**; it justifies the partial index below and the lifecycle/audit reason Model B was chosen. The revoke endpoint is a §13 follow-up.
- `createdAt`, `updatedAt` timestamptz
- **Partial unique index** on `(userId)` WHERE `status='ACTIVE'` → enforces one active membership per user (MVP) and is the **race fence** for concurrent invite acceptance.
- Index on `(operatorId)`.

**`provider_invites`**
- `id` text PK (uuid)
- `email` text NOT NULL (lowercased invited Google email)
- `operatorId` text NOT NULL → `operators.id`
- `role` `operator_role` NOT NULL
- `tokenHash` text NOT NULL UNIQUE (sha256 of the token; **plaintext token shown once at creation, never stored**)
- `status` enum `('PENDING','ACCEPTED')` NOT NULL default `PENDING` — expired-ness is **computed** from `expiresAt`, not a stored state; `REVOKED`/`EXPIRED` are added only when a revoke/sweep path lands (YAGNI).
- `expiresAt` timestamptz NOT NULL
- `invitedByUserId` text → `users.id` (audit)
- `acceptedByUserId` text → `users.id` (nullable)
- `createdAt`, `updatedAt`
- Index on `(email)`; unique on `(tokenHash)`.

**FK `onDelete` policy (new FKs) — make explicit (architect unknown-unknown):**
- `operator_memberships.userId` → **cascade** (delete user ⇒ drop their grants).
- `operator_memberships.operatorId`, `provider_invites.operatorId` → **restrict** (operator deletion is out of scope §12; restrict fails loud rather than leaving a dangling projected `users.operatorId` whose slug 404s the dashboard).
- `provider_invites.invitedByUserId` / `acceptedByUserId` → **set null** (audit row survives the actor's deletion).
- Lowercase `provider_invites.email` **on insert** (admin endpoint), not only at compare-time.

**Migration:** `bun run db:generate --name add_operator_memberships_and_provider_invites` → `db:migrate` → `db:verify` (4 green). Next number ≈ `0047` — **do not hardcode**; regenerate and renumber if a sibling (#511 in-progress) lands first (see CLAUDE.md drizzle gotcha).

## 5. OAuth intent + invite threading

Mirror the existing returnTo-cookie pattern (low complexity, same security posture). It works because **SameSite=Lax cookies are sent on the top-level GET navigation** Google makes back to `/auth/google/callback` — the same reason the existing state/return cookies survive the round-trip.

- `/auth/google/start` accepts `?intent=renter|provider` and `?invite=<token>` (both optional) alongside `returnTo`.
  - Validate `intent` against the enum (default `renter`).
  - Validate `invite` charset/length; store in HttpOnly `kuruma_oauth_intent` + `kuruma_oauth_invite` cookies (TTL 600s, SameSite=Lax), cleared after callback.
- `/auth/google/callback` reads both cookies, runs the decision logic below, then deletes them (defence in depth, like the existing return-cookie re-validation).

## 6. Callback decision logic

```
profile = await provider.getUserInfo(...)    // GoogleProfile {sub, email?, email_verified?, ...}
email   = profile.email?.toLowerCase()
user    = resolveUser(profile)               // existing: get-or-create RENTER + link account
intent  = readIntentCookie()                 // 'renter' | 'provider' (default 'renter')
token   = readInviteCookie()                 // optional

// --- decide final identity; default = the user's projected identity ---
grant = { role: user.role, operatorId: user.operatorId }

if intent === 'provider' && !findActiveMembership(user.id) && token:
    if !email || profile.email_verified !== true:
        return redirect '/<locale>/provider/login?error=access_not_found'
    invite = findActiveInviteByTokenHash(sha256(token))
    if invite && invite.status === 'PENDING' && invite.expiresAt > now
              && invite.email === email:               // both lowercased
        await runTx(tx => {                             // RAW runTx (NOT runInTransaction — C1), atomic (#493)
            insert operator_memberships(user, invite.operatorId, invite.role, ACTIVE)
            update users   set role=invite.role, operatorId=invite.operatorId   // MVP projection
            update invite  set status=ACCEPTED, acceptedByUserId=user.id
        })
        grant = { role: invite.role, operatorId: invite.operatorId }
    else:
        return redirect '/<locale>/provider/login?error=invite_invalid'

// --- single mint path: slug ALWAYS derived from operatorId, regardless of intent ---
operatorSlug = grant.operatorId ? findOperator(grant.operatorId).slug : undefined
mint JWT { sub, role: grant.role, operatorId: grant.operatorId, operatorSlug, csrf, ... }

// --- redirect ---
if intent === 'provider':
    grant.operatorId ? redirect '/<locale>/manage/<operatorSlug>/dashboard'   // computed dest wins over returnTo
                     : redirect '/<locale>/provider/login?error=access_not_found'
else:
    redirect safeReturnPath(returnTo) ?? '/<locale>'
```

Security invariants:
- **Provider intent alone never writes membership/role** — only a valid invite or pre-existing membership grants; renter intent never reads invites/memberships. (AC: "intent alone never grants".)
- Email match requires a **present, Google-verified** email; **both sides lowercased** before compare (emails treated as opaque — no Gmail dot canonicalization). Unverified/absent → `access_not_found`.
- The three acceptance writes run in **one raw `runTx`** (`@kuruma/shared/db`; needs pooled `DATABASE_URL`, #493), with the **membership INSERT first** so the partial-unique-active index aborts the *whole* tx (including the `users` projection) on a concurrent double-accept. **On unique-violation the callback must NOT mint from the pre-tx `grant`** (still `RENTER` from the stale pre-tx read) — it re-reads the now-active membership (the winner) and mints from that, mirroring the `resolveUser` race fix at `drizzle-oauth-account-store.ts:64-87`. *(Architect HIGH — Check-Then-Act: a read-then-conditional-write that straddles a tx boundary must re-read on conflict; never trust the pre-tx snapshot.)*
- Invites are **single-use** (PENDING→ACCEPTED), time-limited, looked up by **hash**, never plaintext.
- `operatorSlug` is minted whenever `operatorId` is set, on **every** intent — so an operator using the renter door still satisfies the `/manage/$slug` guard (resolves §14.2). One mint path, no per-intent divergence.
- Redirect targets are built from the **server-side** `operator.slug`, never user input; for provider intent the computed dashboard overrides `returnTo`.

**Defined behaviors:**
- Existing member who opens a *different* operator's invite link: the membership check short-circuits before the token branch → routed to their current operator dashboard, invite left PENDING (single-membership MVP). Multi-operator + switch is a follow-up.

## 7. API surface

- **`POST /admin/provider-invites`** — lives in `routes/admin.ts` under the existing `requirePlatformAdmin` middleware on `/admin/*` (same pattern as `POST /admin/operators`). Body `{ email, operatorId, role }` (Zod `createProviderInviteSchema`). Generates the token via the existing **`randomToken(32)`** (256-bit, `auth/google.ts:76`) — do not hand-roll; stores `sha256(token)`, returns one-time `{ token, inviteUrl, expiresAt }`. Operator/renter callers already 403 via the middleware. Emit a **structured audit log** on creation (`invitedByUserId`, `operatorId`, `email`); confirm the path is inside the IP rate limiter (`index.ts:484`). (Architect MEDIUM.)
- **`GET /provider-invites/:token/preview`** — public, returns **`{ operatorName, expiresAt, valid }` only — NOT the invited `email`** (a leaked invite URL must not disclose the target address or aid a targeted phish; the email is verified server-side at accept, so the page never needs it). Renders "You're invited to <Operator>"; clear 404/expired (`valid:false`) states; inside the IP rate limiter. (Resolved §14.1; architect MEDIUM.)
- **`/auth/google/start` + `/auth/google/callback`** — extend per §5/§6.
- **`GET /auth/session`** — extend response to include `operatorId` + `operatorSlug` (from JWT) so web guards can match slug.
- **Add `email_verified`:** `GoogleProfile` (`api/src/auth/google.ts:10`) currently has only `{sub, email?, name?, picture?}`. Extend the interface + `getUserInfo` to read `email_verified` from Google's userinfo and surface it to the callback. Treat **absent email** as un-grantable for provider invites.
- **Repositories:** `ProviderInviteRepository`, `OperatorMembershipRepository` (interfaces in `repositories/types.ts`; Drizzle + InMemory impls; wired in `index.ts` composition root only — per the DI boundary rules).
- **`OperatorGrantService` (services layer) + raw `runTx` (architect C1+H4):** the grant decision (§6) and the 3-write acceptance live in a new `OperatorGrantService`, **not** the callback route — the route stays HTTP-only (calls the service, then mints). The service is constructed with the **raw `runTx`** (`RunTx` from `@kuruma/shared/db`), injected exactly like `new DrizzleThreadRepository(db, runTx)` (`index.ts:276`). **Do NOT use `runInTransaction`** — that is `createDrizzleTransaction`'s fixed 8-repo *booking* bundle (`repositories/types.ts:544-555`), whose callback receives `TransactionRepos`, not a `tx` handle, and cannot write memberships/invites/users.

## 8. Web surface

- **`routes/$locale/provider/login.tsx`** — provider-branded `LoginCard` variant; Google button action `/auth/google/start?intent=provider&returnTo=/<locale>/manage`. Renders `error=access_not_found|invite_invalid` panel with **sign out** + **request access** (a `mailto:`/contact link for MVP; the real request form is a §13 follow-up).
- **`routes/$locale/provider/invite/$token.tsx`** — invite acceptance card; preview fetch (`GET /provider-invites/:token/preview`); Google button action `/auth/google/start?intent=provider&invite=<token>&returnTo=…`.
- **`routes/$locale/manage/$operatorSlug/`** — a **layout route at the `$operatorSlug` segment** owns the guard in its `beforeLoad` (a *pathless* `_manage` above it can't read the slug param). Guard = `businessGuard` **AND** `params.operatorSlug === session.user.operatorSlug` (fail-closed → forbidden). Child `dashboard.tsx` = minimal landing (port-pending acceptable; #512 fills it). Note: `PLATFORM_ADMIN`/STAFF have no `operatorSlug`, so this guard excludes them from `/manage/$slug` — intended for MVP (they use the #462 admin portal). Remember to `vite build` to regen `routeTree.gen.ts` before typecheck and stage it.
- **Session type** (`vite/session.ts`): add `operatorId?: string`, `operatorSlug?: string`.
- **i18n:** new `auth.provider.*` keys (signInTitle/subtitle, continueAsProvider, invite.title, invite.expired, accessNotFound, requestAccess) in `en`, `ja`, `zh` — keep parity (`lint:i18n-parity`).

## 9. TDD vertical slices (re-cut to vertical click-throughs)

Each slice is demoable end-to-end, not a horizontal layer.

**A — Invite issuance** (DB → admin API; curl-demoable). Enum + 2 tables + migration; `ProviderInviteRepository` + `OperatorMembershipRepository` (interfaces + Drizzle + InMemory, wired in `index.ts`); `POST /admin/provider-invites` in `admin.ts`; `createProviderInviteSchema`; env-driven seeded demo invite. Tests: repo CRUD, token-hash lookup, expiry-at-read; endpoint authz (reject operator/renter), validation, one-time token shape. **The partial-unique-active fence test runs against Drizzle/Postgres (the integration lane), NOT InMemory** — a map can't enforce a partial unique index, so an in-memory assertion proves nothing. (Architect LOW.)

**B — Invite acceptance, click-through** (web invite page → OAuth → operator dashboard). `provider/invite/$token.tsx` + preview; `intent`+`invite` cookie threading in start/callback; `email_verified` added to `GoogleProfile`/`getUserInfo`; `OperatorGrantService` + acceptance via raw `runTx` + projection; consolidated single-mint with `operatorSlug`; `/manage/$operatorSlug` guard + landing. Tests (fake `GoogleOAuthProvider` returning canned `{sub,email,email_verified}` — the #497 seam): accept success → membership + projection + invite ACCEPTED + dashboard; **email mismatch / unverified / absent** → `access_not_found`; expired/used invite → `invite_invalid`; provider-intent-without-invite never writes role.

**C — Existing-member login, click-through** (web provider/login → OAuth → dashboard). `provider/login.tsx`; callback membership→dashboard path; `/auth/session` exposes `operatorId`+`operatorSlug`; session type extended. Tests: member routes to correct dashboard; **renter-door operator** still lands an operator session (§14.2); cross-operator slug → forbidden.

**D — Not-authorized + renter regression + i18n** (web). `access_not_found`/`invite_invalid` panels (sign out + mailto request-access); renter-login regression intact; full `auth.provider.*` keys in en/ja/zh. Tests: error panels render; renter happy path unbroken; `lint:i18n-parity`.

Each slice: RED→GREEN→REFACTOR, committed independently, gates green (`typecheck`, `lint`, `lint:boundaries`, `lint:i18n-parity`, web/api vitest, `db:verify`).

## 10. Acceptance criteria → coverage

| AC | Slice |
|----|-------|
| Renter login creates/resumes renter, routes to renter dest | D (regression) |
| Provider login routes existing member to operator dashboard | C |
| Invite login accepts only invited Google email, creates membership | B |
| Uninvited account can't access provider routes, sees not-authorized | B,C,D |
| Provider UI intent alone never grants role/operatorId | B |
| Guards block renter↔provider crossover | C,D |
| Tests cover new-renter / existing-provider / invite-accept / email-mismatch / uninvited | B,C |

## 11. Risks & mitigations

- **Tx primitive (architect C1)** → acceptance uses **raw `runTx`** inside `OperatorGrantService`, NOT `runInTransaction` (the fixed booking bundle). Interactive tx needs pooled `DATABASE_URL` (#493); default neon-http `db.transaction()` throws.
- **`email_verified` not captured today** → extend `GoogleProfile`/`getUserInfo` in Slice B *before* the email-match gate can work; treat absent email as un-grantable.
- **Migration number race** (#511 active) → generate late; renumber per drizzle gotcha; `db:verify` is the real signal.
- **Dual representation** (membership row + projected `users` cols) → single-transaction write; documented follow-up to read membership directly.
- **Open-redirect / cross-tenant** → server-derived slug for redirects; `/manage/$slug` guard fail-closed on slug mismatch.
- **Token leakage** → store hash only, one-time plaintext display, short expiry.
- **Email spoofing** → require `email_verified`; reject otherwise.
- **i18n drift** → add all keys to 3 locales in the same commit; `lint:i18n-parity`.

## 12. Out of scope (issue non-goals)

Public provider self-serve onboarding; full operator-portal re-port; multi-operator role switcher; separate OAuth client.

## 13. Follow-ups to file

- Operator-owner invites their own staff (vs platform-admin only).
- Invite/membership **revoke** endpoint (activates the `REVOKED` states) + lazy `EXPIRED` sweep.
- Mint operator JWT claims directly from `operator_memberships`; drop `users` projection.
- Multi-operator membership + switcher.
- `request access` form/flow behind the not-found state (MVP is a mailto link).
- **Audit-log stream** for privilege grants (membership create) beyond the `invitedBy`/`acceptedBy` columns.
- **Operator archive/delete lifecycle** (today: `restrict` FKs, deletion out of scope) — cascade or soft-archive memberships + invites.
- **Supersede duplicate PENDING invites** for the same `(email, operatorId)` at create time (today multiple live tokens are allowed; they go inert after first accept but remain valid until expiry).
- **Stale renter tabs after a grant**: a renter who accepts an invite has the session cookie replaced, but already-open renter tabs hold the old session until `/auth/session` refetches — acceptable; note for support.

## 14. Resolved decisions (2026-06-11)

1. **Include** the `GET /provider-invites/:token/preview` endpoint — invite page shows "You're invited to <Operator>" + expiry (better #488 demo UX).
2. **Operator identity regardless of door.** An operator signing in via the renter door still gets their operator session; guards route correctly. Single `resolveUser` path. (Implemented via the consolidated single-mint in §6 — `operatorSlug` is always derived from `operatorId`.)
3. **New `_manage` route group** hosting `/manage/$operatorSlug/dashboard`: the guard lives in the **`$operatorSlug` layout route's `beforeLoad`** (not a pathless layout — it must read the slug param) = `businessGuard` AND `params.operatorSlug === session.user.operatorSlug` (fail-closed). Clean separation from the legacy `_business` stub. (Excludes platform-admins, who lack a slug — intended; see §8.)

## 15. Review revisions (2026-06-11)

Folded in from the review pass:
- §6 consolidated to a **single JWT-mint path** so `operatorSlug` is set on every intent (fixes renter-door operator → `/manage` guard).
- §6 acceptance writes wrapped in **raw `runTx`** inside `OperatorGrantService` (#493); partial-unique-active index named as the race fence.
- §6 email compare **normalized + verified-email/absent-email gated**.
- §9 **re-cut to vertical click-throughs (A–D)**; callback test seam (fake `GoogleOAuthProvider`) named.
- §4 dropped speculative invite statuses (`EXPIRED`/`REVOKED`); kept membership `REVOKED` with rationale; revoke is a §13 follow-up.
- §7 admin endpoint placed in `admin.ts`/`requirePlatformAdmin`; `email_verified` add made explicit; raw `runTx` injection into `OperatorGrantService` noted.
- §8 `/manage/$slug` guard moved to the `$operatorSlug` `beforeLoad`; "request access" defined as MVP mailto; platform-admin exclusion noted.
- Seeded demo invite made **env-driven** (not hardcoded email).

**Architect review (2026-06-11) — two passes.** Pass 1 returned SHIP-WITH-NITS but **mis-confirmed the tx claim** (it cited `index.ts:272`, which is `runInTransaction`/the fixed booking bundle — not raw `runTx`). Pass 2 (independent) returned **NEEDS-CHANGES** on that exact point (**C1**): the membership/invite/user writes must use **raw `runTx`** (the `index.ts:276` injection pattern), not `runInTransaction`, whose callback receives a fixed 8-repo `TransactionRepos` and cannot run them. **C1 now fixed** across §2/§6/§7/§9/§11 — raw `runTx` inside a dedicated `OperatorGrantService`, callback stays HTTP-only (also resolves the H4 routes→services boundary). Other claims confirmed sound: `GoogleProfile` lacks `email_verified` but extendable; OAuth cookies HttpOnly+Lax survive the redirect; `requirePlatformAdmin` 401-before-403; projection keeps `tenancy.ts`/JWT unchanged, `operatorSlug` greenfield. Nits folded:
- §6 **HIGH** concurrent-login race → membership-INSERT-first + loser re-reads the winner's membership (no stale-`RENTER` mint).
- §7 **MED** token pinned to `randomToken(32)`; preview drops the `email` field; rate-limiter coverage + grant audit-log noted.
- §4 **LOW** typed `operatorRoleToUserRole` (`satisfies`); explicit FK `onDelete` policy; lowercase email on insert.
- §9 **LOW** partial-unique fence test is a DB-integration test, not InMemory.
- §13 unknown-unknowns filed (audit stream, operator-deletion lifecycle, duplicate-invite supersede, stale renter tabs).

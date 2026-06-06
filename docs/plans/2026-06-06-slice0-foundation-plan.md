# Slice 0 — Migration foundation: implementation plan

**Worktree:** `~/Dev/kuruma-slice0-pages-shell` · **Branch:** `feat/slice0-pages-shell` (off `origin/marketplace-pivot`)
**Issue:** #378 (claimed `in-progress`). **Decision:** `docs/plans/2026-06-06-deploy-blocker-analysis.md` §0 (Option B).
**Design (locked):** `docs/superpowers/specs/2026-04-18-migrate-web-off-nextjs-design.md` + handoff razor `2026-04-18-nextjs-migration-handoff.md`.

## What & why
Deploy is structurally blocked (Next.js handler alone ~10.5 MiB > CF's 10 MiB paid Worker cap). Fix = migrate web to Vite + CF Pages (#378), starting with **Slice 0**: stand up a CF Pages shell + Functions proxy + prove cookie auth, *before* any marketplace web slice (guardrail on #378). This plan covers the **secret-independent foundation** — the bulk of the risk — which needs neither CF Pages access nor Apple creds.

## Scope of this plan
- **In:** API-side cookie session + CSRF; Google OAuth relocated to the API (direct authorization-code flow minting our `kuruma_session`, OAuth HTTP boundary injected in tests); CF Pages Functions proxy scaffold; Vite + TanStack Router shell with `beforeLoad` guards + `useSession`.
- **Out / deferred:** live Pages preview deploy (needs **CF access — #304**); full 1:1 route port of every marketplace page (the "bulk", lands after Slice 0 is green); domain cutover (#373).
- **Apple: DROPPED (user decision 2026-06-07) — Google is the only provider.** Former Phase 3 (Apple carve-out stub) is removed. Adding a provider later is trivial (razor line 128, no schema change) if it's ever wanted.

## Grounded current state (read before coding)
- API already verifies a **Bearer** JWT: `packages/api/src/middleware/auth.ts` → `verifyJwt` (jose, HS256, shared `AUTH_SECRET`, issuer `kuruma-web` / aud `kuruma-api`). Minted today by web `packages/web/src/lib/api-token.ts`.
- App factory: `createApp(overrides?)` at `packages/api/src/index.ts:112`; route guards mounted as `app.use('/vehicles/*', requireAuth())` etc. (index.ts:342-349).
- Test harness refs: `packages/api/tests/routes/auth-middleware.test.ts`, `cors-env.test.ts`.
- Env present locally: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `DATABASE_URL`. **No `AUTH_APPLE_*`.**
- Schema the adapter needs: `packages/shared/src/db/schema.ts` (`users`, `accounts`, `sessions`, `verificationTokens`).

## Phases (each phase = green tests + a commit + a handoff line)

### Phase 1 — API cookie session + CSRF (no OAuth yet) — DONE
The risk core, fully TDD-able without OAuth/CF.
- Add a `csrf` claim (32-byte random, session-lifetime stable) to the session JWT contract (spec §5.3).
- `GET /auth/session` — read `kuruma_session` cookie → verify JWT → `{ user, csrfToken }` or **401**.
- CSRF middleware — on non-GET to `/api/*` and `/auth/signout`, compare `X-CSRF-Token` header to `payload.csrf`; mismatch/absent → **403**. Cookie-less callers (partner Bearer / API-key) are exempt — they carry no session cookie and are CSRF-immune.
- Extend `requireAuth()` to accept the `kuruma_session` **cookie** in addition to Bearer (Bearer/API-key stay for PARTNER).
- **Tests (RED→GREEN, mutation-resistant):** valid cookie → 200 with exact `{user:{id,role}, csrfToken}`; missing cookie → 401; tampered JWT → 401; non-GET with good token+header → passes; with missing/bad `X-CSRF-Token` → 403; GET never requires CSRF. Cookie attrs assert `HttpOnly; Secure; SameSite=Lax`.
- **Files (~≤5):** `packages/api/src/routes/auth.ts` (new), `packages/api/src/middleware/csrf.ts` (new), edits to `middleware/auth.ts` + `index.ts` wiring, `packages/api/tests/routes/auth-session.test.ts` (new).

### Phase 2 — Google OAuth on the API — DONE (2a–2d, local)
Diverged from `@hono/auth-js` (user-confirmed): drive the authorization-code flow **directly** and mint our own Phase-1 `kuruma_session` — one session system, no worker bloat (the very size cap that forced this migration). For only one provider this is the simpler long-term shape.
- `POST /auth/google/start` → 302 to Google (state bound to a short-lived cookie). `GET /auth/google/callback` → state check → exchange code → userinfo → resolve/upsert user via `@auth/drizzle-adapter` (same `users`/`accounts` tables) → mint session JWT (with `csrf`) → set `kuruma_session` (`HttpOnly; Secure; SameSite=Lax`) → redirect. `POST /auth/signout` → clear cookie, 204.
- Ports in `src/auth/google.ts`; concretes `FetchGoogleOAuthProvider` + `DrizzleOAuthAccountStore` in `src/auth/` (wired only in `index.ts`).
- **Tests:** route logic behind injected fakes + a createApp wiring seam (`googleAuthRuntime` override). Remaining: the live `AUTH_GOOGLE_*` round-trip (manual; non-prod DB) — verified on the Pages preview (Phase 4).

### Phase 3 — REMOVED
Was "Apple carve-out (stubbed)". Dropped 2026-06-07 — Google is the only provider (user decision). Phases 4–5 keep their numbers to stay consistent with prior commits/handoffs.

### Phase 4 — CF Pages Functions proxy scaffold
- Pages Functions that proxy `/api/*` and `/auth/*` to the API origin so web+API are **same-origin** (makes `SameSite=Lax` valid from day one). Scaffold + config; live deploy deferred to CF access (#304).

### Phase 5 — Vite + TanStack Router shell
- Vite app, route tree ported 1:1 (`/:locale/...`), `beforeLoad` guards on `_renter`/`_business` (silent redirect per razor line 122), `useSession()` via React Query against `/auth/session`, inline-bootstrap FOUC handling. i18n `next-intl`→`use-intl` is its own rename pass (#377), can parallelize.

## Checkpoint (from decision doc §0)
End of **migration day 2**, counted from when Slice 0 starts *with required secrets/access available* (CF Pages access — #304). **Pass:** Pages preview exists; `/api/*` + `/auth/*` proxy via Functions; Google OAuth green on preview; cookie `SameSite=Lax`; CSRF rejects missing/bad tokens. **Fail:** trigger the A-bridge (non-CF host) next morning, one timeboxed day, freeze non-demo Next.js work, return to B.

## Workflow guardrails
TDD vertical slices (one failing test → impl → green). Commit per green phase. Rebase onto `origin/marketplace-pivot` before any PR; never force-push. Ships incrementally toward #378 (epic stays open until the full port lands). No commit attribution.

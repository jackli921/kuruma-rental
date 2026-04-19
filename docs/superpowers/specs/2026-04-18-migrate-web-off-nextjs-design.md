# Design: migrate `packages/web` off Next.js to Vite + TanStack Router + CF Pages

**Date:** 2026-04-18
**Umbrella issue:** #378
**Related issues:** #372 (CSRF), #373 (parent domain), #377 (i18n)
**Status:** approved design, pending implementation plan

---

## 1. Problem

The web Worker bundle is ~13.6 MiB (10.5 MiB handler + 2.2 MiB `@vercel/og` + 0.9 MiB middleware). It exceeds both CF Workers tiers (3 MiB free, 10 MiB paid) so deploys fail on size. Root cause: `@opennextjs/cloudflare` bundles Next.js runtime + React 19 RSC + Auth.js + DrizzleAdapter + postgres driver into one Worker. The Next.js runtime alone is 4–5 MiB before app code.

Paying the $5/mo CF Workers Paid tier only buys breathing room up to 10 MiB — we're already at 10.5. Every added feature tightens the noose. The fix is to stop deploying web as a Worker.

## 2. Goals / non-goals

**Goals**
- Web package fits CF free-tier Pages (unmetered static hosting, no size limit).
- Port all existing routes and user flows with identical URL shape.
- Keep Google + Apple OAuth working end-to-end.
- Keep i18n parity (en/ja/zh, ICU formatting, JA as primary audience).
- Three-to-five focused days of work.

**Non-goals**
- SSR return. SPA is acceptable; SEO is nice-to-have, not critical.
- Feature work. Port-only migration.
- API changes. Hono API stays exactly as it is except for the auth relocation (§5).
- 3rd-party OTA callers. Parked indefinitely per existing memory.

## 3. Target architecture

| Layer | Today | After migration |
|-------|-------|-----------------|
| Framework | Next.js 16 (App Router) | Vite + TanStack Router (file-based routing) |
| Hosting | CF Workers via `@opennextjs/cloudflare` | CF Pages (static) |
| Auth | Auth.js in web, DrizzleAdapter in web | `@auth/core` in Hono API, DrizzleAdapter in API |
| Auth transport | Bearer JWT signed by Next.js server | HttpOnly session cookie set by API |
| CSRF | N/A (Bearer is CSRF-immune) | JWT-embedded token, double-submit `X-CSRF-Token` (#372) |
| i18n | `next-intl` | `use-intl` (same hooks; import rename) (#377) |
| Middleware | `middleware.ts` (JWT + role + locale) | TanStack `beforeLoad` route guards + inline bootstrap script |
| Data fetching | Server Components + React Query | TanStack `loader` + `queryClient.ensureQueryData` + React Query |
| Forms | react-hook-form + zod → API (already) | react-hook-form + zod → API (unchanged) |
| Components | shadcn / Tailwind / base-ui | shadcn / Tailwind / base-ui (unchanged) |

**Packages pruned from `packages/web`:** `next`, `next-auth`, `next-intl`, `@opennextjs/cloudflare`, `@auth/drizzle-adapter`, `wrangler`.
(`@vercel/og` is transitive through `@opennextjs/cloudflare`; drops free. Grep confirmed no `ImageResponse` / `opengraph-image` usage in the app — nothing to port.)
**Packages added to `packages/web`:** `vite`, `@vitejs/plugin-react`, `@tanstack/react-router`, `@tanstack/router-plugin`, `use-intl`.
**Packages added to `packages/api`:** `@auth/core`, `@auth/drizzle-adapter`, `@hono/auth-js` (Hono wrapper — cleaner than hand-mounting `@auth/core` handlers on Hono context).

## 4. Routing

### 4.1 URL scheme
Preserved: `/:locale/...` with `locales ∈ {en, ja, zh}`. Root `/` redirects to detected locale via the inline bootstrap script (§6.2). Invalid locale → 404.

### 4.2 Route tree
Ported 1:1 from `packages/web/src/app/[locale]/`:
- `(public)` — `/`, `/vehicles`, `/vehicles/$id`
- `(auth)` — `/login`
- `(renter)` — `/bookings`, `/bookings/new`, `/bookings/confirmation`, `/messages/*`
- `(business)` — `/dashboard`, `/manage/vehicles`, `/manage/vehicles/$id`, `/manage/bookings`, `/manage/bookings/$id`, `/manage/customers`, `/manage/customers/$id`, `/manage/classes`
- `error.tsx`, `not-found.tsx` at root

Route groups (`(auth)`, `(renter)`, `(business)`) map to TanStack Router layout routes (`_auth.tsx`, `_renter.tsx`, `_business.tsx`) for shared layout + guard logic.

### 4.3 Guards (replaces `middleware.ts`)
`beforeLoad` on layout routes:
- `_renter.tsx` — requires session. Redirect to `/:locale/login?returnTo=<path>` if missing.
- `_business.tsx` — requires session AND `role ∈ {staff, admin}`. Redirect to `/:locale/dashboard` if wrong role (razor default, see handoff table).
- Session source: `queryClient.ensureQueryData({ queryKey: ['session'] })` — one in-flight request, cached.
- API enforcement remains the real security boundary; guards are UX only.

### 4.4 Data fetching
Default pattern: `loader` calls `queryClient.ensureQueryData(...)`; component uses `useQuery(...)` with the same key. Result: prefetch during navigation, live reactivity during mount.
Per-route deviation allowed where a specific need exists (e.g., optimistic UI).

### 4.5 Loading contract (auth-session FOUC)
Inline bootstrap (§6.2) handles i18n FOUC but can't touch the HttpOnly session cookie — it's invisible to JS by design. The loading contract for auth-gated routes:

- `beforeLoad` on `_renter` / `_business` calls `queryClient.ensureQueryData({ queryKey: ['session'] })`. Navigation is held until `/auth/session` resolves (hit or 401). No render happens with ambiguous auth state.
- Cold mount (direct URL entry to `/manage/bookings`): TanStack's `pendingComponent` on the layout route renders a global `<PageSkeleton>` during the in-flight session fetch. No auth flash, no redirect-then-content flash.
- Subsequent navigations are synchronous — React Query serves the cached session, `beforeLoad` resolves immediately.
- Sign-out invalidates the `['session']` query; the next guarded route re-fetches.

## 5. Auth relocation

### 5.1 Endpoints (on Hono API)
- `POST /auth/google/start` → 302 to Google OAuth with state/nonce.
- `GET /auth/google/callback` → verifies, upserts user via DrizzleAdapter, sets `kuruma_session` cookie (HttpOnly, Secure, `SameSite=None`), redirects to web.
- `POST /auth/apple/callback` → same as Google; CSRF-exempt (first touch from Apple form POST, no session yet).
- `GET /auth/session` → reads cookie, returns `{ user: {...}, csrfToken }` or 401.
- `POST /auth/signout` → clears cookie, 204.

### 5.2 DrizzleAdapter
Stays, relocated from `packages/web/src/auth.ts` to `packages/api/src/auth/index.ts`. Schema (`users`, `accounts`, `sessions`, `verificationTokens`) is unchanged; imports shift from web to api. We use JWT session strategy, so the `sessions` table is currently unused — keep it for future rotation (override trigger lives in handoff razor table).

### 5.3 Session transport
- JWT signed with `AUTH_SECRET` (shared between web build-time and API runtime — already shared today for the current Bearer path, so no new secret plumbing).
- Payload: `{ sub, email, role, csrf, iat, exp }`. `csrf` = 32-byte random, generated at sign-in, stable for session lifetime (razor default; override trigger documented).
- Cookie: `kuruma_session`, HttpOnly, Secure, `SameSite=Lax`, 7-day lifetime (matches today). Set by the API, surfaced to the browser through the Pages Functions proxy (§5.5) so it's same-origin.
- Web never reads the cookie directly. It calls `/auth/session` via React Query; response body includes `csrfToken` for client-side double-submit.

### 5.4 CSRF (#372)
- On every non-GET request to `/api/*` and `/auth/signout`, web sends `X-CSRF-Token: <token from useSession>`.
- API decodes the JWT from the cookie, compares `payload.csrf` to the header. Mismatch → 403.
- Apple callback is exempt (no session exists yet; the OAuth state param provides CSRF equivalence for that one round-trip).
- Bearer-token path stays for partner callers (identified by route prefix, e.g., `/api/partner/*`). Those don't need CSRF because they're not cookie-authenticated.

### 5.5 Same-origin via CF Pages Functions proxy
Safari ITP is hostile to cross-site cookies. Rather than ship `SameSite=None` and hope for the best during the weeks/months before the owner picks a domain (#373), the web app is same-origin with the API from day one via a CF Pages Function proxy:

- `packages/web/functions/api/[[path]].ts` — CF Pages Function that proxies `/api/*` to the API Worker (`API_ORIGIN` env var on Pages).
- `packages/web/functions/auth/[[path]].ts` — same for `/auth/*`.
- Browser sees one origin (the Pages hostname). Cookie is `SameSite=Lax; Secure`, no `Domain=` attribute. Safari-safe immediately.
- Partner/3rd-party callers hit the API Worker directly at its `*.workers.dev` hostname with Bearer tokens — no cookie involved.

Parent-domain cutover (#373) becomes a cosmetic hostname change only (DNS flip from `*.pages.dev` to `app.<owner-chosen>.app`). The proxy and cookie config are unchanged; it's still same-origin. Timing is still gated on the owner but no longer blocks Safari auth.

## 6. i18n (#377)

### 6.1 Library swap
`next-intl` → `use-intl`. Same hooks (`useTranslations`, `useFormatter`, `useLocale`), same ICU message format. All 79 call sites change imports only.

Provider at root route; locale sourced from `$locale` route param.

### 6.2 FOUC handling
Inline script in `index.html`, pre-hydration:
1. Read `NEXT_LOCALE` cookie (preserved name for back-compat).
2. If missing, parse `navigator.language` → `en|ja|zh` → else `en`.
3. Set `<html lang>`, `window.__LOCALE__`.
4. Kick off `fetch('/messages/' + locale + '.json')`.

React entry awaits that fetch before mounting. No flash. Cost: ~800 B inline + one extra blocking fetch (cached after first visit).

Non-active locales load lazily on switch via `useQuery(['messages', locale])`, cached forever.

### 6.3 Messages layout
`packages/web/messages/{en,ja,zh}.json` copied to `packages/web/public/messages/` at build time (Vite `publicDir`). Structure (635 lines × 3) is unchanged.

## 7. Build and deploy

### 7.1 Vite config (high level)
- `base: '/'`, `build.outDir: 'dist'`, React plugin, TanStack Router plugin.
- `publicDir: 'public'` copies `messages/*.json` and static assets.
- No SSR. No edge runtime. Just static output.

### 7.2 Prerender — explicit drop (reversal documented)
The original brainstorm floated "SPA with prerendered public routes" for SEO on `/`, `/vehicles`, `/vehicles/$id`. **This spec drops prerender for v1.** `_redirects: /* /index.html 200` means every route is served by the SPA shell; public routes rank on client-rendered content.
Reversal path if SEO becomes critical (razor table trigger row 2): add `vite-react-ssg` or a small CF Pages Function that server-renders the three public routes on first request and caches. Half-day of work. Owner-visible behavior today: link previews (Line/WeChat/Slack) will not show a useful OG image; Google will index the app but crawl budget is higher than SSR'd HTML.

### 7.3 CF Pages deploy
- New CF Pages project `kuruma-web-pages`, separate from the existing Worker.
- Build command: `bun run build` inside `packages/web`.
- Output directory: `packages/web/dist`.
- Client env vars: all `VITE_*` prefix, baked in at build time (no runtime env). `VITE_API_BASE_URL = '/api'` (same-origin via proxy — §5.5).
- Functions env vars: `API_ORIGIN` (the API Worker URL, read server-side by the proxy Functions).
- `_redirects` file for SPA fallback: `/* /index.html 200` (last — Functions match first).
- `_headers` file sets CSP, COOP, COEP; mirrors current middleware CSP where applicable.

### 7.4 CI changes
- `deploy.yml` — gate the existing web-Worker deploy step with `if: false` (the "bridge freeze"; umbrella issue #378). Keep the step so we can delete it at cutover without hunting.
- New step: `wrangler pages deploy packages/web/dist --project-name=kuruma-web-pages --branch=<preview|production>`. CF Pages creates a per-branch preview URL automatically.
- Rotate-secrets workflow untouched.
- `db-drift` job untouched.

### 7.5 Bridge: coexistence and cutover
During migration the two deploys coexist:
- **Old Next.js Worker** at its current `*.workers.dev` hostname — frozen at last green build (CI step gated off). Still serves production until cutover.
- **New Pages project** at `kuruma-web-pages.pages.dev` + per-branch preview URLs — receives every migration PR. Not user-facing during bridge.

There is no `VITE_USE_NEW_WEB` flag. The switch is a DNS/routing change at step 6 of §8:
1. The public hostname (currently CNAMEd to the old Worker) is repointed to the Pages project.
2. Old Worker is deleted from the CF dashboard.
3. Frozen CI step is deleted, Next.js app is deleted, deps pruned.

Before that cutover, internal testing and stakeholder review happen on the Pages preview URLs. QA sign-off per slice means "green on the Pages preview" — not "merged to main behind a flag."

## 8. Vertical slicing

Each slice is its own PR, its own sub-issue of #378. Slices merge to `main` and deploy to the Pages project's preview URL. The old Next.js Worker keeps serving production until the DNS flip in step 6 (see §7.5).

1. **Shell + public landing.** Vite + TanStack root route, `use-intl` provider, locale bootstrap, navbar/footer, `/`, `/vehicles`, `/vehicles/$id`. Proves build + CF Pages + i18n on staging.
2. **Auth slice.** Add `@auth/core` + relocate DrizzleAdapter config from `packages/web` to `packages/api`; build `/auth/*` endpoints on Hono; port `/login` page; implement `useSession` + CSRF token flow; `_auth`/`_renter`/`_business` layout guards. First real cookie exercise.
3. **Renter browse + book.** `/bookings/new`, `/bookings/confirmation`. Full renter journey from landing to confirmed booking.
4. **Business dashboard.** `/dashboard`, `/manage/*` (vehicles, bookings, customers, classes). Largest surface, but port-only.
5. **Renter account + messaging.** `/bookings`, `/messages/*`. Tail.
6. **Cutover.** DNS flip public hostname to Pages, delete old Worker, delete Next.js app + `auth.ts`/`auth.config.ts`/`middleware.ts`/`open-next.config.ts`/`app/**`, prune deps listed in §3, remove the frozen CI step, close #378.

## 9. Test strategy

- Unit tests — port unchanged where possible; route-level utilities get new tests for guards.
- Integration — API auth endpoints (`/auth/*`) get Hono `app.request(...)` tests including CSRF paths and Apple carve-out.
- E2E (Playwright) — existing flows retargeted at the CF Pages preview URL produced by the slice's PR (Pages auto-creates `<branch>.<project>.pages.dev`). Test config reads `E2E_BASE_URL` env var; CI sets it to the preview URL for migration PRs. Every slice must leave the e2e smoke green on its preview before the PR merges.
- Size check — CI step that fails if `packages/web/dist` exceeds a budget (start at 2 MiB gzipped, tighten later). Headroom under CF's free tier forever.

## 10. Risks + mitigations

| Risk | Mitigation |
|------|-----------|
| Safari ITP blocks cross-site cookie | Moot — Pages Functions proxy (§5.5) makes web and API same-origin from day one; cookie is `SameSite=Lax` |
| CF Pages Functions proxy adds a hop | One extra hop inside CF's own network — negligible latency. Measured in p95 before cutover; if >50ms added, reassess |
| `use-intl` has a subtle behavioral diff from `next-intl` | Snapshot every rendered locale string on a visited-routes sweep before cutover |
| TanStack `loader`/React Query interaction surprises | Start with shell slice (§8 step 1) to discover patterns before committing the whole app |
| Apple callback CSRF carve-out widens over time | Single carve-out, codified in middleware with a comment + test that exercises it |
| Long-lived migration branch drifts | Slices merge to `main` and deploy to Pages previews — no long-lived branch. Old Worker stays frozen at last green until cutover |
| Owner picks a domain that requires re-issuing cookies mid-session | Accept one forced re-login at cutover; announce in release notes |

## 11. Decisions captured elsewhere

See `docs/plans/2026-04-18-nextjs-migration-handoff.md` for the razor-default table (role guards, SEO, fetching pattern, CSRF rotation cadence, messages bundling, env vars, OAuth providers, cookie name). Rule at the top of that table: if a decision is in the table, take the default and move on.

## 12. Acceptance

- [ ] `packages/web/dist` builds < 2 MiB gzipped.
- [ ] All URLs in §4.2 reachable on staging, same shape as today.
- [ ] Google + Apple OAuth succeed end-to-end on staging.
- [ ] All 79 `use-intl` call sites render; JA date/currency identical to today.
- [ ] `_renter` and `_business` guards enforce correctly (E2E).
- [ ] CSRF double-submit enforced on every state-changing `/api/*` call; Apple callback exempt and tested.
- [ ] Old Next.js app deleted; web Worker deleted from CF dashboard.
- [ ] `deploy.yml` has no `@opennextjs/cloudflare`, no `wrangler deploy` for web.

## 13. Out of scope

- SSR / TanStack Start (§11 razor table, row 2 — override trigger documented).
- Session rotation beyond stable-per-session (§11 razor table, row 4).
- Line/WeChat OAuth (§11 razor table, row 7).
- Any non-port changes to components, business logic, or API contracts.

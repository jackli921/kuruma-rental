# #541 — Port platform admin portal (#462 shell) to Vite

**Status:** PLAN v2 — review applied (3 findings folded), awaiting re-approval (no code yet)
**Issue:** #541 · **Original shell:** #462 (Next.js impl #481 `4c15833`) · **Vite migration:** #378
**Branch/worktree:** `feat/541-admin-portal-vite` · `~/Dev/kuruma-541-admin-portal` (off `marketplace-pivot` @ `3c2161f`)
**Unblocks:** #515 (renter-doc verify UI lives in the admin shell) · **Closes #501** (Slice D re-enables the admin-portal e2e)

## Review applied (2026-06-11)
- **[P1] Global-nav suppression** — `$locale.tsx` always mounts `<Navbar/>`; suppression is CSS `:root:has([data-admin-sidebar])`. Verified. → Slice B emits `data-admin-sidebar`; Slice D proves no `[data-global-nav]`/`[data-mobile-menu]` bleed in a real browser.
- **[P1] #501 not actually unblocked** — `admin-portal.spec.ts` is `testIgnore`d and encodes Next.js wiring (`callbackUrl`, `data-business-nav`). Verified. → new **Slice D** ports + re-enables it.
- **[P2] UserMenu i18n** — pin the link label to existing `admin.home.title`, no new keys. → folded into Slice E.

## Why
The platform admin portal (platform-STAFF, per-partner revenue/commission) shipped on the **frozen Next.js tree** (`src/app/[locale]/(admin)/admin/*`). After the Vite + TanStack Router migration (#378) there is **no `admin/` route under `src/routes/$locale/`**, so the portal is **unreachable on the live CF Pages deploy**. This ports the shell (layout + sidebar + two placeholder pages) to Vite at the same URLs. It is the platform-level counterpart to epic #523 (operator/provider portal).

## Reuse (already exists — no new infrastructure)
- **`isPlatformAdmin(role)`** — `@/lib/platform-roles.ts`, pure + dependency-free (admits `PLATFORM_ADMIN` + legacy `STAFF`/`ADMIN`). Import directly into the Vite guard.
- **i18n** — `admin.*` keys already present in `messages/{en,ja,zh}.json` (`nav.overview`, `nav.revenue`, `home.title/subtitle`, `revenue.title/subtitle/comingSoon/model`). No new keys; verify parity only.
- **`@/components/ui/card`** — already imported by Vite views (`BookingConfirmationView`, `ClassDetailView`). Safe to reuse for the revenue placeholder.
- **Template** — `src/routes/$locale/_business.tsx` (pathless layout + `businessGuard` + `Outlet`) is the exact pattern to mirror.

## Route map (mirrors Next.js `(admin)/admin/*`, identical URLs)
| Vite file | URL | Role |
|---|---|---|
| `$locale/_admin.tsx` | (pathless layout) | `beforeLoad` → `adminGuard`; renders `AdminSidebar` + `<Outlet>` |
| `$locale/_admin/admin/index.tsx` | `/{locale}/admin` | Platform Admin home (title + subtitle) |
| `$locale/_admin/admin/revenue.tsx` | `/{locale}/admin/revenue` | Partner-revenue **placeholder** (Card) |

## Implementation — TDD vertical slices
**Slice A — `adminGuard` (pure, FC/IS).** RED: `guards.test.ts` — allow `PLATFORM_ADMIN`/`STAFF`/`ADMIN`; `forbidden` for `OPERATOR_*`/`RENTER`; `login` for `null`. GREEN: add `adminGuard()` to `src/vite/guards.ts` mirroring `businessGuard`, backed by `isPlatformAdmin`.

**Slice B — `AdminSidebar`.** RED: `tests/vite/nav/AdminSidebar.test.tsx` — (1) renders Overview→`/admin` and Partner Revenue→`/admin/revenue` links with `admin.nav.*` labels + `aria-current` active state; (2) **emits `data-admin-sidebar=""` on its root**. GREEN: port Next.js `components/nav/AdminSidebar.tsx` → `src/vite/nav/AdminSidebar.tsx` (TanStack `Link`, typed `params={{locale}}`, use-intl, reuse `@/lib/cn`). **The `data-admin-sidebar` marker is load-bearing** [P1 review]: `globals.css:232` hides `[data-global-nav]`/`[data-mobile-menu]` only via `:root:has([data-admin-sidebar])`; without it the always-mounted `<Navbar/>` (`$locale.tsx`) double-renders on `/admin`. (Confirm `globals.css` is imported by the Vite entry.)

**Slice C — routes + views.** Add `_admin.tsx` (guard + sidebar + Outlet), `_admin/admin/index.tsx`, `_admin/admin/revenue.tsx`. View components under `src/vite/admin/` (`AdminHomeView`, `RevenuePlaceholderView`). `vite build` to regen `routeTree.gen.ts` (**staged**). RED: route-component tests assert home title + revenue `comingSoon`/`model` render. (Nav-suppression is a CSS `:has()` rule — jsdom can't evaluate it, so it is proven in Slice D, not vitest.)

**Slice D — re-enable + port admin E2E (closes #501) [P1 review].** Remove `**/admin-portal.spec.ts` from `playwright.config.ts` `testIgnore`; port `e2e/admin-portal.spec.ts` off its Next.js-isms: (a) unauth redirect `…/login?callbackUrl=` → **`?returnTo=`** (Vite guard param); (b) global-nav assertions `[data-business-nav]` → **`[data-global-nav]`** (the Vite Navbar marker). Keep all 6 cases — unauth redirect, RENTER + OPERATOR_OWNER forbidden→home, PLATFORM_ADMIN sidebar+revenue, renter-view no-leak, mobile `[data-mobile-menu]` hidden. Auth via the existing `mint-mock-session`; verify the minted role resolves through the mock `/auth/session` while wiring. **This is the only real-browser proof that the admin shell stays isolated from the always-mounted Navbar.**

## Open decision — how admins reach `/admin`
After Slice C the routes are URL-reachable but **nothing links to them**. Options:
- **(Recommended) Slice E — `UserMenu` link.** Add a "Platform Admin" entry in `src/vite/nav/UserMenu.tsx` gated on `isPlatformAdmin(session.user.role)`. **Label = `t('admin.home.title')` ("Platform Admin") — reuses the existing key, no new i18n** [P2 review], keeping i18n-parity clean. Discoverable in-app; touches shared nav — low collision, one conditional item + 1-2 tests.
- **URL-only + follow-up.** Ship A–D; leave `/admin` reachable by direct URL; file a follow-up for the nav entry. Smallest change.

## Out of scope (explicit)
- Real revenue aggregation + `GET /admin/revenue` API — gated on #461 (`payment_events` not in `schema.ts`). Revenue tab stays a placeholder (#462 acceptance gate).
- Deleting/altering the frozen Next.js admin (stays frozen until cutover).
- Legacy `STAFF`/`ADMIN` revocation (#487).
- Renter-document verify UI (#515) — separate issue, builds *on* this shell.

## Gotchas respected
- Adding route files requires `vite build` to regen `routeTree.gen.ts` **before** typecheck; stage the gen file.
- Biome import-sort is an assist — needs `bunx biome check --write`, not `format`.
- Typecheck **both** default and frozen tsconfig; Vite shell imports only pure `@/lib` helpers + `@/components/ui/*` (no `@/modules/*` — `lint:modules`).

## Gates (per slice + final)
`bun run --filter @kuruma/web test` · typecheck (default + frozen) · `bun run lint` · `vite build` · `lint:dist-size` · **`bun run test:e2e`** (admin-portal spec re-enabled in Slice D — chromium).

## Verification & ship
`/verify` after Slice C · `/code-review` + `architect-review` · PR `Closes #541, Closes #501` → `marketplace-pivot` · close issues.

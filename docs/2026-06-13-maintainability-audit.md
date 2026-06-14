# Maintainability Audit — kuruma-rental @ `marketplace-pivot` (87f5b327)

**Date:** 2026-06-13 · **Method:** 5 parallel specialist agents (architecture, dead-code, code-quality, type/schema, test-health) over a clean read-only worktree at the real integration branch. Every finding below is grounded in a verified `file:line`; the source tree audited was **mp** (149 commits ahead of `main`), not the stale local checkout.

> **Status update — 2026-06-14.** Two of the three debt themes are now resolved. **Theme 1 (two-headed `web/`) is fully removed:** the frozen Next.js tree (`app/`, `modules/`, `hooks/`, `actions/`, non-`ui/` components), the `next`/`next-intl`/`next-auth`/`@opennextjs` deps, and the 51 frozen test files are gone (#698 tests · #714 runtime+deps · epic #689 verified); only `components/ui/*` remains, as recommended. **Theme 3's `schema.ts` god-file split shipped** (#813, issue #725) — `schema.ts` is now a 25-line `export *` barrel over per-domain `db/<context>.ts` modules and the 800-line cap is restored. Findings below are annotated **✓ DONE** where superseded; the enum-SSoT (partly #688) and role-sets work remain open.

---

## Executive summary

**This is an unusually disciplined codebase.** The hexagonal API (routes → services → repositories, DI by construction) holds; `shared` has zero deps on api/web; `any` is effectively zero; validators are a single Zod source; the test suite runs real-Postgres integration on every critical flow with strong assertions and no module-mocking. Two going-in worries were *disproven*: the live Vite SPA **is** well-tested (just not co-located), and the role-enum "PARTNER mismatch" is **intentional** (persistence vs authz bounded contexts).

The maintainability debt is **concentrated in three themes**, not spread thin:

1. **A two-headed `web/` package** — a live Vite SPA forked from a frozen Next.js app, leaving **~20,000 LOC of removable dead/duplicate code**. This is the single largest drain. **✓ DONE — removed (#698/#714/#689); only `components/ui/*` kept.**
2. **Single-source-of-truth drift in closed sets** — roles and DB enums are hand-copied into 3–10 places with only comments linking them. The highest-leverage *correctness-at-scale* hazard.
3. **A few god-files near the size cap** — `schema.ts` (823, over cap — **split shipped #813**), `booking.ts` (796), `index.ts` (776), `repositories/types.ts` (774) — each with a clear, low-risk split seam.

Everything else is housekeeping.

## Health scorecard

| Dimension | Grade | Headline |
|---|---|---|
| API architecture & boundaries | **A−** | Layering disciplined; debt is 5 routes bypassing services + a lint weaker than the doc. |
| Web architecture | **C → resolved** | ~~Live Vite vs frozen Next fork; ~20k LOC dead~~ — frozen tree removed (#698/#714); now a single Vite tree. |
| Code quality | **B** | Role/enum duplication is the wart; error handling has two coexisting channels; 48 unvalidated path params. |
| Type system & schema | **A−** | `any`≈0, assertions justified; debt = enum→union hand-mirroring + `schema.ts` over cap (**split shipped #813**). |
| Test health | **A** | Real-pg integration on every critical flow, 30:1 strong:weak, zero skips/mocks. Only dead-test housekeeping. |
| Docs accuracy | **C** | `docs/architecture/modules.md` describes an architecture that doesn't exist; `lint:modules` referenced, not wired in api. |

---

## Theme 1 — The two-headed `web/` package (~20k LOC dead)

`packages/web` completed a Next-Pages → Vite/TanStack-Router SPA migration (#378). **Vite is canonical** (`build` = `vite build`, deploy ships `dist`; CI builds only Vite). The entire Next tree (`app/`, plus its supporting `components/<feature>/`, `modules/`, ~half of `lib/`, `hooks/`, `actions/`, `auth*.ts`, `middleware.ts`) is **frozen-legacy** — typecheck-partitioned away by `tsconfig.app.json` vs `tsconfig.json`, deployed by nothing.

- **~13,400 LOC dead source** across ~190 files + **~6,573 LOC** of tests (51 files) exercising only the frozen tree. Combined removable surface **~20,000 LOC**.
- **Diverged duplicate pairs** (fixes land only in the Vite copy — latent-bug risk): `components/vehicles/VehicleForm` (471, stale) vs `vite/operator-fleet/VehicleForm` (389, current); same for `FleetFilters`, `VehicleList`, `StorefrontCard`/`StorefrontSearchForm` (class-filter #658 added Vite-only), `nav/*`.
- **A second, dead vehicle API client**: `lib/vehicle-api.ts` (228, Bearer-token hono-client) is dead; live tree uses `vite/operator-fleet/api.ts` (cookie fetch). Move the one shared `VehicleData` type out, delete the rest.

**Safe removal sequence** (grandfather policy: deleting an unreachable tree is removal, not modification):
1. **PR1 — legacy tests** (`tests/{components,modules,app,hooks}`, 51 files / 6,573 LOC). Zero live-coverage loss (`tests/vite/**` already re-covers migrated screens). Do first so later src deletes don't red the suite.
2. **PR2 — leaf legacy UI/logic** (`src/modules/**`, `src/components/**` non-`ui/`, dead `lib/*.ts`, `hooks/**`). **Keep** `components/ui/*` + the ~24 still-shared `lib/*` leaves (`fleet-filters`, `fleet-grouping`, `datetime`, `format`, `business-roles`, `platform-roles`, `api-error`, `rbc-localizer`). Verify with `grep -rl "@/modules" src/vite src/routes` (empty).
3. **PR3 — Next runtime + deps** (`src/app/**` except `globals.css`, `auth*.ts`, `middleware.ts`, `next-intl`/`next-auth`/`next`/`@opennextjs/cloudflare`, the `build:next`/`build:worker` scripts). **GATED on the DNS cutover** — `deploy.yml` says the frozen Next Worker still serves prod until the flip. Do NOT do PR3 before cutover.

**Also:** formalize the seam now — add a "no new files under `app/`" lint and a banner marking the Next dirs legacy, so the fork stops growing before it can be deleted.

## Theme 2 — Single-source-of-truth drift (roles & enums)

The same closed set is materialized in many hand-maintained copies with no compile-time link. Two halves:

### Roles (partly in-flight on `refactor/role-sets-single-source` — coordinate, don't collide)
- `roleEnum` (schema, 6 members) vs `UserRole` union (auth.ts, 7 incl. API-key-only `PARTNER`) — the PARTNER gap is **intentional** (persistence ≠ authz). Not a bug.
- `SCOPE_BYPASS_ROLES` (`auth.ts:62`) **≡** `PRIVILEGED_ROLES` (`auth.ts:129`) — byte-identical, defined twice. Best impact/effort fix in the audit (delete one).
- Web `business-roles.ts` / `platform-roles.ts` are `Set<string>` hand-mirrored from the API "via a comment only" — if they drift, web lets an operator into a page the API then 403s. Fix: export members from dep-free `@kuruma/shared`, both sides build their Set from it. Web `Session.user.role: string` (`session.ts:13`) is the only role surface with **zero** type safety.

### Enums (UNCLAIMED — the highest-leverage structural win available now)
- `bookingStatus` is hand-copied into **10+ places** (api `stores.ts`, shared validator, and 7 web files). Adding a status means editing 10+ literals; the schema test only checks the pgEnum, so stale copies compile green.
- `stores.ts` derives 4 enum fields correctly but hand-writes ~12 siblings inconsistently — a reader can't tell which are safe.
- Zod enums (`validators/*.ts`) hand-duplicate pgEnum values instead of `z.enum(<enum>.enumValues)`.
- **Fix pattern already proven in-repo:** `LUGGAGE_SIZES` (one `as const` → pgEnum + Zod + TS type). Derive `BookingStatus` etc. from `(typeof bookingStatusEnum.enumValues)[number]`, expose via a no-DB shared subpath so web can import, replace every literal. Mechanical, M effort, kills the whole class.

## Theme 3 — God-files near the cap (clear seams, low risk)

- **✓ DONE (split shipped #813, issue #725 — `schema.ts` is now a barrel over per-domain `db/<context>.ts` modules; 800 cap restored).** ~~`schema.ts` (823, over the 800 cap; #458 raised to 1000 as stopgap → #518).~~ The per-domain split design was **executable** (see appendix): the lazy-thunk circular-FK + `export *` barrel pattern is already proven by 4 extracted modules (`renter-documents`, `add-on`, `booking-types`, `provider-access`); `db:verify` guarantees migration safety because emitted SQL is byte-identical. **Gated on schema-PR swarm timing** (region #671/#675, etc.) — execute when the file quiets so it goes through last.
- **`BookingService` (796) — genuine god-service.** Split along the visible seam: 4 read-enrichment methods → `BookingQueryService`; keep create/substitute/transition. Lift the 190-line `submitInTx` pricing pipeline's pure steps (`priceInsurance`/`priceAddOns`/`resolveEffectiveEnd`) into a functional core so price math is unit-testable without repos (FC/IS).
- **`index.ts` (776) — wiring blob.** Extract the three near-identical repo-construction branches into `composition/repositories.ts` (`buildDrizzleRepos`/`buildInMemoryRepos`/`buildOverrideRepos` → one `Repos` bundle). Kills the hand-lockstep that is the real source of "added to Drizzle, forgot in-memory" runtime bugs. Keep the `.route()` chain inline (`hc<AppType>` needs it). **Bonus:** the same bundle lets the e2e real-db harness reuse prod wiring instead of re-listing 20+ repos (already caused bug #635).
- **`repositories/types.ts` (774) — interface dump.** Navigation/cache cost, not SRP. Split per-domain opportunistically alongside the schema split.

---

## Prioritized backlog

### Quick wins — S effort, low collision, ship now
| # | Item | Effort | Notes |
|---|---|---|---|
| Q1 | Reconcile `docs/architecture/modules.md` with reality (or banner it superseded) + wire/remove the phantom `lint:modules` ref | S | Docs-only, zero collision. Stops actively misleading every contributor. |
| Q2 | Delete duplicate `SCOPE_BYPASS_ROLES` ≡ `PRIVILEGED_ROLES` | S | **Coordinate with `role-sets` branch** — likely in its scope; don't double-build. |
| Q3 | Hoist `booking.ts` repeated error strings to named consts (match `add-on.ts`) + name the `500` truncation magic number | S | Pure cleanup. |
| Q4 | Tighten geocoder weak assertions (`location.test.ts` 9× `toHaveBeenCalled()` → `toHaveBeenCalledWith`) + `toBeTruthy` id/token/timestamp asserts in auth-google/booking tests | S | The one critical flow (geocoding) with weak spots. |

### Structural — sequence & gating matter
| # | Item | Effort | Gating |
|---|---|---|---|
| S1 | **Enum SSoT sweep** — derive `BookingStatus` etc. from `enumValues`, `z.enum(enum.enumValues)`, fix `stores.ts` unions, replace 10+ literals | M | **Unclaimed, highest-leverage.** Touches api+web+zod — land before the schema split. |
| S2 | `parseId` helper → validate the 48 unvalidated path params (latent 500s → clean 400s) | M | API-only, mechanical. |
| S3 | ~~Web dead-code removal PR1/PR2/PR3~~ **✓ DONE** | M | All shipped (#698 tests · #714 runtime+deps+leaves); only `components/ui/*` kept. |
| S4 | `index.ts` → `composition/repositories.ts` repo bundle (+ reuse in e2e harness, closes #634/#635 class) | M | API-only; low collision. |
| S5 | ~~`schema.ts` #518 per-domain split~~ **✓ DONE (#813/#725)** | M | Shipped — `schema.ts` is now a barrel over `db/<context>.ts`. |
| S6 | `BookingService` reads/writes split + extract pure pricing core | L | Best correctness payoff; after S1. |
| S7 | Route→service lint gap: extract `MessageService`/`UserDirectoryService`, make lint match the doc (or sanction thin reads as documented exceptions) | M | Closes documented-vs-enforced divergence. |
| S8 | Web role-sets → import members from `@kuruma/shared`; type `Session.user.role` | M | **Coordinate with `role-sets` branch.** |
| S9 | drizzle repos → `$inferSelect` rows (the "wide-string" comment is stale for drizzle 0.45.2) | M-L | Fold into S5 per-domain. |

### Don't touch / already healthy
- Test suite (DI-driven, real-pg, strong assertions) — only the housekeeping in Q4/S3.
- Dual InMemory+Drizzle repos, lazy-thunk FKs, Auth.js-in-web DB access — all documented & intentional.
- `refactor/role-sets-single-source` is **in flight** (foreign worktree) — it owns the role half of Theme 2 and #487. Don't collide; the *enum* half (S1) is the independent, unclaimed win.

---

## Appendix A — `schema.ts` #518 split layout (executable)

Keep `schema.ts` as **barrel + hub** (`roleEnum`, `operators`, `users`, `accounts` + `export *` re-exports — the import target for every child's `() => users.id` thunk). Pull leaves into siblings using the proven thunk + re-export pattern:

`db/vehicles.ts` (transmission/luggage/class/vehicle enums + `vehicleClasses` + `vehicles`) · `db/locations.ts` · `db/bookings.ts` (status/source/fulfillment/event enums + `bookings` + `bookingEvents` + `VALID_BOOKING_TRANSITIONS` + status type exports — the ~200-line cluster) · `db/payments.ts` · `db/fees.ts` · `db/insurance.ts` · `db/notifications.ts` · `db/messaging.ts` · `db/maintenance.ts` (or fold into vehicles).

Rule to add to `lint:modules`: children import from `./schema` (hub) only, never sibling-to-sibling for values; cross-domain FKs use lazy thunks. After: `bun run db:verify` must stay green (SQL is byte-identical). Risk = a missed `export *` (caught instantly by `tsc` + `db:verify`).

## Appendix B — provenance
Agents: architecture (`architect`), dead-code (`refactor-cleaner`), code-quality (`code-reviewer`), type/schema + test-health (`general-purpose`). All read-only against `/Users/jack/Dev/kuruma-audit` (detached @ 87f5b327). No files modified; sibling worktrees untouched.

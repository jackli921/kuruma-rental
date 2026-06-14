@AGENTS.md

# Project Overview

Airbnb-style car rental platform for a Japan-based company (Osaka) serving international tourists. Single-tenant, 40-50 vehicles, 200+ users scaling to 2000+.

## Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Booking flow | Instant-book (no approval) | Owner accepts by default; verification at pickup |
| Scheduling | Hourly granularity (`timestamptz`) | Owner needs flexible scheduling for 40-50 cars |
| Conflict prevention | Postgres exclusion constraint | DB-level double-booking prevention, no app race conditions |
| API architecture | Hono on CF Workers | Source-agnostic API for web + 3rd-party (Trip.com) callers |
| Auth | Auth.js v5 (JWT strategy) | Google + Apple OAuth, role in JWT token |
| Cancellation | Tiered: 72h free / 48h 30% / 24h 70% / same-day 100% | From owner |

## Architecture Boundaries (CRITICAL)

- `packages/web` has **NO direct DB access**. All data flows through the Hono API.
- `packages/api` has **NO UI rendering**. Pure REST API.
- `packages/shared` has **NO runtime deps** on api or web.
- OAuth sign-in and session-JWT minting live in `packages/api` (`auth/jwt.ts`); the Vite web holds no Auth.js runtime and reads identity over HTTP (`GET /auth/session`).
- 3rd-party callers (Trip.com) hit the same API routes as the web frontend.

## Key Documents

| File | What |
|------|------|
| `docs/plans/2026-05-25-marketplace-mvp-proposal.md` | **Source of truth.** Marketplace MVP plan (multi-tenant), 8-slice execution. Epic #385. |
| `docs/plans/2026-04-07-architecture-redesign.md` | Architecture decisions (instant-book, hourly, monorepo) — still holds post-pivot |
| `packages/web/DESIGN.md` | Web design system (colors, typography, spacing, components) |
| `docs/plans/2026-04-09-cloudflare-deployment-lessons.md` | CF Workers deployment post-mortem (10 lessons, correct patterns) |
| `docs/2026-04-02-kuruma-mvp-design.md` | _Superseded 2026-05-24_ — pre-pivot single-tenant spec; kept for history |
| `docs/plans/2026-04-07-schema-api-design.md` | _Superseded 2026-05-24_ — pre-pivot schema; marketplace schema lives in proposal §5 |

---

# Gotchas & Lessons Learned

> **Rule: Self-document gotchas.** When you hit a surprise, add it here immediately.

## Web shell: Vite + TanStack Router + shadcn (base-ui)

> The web is a **Vite SPA** (`packages/web/src/vite/`, build = `vite build` → `dist`). The frozen Next.js tree was deleted in #714 — there is no `src/app/`, `middleware.ts`, `next.config.ts`, or `open-next.config.ts`. The `lint:no-next-app` guard (`scripts/lint-no-next-app.ts`) blocks reintroducing one.

- **No `asChild` on base-ui shadcn primitives.** Use `buttonVariants()` on TanStack Router's `<Link>`, or the `render` prop on triggers.
- **`noUncheckedIndexedAccess` is on.** `segments[1]` returns `T | undefined`.
- **Active links:** `aria-current="page"` + Tailwind `aria-[current=page]:*` variants (still the a11y-correct pattern; no SSR hydration to trip over now).

## Biome Linter

- Biome auto-sorts imports and reformats. Re-read files after biome runs or Edit tool will fail on stale `old_string`.
- Biome may remove unused imports aggressively.

## Auth & session JWTs

- **The API owns sessions.** OAuth sign-in (Google/Apple, `@auth/drizzle-adapter` tables) runs server-side in `packages/api`, which then mints a custom **`jose` JWT** (`api/src/auth/jwt.ts`) carried in the `kuruma_session` cookie. The Vite web has no Auth.js runtime — it reads identity via **`GET /auth/session`** (`vite/session.ts`, TanStack Query). The old NextAuth JWT-callback / edge `auth.config.ts` split is gone (#378/#714).
- **`verifyJwt` asserts issuer + audience** so a token minted for any other purpose can't be replayed as an API caller. The role rides in the token; `Session.user.role` on web is still an untyped `string` (maintainability-audit Theme 2).

## Cloudflare Workers Deployment

> Full post-mortem: `docs/plans/2026-04-09-cloudflare-deployment-lessons.md`

Critical rules:
1. **Lazy singleton for DB.** Never call `getDb()` at module scope.
2. Secrets set via `npx wrangler secret put` — CF dashboard wipes them on redeploy.
3. **Shared secrets (AUTH_SECRET, DATABASE_URL) must match between API and Web workers.** GitHub Secrets is the source of truth. `deploy.yml` no longer re-asserts secrets every deploy — wrangler 4's gradual deployments refuse `secret put` when a pending version exists (cloudflare/workers-sdk#6763) and the old pattern locked up deploys. Instead: `deploy.yml` runs a read-only `wrangler secret list` presence check; `rotate-secrets.yml` (workflow_dispatch) re-asserts values. Rotate after changing a GitHub Secret, whenever the presence check fails, or if "Unauthorized" starts appearing silently.
4. **`getDb()` (neon-http) CANNOT run interactive transactions** — `db.transaction(cb)` throws `"No transactions support in neon-http driver"` at runtime (tsc does NOT catch it → it 500s in prod). The HTTP driver is stateless fetch-per-query, safe to reuse across requests. For interactive transactions use **`runTx(fn)`** from `@kuruma/shared/db` (#493): it opens a short-lived **neon-serverless (WebSocket) Pool** per call, runs the tx, closes it — the only Workers-safe lifecycle (a WebSocket Pool can't cross requests: "Cannot perform I/O on behalf of a different request"). Repos take the runner via constructor injection; the composition root wires `runTx`. **`DATABASE_URL` must be the Neon POOLED endpoint** (`-pooler` host) — per-call connections against a direct endpoint exhaust Postgres backends under load.

## i18n (use-intl v4)

> The Vite shell uses **use-intl** with TanStack Router: a `$locale` route param (en/ja/zh, default en — see `vite/i18n/locale.ts`), an `IntlProvider`, and `messages/` served by Vite. There is no next-intl and no `@/i18n/routing`.

- **Navigate with TanStack Router's `<Link>`** carrying the `$locale` param — never `next/link` or `@/i18n/routing`.
- **Adding a message file may need a Vite dev restart** to be picked up.
- **Verify all i18n keys exist after merges.** Conflict resolution silently drops keys.

## Stripe payments (#461)

- **Webhook is the source of truth.** A `payment_events` row is written ONLY on the verified, signed `checkout.session.completed` webhook — never the client redirect. "Don't trust the client for money."
- **CF Workers Stripe rules** (both mandatory, or it throws at runtime): construct with `Stripe(key, { httpClient: Stripe.createFetchHttpClient() })`, and verify webhooks with `webhooks.constructEventAsync` (SubtleCrypto), NOT the sync `constructEvent`. Stripe SDK confined to `services/payment/stripe-payment-gateway.ts`.
- **Webhook raw body**: read `await c.req.text()` (NOT parsed JSON) — the signature is over the exact bytes. `/webhooks/stripe` is public (no `requireAuth`); the global CSRF guard no-ops on the cookie-less call.
- **JPY is zero-decimal**: Stripe `unit_amount` / `amount_total` are whole yen (no ×100).
- **Three unique seals** on `payment_events`: `stripeEventId` (redelivery), `stripeCheckoutSessionId`, and a PARTIAL `payment_events_one_success_per_booking` (`WHERE status='SUCCEEDED'`). The webhook tells them apart by constraint name (`pg-errors.ts`): event/session = idempotent no-op, one-success = double-pay anomaly.
- **Secrets**: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (test mode for the demo). Wired in `rotate-secrets.yml`; absent ⇒ a throwing sentinel gateway. NOT yet in `deploy.yml`'s presence check (would break deploys before Stripe is set up) — add there once live.

## Monorepo

- shadcn: `bunx shadcn@latest add <component> -c packages/web`
- **`.env` lives at repo root — no `packages/web/.env`.** The API loads root `.env` directly. The Vite web reads only `VITE_*` vars from the shell, each with a safe fallback (`VITE_DEV_API_PROXY`/`VITE_API_BASE_URL` → the `/api` proxy to `localhost:8787`), so it needs no env file. The old `packages/web/.env` symlink was a legacy-Next requirement and is gone.
- Order: `db:generate` -> `db:migrate` -> `db:seed`.
- Worktrees: always `bun install` + `bun run db:migrate` + verify `tsc --noEmit` in a fresh worktree. Each worktree's DB must match *its own* migrations — `bun run dev[:api]` runs a `predev` drift check (`db:drift-warn`) that loudly warns when the DB is behind, so a stale worktree can't silently 500 a page (#740).

## Database Migrations (drizzle)

> Two production-like incidents (issue #27). Follow exactly.

**Workflow when changing the schema** (tables live in `db/<context>.ts` modules; `schema.ts` is just the `export *` barrel since #725)**:**
```bash
bun run db:generate --name <describe_change>
bun run db:migrate
bun run db:verify   # must show 3 green checks
```

**Hand-written migrations:** use `bun run db:generate --custom --name <name>`, never drop raw `.sql` into `drizzle/`.

**`bun run db:verify`** checks: schema-snapshot sync, journal-disk sync, journal-DB sync. CI enforces via `db-drift` job. Run before any commit touching `schema.ts` or `drizzle/`.

**Gotcha — drizzle-kit migrate silently skips out-of-order timestamps (2026-04-17 incident).** Cherry-picking or rebasing a migration can leave its `when` field in `drizzle/meta/_journal.json` older than the preceding migration. `drizzle-kit migrate` treats migrations whose `when` is older than the last-applied as already-applied and skips them — while still printing "migrations applied successfully". The resulting column drift crashed the booking API (`column "phone" does not exist`) and blocked production Deploy for ~15 min. Mitigations:
- **Never trust the `migrate` success line alone** — `db:verify` (journal-count vs applied-count) is the real signal. CI already fails on this via the `db-drift` job.
- **If you rebase/cherry-pick a migration, bump its `when` in `_journal.json` to `max(previous_when) + 1`** before committing, or regenerate it. Don't merge until `db:verify` passes locally against a DB in the same state as prod.
- **Recovery:** apply the skipped SQL manually (`ALTER TABLE … IF NOT EXISTS`), then insert a matching row into `drizzle.__drizzle_migrations` with the file's SHA256 hash and a post-predecessor timestamp.

---

# Architecture Rules

Canonical rules: `docs/architecture/modules.md`.

- **`packages/api`** is layered MVC + DI: `routes/` → `services/` → `repositories/`, wired in `index.ts`. Import direction never goes backwards. Details in AGENTS.md ("API Layer Architecture").
- **`packages/web`** organizes UI by feature under `src/modules/<feature>/`; import only from the `@/modules/<feature>` barrel.

**Grandfather policy (web):** before non-trivial changes to code in `lib/` or `components/<feature>/`, land a migration PR first.

Enforcement: `bun run --filter @kuruma/api lint:boundaries` (api layers), `bun run lint:modules` (web barrels), `bun run lint:size` (file size), `.husky/pre-commit`.

---

# Session Protocol

- **On start:** `gh issue list`, claim with `in-progress` label.
- **On end:** remove label, close completed issues, create follow-ups, clean up worktrees.
- **Worktree naming:** `../kuruma-<slug>` with branch `<type>/<slug>`.
- **Always rebase onto `origin/main` before pushing.** Never force push.
- **Stay in scope.** Don't fix unrelated things in another slice's PR.

## Danger zones

- `drizzle/` — append-only, never edit merged migrations.
- `packages/shared/src/db/` schema — tables live in bounded-context `db/<context>.ts` modules (`schema.ts` is the `export *` barrel since #725); always generate + migrate + verify.
- `packages/shared/src/validators/` — changes affect both api and web.
- Another session's branch — never touch it.
- Production secrets — never hardcode or log.

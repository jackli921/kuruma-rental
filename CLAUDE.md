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
- Auth.js lives in `web`. API verifies JWTs independently.
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

## Next.js 16 + shadcn (base-ui)

- **No `asChild` prop.** Use `buttonVariants()` on `<Link>`, or `render` prop on triggers. See code examples in `packages/web/src/components/`.
- **Use `middleware.ts`, NOT `proxy.ts`.** `proxy.ts` forces Node.js runtime; `@opennextjs/cloudflare` is Edge only. The deprecation warning is cosmetic.
- **Middleware must use `auth.config.ts`** (edge-safe, no DB). NOT `auth.ts` (imports Drizzle/postgres-js, breaks Edge).
- **`noUncheckedIndexedAccess` is on.** `segments[1]` returns `T | undefined`.
- **Hydration trap with active-link classNames (issue #25).** Use `aria-current="page"` + Tailwind `aria-[current=page]:*` variants. See `BusinessSidebar.tsx` for pattern.

## Biome Linter

- Biome auto-sorts imports and reformats. Re-read files after biome runs or Edit tool will fail on stale `old_string`.
- Biome may remove unused imports aggressively.

## Auth.js v5

- **JWT callback `user` is only present on first sign-in.** Re-fetch role from DB in the `else` branch.
- **Split auth config:** `auth.config.ts` must mirror callbacks from `auth.ts`. Middleware uses the edge config; any field it needs must have callbacks in BOTH.

## Cloudflare Workers Deployment

> Full post-mortem: `docs/plans/2026-04-09-cloudflare-deployment-lessons.md`

Critical rules:
1. **Lazy singleton for DB + auth.** Never call `getDb()` or `NextAuth()` at module scope.
2. **Guard `session?.user` everywhere.** On CF Workers, `auth()` can return session where `user` is undefined.
3. **`open-next.config.ts` must exist** or the CLI hangs.
4. **`typescript.ignoreBuildErrors: true`** in `next.config.ts` (tsc runs locally/CI, not during `next build`).
5. Secrets set via `npx wrangler secret put` — CF dashboard wipes them on redeploy.
6. **Shared secrets (AUTH_SECRET, DATABASE_URL) must match between API and Web workers.** GitHub Secrets is the source of truth. `deploy.yml` no longer re-asserts secrets every deploy — wrangler 4's gradual deployments refuse `secret put` when a pending version exists (cloudflare/workers-sdk#6763) and the old pattern locked up deploys. Instead: `deploy.yml` runs a read-only `wrangler secret list` presence check; `rotate-secrets.yml` (workflow_dispatch) re-asserts values. Rotate after changing a GitHub Secret, whenever the presence check fails, or if "Unauthorized" starts appearing silently.
7. **`getDb()` (neon-http) CANNOT run interactive transactions** — `db.transaction(cb)` throws `"No transactions support in neon-http driver"` at runtime (tsc does NOT catch it → it 500s in prod). The HTTP driver is stateless fetch-per-query, safe to reuse across requests. For interactive transactions use **`runTx(fn)`** from `@kuruma/shared/db` (#493): it opens a short-lived **neon-serverless (WebSocket) Pool** per call, runs the tx, closes it — the only Workers-safe lifecycle (a WebSocket Pool can't cross requests: "Cannot perform I/O on behalf of a different request"). Repos take the runner via constructor injection; the composition root wires `runTx`. **`DATABASE_URL` must be the Neon POOLED endpoint** (`-pooler` host) — per-call connections against a direct endpoint exhaust Postgres backends under load.

## i18n (next-intl v4)

- Import navigation helpers from `@/i18n/routing`, not `next/link`.
- Business routes use `/manage/` prefix. `/dashboard` has no prefix.
- **New i18n namespaces require dev server restart** (`rm -rf packages/web/.next && bun run dev`).
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
- **`.env` lives at repo root; symlinked to `packages/web/.env`.**
- Order: `db:generate` -> `db:migrate` -> `db:seed`.
- Worktrees: always `bun install` + verify `tsc --noEmit` in a fresh worktree.

## Database Migrations (drizzle)

> Two production-like incidents (issue #27). Follow exactly.

**Workflow when changing `schema.ts`:**
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

# Architecture Rules (Feature Modules)

Feature code lives under `src/modules/<feature>/`. Canonical rules: `docs/architecture/modules.md`.

**Grandfather policy:** before non-trivial changes to code in `lib/` or `components/<feature>/`, land a migration PR first.

Enforcement: `bun run lint:size`, `bun run lint:modules`, `.husky/pre-commit`.

---

# Session Protocol

- **On start:** `gh issue list`, claim with `in-progress` label.
- **On end:** remove label, close completed issues, create follow-ups, clean up worktrees.
- **Worktree naming:** `../kuruma-<slug>` with branch `<type>/<slug>`.
- **Always rebase onto `origin/main` before pushing.** Never force push.
- **Stay in scope.** Don't fix unrelated things in another slice's PR.

## Danger zones

- `drizzle/` — append-only, never edit merged migrations.
- `packages/shared/src/db/schema.ts` — always generate + migrate + verify.
- `packages/shared/src/validators/` — changes affect both api and web.
- Another session's branch — never touch it.
- Production secrets — never hardcode or log.

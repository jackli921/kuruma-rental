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
| `docs/2026-04-02-kuruma-mvp-design.md` | Full MVP spec (data model, user flows, scheduling) |
| `docs/plans/2026-04-07-architecture-redesign.md` | Architecture decisions, current state, execution order |
| `docs/plans/2026-04-07-schema-api-design.md` | Schema + API contract (architect-reviewed) |
| `packages/web/DESIGN.md` | Web design system (colors, typography, spacing, components) |
| `docs/plans/2026-04-09-cloudflare-deployment-lessons.md` | CF Workers deployment post-mortem (10 lessons, correct patterns) |

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
6. **Shared secrets (AUTH_SECRET) must be set on BOTH workers.** `deploy.yml` is the single source of truth — never set secrets manually via `wrangler secret put` in production. If they drift, JWT verification fails silently ("Unauthorized").

## i18n (next-intl v4)

- Import navigation helpers from `@/i18n/routing`, not `next/link`.
- Business routes use `/manage/` prefix. `/dashboard` has no prefix.
- **New i18n namespaces require dev server restart** (`rm -rf packages/web/.next && bun run dev`).
- **Verify all i18n keys exist after merges.** Conflict resolution silently drops keys.

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

**`bun run db:verify`** checks: schema-snapshot sync, monotonic journal `when`, journal-disk sync, journal-DB sync. CI enforces via `db-drift` job. Run before any commit touching `schema.ts` or `drizzle/`.

**Gotcha — drizzle-kit migrate silently skips out-of-order timestamps (2026-04-17 incident).** Cherry-picking or rebasing a migration can leave its `when` field in `drizzle/meta/_journal.json` older than the preceding migration. `drizzle-kit migrate` treats migrations whose `when` is older than the last-applied as already-applied and skips them — while still printing "migrations applied successfully". The resulting column drift crashed the booking API (`column "phone" does not exist`) and blocked production Deploy for ~15 min.
- **`db:verify` now enforces strictly monotonic `when` at commit time** — this is the primary guard. Do not remove the check.
- **If you rebase/cherry-pick a migration**, bump its `when` in `_journal.json` to `max(previous_when) + 1` before committing; `db:verify` will tell you if you forgot.
- **Do not trust `drizzle-kit migrate`'s success line alone** — it prints "migrations applied successfully" even when it skipped an entry. The `journal ↔ DB sync` check (count vs count) is what actually catches a skip post-deploy.
- **Recovery if a skip reaches prod:** apply the skipped SQL manually (`ALTER TABLE … IF NOT EXISTS` form), then insert a matching row into `drizzle.__drizzle_migrations` with the file's SHA256 hash and a `created_at` strictly greater than its predecessor.

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

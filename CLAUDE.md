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

> **Rule: Self-document gotchas.** When you hit a surprise, waste time on a wrong assumption, or discover a non-obvious behavior, add it to this section immediately. Future sessions read this file first -- save them from repeating your mistakes.

## Next.js 16 + shadcn (base-ui)

- **No `asChild` prop.** shadcn components use `@base-ui/react`, not Radix. The `Button` component does NOT support `asChild`. Use `buttonVariants()` as a className on `<Link>` elements, or use the `render` prop on triggers.
  ```tsx
  // WRONG -- will not compile
  <Button asChild><Link href="/foo">Go</Link></Button>

  // CORRECT -- buttonVariants on Link
  <Link href="/foo" className={cn(buttonVariants({ variant: 'outline' }))}>Go</Link>

  // CORRECT -- render prop on triggers
  <DropdownMenuTrigger render={<Button variant="ghost">Open</Button>} />
  ```

- **Use `middleware.ts`, NOT `proxy.ts`.** Next.js 16 deprecated middleware in favor of proxy, BUT `proxy.ts` forces Node.js runtime and `@opennextjs/cloudflare` does NOT support Node.js middleware. Stay on `middleware.ts` (Edge runtime by default) until opennextjs-cloudflare adds proxy support. The deprecation warning is cosmetic.

- **Middleware must use edge-safe auth.** Import `authConfig` from `auth.config.ts` (providers only, no DB), NOT `auth` from `auth.ts` (imports Drizzle/postgres-js which is Node.js only). The proxy/middleware runs on Edge, so any Node.js import chain kills the Cloudflare build.

- **`noUncheckedIndexedAccess` is on.** Array indexing like `segments[1]` returns `T | undefined`. Always guard with a variable check before returning.

- **Active-link className conditionals are a hydration trap (issue #25).** When a `'use client'` nav component computes a conditional className from `usePathname()` (e.g. `cn('base', isActive ? 'on' : 'off')`), Next.js 16 + Turbopack can produce a server/client className mismatch on the rendered `<a>`. The visible symptom is a hydration error pointing at the `<Link>` line with a className diff. Fix pattern:
  1. Make the className a single static string (no `cn()` conditional).
  2. Express active state via `aria-current="page"` and Tailwind `aria-[current=page]:*` variants.
  3. Defer the active calculation behind a `mounted` flag (`const [mounted,setMounted]=useState(false); useEffect(()=>setMounted(true),[])`) so the SSR pass and the first client render emit identical DOM, and only after hydration does any item gain `aria-current`. The 1-frame flicker is invisible and the mismatch becomes structurally impossible.
  See `packages/web/src/components/nav/BusinessSidebar.tsx` for the canonical pattern.

## Biome Linter

- Biome auto-sorts imports and reformats on save/check. If you write a file and it gets reformatted, re-read before editing again or the Edit tool will fail on stale `old_string`.
- Run `bunx biome check --fix ./packages/web/src` after creating multiple files to batch-fix formatting.
- Biome may remove unused imports aggressively -- if a file disappears from the build, check if biome stripped an import.

## Auth.js v5

- Session type doesn't include `role` by default. Type augmentation lives in `packages/web/src/types/next-auth.d.ts`.
- **JWT callback `user` is only present on first sign-in.** On subsequent token refreshes, `user` is `undefined`. Any DB field stored in the JWT (like `role`) must be re-fetched from DB in the `else` branch, or changes will never take effect. See `docs/2026-04-08-lessons-learned.md` #1.
- In middleware, `req.auth` gives the session. Cast `session.user` to access role until type augmentation is loaded.
- **Split auth config: `auth.config.ts` must mirror callbacks from `auth.ts`.** Middleware uses `auth.config.ts` (edge-safe, no DB). If it has no JWT/session callbacks, `session.user.role` is undefined and business route checks redirect to home. Any field middleware needs must have callbacks in BOTH configs. The edge config passes token fields through; the full config adds DB re-fetching on top.

## Cloudflare Workers Deployment (CRITICAL -- read before touching deploy)

> Full post-mortem: `docs/plans/2026-04-09-cloudflare-deployment-lessons.md`

### Build pipeline (must pass locally before pushing)
```bash
cd packages/web
bun run build          # Next.js
bun run build:worker   # opennextjs-cloudflare → .open-next/worker.js
npx wrangler deploy --dry-run  # Verify wrangler packaging
```

### CF dashboard config
- **Build command**: `bun install && cd packages/web && bun run build && bun run build:worker`
- **Deploy command**: `cd packages/web && npx wrangler deploy`
- **Path**: `/`

### Secrets (set via CLI, persist across deploys)
```bash
npx wrangler secret put DATABASE_URL -c packages/web/wrangler.jsonc
npx wrangler secret put AUTH_SECRET -c packages/web/wrangler.jsonc
npx wrangler secret put AUTH_GOOGLE_ID -c packages/web/wrangler.jsonc
npx wrangler secret put AUTH_GOOGLE_SECRET -c packages/web/wrangler.jsonc
```
Do NOT rely on the CF dashboard for secrets -- they get wiped on redeploy.

### Critical rules
1. **Lazy singleton for DB + auth.** Never call `getDb()` or `NextAuth()` at module scope. Use lazy initialization on first request. Build-time static generation imports these modules but must not trigger DB connections.
2. **Use `middleware.ts`, NOT `proxy.ts`.** Next.js 16 `proxy.ts` forces Node.js runtime, incompatible with @opennextjs/cloudflare (Edge only). The deprecation warning is cosmetic.
3. **Middleware must use `auth.config.ts`** (providers only, no DB imports). The full `auth.ts` imports Drizzle/postgres-js which are Node.js-only and break Edge middleware.
4. **Guard `session?.user` everywhere.** On CF Workers, `auth()` can return a session where `user` is undefined. Always use `session?.user` not just `session`.
5. **`open-next.config.ts` must exist** or the CLI hangs waiting for interactive input.
6. **`opennextjs-cloudflare build`** -- always include the `build` subcommand.
7. **`typescript.ignoreBuildErrors: true`** in `next.config.ts` -- tsc runs locally/CI, not during `next build` (prevents CF build timeout).

## i18n (next-intl v4)

- Navigation helpers (`Link`, `useRouter`, `usePathname`, `redirect`) come from `createNavigation(routing)` in `src/i18n/routing.ts`. Import from `@/i18n/routing`, not from `next/link` or `next/navigation`.
- Route groups `(renter)` and `(business)` don't create URL segments. Business routes use `/manage/` prefix (`/manage/bookings`, `/manage/vehicles`, `/manage/customers`, `/manage/messages`) to avoid collision with renter routes (`/bookings`, `/messages`). `/dashboard` has no prefix (it's unique to business).
- **Adding new top-level i18n namespaces requires a dev server restart.** Turbopack caches message JSON via dynamic import. Run `rm -rf packages/web/.next && bun run dev` after adding new namespaces. Editing existing keys within an existing namespace usually hot-reloads fine.
- **After merging branches that modify i18n files, verify all keys exist.** Merge conflict resolution can silently drop keys. Always re-read the merged JSON and check for missing namespaces.

## Dev Server Crash Loops

- If the dev server shows repeated `next dev -p 3001` restarts and `Failed to fetch RSC payload` errors, check for zombie processes: `lsof -ti:3001 | xargs kill -9`. Multiple `next dev` processes fighting over the same port cause this.
- When CSS or i18n changes aren't reflected, clear the Turbopack cache: `rm -rf packages/web/.next && bun run dev`.

## Worktree Dependency Drift

- When working in a git worktree, dependencies may be missing if they were added in the main worktree but never committed to `package.json`. Example: `@tanstack/react-query` and `react-hook-form` were installed in the main tree but not in `package.json`, causing `tsc --noEmit` to fail in a fresh worktree.
- Always run `bun install` in a new worktree and verify `tsc --noEmit` passes before starting work. If a dependency is missing, add it explicitly with `bun add <package>`.

## CSS / Tailwind v4

- **Check CSS variable references aren't circular.** `--font-sans: var(--font-sans)` silently falls back to serif. The correct reference is `--font-sans: var(--font-geist-sans)` (the variable set by `next/font/google`). Always verify `@theme inline` right-hand sides point to actual source variables.
- **`globals.css` must be imported in the layout that renders the HTML shell.** If CSS doesn't load, check the import chain first.

## Merge Hygiene

- **Multi-branch merges can silently lose features.** When two branches modify the same component (e.g., one adds `<Link>` wrapping, another adds `searchParams`), the merge may keep only one side's changes. After resolving conflicts, read the full merged file and verify ALL features from ALL branches are present.
- **i18n JSON is especially fragile in merges.** See the i18n section above. Always `grep` for expected keys after merge.

## Monorepo

- shadcn components must be added with `-c packages/web` flag: `bunx shadcn@latest add <component> -c packages/web`
- Lint covers all packages. Run `bunx biome check ./packages/web/src` to lint just web.
- **`.env` lives at repo root; Next.js reads from its package dir.** Symlink: `packages/web/.env` -> `../../.env`. Without this, `DATABASE_URL` won't be found at runtime.
- **Always `db:migrate` before `db:seed`.** Tables must exist before inserting data. Order: `db:generate` -> `db:migrate` -> `db:seed`.

## Database Migrations (drizzle) -- READ BEFORE TOUCHING SCHEMA

> Two production-like incidents (issue #27) were caused by schema changes that shipped without a matching migration, or migrations that were committed without being applied. Both crashed the bookings page at runtime. The rules below exist because of those incidents -- follow them exactly.

### The anti-pattern: "Pending Migration"

Any of these states is a loaded gun:

1. `packages/shared/src/db/schema.ts` has a change, but `drizzle/` has no new `.sql` file for it -- the code references columns/tables the DB doesn't have.
2. `drizzle/` has a new `.sql` file in the journal, but `drizzle.__drizzle_migrations` in the live DB hasn't applied it yet -- same runtime crash.
3. `drizzle/` has a hand-written `.sql` file that is NOT registered in `drizzle/meta/_journal.json` -- it will never be applied by `db:migrate` and future `db:generate` runs will collide with its idx number.

Every one of these produces the same symptom: `PostgresError: column "X" does not exist` or `relation "Y" does not exist`, surfacing as a 500 and a blank page for the user.

### Mandatory workflow

When you change `packages/shared/src/db/schema.ts`:

```bash
bun run db:generate --name <describe_change>  # create the migration file
bun run db:migrate                              # apply it to your local DB
bun run db:verify                               # confirm schema + journal + DB all in sync
```

When you need a hand-written migration (extension install, constraint, etc.):

```bash
bun run db:generate --custom --name <describe_change>  # drizzle creates an empty file + journal entry
# ...edit the generated 0NNN_*.sql to add your raw SQL...
bun run db:migrate
bun run db:verify
```

**Never** drop a hand-written `.sql` into `drizzle/` without `--custom` -- it won't be in the journal and `db:migrate` will silently skip it.

### The verify gate

`bun run db:verify` (`scripts/db-verify.ts`) runs three checks:

1. **schema.ts ↔ snapshot**: invokes `drizzle-kit generate` in dry-run mode; any pending schema change fails the check (and rolls back the accidental file so your tree stays clean).
2. **journal ↔ disk**: every `_journal.json` entry must have a corresponding `.sql` file and vice versa. Catches orphan hand-written files and journal-file-deleted drift.
3. **journal ↔ DB**: `drizzle.__drizzle_migrations` count must equal `_journal.json` entry count. Only runs when `DATABASE_URL` is set (cleanly skipped otherwise).

Run it before every commit that touches `packages/shared/src/db/schema.ts` or `drizzle/`. CI enforces the same gate against a fresh Postgres service container (see `.github/workflows/ci.yml` `db-drift` job), so drift cannot merge -- but catching it locally is faster than round-tripping through CI.

### If verify fails

Fix the underlying drift, never bypass the check:

- "schema.ts ↔ snapshot drift detected" -> you edited `schema.ts` but forgot to generate. Run `bun run db:generate --name <describe_change>`.
- "orphan .sql files not in journal" -> hand-written SQL. Delete the loose file and use `bun run db:generate --custom --name <same_thing>` instead.
- "journal references missing files" -> someone deleted a migration file after it was journaled. Restore it from git or remove the journal entry (only safe if the DB has NOT applied it yet).
- "journal ↔ DB sync" mismatch -> pending migrations. Run `bun run db:migrate`. If migration fails, fix the SQL and retry -- do NOT edit `__drizzle_migrations` directly to "skip" the problem.

---

# Vertical Slice TDD (MANDATORY -- NO EXCEPTIONS)

**Every feature must be a vertical slice with strict TDD. This is non-negotiable.**

## What is a vertical slice?

A single user-facing feature delivered end-to-end: schema + API + UI in one shippable unit.

```
WRONG (horizontal layers):
  Step 1: Build all DB tables
  Step 2: Build all API routes
  Step 3: Build all UI pages

RIGHT (vertical slices):
  Slice 1: Vehicle browsing  → schema + API + web page (end-to-end)
  Slice 2: Instant booking   → schema + API + booking UI (end-to-end)
  Slice 3: Calendar dashboard → API + calendar UI (end-to-end)
```

## TDD cycle (RED-GREEN-REFACTOR)

Every implementation step follows this cycle. No exceptions.

```
RED:     Write ONE failing test for ONE behavior
GREEN:   Write MINIMAL code to make it pass
REFACTOR: Clean up while tests stay green
REPEAT
```

**Vertical, not horizontal:**
```
WRONG: test1, test2, test3, test4 → impl1, impl2, impl3, impl4
RIGHT: test1 → impl1 → test2 → impl2 → test3 → impl3
```

## Martin Fowler refactoring techniques

Apply during REFACTOR phase:
- **Extract Method** — pull reusable logic into named functions
- **Move Function** — relocate logic to where it belongs (e.g., DB queries → `lib/` module)
- **Replace Conditional with Polymorphism** — when if/switch grows unwieldy
- **Parallel Change** — expand interface, migrate callers, contract interface
- **Remove Dead Code** — delete unused code immediately, git has history

## Rules

1. Each slice touches shared + api + web as needed — one feature, all layers
2. Each slice ends with a working UI that a user can interact with
3. Each slice has tests at every layer (unit + integration + component)
4. Each slice is committed and mergeable independently
5. Schema migrations are part of the feature slice — never a separate task
6. Plan by user story ("renter can book a car"), not by technical layer ("add bookings table")
7. Subagents dispatched for implementation MUST also follow TDD — include this in agent prompts
8. Tests must be mutation-resistant — assert specific values, not truthiness

**Why:** Horizontal layers produce fully built backends with zero user-facing value. Vertical slices deliver working features incrementally, catch integration issues early, and let the owner see progress.

---

# Issue Tracking & Session Protocol

## Source of truth: GitHub Issues

All work is tracked as GitHub Issues. Use `gh` CLI to query and update.

```bash
gh issue list                                    # all open issues
gh issue list --label slice                      # vertical slices
gh issue list --milestone "Phase 1: Core Booking" # milestone view
gh issue view <number>                           # issue detail
```

## Session protocol (MANDATORY)

### On start:
1. Run `gh issue list` to see open issues
2. Pick an issue to work on and add `in-progress` label: `gh issue edit <N> --add-label in-progress`

### On end:
1. Remove `in-progress` label from completed issues: `gh issue edit <N> --remove-label in-progress`
2. Close completed issues: `gh issue close <N>`
3. Create new issues for anything discovered: `gh issue create --title "..." --label <label>`

---

# Parallel Work Protocol

Multiple sessions may work on this repo simultaneously (e.g., API in a worktree, web on the main branch). Follow these rules:

1. **Check `gh issue list`** before starting. Avoid claiming work another session is doing.
2. **Don't touch other packages** unless explicitly asked. If you're on web, don't modify `packages/api` or `packages/shared`.
3. **Use worktrees** for isolated work: `git worktree add ../kuruma-<feature> -b feat/<feature>`
4. **Commit frequently** with conventional commits (`feat:`, `fix:`, `refactor:`, etc.).

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

## Biome Linter

- Biome auto-sorts imports and reformats on save/check. If you write a file and it gets reformatted, re-read before editing again or the Edit tool will fail on stale `old_string`.
- Run `bunx biome check --fix ./packages/web/src` after creating multiple files to batch-fix formatting.
- Biome may remove unused imports aggressively -- if a file disappears from the build, check if biome stripped an import.

## Auth.js v5

- Session type doesn't include `role` by default. Type augmentation lives in `packages/web/src/types/next-auth.d.ts`.
- Role is set in the JWT callback (`auth.ts`), defaults to `'RENTER'` if not present.
- In middleware, `req.auth` gives the session. Cast `session.user` to access role until type augmentation is loaded.

## Build without DATABASE_URL

- `getDb()` in `packages/shared/src/db/index.ts` uses a placeholder URL when `DATABASE_URL` is not set. This is safe because `postgres-js` only connects on first query, not at instantiation. The real URL is provided at runtime by Cloudflare env bindings.
- TypeScript type-checking works without DB: `bunx tsc --noEmit`

## Cloudflare Deployment

- **Build command**: `bun install && cd packages/web && bun run build && bun run build:worker`
- **Deploy command**: `cd packages/web && npx wrangler deploy`
- **Path**: `/` (root -- full monorepo must be available for workspace resolution)
- `next build` runs first, then `opennextjs-cloudflare build` converts the output to `.open-next/worker.js` for wrangler.
- `open-next.config.ts` MUST exist in `packages/web/` or the CLI will hang waiting for interactive input.
- `typescript.ignoreBuildErrors: true` in `next.config.ts` -- tsc is checked locally and in CI, not during `next build` (saves ~10s, prevents CF build timeouts).
- **Required env vars on Cloudflare**: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- **Worker name mismatch warning**: The wrangler config says `kuruma-api` but CF expects `kuruma-rental`. Non-blocking, CF overrides it.

## i18n (next-intl v4)

- Navigation helpers (`Link`, `useRouter`, `usePathname`, `redirect`) come from `createNavigation(routing)` in `src/i18n/routing.ts`. Import from `@/i18n/routing`, not from `next/link` or `next/navigation`.
- Route groups `(renter)` and `(business)` don't create URL segments. Business routes use `/manage/` prefix (`/manage/bookings`, `/manage/vehicles`, `/manage/customers`, `/manage/messages`) to avoid collision with renter routes (`/bookings`, `/messages`). `/dashboard` has no prefix (it's unique to business).

## Worktree Dependency Drift

- When working in a git worktree, dependencies may be missing if they were added in the main worktree but never committed to `package.json`. Example: `@tanstack/react-query` and `react-hook-form` were installed in the main tree but not in `package.json`, causing `tsc --noEmit` to fail in a fresh worktree.
- Always run `bun install` in a new worktree and verify `tsc --noEmit` passes before starting work. If a dependency is missing, add it explicitly with `bun add <package>`.

## Monorepo

- shadcn components must be added with `-c packages/web` flag: `bunx shadcn@latest add <component> -c packages/web`
- Lint covers all packages. Run `bunx biome check ./packages/web/src` to lint just web.

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

# Parallel Work Protocol

Multiple sessions may work on this repo simultaneously (e.g., API in a worktree, web on the main branch). Follow these rules:

1. **Check branch status** before starting. Read `docs/plans/2026-04-07-architecture-redesign.md` "Branch status" section.
2. **Don't touch other packages** unless explicitly asked. If you're on web, don't modify `packages/api` or `packages/shared`.
3. **Use worktrees** for isolated work: `git worktree add ../kuruma-<feature> -b feat/<feature>`
4. **Commit frequently** with conventional commits (`feat:`, `fix:`, `refactor:`, etc.).

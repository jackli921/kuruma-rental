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

- **Middleware is deprecated in Next.js 16.** Use "proxy" instead. Current `middleware.ts` still works but shows a deprecation warning. Migration needed before Next.js 17.

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

- `bun run build` for the web package will fail at the static generation phase if `DATABASE_URL` is not set (Auth.js Drizzle adapter eagerly connects). TypeScript type-checking still passes. Use `bunx tsc --noEmit` for a CI-friendly type check without DB.

## i18n (next-intl v4)

- Navigation helpers (`Link`, `useRouter`, `usePathname`, `redirect`) come from `createNavigation(routing)` in `src/i18n/routing.ts`. Import from `@/i18n/routing`, not from `next/link` or `next/navigation`.
- Route groups `(renter)` and `(business)` don't create URL segments. Paths like `/bookings` and `/messages` exist under both groups in the spec -- this will collide. Resolve by prefixing business routes (e.g. `/manage/...`) when those pages are built.

## Monorepo

- shadcn components must be added with `-c packages/web` flag: `bunx shadcn@latest add <component> -c packages/web`
- Lint covers all packages. Run `bunx biome check ./packages/web/src` to lint just web.

---

# Parallel Work Protocol

Multiple sessions may work on this repo simultaneously (e.g., API in a worktree, web on the main branch). Follow these rules:

1. **Check branch status** before starting. Read `docs/plans/2026-04-07-architecture-redesign.md` "Branch status" section.
2. **Don't touch other packages** unless explicitly asked. If you're on web, don't modify `packages/api` or `packages/shared`.
3. **Use worktrees** for isolated work: `git worktree add ../kuruma-<feature> -b feat/<feature>`
4. **Commit frequently** with conventional commits (`feat:`, `fix:`, `refactor:`, etc.).

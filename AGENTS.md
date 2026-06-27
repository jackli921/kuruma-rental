<!-- BEGIN:nextjs-agent-rules -->
# Web is Vite + TanStack Router (NOT Next.js)

`packages/web` was migrated off Next.js to **Vite + TanStack Router** on Cloudflare Pages (epic #378). The live shell lives under `packages/web/src/vite/` + `packages/web/src/routes/`. The legacy Next.js tree (`src/app/`, `middleware.ts`, `next.config.ts`, `open-next.config.ts`) and all Next/OpenNext/next-intl/next-auth deps were **deleted in #714** — there is no Next.js in this repo anymore. Adding a route requires `vite build` to regenerate `routeTree.gen.ts` before typecheck.
<!-- END:nextjs-agent-rules -->

# Monorepo Architecture

This is a Bun workspace monorepo with three packages:

- `packages/api` — Hono REST API (deploys to CF Workers). All business logic lives here.
- `packages/web` — Vite + TanStack Router SPA (deploys to CF Pages). UI only, no direct DB access.
- `packages/shared` — Drizzle schema, Zod validators, shared types. No runtime deps on api or web.

**Key rules:**
- The web package NEVER imports from `packages/api` directly. It calls the Hono API via `hono/client` (typed HTTP client).
- The API is the single source of truth for all data operations.
- Schema and validators live in `@kuruma/shared` — import from there, not from local copies.
- DB imports use `@kuruma/shared/db` and `@kuruma/shared/db/schema`.
- Validator imports use `@kuruma/shared/validators/auth` (etc.).

## API Layer Architecture (MVC + Dependency Injection)

`packages/api` follows a three-layer architecture with function injection:

```
routes/        → Controller layer (HTTP in/out only)
services/      → Service layer (business logic, validation, orchestration)
repositories/  → Data access layer (DB queries, in-memory stores)
index.ts       → Composition root (constructs concretes, wires DI)
```

**Import direction: routes → services → repositories. Never backwards.**

| Rule | Why |
|------|-----|
| Routes import services and `routes/helpers.ts` only — never `repositories/`, not even `types.ts`. | Routes handle HTTP concerns; business logic belongs in services. Filter/entity shapes reach routes through the service layer (e.g. `services/filters.ts`), not the data layer. One scoped carve-out (#692): **sanctioned thin-read routes** (`regions`, `stats`) carry no *domain* policy — a pass-through service would be anemic — so they may DI *only* their `*Repository` interface from `types.ts` (an entity/filter import is query-shaping that belongs in a service, and stays blocked; transport-level auth such as `stats`' API-key check is a route concern and stays put). A sanctioned route that later grows domain logic (authz scoping, response shaping, orchestration) must **graduate to a service** — the path `vehicles` took to `VehicleService` (#819) — not widen its carve-out. Every other route is fully enforced. |
| Services import repository *interfaces* (`types.ts`) only. Never concrete classes. | Enables swapping InMemory ↔ Drizzle without touching business logic. |
| Only `index.ts` imports concrete classes (`DrizzleBookingRepository`, `InMemoryBookingRepository`, etc.) | Single place to change wiring; the rest of the code is implementation-agnostic. |
| No `new ConcreteRepository()` outside the composition root (`index.ts` / `composition/`) — except the two transaction factories (`repositories/drizzle/*-transaction.ts`). | Prevents hidden coupling that breaks testability. The tx factories are the lone carve-out: they must rebind every repo to the per-call neon-serverless tx connection, which `index.ts` can't do per call. |

Shared helpers live in `routes/helpers.ts`: `ok()`, `fail()`, `parseBody()`, `parseDateRange()`.
Use them instead of manual `c.json({ success: true/false, ... })` construction.

Enforced by `bun run --filter @kuruma/api lint:boundaries` (CI step) — which also flags any `new Drizzle*`/`new InMemory*` construction outside the composition root and the sanctioned `*-transaction.ts` factories.

**Platform-admin surfaces MUST mount under `/admin/*` (#1164, #1228).** The structural read-floor `requirePlatformMember()` (mounted once as `app.use('/admin/*', requireAuth())` → `app.use('/admin/*', requirePlatformMember())` in `index.ts`) is **path-prefix-bound**: it only protects routes under that prefix. A platform route mounted anywhere else inherits NO structural authz and relies solely on its in-body `requirePlatform*` call — one forgotten call = an open admin surface. So: register every platform-admin router under `/admin/*`, never a sibling prefix. The per-handler `requirePlatform*` gates stay as defense-in-depth (and carry the stricter write-only `requirePlatformAdmin` distinction).

## Commands

| Task | Command |
|------|---------|
| Run all tests | `bun run test` |
| Run one package's tests | `bun run --filter @kuruma/web test` |
| Run E2E tests (Playwright) | `bun run test:e2e` |
| Debug E2E in Playwright UI | `bun run test:e2e:ui` |
| Dev server (web) | `bun run dev` |
| Dev server (API) | `bun run dev:api` |
| Lint | `bun run lint` |
| Format | `bun run format` |
| DB generate migration | `bun run db:generate` |
| DB apply migrations | `bun run db:migrate` |
| DB seed | `bun run db:seed` |
| DB browser | `bun run db:studio` |

## Imported Claude Cowork project instructions

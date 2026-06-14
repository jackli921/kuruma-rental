<!-- BEGIN:nextjs-agent-rules -->
# Web is Vite + TanStack Router (NOT Next.js)

`packages/web` was migrated off Next.js to **Vite + TanStack Router** on Cloudflare Pages (epic #378). The live shell lives under `packages/web/src/vite/` + `packages/web/src/routes/`. A **frozen** Next.js tree (`src/app/`, `middleware.ts`, `next.config.ts`, `open-next.config.ts`) is still present but is NOT the build path and is slated for deletion at cut-over — **do not extend it**. Adding a route requires `vite build` to regenerate `routeTree.gen.ts` before typecheck.
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
| Routes import services and `routes/helpers.ts` only. Never repositories. | Routes handle HTTP concerns; business logic belongs in services. |
| Services import repository *interfaces* (`types.ts`) only. Never concrete classes. | Enables swapping InMemory ↔ Drizzle without touching business logic. |
| Only `index.ts` imports concrete classes (`DrizzleBookingRepository`, `InMemoryBookingRepository`, etc.) | Single place to change wiring; the rest of the code is implementation-agnostic. |
| No `new ConcreteRepository()` outside the composition root (`index.ts` / `composition/`) — except the two transaction factories (`repositories/drizzle/*-transaction.ts`). | Prevents hidden coupling that breaks testability. The tx factories are the lone carve-out: they must rebind every repo to the per-call neon-serverless tx connection, which `index.ts` can't do per call. |

Shared helpers live in `routes/helpers.ts`: `ok()`, `fail()`, `parseBody()`, `parseDateRange()`.
Use them instead of manual `c.json({ success: true/false, ... })` construction.

Enforced by `bun run --filter @kuruma/api lint:boundaries` (CI step) — which also flags any `new Drizzle*`/`new InMemory*` construction outside the composition root and the sanctioned `*-transaction.ts` factories.

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

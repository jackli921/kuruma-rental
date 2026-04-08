# Contributing Guide

## Prerequisites

- [Bun](https://bun.sh/) v1.1+
- PostgreSQL (or [Neon](https://neon.tech/) serverless Postgres)
- Node.js 20+ (for Next.js compatibility)

## Environment Setup

1. Clone the repo and install dependencies:
   ```sh
   git clone <repo-url> && cd kuruma-rental
   bun install
   ```

2. Copy the environment file and fill in values:
   ```sh
   cp .env.example .env
   ```

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `DATABASE_URL` | Yes | Postgres connection string (Neon recommended) |
   | `AUTH_SECRET` | Yes | Random secret for Auth.js session signing (`bunx auth secret`) |
   | `AUTH_GOOGLE_ID` | Yes | Google OAuth client ID |
   | `AUTH_GOOGLE_SECRET` | Yes | Google OAuth client secret |
   | `NEXT_PUBLIC_API_URL` | No | API base URL (defaults to `http://localhost:8787`) |

3. Run database migrations and seed:
   ```sh
   bun run db:migrate
   bun run db:seed
   ```

## Monorepo Structure

```
kuruma-rental/
  packages/
    api/      @kuruma/api     Hono REST API (CF Workers)
    web/      @kuruma/web     Next.js 16 frontend (CF Pages)
    shared/   @kuruma/shared  Drizzle schema, Zod validators, shared types
```

**Key rule:** `web` never imports from `api` directly. It calls the API via `hono/client`.

## Available Scripts

### Root (monorepo)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `bun run dev` | Start Next.js dev server (port 3001) |
| `dev:api` | `bun run dev:api` | Start Hono API dev server (Wrangler, port 8787) |
| `build` | `bun run build` | Build all packages |
| `test` | `bun run test` | Run all tests across packages |
| `lint` | `bun run lint` | Lint with Biome |
| `format` | `bun run format` | Format with Biome |
| `db:generate` | `bun run db:generate` | Generate Drizzle migration from schema changes |
| `db:migrate` | `bun run db:migrate` | Apply pending migrations |
| `db:seed` | `bun run db:seed` | Seed database with sample vehicles |
| `db:studio` | `bun run db:studio` | Open Drizzle Studio (DB browser) |

### Per-package

| Package | Script | Description |
|---------|--------|-------------|
| `@kuruma/web` | `bun run --filter @kuruma/web dev` | Next.js dev server |
| `@kuruma/web` | `bun run --filter @kuruma/web typecheck` | TypeScript check (no DB needed) |
| `@kuruma/api` | `bun run --filter @kuruma/api dev` | Wrangler dev server |
| `@kuruma/api` | `bun run --filter @kuruma/api test` | API tests (Vitest) |
| `@kuruma/shared` | `bun run --filter @kuruma/shared test` | Shared package tests |

## Development Workflow

1. **Pick a task** and create a feature branch: `git checkout -b feat/<name>`
2. **Run dev servers**: `bun run dev` (web) and `bun run dev:api` (API) in separate terminals
3. **Write tests first** (TDD) when implementing features or fixing bugs
4. **Commit frequently** with conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
5. **Type-check before pushing**: `bunx tsc --noEmit --project packages/web/tsconfig.json`

## Database Changes

1. Edit the schema in `packages/shared/src/db/schema.ts`
2. Generate migration: `bun run db:generate`
3. Apply migration: `bun run db:migrate`
4. Update validators in `packages/shared/src/validators/` if needed
5. Re-seed if needed: `bun run db:seed`

## Testing

- **Unit/integration tests**: `bun run test` (Vitest across all packages)
- **Type checking**: `bunx tsc --noEmit` (no DB connection needed)
- **Lint**: `bun run lint`

## Internationalization

Three locales: `en`, `ja`, `zh`. Translation files live in `packages/web/messages/`. When adding UI text, add keys to all three files.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Monorepo Architecture

This is a Bun workspace monorepo with three packages:

- `packages/api` — Hono REST API (deploys to CF Workers). All business logic lives here.
- `packages/web` — Next.js frontend (deploys to CF Pages). UI only, no direct DB access.
- `packages/shared` — Drizzle schema, Zod validators, shared types. No runtime deps on api or web.

**Key rule:** The web package NEVER imports from `packages/api` directly. It calls the Hono API via `hono/client` (typed HTTP client). The API is the single source of truth for all data operations.

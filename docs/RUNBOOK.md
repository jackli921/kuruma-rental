# Runbook

## Architecture

```
User -> CF Pages (Vite SPA + proxy Functions) -> CF Workers (Hono API) -> Neon Postgres
```

- **Web**: Vite + TanStack Router SPA on Cloudflare Pages. Same-origin `/api` + `/auth` proxy via Pages Functions (`packages/web/functions/`).
- **API**: Hono on Cloudflare Workers
- **DB**: Neon serverless Postgres
- **Auth**: Google OAuth on the API, cookie session (Apple was dropped).

## Deployment

### Web (Cloudflare Pages)

```sh
cd packages/web
bun run build           # vite build -> dist/
bun run deploy:pages    # wrangler pages deploy dist (project: kuruma-web-pages)
```

> Web deploy is gated in CI on `WEB_PAGES_DEPLOY_ENABLED=true` and the CF account migration (#304). See `docs/plans/2026-06-09-378-pages-cutover.md` §8.

### API (Cloudflare Workers)

```sh
cd packages/api
bun run deploy          # Deploy via Wrangler
```

### Database Migrations (production)

```sh
DATABASE_URL=<prod-url> bun run db:migrate
```

Always run migrations before deploying code that depends on schema changes.

## Common Issues

### `DATABASE_URL is not set`

- **In dev**: Ensure `.env` exists at repo root with `DATABASE_URL` set. The web package symlinks to it (`packages/web/.env -> ../../.env`).
- **In build**: `bun run build` requires `DATABASE_URL` for Auth.js Drizzle adapter. Use `bunx tsc --noEmit` for type-checking without DB.

### `relation "X" does not exist`

Migrations haven't been applied. Run:
```sh
bun run db:migrate
```

### Missing `<html>` and `<body>` tags in root layout

Next.js 16 requires `<html>` and `<body>` in `src/app/layout.tsx`. The locale layout (`src/app/[locale]/layout.tsx`) should NOT duplicate these tags.

### Biome reformats imports after file edit

Biome auto-sorts imports. If editing a file that was just reformatted, re-read it first or the Edit tool will fail on stale content. Batch-fix: `bunx biome check --fix ./packages/web/src`

### shadcn components

Must specify the web package path:
```sh
bunx shadcn@latest add <component> -c packages/web
```

## Monitoring

- **Cloudflare dashboard**: Workers and Pages analytics, error rates, request logs
- **Neon dashboard**: Query performance, connection count, storage usage
- **Drizzle Studio**: `bun run db:studio` for inspecting data locally

### Error monitoring — Sentry (API), #361

The API Worker is instrumented with `@sentry/cloudflare`: it captures unhandled
exceptions (with stack), raw `>=500` responses, and slow requests (`>2s`), tagged
with the deploy's version id as the Sentry **release**. It is **gated off by
default** — nothing is sent until a DSN is present (see
`packages/api/src/observability/`).

To activate (HITL, one-time):
1. Create a Sentry project (platform: Cloudflare Workers); copy its DSN.
2. `cd packages/api && npx wrangler secret put SENTRY_DSN` (paste the DSN). Add a
   matching `SENTRY_DSN` GitHub secret so deploys keep it. Optional:
   `SENTRY_ENVIRONMENT` (defaults to `production`).
3. In Sentry, add an **alert rule**: error rate spikes 5× baseline for 10 min →
   Slack/email. Add an **uptime monitor** pinging `GET /health`.

**Web monitoring is deferred** until the Next→Vite migration (#378/#689) settles —
tracked separately so we don't instrument code that's being deleted.

## Rollback

### Code rollback

```sh
# Cloudflare Pages/Workers support instant rollback via dashboard
# Or redeploy a previous commit:
git checkout <previous-sha>
bun run deploy  # from the relevant package
```

### Database rollback

Drizzle does not auto-generate down migrations. To roll back a schema change:
1. Write a reverse migration manually in SQL
2. Apply via Drizzle Studio SQL console or `psql`
3. Update the schema file to match the rolled-back state

### Emergency: disable a feature

The API is stateless (CF Workers). To disable an endpoint, deploy a patched version that returns 503. Cloudflare Workers deploy in seconds.

## Seed Data

Reset and re-seed the database:
```sh
bun run db:seed
```

This clears all vehicles and inserts 15 sample Japanese rental cars with photos. Idempotent — safe to run multiple times.

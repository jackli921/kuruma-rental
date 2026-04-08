# Runbook

## Architecture

```
User -> CF Pages (Next.js) -> CF Workers (Hono API) -> Neon Postgres
```

- **Web**: Next.js 16 on Cloudflare Pages
- **API**: Hono on Cloudflare Workers
- **DB**: Neon serverless Postgres
- **Auth**: Auth.js v5 (Google + Apple OAuth, JWT strategy)

## Deployment

### Web (Cloudflare Pages)

```sh
cd packages/web
bun run build:worker    # Build with OpenNext for CF
bun run deploy          # Deploy to Cloudflare Pages
```

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

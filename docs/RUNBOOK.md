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

### Error monitoring — Sentry (API + web), #361

Both surfaces are instrumented and **gated off by default** — nothing is sent
until a DSN is present. Plan: `docs/plans/2026-06-17-issue-361-monitoring-activation.md`.

- **API** (`@sentry/cloudflare`, `packages/api/src/observability/`): captures
  unhandled exceptions (with stack), raw `>=500` responses, and slow requests
  (`>2s`), tagged with the deploy commit SHA (`SENTRY_RELEASE` `--var`, falling
  back to `CF_VERSION_METADATA.id`) as the **release**. Gated on the `SENTRY_DSN`
  Worker secret. Source maps upload to Sentry (#959, gated on `SENTRY_AUTH_TOKEN`/
  `SENTRY_ORG`/`SENTRY_PROJECT_API`) so API stack frames resolve to `src/` not
  bundled `worker.js`.
- **Web** (`@sentry/react`, `packages/web/src/lib/observability/`, #765): captures
  React render crashes + TanStack route errors, tagged with the deploy commit SHA
  (`VITE_SENTRY_RELEASE`) as the release. Gated on the public `VITE_SENTRY_DSN`.
  Source maps upload on the deploying build (`vite.config` `sentrySourcemapPlugin`,
  gated on `SENTRY_AUTH_TOKEN`) so web stack traces are de-minified — without it
  every browser error is unreadable minified gibberish.

CI is already wired: `rotate-secrets.yml` rotates `SENTRY_DSN`; `deploy.yml`'s web
build injects `VITE_SENTRY_*` + `SENTRY_AUTH_TOKEN/ORG/PROJECT`. Until those
secrets exist, every build is byte-identical (no maps emitted, SDKs `enabled:false`).

To activate (HITL, one-time):
1. Create **two** Sentry projects: platform **Cloudflare Workers** (API) and
   **React** (web). Copy each DSN. Note your Sentry **org** + **project** slugs.
2. Add GitHub secrets: `SENTRY_DSN` (API), `VITE_SENTRY_DSN` (web — public key,
   safe to bake into the SPA), `SENTRY_AUTH_TOKEN` (source-map upload — a real
   secret, shared by web *and* API). Add repo **variables** `SENTRY_ORG`,
   `SENTRY_PROJECT` (web), **`SENTRY_PROJECT_API`** (#959 — the API project slug;
   the API map upload no-ops until it is set), and `SENTRY_ENVIRONMENT` (set to
   `beta`; the API Worker also reads it from `wrangler.toml` `[vars]`). Unset env
   defaults to `production` and would mis-tag beta errors — don't skip it.
3. Run the **Rotate Worker Secrets** workflow (sets the API `SENTRY_DSN` + uploads
   the API source maps for the promoted version); the next web deploy bakes the web
   DSN + release and uploads web source maps. API maps also upload on every deploy.
4. In Sentry: add an **alert rule** — *error* events spike 5× baseline for 10 min →
   Slack/email (page on errors only; the `>2s` slow-request warnings are
   dashboard-only — Neon cold starts trip 2s, so paging on them is alert fatigue).
   Add an **uptime monitor** pinging `GET /health`. The monitor only proves the
   Worker is routable; **DB-down is caught by the error alerts**, not `/health`.
5. Verify: trigger a test error on each surface; confirm it lands grouped under the
   deploy's release, with a **readable (de-minified)** web stack trace.

> **At real-prod launch, flip BOTH `SENTRY_ENVIRONMENT` homes together** or the two
> surfaces tag differently: the **web** reads the `SENTRY_ENVIRONMENT` *repo
> variable* (`deploy.yml`, default `beta`), the **API** reads the committed
> `wrangler.toml` `[vars]` value. Changing only one tags web `production` while the
> API stays `beta` (or vice-versa).

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

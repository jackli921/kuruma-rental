# Go-Live Checklist (staged)

**Date:** 2026-07-11 · **Epic:** #1476 (path to GA)

The last mile to real customers. Engineering is essentially done; what remains is
**your** decisions + procurement, plus a little in-repo wiring that unblocks once
the Cloudflare resources exist. Four buckets, in the order they gate each other.

Live envs today: **beta** = the pre-contract env (`kuruma-web-pages.pages.dev` +
`kuruma-api.kanata-studio.workers.dev`, Neon `beta` branch). **production** does
not exist yet — this checklist builds it.

---

## 1. Done (in repo / DB)

- [x] Features / engineering — essentially complete.
- [x] Clean prod database — Neon `production-live` (br-steep-rice-anpni2dm), schema 103, zero data.
- [x] **Prod API Worker config** — `[env.production]` in `packages/api/wrangler.toml`
      (`kuruma-api-production`), fully isolated from beta: separate `*-production`
      R2 buckets, distinct rate-limiter namespaces (2001-2006), `SENTRY_ENVIRONMENT=production`.
- [x] **Prod deploy command** — `bun run --filter @kuruma/api deploy:production`
      (inert until the resources + secrets below exist; no CI job on purpose).

## 2. Owner decisions (no money — just choices)

- [ ] **GA feature flags (#1476)** — resolve the open questions + pick which Tier-1
      flags to flip. Zero-code, done from the admin switchboard.
- [ ] **Prod web domain** — a real custom domain, or accept the interim
      `kuruma-web-production.pages.dev`. This sets `WEB_ORIGIN` (wrangler.toml) +
      `AUTH_URL` (secret) + the Google OAuth redirect.
- [ ] **Delete the stale Neon `production` branch** (br-shy-tooth) — empty, un-migratable,
      superseded by `production-live`. I'm blocked from deleting it; do it in the Neon console.
- [ ] **Pickup document verification** — `REQUIRE_DOCUMENT_VERIFICATION` is unset (off) in
      prod, same as beta. Confirm you want ID-at-pickup enforcement off for real rentals, or
      set it on the prod worker.

## 3. Owner procurement (lead-time / money / CF console)

- [ ] **Domain** — register + point DNS at Cloudflare.
- [ ] **Stripe LIVE keys** — needs business verification. Yields `STRIPE_SECRET_KEY`
      + `STRIPE_WEBHOOK_SECRET` (live mode).
- [ ] **Cloudflare prod resources (#1009):**
  - [ ] `npx wrangler r2 bucket create kuruma-vehicle-photos-production`
  - [ ] `npx wrangler r2 bucket create kuruma-renter-documents-production`
  - [ ] Enable r2.dev public access on the vehicle-photos bucket, then in `wrangler.toml`
        **uncomment the `VEHICLE_PHOTOS` r2_bucket binding AND set `VEHICLE_PHOTOS_PUBLIC_URL`
        to its r2.dev URL in the same deploy** (both together — a live binding with an empty
        URL 500s the API on boot). Until then, photo upload is off; the rest of prod works.
  - [ ] Create the prod Pages project: `wrangler pages project create kuruma-web-production`
        with `nodejs_compat` + `global_fetch_strictly_public` flags (mirror `pages:create-project`).
  - [ ] (Optional) `GEOCODE_CACHE` KV namespace — else it falls back to in-memory.
- [ ] **Google OAuth** — register `<prod web origin>/auth/google/callback` as a redirect URI.
- [ ] **Prod Worker secrets** — set on the `kuruma-api-production` worker (each is a
      separate `wrangler secret put ... --env production`, sourced from GitHub Secrets):
      `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID/SECRET`, `RESEND_API_KEY`,
      `STRIPE_SECRET_KEY/WEBHOOK_SECRET` (live), `SENTRY_DSN`, `CONSENT_SIGNING_KEY(_ID)`,
      `GOOGLE_TRANSLATE_API_KEY`. Optional (fail closed if unset): `STATS_API_KEY` (the
      `/stats` dashboard), `PARTNER_API_KEY` (Trip.com partner API).
  - [ ] **Do NOT reuse the beta secret `PROD_DATABASE_URL`** — it holds the **beta** DB
        connection string (feeds beta's `DATABASE_URL` + migrations). Create a NEW,
        distinctly-named GitHub secret (e.g. `PRODUCTION_LIVE_DATABASE_URL`) = the
        `production-live` conn string, and source the prod worker's `DATABASE_URL` from it.
        Same caution for `AUTH_SECRET`/`AUTH_URL` if those GitHub secrets are beta-scoped —
        prod must not share beta's session-signing key or callback origin.

## 4. In-repo work remaining (mine — unblocks once §3 exists)

- [ ] **Prod deploy pipeline** — today it's the manual `deploy:production` command.
      Wire a prod-targeted deploy (workflow or parameterized `deploy.yml`) once the
      prod worker + Pages project exist. Deferred deliberately: a guarded-but-dead
      prod CI job beside the live beta one is the "two truths in CI" footgun.
      NOTE: unlike beta's CI deploy, the manual `deploy:production` does NOT run
      migrations first — until this pipeline exists, migrate `production-live` by hand
      before shipping any schema change (`production-live` is at schema 103 today, so
      the first deploy is fine).
- [ ] **Prod web Pages deploy** — `deploy.yml` is beta-only; add a `kuruma-web-production`
      deploy path once that Pages project exists.
- [ ] **Prod secret rotation** — a `rotate-secrets.yml` variant that targets `--env production`.
- [ ] **`deploy.yml` presence check** — add Stripe / Sentry / Consent / Translate to the
      required-secret gate once prod genuinely depends on them.

---

## Ordering

§2 (domain + flag decisions) and the start of §3 (procurement lead-time) run in
parallel now. Then: create CF resources → set prod secrets → I wire §4 → first
prod deploy (`deploy:production` + prod Pages deploy) → smoke-test OAuth round-trip
+ a payment in Stripe live mode → flip DNS. Nothing here is blocked on more
engineering; it's coordination + procurement from here.

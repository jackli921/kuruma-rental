# Cloudflare Account Migration

Transfer Workers from personal CF account to freelance CF account.

## Prerequisites

- Freelance Gmail address
- Access to GitHub repo secrets (Settings > Secrets and variables > Actions)
- Current `AUTH_SECRET` value (stored in GitHub Secrets)

## Steps

### 1. Create new Cloudflare account

- Sign up at https://dash.cloudflare.com/sign-up with freelance Gmail
- Choose the Free plan (Workers free tier covers our usage)

### 2. Generate API token on new account

- Go to: My Profile > API Tokens > Create Token
- Use the "Edit Cloudflare Workers" template
- Copy the token and the Account ID (visible on the Workers dashboard overview page)

### 3. Update GitHub repo secrets

Replace these two secrets in the repo (Settings > Secrets > Actions):

| Secret | New value |
|--------|-----------|
| `CLOUDFLARE_API_TOKEN` | Token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID from step 2 |

All other secrets (`AUTH_SECRET`, `PROD_DATABASE_URL`, `AUTH_GOOGLE_*`) stay the same — they're app secrets, not CF-specific.

### 4. Create the web CF Pages project (#378 §7.5 cutover)

The web app is now a CF **Pages** project (Vite SPA), not the old `kuruma-rental` Worker. Create it once, with the compat flags the same-origin proxy Functions need, and set the proxy's upstream:

```bash
# Compat flags incl. global_fetch_strictly_public (required, or the proxy 404s).
bun run --filter @kuruma/web pages:create-project

# The API Worker URL the proxy forwards /api + /auth to (use the NEW subdomain).
echo "https://kuruma-api.<new-subdomain>.workers.dev" \
  | bunx wrangler pages secret put API_ORIGIN --project-name=kuruma-web-pages

# Un-gate the Pages deploy + smoke steps in deploy.yml.
gh variable set WEB_PAGES_DEPLOY_ENABLED -b true
```

Also enable `global_fetch_strictly_public` on the Pages project in the dashboard if `pages:create-project` did not (verify under Settings → Functions → Compatibility flags).

### 4b. Deploy

```bash
gh workflow run deploy.yml
```

This deploys the `kuruma-api` Worker and the `kuruma-web-pages` Pages project. Worker secrets are NOT re-asserted here — rotate them via `rotate-secrets.yml` (the deploy only runs a read-only presence check).

### 5. Verify

- API health: `curl https://kuruma-api.<new-subdomain>.workers.dev/health`
- Web shell: visit `https://kuruma-web-pages.pages.dev/en`
- Proxy seam: `curl https://kuruma-web-pages.pages.dev/api/health` must return 200 (proves `API_ORIGIN` + `global_fetch_strictly_public` are set). The deploy's "Smoke test web (Pages)" step checks this automatically.
- Log in (Google OAuth) and check the fleet page loads.

### 6. Update URLs for the new subdomain

The new account has a different `*.workers.dev` subdomain. Update:

- `packages/api/wrangler.toml` — `WEB_ORIGIN` var (CORS) → the Pages origin (`https://kuruma-web-pages.pages.dev`)
- `.github/workflows/deploy.yml` — `API_WORKER_URL` env var (and `WEB_PAGES_URL` if the Pages origin differs)
- The Pages `API_ORIGIN` secret (step 4) → the new API subdomain
- Redeploy after updating these

The old `WEB_WORKER_URL` env no longer exists (the web Worker deploy was removed at the §7.5 cutover).

### 7. Auth URL + OAuth callback (post-deploy)

The web is same-origin with the API via the Pages proxy, so OAuth runs against the Pages origin:

1. Create GitHub Secret `AUTH_URL` = the Pages origin (e.g. `https://kuruma-web-pages.pages.dev`).
2. Register `<AUTH_URL>/auth/google/callback` in Google Cloud Console.
3. Run `rotate-secrets.yml` so the API Worker picks up `AUTH_URL`.

### 8. Custom domain (optional)

If you set up a custom domain later: add it to the new CF account, attach it to the `kuruma-web-pages` Pages project (and a Workers route for the API), then update `AUTH_URL` + the OAuth callback + `WEB_ORIGIN` to the new host.

### 9. Clean up old account

- Delete the `kuruma-api` Worker from the personal CF dashboard.
- The old `kuruma-rental` web Worker is deleted at the §378 §8 step-6 DNS cutover, not here (it serves nothing once DNS points at Pages).
- Revoke the old API token.

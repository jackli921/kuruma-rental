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

### 4. Deploy to new account

```bash
gh workflow run deploy.yml
```

This creates both workers (`kuruma-api`, `kuruma-rental`) on the new account and sets all secrets automatically.

### 5. Verify

- API health: `curl https://kuruma-api.<new-subdomain>.workers.dev/health`
- Web: visit `https://kuruma-rental.<new-subdomain>.workers.dev/en`
- Log in and check the fleet page loads

### 6. Update worker URLs

The new account will have a different `*.workers.dev` subdomain. Update:

- `packages/api/wrangler.toml` — `WEB_ORIGIN` var (CORS)
- `.github/workflows/deploy.yml` — `API_WORKER_URL` and `WEB_WORKER_URL` env vars
- Redeploy after updating these

### 7. Custom domain (optional)

If you set up a custom domain later (e.g. `api.kuruma.com`):

1. Add domain to new CF account
2. Add Workers routes in CF dashboard
3. Update `NEXT_PUBLIC_API_URL` build-time env in `deploy.yml`

### 8. Clean up old account

- Delete `kuruma-api` and `kuruma-rental` workers from personal CF dashboard
- Revoke the old API token

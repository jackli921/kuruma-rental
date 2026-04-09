# Cloudflare Workers Deployment Lessons — 2026-04-09

> Post-mortem of deploying Next.js 16 + Auth.js + Drizzle/Neon to Cloudflare Workers via @opennextjs/cloudflare.

## Problem Summary

Deploying the web package to Cloudflare Workers took 15+ iterations due to compounding issues that could have been caught with a single local dry-run. Each fix revealed the next layer of incompatibility.

---

## Lesson 1: Verify the deploy pipeline locally BEFORE pushing

**What happened:** We configured Cloudflare build settings by trial and error through the dashboard, wasting 6+ push-wait-read-logs cycles.

**Fix:** Always run the full pipeline locally first:
```bash
cd packages/web
bun run build              # Next.js build
bun run build:worker       # opennextjs-cloudflare → .open-next/worker.js
npx wrangler deploy --dry-run  # Verify wrangler can package it
```

If any step fails locally, it will fail on Cloudflare. Never push untested deploy config.

---

## Lesson 2: `process.env` works on CF Workers (with @opennextjs/cloudflare)

**What we assumed:** `process.env` is empty on CF Workers, requiring `getCloudflareContext().env`.

**What's actually true:** The debug endpoint proved that `process.env` HAS the secrets — @opennextjs/cloudflare bridges CF worker bindings to `process.env`. Both `process.env.DATABASE_URL` and `getCloudflareContext().env.DATABASE_URL` work.

**However:** `process.env` is NOT available at **module load time** during static generation. It's only populated during request handling. So `const db = getDb()` at module scope still fails at build time — the lazy singleton pattern is still correct.

**Correct pattern:**
```typescript
// WRONG: module scope (fails at build time)
const db = getDb()
export const { auth } = NextAuth({ adapter: DrizzleAdapter(db) })

// RIGHT: lazy singleton (initialized on first request)
let _auth: NextAuthResult | undefined
function getAuthResult() {
  if (!_auth) {
    _auth = NextAuth({ adapter: DrizzleAdapter(getDb()) })
  }
  return _auth
}
export function auth(...args) { return getAuthResult().auth(...args) }
```

---

## Lesson 3: Next.js 16 `proxy.ts` is incompatible with @opennextjs/cloudflare

**What happened:** We renamed `middleware.ts` → `proxy.ts` to follow Next.js 16's convention. The build failed with "Node.js middleware is not currently supported."

**Root cause:** Next.js 16's `proxy.ts` forces Node.js runtime. `@opennextjs/cloudflare` only supports Edge middleware. These are incompatible.

**Fix:** Stay on `middleware.ts` (Edge runtime by default). Accept the deprecation warning — it's cosmetic. Monitor @opennextjs/cloudflare for proxy support.

**Additionally:** Middleware must use edge-safe auth config (`auth.config.ts` with providers only), NOT the full `auth.ts` which imports Drizzle/postgres-js (Node.js only).

---

## Lesson 4: `opennextjs-cloudflare` CLI requires a subcommand

**What happened:** `opennextjs-cloudflare` (no args) prompted interactively for a command, which killed the CI build.

**Fix:** Always use `opennextjs-cloudflare build` explicitly. Updated in `package.json`:
```json
"build:worker": "opennextjs-cloudflare build"
```

---

## Lesson 5: `open-next.config.ts` must exist

**What happened:** The CLI prompted "Missing required open-next.config.ts file, do you want to create one?" — interactive prompt killed CI.

**Fix:** Create `packages/web/open-next.config.ts`:
```typescript
import { defineCloudflareConfig } from '@opennextjs/cloudflare'
export default defineCloudflareConfig({})
```

---

## Lesson 6: Monorepo build commands need explicit directory changes

**What happened:** Cloudflare runs build/deploy commands from the repo root. `wrangler deploy` couldn't find `.open-next/worker.js` because it was in `packages/web/`.

**Fix:**
- Build command: `bun install && cd packages/web && bun run build && bun run build:worker`
- Deploy command: `cd packages/web && npx wrangler deploy`
- Path: `/` (root — full repo must be available for Bun workspace resolution)

---

## Lesson 7: Skip TypeScript checking during `next build` on CF

**What happened:** The CF free tier build timed out — `next build` compiles (15s) + tsc (10s) + opennextjs-cloudflare exceeds the time limit.

**Fix:** Set `typescript.ignoreBuildErrors: true` in `next.config.ts`. TypeScript is checked locally and in CI via `tsc --noEmit` — no need to check again during `next build`.

---

## Lesson 8: CF dashboard secrets get wiped on redeploy

**What happened:** Env vars set in the CF dashboard disappeared after each deployment.

**Fix:** Set secrets via CLI — they persist server-side across deploys:
```bash
npx wrangler secret put DATABASE_URL -c packages/web/wrangler.jsonc
npx wrangler secret put AUTH_SECRET -c packages/web/wrangler.jsonc
npx wrangler secret put AUTH_GOOGLE_ID -c packages/web/wrangler.jsonc
npx wrangler secret put AUTH_GOOGLE_SECRET -c packages/web/wrangler.jsonc
```

---

## Lesson 9: Guard `session.user` — it can be undefined on CF Workers

**What happened:** `Cannot read properties of undefined (reading 'image')` — the Navbar, UserMenu, and MobileMenu all accessed `session.user.name` / `session.user.image` without null checks.

**Root cause:** On CF Workers, `auth()` can return a session object where `user` is undefined (e.g., expired JWT, misconfigured adapter).

**Fix:** Always use `session?.user` instead of `session` when checking auth state:
```typescript
// WRONG
if (session) { return <UserMenu session={session} /> }

// RIGHT
if (session?.user) { return <UserMenu session={session} /> }
```

---

## Lesson 10: Use a debug endpoint to diagnose CF Workers issues

**What happened:** Auth.js swallows errors and shows a generic "Server error" page. CF Workers logs were empty. We couldn't see what was failing.

**Fix:** Add a temporary `/api/debug/db` endpoint that:
1. Checks if CF context exists and lists available env keys
2. Checks if `DATABASE_URL` is accessible
3. Tries a simple DB query and returns the error

This immediately revealed the actual issue (Drizzle API mismatch) instead of guessing.

**Remove this endpoint before production.**

---

## Correct Final Architecture

```
Build time:
  next build → static generation
  - getDb() returns placeholder singleton (no real DB needed)
  - Auth.js module loads but doesn't initialize (lazy)

  opennextjs-cloudflare build → .open-next/worker.js
  - Bundles the Next.js output for CF Workers

Request time (CF Workers):
  - process.env has secrets (bridged by @opennextjs/cloudflare)
  - getDb() creates lazy singleton on first request
  - Auth.js initializes lazily on first auth call
  - Middleware uses edge-safe auth.config.ts (no DB imports)
  - Pages use full auth.ts (with DrizzleAdapter) for session checks
```

---

## Pre-Push Checklist (enforced by .githooks/pre-push)

```bash
bun run --filter @kuruma/web test      # 50 tests
cd packages/web && bun run build       # Next.js build
cd packages/web && bun run build:worker # CF worker bundle
```

All three must pass before `git push` is allowed.

---

*Created: 2026-04-09*

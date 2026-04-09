# Cloudflare Developer Guide

A plain-English guide for developers working on this project. Covers the gotchas, workarounds, and patterns we discovered deploying Next.js 16 + Auth.js + Drizzle/Neon to Cloudflare Workers.

If you're new to this codebase, read this before touching anything deployment-related.

---

## The Stack and Why It's Tricky

We run Next.js on Cloudflare Workers (not Vercel). This means our app runs on Cloudflare's Edge runtime, which is NOT Node.js. It looks like Node.js, smells like Node.js, but it's missing things like TCP sockets and filesystem access.

The bridge between Next.js and Cloudflare is `@opennextjs/cloudflare`. It converts Next.js output into a Cloudflare Worker. This works, but it has opinions about what's allowed.

**The core tension:** Most of the Node.js ecosystem assumes TCP sockets. Cloudflare Workers don't have them. Every library that opens a database connection, reads a file, or spawns a process needs a workaround.

---

## The Two Runtimes Problem

Your code runs in two completely different environments:

### 1. Build Time (Node.js)
When you run `next build`, it generates static pages. During this phase:
- Node.js is running (full access to everything)
- `process.env` may or may not have your secrets
- Next.js tries to import and evaluate your server components
- Any module-level code that calls `getDb()` or `NextAuth()` will run

### 2. Request Time (Cloudflare Workers / Edge)
When a user visits your site, their request hits a Cloudflare Worker:
- NOT Node.js — it's V8 isolates (like a browser's JS engine)
- `process.env` IS populated (thanks to `@opennextjs/cloudflare` bridging CF bindings)
- TCP sockets don't work — the `postgres` npm package fails here
- You need `@neondatabase/serverless` which uses HTTP/WebSocket instead

### The Rule
Never initialize database connections or auth at module scope. Always use lazy singletons that create the connection on first request:

```typescript
// WRONG: runs at build time, crashes
const db = getDb()

// RIGHT: runs only when a request needs it
let _db: ReturnType<typeof drizzle> | undefined
function getDb() {
  if (!_db) {
    _db = drizzle(/* ... */)
  }
  return _db
}
```

---

## Middleware vs Proxy (Next.js 16)

Next.js 16 renamed `middleware.ts` to `proxy.ts`. Don't follow this yet.

**Why:** `proxy.ts` forces Node.js runtime. `@opennextjs/cloudflare` only supports Edge middleware. They're incompatible. If you rename to `proxy.ts`, the Cloudflare build fails with "Node.js middleware is not currently supported."

**What to do:** Keep using `middleware.ts`. Ignore the deprecation warning. It's cosmetic and everything works fine.

---

## The Auth Split: Two Config Files

Auth.js has two config files in this project, and understanding why is critical:

### `auth.config.ts` — Edge-safe, used by middleware
- Contains: providers (Google, Apple) + JWT/session callbacks
- Does NOT import: Drizzle, postgres, or any Node.js-only package
- Used by: middleware (which runs on Edge)

### `auth.ts` — Full config, used by pages and server actions
- Contains: everything in `auth.config.ts` PLUS DrizzleAdapter, DB role re-fetching
- Imports: Drizzle, postgres-js (Node.js only)
- Used by: server components, API routes, server actions

### Why two files?
Middleware runs on Edge. If `middleware.ts` imports `auth.ts`, which imports Drizzle, which imports `postgres`, the Cloudflare build fails. The edge-safe config gives middleware enough to check auth without touching the database.

### The gotcha that bit us
The edge config originally had no callbacks. So `session.user.role` was always `undefined` in middleware. The business route check (`if (!role || !BUSINESS_ROLES.has(role))`) redirected every admin user back to the homepage.

**Rule:** Any field that middleware needs to read from `session.user` (like `role`) must have callbacks in BOTH config files. The edge config reads from the JWT token (no DB). The full config adds DB re-fetching on top.

---

## Database: postgres-js vs @neondatabase/serverless

### The problem
`postgres` (the npm package) uses TCP sockets. Cloudflare Workers don't support TCP sockets (even with `nodejs_compat` flag). The worker crashes with Error 1101.

### The solution
Use `@neondatabase/serverless` instead. It connects to Neon Postgres over HTTP/WebSocket, which works on Edge.

```typescript
// WRONG: TCP sockets, crashes on CF Workers
import postgres from 'postgres'
const client = postgres(url)

// RIGHT: HTTP-based, works on Edge
import { neon } from '@neondatabase/serverless'
const sql = neon(url)
```

### Current state
The `packages/shared/src/db/index.ts` has been updated to use `@neondatabase/serverless`. This works both locally (dev) and on Cloudflare Workers (production).

---

## Environment Variables and Secrets

### Local development
- `.env` file lives at the repo root
- Next.js reads `.env` from its package directory, NOT the repo root
- We symlink it: `packages/web/.env` -> `../../.env`
- Required vars: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`

### Cloudflare Workers
- Set secrets via CLI (they persist across deploys):
  ```bash
  npx wrangler secret put DATABASE_URL -c packages/web/wrangler.jsonc
  npx wrangler secret put AUTH_SECRET -c packages/web/wrangler.jsonc
  npx wrangler secret put AUTH_GOOGLE_ID -c packages/web/wrangler.jsonc
  npx wrangler secret put AUTH_GOOGLE_SECRET -c packages/web/wrangler.jsonc
  ```
- DO NOT use the Cloudflare dashboard for secrets — they get wiped on redeploy
- `process.env` works at request time thanks to `@opennextjs/cloudflare` bridging

---

## Build Pipeline

The build has three steps, and all must pass locally before pushing:

```bash
# 1. Run tests
bun run --filter @kuruma/web test

# 2. Build Next.js
cd packages/web && bun run build

# 3. Bundle for Cloudflare Workers
cd packages/web && bun run build:worker
```

### Things that will break the build
- Importing Node.js-only packages in middleware or Edge routes
- Missing `open-next.config.ts` in `packages/web/`
- Running `opennextjs-cloudflare` without the `build` subcommand (it prompts interactively)
- TypeScript errors (unless `typescript.ignoreBuildErrors: true` is set in `next.config.ts`)

### Cloudflare deploy commands
```
Build command: bun install && cd packages/web && bun run build && bun run build:worker
Deploy command: cd packages/web && npx wrangler deploy
Root directory: / (full repo needed for Bun workspace resolution)
```

---

## Common Errors and What They Mean

| Error | Cause | Fix |
|-------|-------|-----|
| Error 1101: Worker threw exception | Node.js-only code running on Edge (usually `postgres` TCP) | Use `@neondatabase/serverless` |
| `middleware is deprecated` warning | Next.js 16 wants `proxy.ts` | Ignore it. Keep `middleware.ts` |
| `Cannot read properties of undefined (reading 'image')` | `session.user` is undefined on CF Workers | Use `session?.user` everywhere |
| Auth redirect loop to `/en` | Middleware can't read `session.user.role` | Add JWT/session callbacks to `auth.config.ts` |
| `DATABASE_URL is not set` at build time | `getDb()` called at module scope | Use lazy singleton pattern |
| Secrets disappear after deploy | Set via CF dashboard instead of CLI | Use `wrangler secret put` |
| Build hangs / prompts interactively | Missing `open-next.config.ts` or build subcommand | Create the config file, use `opennextjs-cloudflare build` |

---

## Debugging on Cloudflare

Cloudflare Workers logs are minimal. Auth.js swallows errors. When something breaks in production:

1. Add a `/api/debug/db` endpoint that tests DB connectivity and env var access
2. Deploy it, check the response
3. Remove it after debugging

The debug endpoint should check:
- Are CF bindings available?
- Is `DATABASE_URL` set?
- Can we run a simple query (`SELECT 1`)?
- What error does the DB connection throw?

This is faster than reading CF dashboard logs, which often show nothing useful.

---

## Summary: The Mental Model

Think of it as three layers:

```
Layer 1: Build Time (Node.js)
  - Static page generation
  - No DB connections (lazy singletons)
  - No secrets in process.env

Layer 2: Edge Middleware (Cloudflare Workers)
  - Route protection, i18n, redirects
  - No DB access (edge-safe auth only)
  - JWT token has role (set at login time)

Layer 3: Server Components (Cloudflare Workers)  
  - Full DB access via @neondatabase/serverless
  - Full Auth.js with DrizzleAdapter
  - Lazy singleton initialization
```

If your code works locally but breaks on Cloudflare, ask: "Which layer is this running in, and what does that layer NOT have access to?"

---

*Based on 15+ deployment iterations and fixes. See `docs/plans/2026-04-09-cloudflare-deployment-lessons.md` for the detailed post-mortem and `docs/2026-04-08-lessons-learned.md` for the full issue log.*

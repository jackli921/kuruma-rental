// Serves the real Hono API (Drizzle repos against the e2e Neon branch) for the
// authenticated real-DB Playwright track. Mirrors how the integration suite
// runs `createApp()` against real Postgres — no `wrangler dev`, fast boot.
//
// `createApp()` with no overrides + `DATABASE_URL` set routes to the Drizzle
// branch (packages/api/src/index.ts), so the service/repo tenant-scoping layer
// (#395/#402) is exercised for real. AUTH_SECRET verifies the web's HS256 token.
import { createApp } from '../../packages/api/src/index'

const port = Number(process.env.REAL_API_PORT ?? 8788)
const app = createApp()

Bun.serve({ port, fetch: app.fetch })
console.log(`[e2e] real API listening on http://localhost:${port}`)

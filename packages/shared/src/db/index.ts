import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

function getDatabaseUrl(): string {
  // On Cloudflare Workers, process.env doesn't carry runtime secrets.
  // Try getCloudflareContext().env first (request-time only), fall back to process.env.
  try {
    // Dynamic import avoids bundling issues when not on CF Workers
    // biome-ignore lint/suspicious/noExplicitAny: CF context type varies by environment
    const { getCloudflareContext } = require('@opennextjs/cloudflare') as any
    const ctx = getCloudflareContext()
    if (ctx?.env?.DATABASE_URL) {
      return ctx.env.DATABASE_URL as string
    }
  } catch {
    // Not on CF Workers, or outside request context -- fall back to process.env
  }

  const url = process.env.DATABASE_URL
  if (url) return url

  // Build-time placeholder: postgres-js only connects on first query,
  // so this is safe during Next.js static generation.
  return 'postgresql://placeholder:5432/placeholder'
}

// Per-request DB instance on CF Workers (no global singleton).
// On local dev, the singleton is reused across requests.
let localDb: ReturnType<typeof drizzle> | undefined

export function getDb(): ReturnType<typeof drizzle> {
  const url = getDatabaseUrl()

  // Local dev: reuse singleton
  if (process.env.DATABASE_URL) {
    if (localDb) return localDb
    const client = postgres(url, { prepare: false })
    localDb = drizzle(client, { schema })
    return localDb
  }

  // CF Workers: create per-request (connection pooled by Hyperdrive or postgres-js)
  const client = postgres(url, { prepare: false })
  return drizzle(client, { schema })
}

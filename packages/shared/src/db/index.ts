import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

let db: ReturnType<typeof drizzle> | undefined

function getDatabaseUrl(): string {
  // CF Workers: process.env doesn't carry runtime secrets.
  // Use getCloudflareContext().env (only available during request handling).
  try {
    // biome-ignore lint/suspicious/noExplicitAny: CF context type varies by environment
    const { getCloudflareContext } = require('@opennextjs/cloudflare') as any
    const url = getCloudflareContext()?.env?.DATABASE_URL as string | undefined
    if (url) return url
  } catch {
    // Not on CF Workers or outside request context
  }

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  // Build-time placeholder: postgres-js only connects on first query
  return 'postgresql://placeholder:5432/placeholder'
}

// Lazy singleton. Do NOT call at module scope -- CF Workers context
// is only available during request handling.
export function getDb(): ReturnType<typeof drizzle> {
  if (db) return db

  const client = postgres(getDatabaseUrl(), { prepare: false })
  db = drizzle(client, { schema })
  return db
}

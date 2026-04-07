import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

/**
 * Returns a per-request Drizzle instance.
 * In serverless (Cloudflare Workers), each request gets its own connection.
 * No global singleton — avoids stale connections across isolate reuse.
 */
export function getDb(connectionString?: string): ReturnType<typeof drizzle> {
  const url = connectionString ?? process.env.DATABASE_URL

  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }

  const client = postgres(url, { prepare: false })
  return drizzle(client, { schema })
}

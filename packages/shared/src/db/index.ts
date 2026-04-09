import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

let db: ReturnType<typeof drizzle> | undefined

// Accepts an optional URL for CF Workers where process.env is empty.
// Caller is responsible for resolving the URL from getCloudflareContext().
export function getDb(url?: string): ReturnType<typeof drizzle> {
  if (db) return db

  const connectionUrl =
    url ??
    process.env.DATABASE_URL ??
    'postgresql://placeholder:5432/placeholder'

  const client = postgres(connectionUrl, { prepare: false })
  db = drizzle(client, { schema })
  return db
}

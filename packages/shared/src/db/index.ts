import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

let db: ReturnType<typeof drizzle> | undefined

export function getDb(): ReturnType<typeof drizzle> {
  if (db) return db

  // postgres-js only connects on first query, not at instantiation.
  // Use a placeholder at build time so Next.js static generation can
  // import auth.ts without a real DATABASE_URL. Any actual query will
  // fail at runtime if the URL is missing — which is the correct behavior.
  const url = process.env.DATABASE_URL ?? 'postgresql://placeholder:5432/placeholder'

  const client = postgres(url, { prepare: false })
  db = drizzle(client, { schema })
  return db
}

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import * as schema from './schema'

type NeonHttpDb = ReturnType<typeof drizzle>

let db: NeonHttpDb | undefined
let cachedUrl: string | undefined

// Lazy singleton. Accepts optional URL for CF Workers where process.env
// may not carry secrets at module scope. Caller resolves the URL.
export function getDb(url?: string): NeonHttpDb {
  const connectionUrl =
    url ?? process.env.DATABASE_URL ?? 'postgresql://placeholder:5432/placeholder'

  // Reuse singleton if URL hasn't changed
  if (db && cachedUrl === connectionUrl) return db

  const client = neon(connectionUrl)
  db = drizzle({ client, schema })
  cachedUrl = connectionUrl
  return db
}

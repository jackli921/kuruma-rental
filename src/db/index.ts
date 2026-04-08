import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

let db: ReturnType<typeof drizzle> | undefined

export function getDb(): ReturnType<typeof drizzle> {
  if (db) return db

  const url = process.env.DATABASE_URL

  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }

  const client = postgres(url, { prepare: false })
  db = drizzle(client, { schema })
  return db
}

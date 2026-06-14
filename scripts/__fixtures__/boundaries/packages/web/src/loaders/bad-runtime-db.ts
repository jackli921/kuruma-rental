// #722 VIOLATION fixture: a web file reaching the DB at runtime bypasses the Hono API.
import { getDb } from '@/lib/db'
import { users } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'

export function leak(id: string) {
  return getDb().select().from(users).where(eq(users.id, id))
}

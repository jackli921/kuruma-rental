// #722 carve-out fixture: mirrors the real packages/web/src/auth.ts — the sanctioned
// Auth.js DB toucher, exempt from the web no-runtime-DB rule.
import { getDb } from '@/lib/db'
import { users } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'

export const lookup = (id: string) => getDb().select().from(users).where(eq(users.id, id))

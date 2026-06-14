// #722 carve-out fixture: mirrors packages/web/src/lib/db.ts — the Drizzle client factory.
import { getDb as getDbBase } from '@kuruma/shared/db'

export const getDb = getDbBase

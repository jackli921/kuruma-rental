// #722 carve-out: the web package's sanctioned Drizzle client factory for Auth.js.
// lint-module-boundaries exempts lib/db.ts from the "web has no direct DB access"
// rule — do not import getDb() elsewhere in web; route through the Hono API.
import { getDb as getDbBase } from '@kuruma/shared/db'

// Resolves DATABASE_URL from CF Workers context or process.env.
// Must be called during request handling, not at module scope.
export function getDb() {
  let url: string | undefined

  // On CF Workers, env is stored in global scope via Symbol by @opennextjs/cloudflare.
  // This avoids import/require issues with the CF package.
  try {
    const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] as
      | { env?: { DATABASE_URL?: string } }
      | undefined
    url = ctx?.env?.DATABASE_URL
  } catch {
    // Not on CF Workers
  }

  return getDbBase(url)
}

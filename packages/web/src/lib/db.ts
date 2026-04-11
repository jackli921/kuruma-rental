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

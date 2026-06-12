import postgres from 'postgres'
import { pgConnectOptions } from './pg-connect-options'

/**
 * A short-lived postgres-js client for the e2e DB, built from DATABASE_URL's
 * parts (see `pgConnectOptions`) so libpq-only params don't reach postgres-js
 * and TLS is required for remote hosts but off for a localhost container. Caller
 * must `await sql.end()`.
 */
export function testSql(): postgres.Sql {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required for the real-DB e2e track')
  return postgres({ ...pgConnectOptions(url), max: 1 })
}

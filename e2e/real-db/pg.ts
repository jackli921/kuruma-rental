import postgres from 'postgres'

/**
 * A short-lived postgres-js client for the e2e Neon branch, built from
 * DATABASE_URL's parts so libpq-only params (e.g. `channel_binding`) don't reach
 * postgres-js. ssl is forced to `require` (TLS, but not `verify-full`) — fine
 * for a disposable test branch; do not copy this into app code that needs full
 * certificate verification. Caller must `await sql.end()`.
 */
export function testSql(): postgres.Sql {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required for the real-DB e2e track')
  const u = new URL(url)
  return postgres({
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: u.pathname.replace(/^\//, ''),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: 'require',
    max: 1,
  })
}

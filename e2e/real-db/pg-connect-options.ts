/**
 * postgres-js connection options parsed from a Postgres connection URL.
 * Built from URL *parts* (not the raw string) so libpq-only query params such as
 * `channel_binding` never reach postgres-js, which doesn't understand them.
 */
export interface PgConnectOptions {
  host: string
  port: number
  database: string
  username: string
  password: string
  /** TLS for remote hosts; off for a localhost container (it speaks plaintext). */
  ssl: 'require' | false
}

// A GitHub `postgres:16` service container listens on localhost without TLS, so
// `ssl: 'require'` would refuse the connection. Neon (and any remote host) keeps
// TLS. `verify-full` is intentionally not used — fine for a disposable test DB.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function pgConnectOptions(url: string): PgConnectOptions {
  const u = new URL(url)
  const host = u.hostname
  return {
    host,
    port: u.port ? Number(u.port) : 5432,
    database: u.pathname.replace(/^\//, ''),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: LOCAL_HOSTS.has(host) ? false : 'require',
  }
}

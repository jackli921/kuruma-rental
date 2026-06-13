import { $ } from 'bun'

/**
 * One-shot local real-DB e2e (#542): boots a disposable `postgres:16`, applies
 * every migration, seeds the marketplace fixture over TCP, and runs the
 * authenticated happy-path lane — with NO Neon branch.
 *
 * The seed goes through `db:seed:tcp` (postgres-js), not the production
 * neon-http `getDb()`, which can't reach a plain local container. This mirrors
 * the CI `e2e-real-db` job exactly, but manages the throwaway DB for you.
 *
 *   bun run test:e2e:real-db:local                    # full run
 *   E2E_PG_PORT=5455 bun run test:e2e:real-db:local   # override port on collision
 *   docker rm -f kuruma-e2e-pg                         # tear down when done
 *
 * The container is recreated each run so the DB is pristine (matching CI); it is
 * left running afterwards so you can inspect it or re-run the Playwright UI.
 */
const PORT = process.env.E2E_PG_PORT ?? '5433'
const CONTAINER = process.env.E2E_PG_CONTAINER ?? 'kuruma-e2e-pg'
const HEALTH_TIMEOUT_S = 30

const env = {
  ...process.env,
  DATABASE_URL: `postgresql://kuruma:kuruma@localhost:${PORT}/kuruma_e2e`,
  // Any 32+ char string: the harness mints the session cookie and the API
  // verifies it with the SAME value. Not a secret — the DB is local + disposable.
  AUTH_SECRET: process.env.AUTH_SECRET ?? 'local-real-db-e2e-static-secret-0123456789',
}

console.log(`[e2e] (re)creating disposable postgres:16 (${CONTAINER}) on :${PORT}`)
await $`docker rm -f ${CONTAINER}`.nothrow().quiet()
await $`docker run -d --name ${CONTAINER} -e POSTGRES_USER=kuruma -e POSTGRES_PASSWORD=kuruma -e POSTGRES_DB=kuruma_e2e -p ${PORT}:5432 postgres:16`.quiet()

console.log('[e2e] waiting for postgres to accept connections...')
for (let attempt = 1; ; attempt++) {
  // Probe over TCP (-h), not the default unix socket: postgres:16 runs a
  // temporary socket-only init server during bootstrap that answers pg_isready
  // before the real TCP server is up. A socket probe races migrate (which
  // connects over TCP) and intermittently loses; a TCP probe only passes once
  // the real server accepts connections.
  const ready = await $`docker exec ${CONTAINER} pg_isready -h 127.0.0.1 -U kuruma -d kuruma_e2e`
    .nothrow()
    .quiet()
  if (ready.exitCode === 0) break
  if (attempt > HEALTH_TIMEOUT_S) throw new Error(`postgres not ready after ${HEALTH_TIMEOUT_S}s`)
  await Bun.sleep(1000)
}

console.log('[e2e] applying migrations + seeding marketplace fixture (TCP)')
await $`bun run db:migrate`.env(env)
await $`bun run db:seed:tcp`.env(env)

console.log('[e2e] running authenticated real-DB lane')
await $`bun run test:e2e:real-db`.env(env)

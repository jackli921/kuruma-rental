import { $ } from 'bun'

/**
 * One-shot local run of the neon-serverless transaction lane (#493/#496):
 * boots a disposable `postgres:16` + local Neon proxy via the SAME compose file
 * CI uses, applies migrations, and runs the lane through the proxy — with NO
 * Neon branch and no secrets.
 *
 * The proxy serves the production driver's /sql (neon-http reads) and /v2
 * (neon-serverless transactions) endpoints, so `runTx` is exercised exactly as
 * in production. The localhost host in NEON_TEST_DATABASE_URL flips the test's
 * neonConfig into local-proxy mode (see interactive-tx.test.ts).
 *
 *   bun run test:neon:local
 *
 * The stack is torn down on exit (even on failure).
 */
const COMPOSE = 'packages/api/tests/neon/docker-compose.ci.yml'
// Default to non-standard ports so a busy local 5432/4444 doesn't break the run;
// override with NEON_PG_PORT / NEON_PROXY_PORT. CI uses the 5432/4444 defaults.
const PG_PORT = process.env.NEON_PG_PORT ?? '5455'
const PROXY_PORT = process.env.NEON_PROXY_PORT ?? '4455'
const URL = `postgres://kuruma:kuruma@localhost:${PG_PORT}/kuruma_neon`
const PROXY_TIMEOUT_S = 60

const env = {
  ...process.env,
  NEON_PG_PORT: PG_PORT,
  NEON_PROXY_PORT: PROXY_PORT,
  DATABASE_URL: URL,
  NEON_TEST_DATABASE_URL: URL,
}

console.log(`[neon] starting local postgres (:${PG_PORT}) + Neon proxy (:${PROXY_PORT})`)
await $`docker compose -f ${COMPOSE} up -d --wait`.env(env)

console.log(`[neon] waiting for the proxy on :${PROXY_PORT}`)
for (let attempt = 1; ; attempt++) {
  const up = await fetch(`http://localhost:${PROXY_PORT}/sql`, { method: 'POST' })
    .then(() => true)
    .catch(() => false)
  if (up) break
  if (attempt > PROXY_TIMEOUT_S) {
    await $`docker compose -f ${COMPOSE} logs`.env(env).nothrow()
    await $`docker compose -f ${COMPOSE} down -v`.env(env).nothrow()
    throw new Error(`proxy not reachable on :${PROXY_PORT} after ${PROXY_TIMEOUT_S}s`)
  }
  await Bun.sleep(1000)
}

try {
  console.log('[neon] applying migrations')
  await $`bun run db:migrate`.env(env)

  console.log('[neon] running the neon-serverless tx lane via the local proxy')
  await $`bun run --filter @kuruma/api test:neon`.env(env)
} finally {
  console.log('[neon] tearing down the stack')
  await $`docker compose -f ${COMPOSE} down -v`.env(env).nothrow()
}

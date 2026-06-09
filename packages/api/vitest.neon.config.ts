import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Separate lane for tests that must run against a REAL Neon branch over the
// @neondatabase/serverless (HTTP/WebSocket) driver — the production wiring.
// These cannot use the docker-Postgres integration lane: the serverless driver
// speaks Neon's protocol and will not connect to a local Postgres (#493).
//
// The test self-skips unless NEON_TEST_DATABASE_URL points at a NON-PROD Neon
// branch. Kept out of the unit lane (vitest.config.ts excludes tests/neon) and
// the integration lane (which only globs tests/integration).
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/neon/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@kuruma/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})

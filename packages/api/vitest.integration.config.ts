import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@kuruma/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})

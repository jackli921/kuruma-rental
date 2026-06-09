import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    exclude: ['tests/integration/**', 'tests/neon/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@kuruma/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})

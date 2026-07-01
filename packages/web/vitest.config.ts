import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Auto-restore every `vi.stubEnv` before each test so a feature-flag stub set
    // by a helper (e.g. renderWithUsdIndicative) or a beforeEach can never bleed
    // into a later test in the same file. One guarantee for the whole suite, so no
    // render helper has to own a paired teardown (#1070 review follow-up).
    unstubEnvs: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@kuruma/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})

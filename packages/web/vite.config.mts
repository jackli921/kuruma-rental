import path from 'node:path'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite + TanStack Router shell for CF Pages (#378, slice 0 phase 5).
// Coexists with the frozen Next.js app until DNS cutover (spec §7.5):
// `vite build` is the Pages primary; `build:worker` still emits the Next Worker.
export default defineConfig({
  base: '/',
  plugins: [
    // Router codegen must run before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
  ],
  // Copies messages/* and static assets into dist/ (spec §6.3, §7.1).
  publicDir: 'public',
  build: { outDir: 'dist' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@kuruma/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})

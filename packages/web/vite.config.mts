import { cpSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig } from 'vite'

const MESSAGES_DIR = path.resolve(__dirname, 'messages')

// In production the CF Pages Functions proxy /api + /auth to the Hono API so the
// session cookie stays same-origin (spec §5.5). The Vite dev server has no such
// Function, so it proxies the same way — defaulting to the local `wrangler dev`
// port, overridable (the E2E mock API points it at its own port via env).
const DEV_API_PROXY = process.env.VITE_DEV_API_PROXY ?? 'http://localhost:8787'

// Serve `messages/<locale>.json` at /messages/* in dev and copy the dir into the
// build (spec §6.3). Keeps `messages/` the single source — the frozen Next app
// still imports it via next-intl — instead of duplicating into public/.
function messagesPlugin(): Plugin {
  return {
    name: 'kuruma-messages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/messages\/([a-z]{2})\.json(?:\?.*)?$/)
        const file = match ? path.join(MESSAGES_DIR, `${match[1]}.json`) : null
        if (!file || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/json')
        res.end(readFileSync(file))
      })
    },
    writeBundle(options) {
      cpSync(MESSAGES_DIR, path.join(options.dir ?? 'dist', 'messages'), { recursive: true })
    },
  }
}

// Vite + TanStack Router shell for CF Pages (#378, slice 0 phase 5).
// Coexists with the frozen Next.js app until DNS cutover (spec §7.5):
// `vite build` is the Pages primary; `build:worker` still emits the Next Worker.
export default defineConfig({
  base: '/',
  plugins: [
    // Router codegen must run before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    // Tailwind v4 — processes `@import "tailwindcss"` in app/globals.css, which
    // main.tsx imports. Without this the Vite shell ships unstyled (#510).
    tailwindcss(),
    messagesPlugin(),
  ],
  publicDir: 'public',
  build: { outDir: 'dist' },
  // Dev-only (ignored by `vite build`). `/api/*` is stripped (the Hono API has no
  // /api prefix); `/auth/*` is forwarded verbatim — matching the Pages Functions.
  server: {
    port: 3001,
    strictPort: true,
    proxy: {
      '/api': {
        target: DEV_API_PROXY,
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api/, ''),
      },
      '/auth': { target: DEV_API_PROXY, changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@kuruma/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})

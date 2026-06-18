import { cpSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { type Plugin, type PluginOption, defineConfig } from 'vite'

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

// Sentry source-map upload (#361). Gated on the build-time auth token + org +
// project so dormant builds are a TRUE no-op: with any missing, NO source maps
// are emitted (byte-identical output) and the plugin is skipped. SENTRY_AUTH_TOKEN
// is a real secret and must NEVER be a VITE_* var — it must not reach the bundle.
const uploadSourcemaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
)

// When active, maps are emitted 'hidden' (not referenced by the shipped JS),
// uploaded to Sentry keyed to the same release as the runtime client
// (VITE_SENTRY_RELEASE), then deleted so they never ship in the Pages artifact.
function sentrySourcemapPlugin(): PluginOption {
  const authToken = process.env.SENTRY_AUTH_TOKEN
  const org = process.env.SENTRY_ORG
  const project = process.env.SENTRY_PROJECT
  if (!authToken || !org || !project) return null
  const release = process.env.VITE_SENTRY_RELEASE
  return sentryVitePlugin({
    authToken,
    org,
    project,
    ...(release ? { release: { name: release } } : {}),
    // Absolute glob anchored to THIS config dir, not process.cwd(): the plugin
    // resolves filesToDeleteAfterUpload against cwd, so a root-level
    // `bun run --filter @kuruma/web build` would resolve './dist' to the repo
    // root, match nothing, and silently leave maps in packages/web/dist.
    sourcemaps: { filesToDeleteAfterUpload: [path.resolve(__dirname, 'dist/**/*.map')] },
    // Non-fatal upload failures. The API Worker deploys earlier in the pipeline,
    // so a hard throw here would strand a half-deploy (new API, stale web). A
    // transient flake (bad token, network, quota) degrades to "this release isn't
    // symbolicated" instead of breaking the web deploy. Verified: even on a failed
    // upload the plugin still deletes the maps (0 .map left in dist), so a flake
    // never leaks maps into the Pages artifact nor trips the size budget.
    errorHandler: (err: Error) => {
      console.warn('[sentry-vite-plugin] source-map upload failed (non-fatal):', err.message)
    },
  })
}

// Vite + TanStack Router shell for CF Pages (#378, slice 0 phase 5).
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
    // Must be last so it sees the final emitted bundle + maps (Sentry docs).
    // No-op unless SENTRY_AUTH_TOKEN/ORG/PROJECT are all set.
    sentrySourcemapPlugin(),
  ],
  publicDir: 'public',
  // 'hidden' only when uploading: emit maps for Sentry but don't reference them
  // from the shipped JS; the plugin deletes them post-upload. Off otherwise so
  // the default Pages build is unchanged.
  build: { outDir: 'dist', sourcemap: uploadSourcemaps ? 'hidden' : false },
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

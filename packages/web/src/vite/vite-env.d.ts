/// <reference types="vite/client" />

// Typed access to the client env baked in at build time (spec §7.3). Only the
// Vite app sees this (frozen tsconfig.json excludes src/vite/**), so the Next
// app keeps process.env.* typing.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  // Browser Sentry (#765). DSN absent → instrumentation is a no-op. Release is
  // injected by CI at build time; environment defaults to 'production'.
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

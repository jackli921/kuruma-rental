/// <reference types="vite/client" />

// Typed access to the client env baked in at build time (spec §7.3). Only the
// Vite app sees this (frozen tsconfig.json excludes src/vite/**), so the Next
// app keeps process.env.* typing.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  // Build-time gate for the premium interactive search map (#885). Unset/anything
  // but 'true' → map OFF (beta ships a pure store list). See vite/search/flags.ts.
  readonly VITE_SEARCH_MAP_ENABLED?: string
  // Build-time gates for post-MVP features billed as add-ons. Unset/anything but
  // 'true' → OFF (the beta demo ships canonical MVP only). See vite/config/features.ts.
  readonly VITE_FEATURE_CANCELLATION?: string
  readonly VITE_FEATURE_OPERATOR_MANUAL_BOOKING?: string
  readonly VITE_FEATURE_OPERATOR_TEAM?: string
  readonly VITE_FEATURE_OPERATOR_SETTINGS?: string
  // Browser Sentry (#765). DSN absent → instrumentation is a no-op. Release is
  // injected by CI at build time; environment defaults to 'production'.
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

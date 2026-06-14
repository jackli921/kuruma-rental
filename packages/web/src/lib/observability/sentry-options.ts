/**
 * Resolves browser Sentry init options from the Vite env (#765, web slice of
 * #361). Pure so gating + release-tag derivation are testable without a live
 * Sentry client. Mirrors the API's `observability/sentry-options.ts`.
 *
 * Gating: with no `VITE_SENTRY_DSN` the SDK is `enabled: false`, so local dev,
 * CI, and any build without the public DSN send nothing — the instrumentation
 * is a no-op until the DSN is provisioned (HITL).
 */

export interface BrowserSentryEnv {
  VITE_SENTRY_DSN?: string
  VITE_SENTRY_ENVIRONMENT?: string
  /** CI injects the deploy version id so errors group per release (#361 AC). */
  VITE_SENTRY_RELEASE?: string
}

export interface ResolvedSentryOptions {
  dsn: string | undefined
  enabled: boolean
  environment: string
  release: string | undefined
  tracesSampleRate: number
  sendDefaultPii: false
}

export function resolveBrowserSentryOptions(
  env: BrowserSentryEnv | undefined,
): ResolvedSentryOptions {
  // `|| undefined`, not `??`: a blank/whitespace-only value trims to '' and must
  // gate off — `??` would keep the empty string and wrongly enable Sentry.
  const dsn = env?.VITE_SENTRY_DSN?.trim() || undefined
  const release = env?.VITE_SENTRY_RELEASE?.trim() || undefined
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: env?.VITE_SENTRY_ENVIRONMENT?.trim() || 'production',
    release,
    // Out of scope (#361): full APM / trace waterfalls.
    tracesSampleRate: 0,
    // Out of scope (#361): PII scrubbing pipeline. Keep Sentry from attaching
    // request bodies / headers by default; revisit at scale.
    sendDefaultPii: false,
  }
}

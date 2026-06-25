/**
 * Resolves Sentry init options from the Worker env (#361). Pure so gating +
 * release-tag derivation are testable without a live Sentry client.
 *
 * Gating: with no `SENTRY_DSN` the SDK is `enabled: false`, so local dev, CI,
 * and any deploy without the secret send nothing — the instrumentation is a
 * no-op until the DSN secret is provisioned (HITL).
 */

export interface SentryRuntimeEnv {
  SENTRY_DSN?: string
  SENTRY_ENVIRONMENT?: string
  /**
   * Explicit release tag, injected as a Worker `--var` at deploy time = the
   * commit SHA (#959). Preferred over `CF_VERSION_METADATA.id` because the SHA
   * is known *before* deploy, so the uploaded source maps can be keyed to the
   * same release the runtime reports (Sentry requires the two to match).
   */
  SENTRY_RELEASE?: string
  /**
   * CF `[version_metadata]` binding — the deployed version id. Fallback release
   * tag when `SENTRY_RELEASE` is absent (e.g. a deploy that didn't set the var).
   */
  CF_VERSION_METADATA?: { id?: string; tag?: string }
}

export interface ResolvedSentryOptions {
  dsn: string | undefined
  enabled: boolean
  environment: string
  release: string | undefined
  tracesSampleRate: number
  sendDefaultPii: false
}

export function resolveSentryOptions(env: SentryRuntimeEnv | undefined): ResolvedSentryOptions {
  const dsn = env?.SENTRY_DSN?.trim() || undefined
  const release = env?.SENTRY_RELEASE?.trim() || env?.CF_VERSION_METADATA?.id?.trim() || undefined
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: env?.SENTRY_ENVIRONMENT?.trim() || 'production',
    release,
    // Out of scope (#361): full APM / trace waterfalls.
    tracesSampleRate: 0,
    // Out of scope (#361): PII scrubbing pipeline. Keep Sentry from attaching
    // request bodies / headers by default; revisit at scale.
    sendDefaultPii: false,
  }
}

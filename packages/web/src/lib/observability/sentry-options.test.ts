import { describe, expect, it } from 'vitest'
import { resolveBrowserSentryOptions } from './sentry-options'

describe('resolveBrowserSentryOptions', () => {
  it('is disabled with no dsn when env is undefined (local dev / tests)', () => {
    const opts = resolveBrowserSentryOptions(undefined)
    expect(opts.enabled).toBe(false)
    expect(opts.dsn).toBeUndefined()
    expect(opts.environment).toBe('production')
    expect(opts.release).toBeUndefined()
  })

  it('enables and carries the dsn when VITE_SENTRY_DSN is set', () => {
    const opts = resolveBrowserSentryOptions({
      VITE_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42',
    })
    expect(opts.enabled).toBe(true)
    expect(opts.dsn).toBe('https://abc@o1.ingest.sentry.io/42')
  })

  it('treats a blank/whitespace dsn as unset (gated off)', () => {
    const opts = resolveBrowserSentryOptions({ VITE_SENTRY_DSN: '   ' })
    expect(opts.enabled).toBe(false)
    expect(opts.dsn).toBeUndefined()
  })

  it('derives the release from VITE_SENTRY_RELEASE (CI injects the deploy version)', () => {
    const opts = resolveBrowserSentryOptions({
      VITE_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42',
      VITE_SENTRY_RELEASE: 'deadbeef-version-id',
    })
    expect(opts.release).toBe('deadbeef-version-id')
  })

  it('honours an explicit VITE_SENTRY_ENVIRONMENT override', () => {
    const opts = resolveBrowserSentryOptions({
      VITE_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42',
      VITE_SENTRY_ENVIRONMENT: 'staging',
    })
    expect(opts.environment).toBe('staging')
  })

  it('keeps PII off and tracing disabled (out of scope for this slice)', () => {
    const opts = resolveBrowserSentryOptions({
      VITE_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42',
    })
    expect(opts.sendDefaultPii).toBe(false)
    expect(opts.tracesSampleRate).toBe(0)
  })
})

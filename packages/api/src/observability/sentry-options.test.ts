import { describe, expect, it } from 'vitest'
import { resolveSentryOptions } from './sentry-options'

describe('resolveSentryOptions', () => {
  it('is disabled with no dsn when env is undefined (local dev / tests)', () => {
    const opts = resolveSentryOptions(undefined)
    expect(opts.enabled).toBe(false)
    expect(opts.dsn).toBeUndefined()
    expect(opts.environment).toBe('production')
    expect(opts.release).toBeUndefined()
  })

  it('enables and carries the dsn when SENTRY_DSN is set', () => {
    const opts = resolveSentryOptions({ SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42' })
    expect(opts.enabled).toBe(true)
    expect(opts.dsn).toBe('https://abc@o1.ingest.sentry.io/42')
  })

  it('treats a blank/whitespace dsn as unset (gated off)', () => {
    const opts = resolveSentryOptions({ SENTRY_DSN: '   ' })
    expect(opts.enabled).toBe(false)
    expect(opts.dsn).toBeUndefined()
  })

  it('derives the release from the CF version metadata id', () => {
    const opts = resolveSentryOptions({
      SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42',
      CF_VERSION_METADATA: { id: 'deadbeef-version-id', tag: 'v3' },
    })
    expect(opts.release).toBe('deadbeef-version-id')
  })

  it('honours an explicit SENTRY_ENVIRONMENT override', () => {
    const opts = resolveSentryOptions({
      SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42',
      SENTRY_ENVIRONMENT: 'staging',
    })
    expect(opts.environment).toBe('staging')
  })

  it('keeps PII off and tracing disabled (out of scope for this slice)', () => {
    const opts = resolveSentryOptions({ SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42' })
    expect(opts.sendDefaultPii).toBe(false)
    expect(opts.tracesSampleRate).toBe(0)
  })
})

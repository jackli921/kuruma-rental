import * as Sentry from '@sentry/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initBrowserSentry } from './sentry'

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  ErrorBoundary: ({ children }: { children: unknown }) => children,
}))

describe('initBrowserSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT call Sentry.init when no DSN (no-op until provisioned)', () => {
    const result = initBrowserSentry(undefined)
    expect(Sentry.init).not.toHaveBeenCalled()
    expect(result.enabled).toBe(false)
  })

  it('calls Sentry.init with the resolved gated options when a DSN is set', () => {
    initBrowserSentry({
      VITE_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42',
      VITE_SENTRY_RELEASE: 'v9',
      VITE_SENTRY_ENVIRONMENT: 'staging',
    })
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://abc@o1.ingest.sentry.io/42',
        enabled: true,
        environment: 'staging',
        release: 'v9',
        tracesSampleRate: 0,
        sendDefaultPii: false,
      }),
    )
  })
})

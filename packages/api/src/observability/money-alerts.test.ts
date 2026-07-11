import * as Sentry from '@sentry/cloudflare'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportStrandedFunds } from './money-alerts'

vi.mock('@sentry/cloudflare', () => ({ captureMessage: vi.fn() }))

describe('reportStrandedFunds', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.mocked(Sentry.captureMessage).mockClear()
  })

  it('raises an error-level Sentry event carrying the message and context', () => {
    // The SDK only auto-captures thrown/unhandled errors; a handled money-stuck
    // condition must be captured explicitly or it never pages anyone.
    reportStrandedFunds('2 refunds stranded', { bookingId: 'bk_1', failed: 2 })

    expect(Sentry.captureMessage).toHaveBeenCalledWith('2 refunds stranded', {
      level: 'error',
      extra: { bookingId: 'bk_1', failed: 2 },
    })
  })

  it('also logs to console.error so the worker/webhook log keeps full context', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    reportStrandedFunds('double charge', { eventId: 'evt_1' })

    expect(errorSpy).toHaveBeenCalledWith('double charge', { eventId: 'evt_1' })
  })
})

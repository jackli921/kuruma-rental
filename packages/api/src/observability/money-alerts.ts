import * as Sentry from '@sentry/cloudflare'

/**
 * Raise a Sentry error-level event for money that is stuck at Stripe and needs a
 * human (a stranded cancellation refund, a captured-but-unrefundable mismatch, a
 * double charge). Handled money-stuck conditions do NOT throw, and the Sentry SDK
 * only auto-captures thrown/unhandled errors, so without this explicit capture the
 * signal is a `console.*` line that pages nobody. Logs to `console.error` too so the
 * worker/webhook log keeps the full identifier context as a breadcrumb.
 *
 * No-ops safely when Sentry is disabled (no DSN) or uninitialised (unit tests / a
 * `createApp` outside the Worker wrapper): `captureMessage` is a no-op there.
 */
export function reportStrandedFunds(message: string, context: Record<string, unknown>): void {
  console.error(message, context)
  Sentry.captureMessage(message, { level: 'error', extra: context })
}

import * as Sentry from '@sentry/cloudflare'
import type { MiddlewareHandler } from 'hono'
import { classifyRequest } from './report-policy'

/**
 * Times each request and reports raw >=500 responses and slow (>2s) requests
 * to Sentry (#361). Thrown errors are already captured with a stack by the
 * `onError` hook, so `classifyRequest` dedupes those via `hadUnhandledError`.
 *
 * Safe when Sentry is disabled (no DSN) or uninitialised (unit tests call
 * `createApp` directly, not via the Worker wrapper): the SDK no-ops.
 */
export function observability(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now()
    await next()
    const durationMs = Date.now() - start
    const decision = classifyRequest({
      status: c.res.status,
      durationMs,
      hadUnhandledError: Boolean(c.error),
    })
    if (!decision.report) return
    Sentry.captureMessage(
      `${decision.reason}: ${c.req.method} ${c.req.path} -> ${c.res.status} (${durationMs}ms)`,
      decision.level,
    )
  }
}

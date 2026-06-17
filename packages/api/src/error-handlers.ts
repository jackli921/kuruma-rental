import * as Sentry from '@sentry/cloudflare'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ForbiddenError, OperatorRequiredError } from './middleware/auth'

export function setupGlobalHandlers(app: Hono): void {
  app.onError((err, c) => {
    // Defer only when the HTTPException carries an explicit safe response
    // (e.g. rate-limit middleware does `new HTTPException(429, { res })`).
    // A bare `new HTTPException(500, { message })` still falls through to the
    // sanitized branch so internal error messages never leak.
    if (err instanceof HTTPException && err.res) {
      return err.getResponse()
    }
    // Repo-layer authz guards (issue #329) throw ForbiddenError when a
    // caller bypassed the route-level STAFF_ROLES gate. Map to 403 so
    // clients see a policy denial, not a server outage.
    if (err instanceof ForbiddenError) {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }
    // A non-operator write that named no target operator and could not be
    // inferred (zero or 2+ operators). Well-formed but unprocessable (#401).
    if (err instanceof OperatorRequiredError) {
      // Self-describing envelope code so the web discriminates this 422 by `code`
      // rather than regex-matching the message (a reword/i18n change can't break it) (#934).
      return c.json({ success: false, error: err.message, code: 'OPERATOR_REQUIRED' }, 422)
    }
    // Only genuinely-unexpected errors reach here — the handled policy
    // responses (HTTPException-with-res, Forbidden 403, OperatorRequired 422)
    // returned above. Capture with the stack for Sentry (#361); no-op when the
    // SDK is disabled (no DSN) or uninitialised.
    Sentry.captureException(err)
    console.error(
      JSON.stringify({
        level: 'error',
        message: err.message,
        // Drizzle/postgres-js wrap the driver failure in `err.cause` and keep
        // the useful frames in `err.stack`. Log both server-side so a DB error
        // (e.g. missing column/constraint) is self-diagnosing (#539). The
        // client response below stays sanitized — nothing here leaks.
        cause:
          err.cause instanceof Error
            ? { message: err.cause.message, stack: err.cause.stack }
            : (err.cause ?? null),
        stack: err.stack,
        path: c.req.path,
        method: c.req.method,
      }),
    )
    return c.json({ success: false, error: 'Internal server error' }, 500)
  })

  app.notFound((c) => {
    return c.json({ success: false, error: 'Not found' }, 404)
  })
}

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
      return c.json({ success: false, error: err.message }, 422)
    }
    console.error(
      JSON.stringify({
        level: 'error',
        message: err.message,
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

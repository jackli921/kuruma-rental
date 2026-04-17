import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

export function setupGlobalHandlers(app: Hono): void {
  app.onError((err, c) => {
    // Defer only when the HTTPException carries an explicit safe response
    // (e.g. rate-limit middleware does `new HTTPException(429, { res })`).
    // A bare `new HTTPException(500, { message })` still falls through to the
    // sanitized branch so internal error messages never leak.
    if (err instanceof HTTPException && err.res) {
      return err.getResponse()
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

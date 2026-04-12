import type { MiddlewareHandler } from 'hono'

/**
 * Structured JSON logger. Logs method, path, status, duration, and
 * request ID for every request. Integrates with CF Workers logging.
 */
export function structuredLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now()
    await next()
    const duration = Date.now() - start
    const requestId = (c.get('requestId') as string) ?? '-'

    const entry = {
      level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration,
      requestId,
    }

    console.log(JSON.stringify(entry))
  }
}

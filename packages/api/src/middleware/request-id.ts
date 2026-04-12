import type { MiddlewareHandler } from 'hono'

/**
 * Generates a unique request ID and attaches it to the context.
 * Also sets the X-Request-Id response header for client correlation.
 */
export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.header('X-Request-Id') ?? crypto.randomUUID()
    c.set('requestId', id)
    c.header('X-Request-Id', id)
    await next()
  }
}

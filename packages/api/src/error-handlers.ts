import type { Hono } from 'hono'

export function setupGlobalHandlers(app: Hono): void {
  app.onError((err, c) => {
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

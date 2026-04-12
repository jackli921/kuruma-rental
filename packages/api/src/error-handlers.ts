import type { Hono } from 'hono'

export function setupGlobalHandlers(app: Hono): void {
  app.onError((_err, c) => {
    return c.json({ success: false, error: 'Internal server error' }, 500)
  })

  app.notFound((c) => {
    return c.json({ success: false, error: 'Not found' }, 404)
  })
}

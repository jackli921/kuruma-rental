import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

// Minimal app that mounts the global handlers the same way createApp does.
// We add a throwing route to trigger onError.
function createTestApp(setupHandlers: (app: Hono) => void): Hono {
  const app = new Hono()
  setupHandlers(app)
  app.get('/throw', () => {
    throw new Error('kaboom')
  })
  return app
}

describe('Global error handlers', () => {
  // We'll import the setup function once it exists
  let setupGlobalHandlers: (app: Hono) => void

  it('onError returns { success: false } with 500 and no stack trace', async () => {
    const { setupGlobalHandlers: setup } = await import('../../src/error-handlers')
    setupGlobalHandlers = setup

    const app = createTestApp(setupGlobalHandlers)
    const res = await app.request('/throw')

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Internal server error')
    expect(body).not.toHaveProperty('stack')
    expect(JSON.stringify(body)).not.toContain('kaboom')
  })

  it('notFound returns { success: false } with 404', async () => {
    const { setupGlobalHandlers: setup } = await import('../../src/error-handlers')

    const app = createTestApp(setup)
    const res = await app.request('/nonexistent')

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Not found')
  })
})

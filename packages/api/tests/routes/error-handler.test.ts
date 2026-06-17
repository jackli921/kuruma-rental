import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

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

  it('logs err.cause and err.stack server-side on a 500 (self-diagnosing DB errors, #539)', async () => {
    const { setupGlobalHandlers: setup } = await import('../../src/error-handlers')

    const app = new Hono()
    setup(app)
    app.get('/throw-with-cause', () => {
      throw new Error('wrapped query failure', {
        cause: new Error('column "phone" does not exist'),
      })
    })

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/throw-with-cause')

    expect(res.status).toBe(500)
    const body = await res.json()
    // Client-facing body stays sanitized — the cause never leaks to the caller.
    expect(body).toEqual({ success: false, error: 'Internal server error' })

    expect(spy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(spy.mock.calls[0]?.[0] as string)
    expect(payload.message).toBe('wrapped query failure')
    expect(payload.cause).toMatchObject({ message: 'column "phone" does not exist' })
    expect(typeof payload.cause.stack).toBe('string')
    expect(typeof payload.stack).toBe('string')
    expect(payload.path).toBe('/throw-with-cause')

    spy.mockRestore()
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

  it('maps OperatorRequiredError to a 422 carrying the OPERATOR_REQUIRED code (#934)', async () => {
    // A self-describing envelope `code` lets the web discriminate this 422 by code
    // instead of regex-matching the message (which a reword/i18n change would break).
    const { setupGlobalHandlers: setup } = await import('../../src/error-handlers')
    const { OperatorRequiredError } = await import('../../src/middleware/auth')

    const app = new Hono()
    setup(app)
    app.get('/op-required', () => {
      throw new OperatorRequiredError('operatorId is required: specify a target operator')
    })

    const res = await app.request('/op-required')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      success: false,
      error: 'operatorId is required: specify a target operator',
      code: 'OPERATOR_REQUIRED',
    })
  })
})

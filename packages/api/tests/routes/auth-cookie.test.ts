import { Hono } from 'hono'
import { describe, expect, test } from 'vitest'
import { clearSessionCookie, setSessionCookie } from '../../src/routes/auth'

/** Drive the cookie helpers through real routes so we assert the actual
 *  Set-Cookie header the browser receives, not an internal options object. */
function appWithCookieRoutes() {
  const app = new Hono()
  app.post('/set', (c) => {
    setSessionCookie(c, 'the-session-token')
    return c.body(null, 204)
  })
  app.post('/clear', (c) => {
    clearSessionCookie(c)
    return c.body(null, 204)
  })
  return app
}

describe('session cookie attributes', () => {
  test('setSessionCookie emits HttpOnly; Secure; SameSite=Lax with the token', async () => {
    const app = appWithCookieRoutes()
    const res = await app.request('/set', { method: 'POST' })
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('kuruma_session=the-session-token')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Max-Age=604800') // 7 days, matches Auth.js today
  })

  test('clearSessionCookie expires the cookie (Max-Age=0)', async () => {
    const app = appWithCookieRoutes()
    const res = await app.request('/clear', { method: 'POST' })
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('kuruma_session=')
    expect(setCookie).toContain('Max-Age=0')
  })
})

import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { SESSION_COOKIE, verifySessionCookie } from '../middleware/auth'
import { fail, ok } from './helpers'

// 7-day lifetime, matching the Auth.js session today (design spec §5.3).
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

// HttpOnly so JS can't read it (web learns its session via GET /auth/session);
// Secure + SameSite=Lax because web and API are same-origin behind the CF Pages
// proxy (§5.5), which keeps Lax valid and Safari-safe without a Domain= attr.
const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const

/** Set the session cookie at sign-in. Consumed by the OAuth callback (Phase 2);
 *  centralised here so the security attributes live in exactly one place. */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTS, maxAge: SESSION_TTL_SECONDS })
}

/** Expire the session cookie at sign-out (Phase 2). Mirrors the set attributes
 *  so the browser reliably matches and drops it. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, SESSION_COOKIE_OPTS)
}

/**
 * Auth surface for the cookie-session flow (Vite/CF Pages migration, #378).
 *
 * `GET /auth/session` is the browser's only window into its session: the web
 * app never reads the `kuruma_session` cookie directly (it's HttpOnly), so it
 * calls this endpoint to learn who it is and to obtain the `csrfToken` it must
 * echo in `X-CSRF-Token` on every state-changing request (design spec §5.3).
 */
export function createAuthRoutes() {
  return new Hono().get('/auth/session', async (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (!token) return fail(c, 'Unauthorized', 401)

    const session = await verifySessionCookie(token)
    if (!session) return fail(c, 'Unauthorized', 401)

    return ok(c, {
      user: { id: session.user.id, role: session.user.role },
      csrfToken: session.csrf,
    })
  })
}

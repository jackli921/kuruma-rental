import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  type GoogleAuthRuntime,
  type GoogleOAuthConfig,
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  buildGoogleAuthorizeUrl,
  randomToken,
  safeReturnPath,
} from '../auth/google'
import { SESSION_COOKIE, mintSessionToken, verifySessionCookie } from '../middleware/auth'
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

/** Drop both one-time OAuth-flow cookies (state + return). Called on every
 *  callback failure path so a dead-ended sign-in leaves nothing behind to expire. */
function clearOAuthFlowCookies(c: Context): void {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' })
  deleteCookie(c, OAUTH_RETURN_COOKIE, { path: '/' })
}

/**
 * Auth surface for the cookie-session flow (Vite/CF Pages migration, #378).
 *
 * `GET /auth/session` is the browser's only window into its session: the web
 * app never reads the `kuruma_session` cookie directly (it's HttpOnly), so it
 * calls this endpoint to learn who it is and to obtain the `csrfToken` it must
 * echo in `X-CSRF-Token` on every state-changing request (design spec §5.3).
 */
export function createAuthRoutes(
  googleConfig?: GoogleOAuthConfig,
  googleRuntime?: GoogleAuthRuntime,
) {
  return new Hono()
    .post('/auth/google/start', (c) => {
      if (!googleConfig) return fail(c, 'Google sign-in is not configured', 503)

      // Bind a fresh state to a short-lived cookie; the callback rejects any
      // response whose state doesn't match (OAuth CSRF defence).
      const state = randomToken()
      setCookie(c, OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: OAUTH_STATE_TTL_SECONDS,
      })

      // Carry a *validated* return path through the round-trip so the callback
      // can land the user back where the guard intercepted them. Open-redirect
      // targets are dropped (safeReturnPath → undefined) and simply ignored.
      const returnTo = safeReturnPath(c.req.query('returnTo'))
      if (returnTo) {
        setCookie(c, OAUTH_RETURN_COOKIE, returnTo, {
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
          path: '/',
          maxAge: OAUTH_STATE_TTL_SECONDS,
        })
      }
      return c.redirect(buildGoogleAuthorizeUrl(googleConfig, state), 302)
    })
    .get('/auth/google/callback', async (c) => {
      if (!googleConfig || !googleRuntime) return fail(c, 'Google sign-in is not configured', 503)

      // Reject unless the returned state matches the one we bound at /start —
      // an attacker can neither read nor forge the HttpOnly state cookie.
      const expectedState = getCookie(c, OAUTH_STATE_COOKIE)
      const state = c.req.query('state')
      if (!expectedState || !state || expectedState !== state) {
        clearOAuthFlowCookies(c)
        return fail(c, 'Invalid OAuth state', 400)
      }
      const code = c.req.query('code')
      if (!code) {
        clearOAuthFlowCookies(c)
        return fail(c, 'Missing authorization code', 400)
      }
      deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' })

      const secret = process.env.AUTH_SECRET
      if (!secret) return fail(c, 'Server auth is not configured', 500)

      const { accessToken } = await googleRuntime.provider.exchangeCode(code, googleConfig)
      const profile = await googleRuntime.provider.getUserInfo(accessToken)
      const user = await googleRuntime.accountStore.resolveUser(profile)

      const token = await mintSessionToken(
        {
          sub: user.id,
          role: user.role,
          csrf: randomToken(),
          // exactOptionalPropertyTypes: omit the key rather than pass undefined.
          ...(user.operatorId !== undefined ? { operatorId: user.operatorId } : {}),
          // Display profile for the navbar (avatar/name/email) — mirrors what
          // NextAuth seeded into its session JWT from the OAuth profile.
          ...(profile.name !== undefined ? { name: profile.name } : {}),
          ...(profile.email !== undefined ? { email: profile.email } : {}),
          ...(profile.picture !== undefined ? { image: profile.picture } : {}),
        },
        secret,
      )
      setSessionCookie(c, token)

      // Honour a return path stashed at /start, then clear the one-time cookie.
      // The attacker can neither read nor forge the HttpOnly value, but we still
      // re-validate (defence in depth) so a tampered cookie can't open-redirect.
      const returnTo = safeReturnPath(getCookie(c, OAUTH_RETURN_COOKIE))
      deleteCookie(c, OAUTH_RETURN_COOKIE, { path: '/' })
      // Resolve the validated (root-relative) returnTo against the same web origin
      // postLoginRedirect targets, so a relative path can never land on the API's
      // own origin if the callback is ever hit off-proxy (#378 cutover insurance).
      const target = returnTo
        ? new URL(returnTo, googleConfig.postLoginRedirect).toString()
        : googleConfig.postLoginRedirect
      return c.redirect(target, 302)
    })
    .get('/auth/session', async (c) => {
      const token = getCookie(c, SESSION_COOKIE)
      if (!token) return fail(c, 'Unauthorized', 401)

      const session = await verifySessionCookie(token)
      if (!session) return fail(c, 'Unauthorized', 401)

      // Spread the display-only profile (name/email/image) the token carries.
      // `profile` holds only the keys actually present, so the user object never
      // gains a stray `name: undefined` (exactOptionalPropertyTypes).
      return ok(c, {
        user: { id: session.user.id, role: session.user.role, ...session.profile },
        csrfToken: session.csrf,
      })
    })
    .post('/auth/signout', (c) => {
      // CSRF-gated by the global csrf middleware (cookie-authenticated non-GET).
      // Idempotent: clearing an absent cookie is a no-op 204.
      clearSessionCookie(c)
      return c.body(null, 204)
    })
}

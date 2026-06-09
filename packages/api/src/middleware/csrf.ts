import { timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { fail } from '../routes/helpers'
import { SESSION_COOKIE, verifySessionCookie } from './auth'

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Constant-time string compare. Length is not secret here, so a length
 *  mismatch short-circuits before the timing-safe byte compare. */
function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Double-submit CSRF guard for the cookie session (design spec §5.4).
 *
 * The attack it stops: a browser auto-sends the HttpOnly `kuruma_session`
 * cookie on cross-site form posts, so a cookie alone can't prove intent. We
 * require the caller to also echo the session's `csrf` claim in an
 * `X-CSRF-Token` header — a value a cross-origin attacker can't read.
 *
 * Exemptions fall out of the invariant "CSRF rides the ambient cookie":
 *  - Safe methods (GET/HEAD/OPTIONS) never mutate.
 *  - Requests with no session cookie aren't cookie-authenticated — partner
 *    Bearer/API-key callers carry no ambient cookie. Nothing to forge → pass
 *    through. (Google's callback is a GET, already covered by safe methods.)
 */
export function csrf(): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()

    const token = getCookie(c, SESSION_COOKIE)
    if (!token) return next()

    // Invalid/expired cookie: defer to requireAuth's 401 rather than masking
    // the real cause with a 403.
    const session = await verifySessionCookie(token)
    if (!session) return next()

    const header = c.req.header('X-CSRF-Token')
    if (!session.csrf || !header || !tokensMatch(header, session.csrf)) {
      return fail(c, 'CSRF token mismatch', 403)
    }
    return next()
  }
}

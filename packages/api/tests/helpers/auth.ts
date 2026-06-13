import type { MiddlewareHandler } from 'hono'
import { SignJWT } from 'jose'
import {
  type FlowPayload,
  OAUTH_FLOW_COOKIE_PREFIX,
  type OAuthIntent,
  decodeFlowPayload,
  encodeFlowPayload,
  flowCookieName,
} from '../../src/auth/google'
import { API_TOKEN_AUDIENCE, API_TOKEN_ISSUER, type UserRole } from '../../src/middleware/auth'

export const TEST_AUTH_SECRET = 'test-auth-secret-at-least-32-chars-long'

/** Middleware that sets a fake authenticated user for unit tests that
 *  mount route handlers directly (without the full createApp() + JWT flow).
 *  Pass `operatorId` to simulate a tenant-scoped OPERATOR_* caller. */
export function testAuthMiddleware(
  id = 'test-user',
  role: UserRole = 'ADMIN',
  operatorId?: string,
): MiddlewareHandler {
  return async (c, next) => {
    c.set('user', operatorId !== undefined ? { id, role, operatorId } : { id, role })
    return next()
  }
}

export async function signTestJwt(
  payload: { sub: string; role?: string } = { sub: 'test-user-id', role: 'ADMIN' },
  secret = TEST_AUTH_SECRET,
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ role: payload.role ?? 'ADMIN', ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .setIssuedAt()
    .setIssuer(API_TOKEN_ISSUER)
    .setAudience(API_TOKEN_AUDIENCE)
    .sign(key)
}

export function setupAuthEnv(): void {
  process.env.AUTH_SECRET = TEST_AUTH_SECRET
}

export async function authHeaders(payload?: { sub: string; role?: string }): Promise<
  Record<string, string>
> {
  const token = await signTestJwt(payload)
  return { Authorization: `Bearer ${token}` }
}

/** Build the per-flow OAuth cookie a browser would send to the callback, using the
 *  SAME encoder the /start route uses, so a test can never drift from production.
 *  `state` names the cookie; returnTo/intent/invite ride in its value (#519). */
export function oauthFlowCookie(
  state: string,
  flow: { returnTo?: string; intent?: OAuthIntent; invite?: string } = {},
): string {
  const value = encodeFlowPayload({
    returnTo: flow.returnTo,
    intent: flow.intent ?? 'renter',
    invite: flow.invite,
  })
  return `${flowCookieName(state)}=${value}`
}

/** Read + decode the per-flow OAuth cookie a /start response set: the flow `state`
 *  (cookie-name suffix) and the decoded payload, or undefined when none was set
 *  (or it's an expiry/Max-Age=0 erase, whose value is empty). */
export function readOAuthFlowCookie(
  res: Response,
): { state: string; payload: FlowPayload } | undefined {
  const hit = (res.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith(OAUTH_FLOW_COOKIE_PREFIX),
  )
  if (!hit) return undefined
  const pair = hit.split(';')[0] ?? ''
  const eq = pair.indexOf('=')
  const value = pair.slice(eq + 1)
  if (value === '') return undefined
  return {
    state: pair.slice(OAUTH_FLOW_COOKIE_PREFIX.length, eq),
    payload: decodeFlowPayload(value),
  }
}

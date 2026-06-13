import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  type GoogleAuthRuntime,
  type GoogleOAuthConfig,
  OAUTH_STATE_TTL_SECONDS,
  buildGoogleAuthorizeUrl,
  decodeFlowPayload,
  encodeFlowPayload,
  flowCookieName,
  localeFromReturnPath,
  parseOAuthIntent,
  randomToken,
  safeInviteToken,
  safeReturnPath,
} from '../auth/google'
import {
  SESSION_COOKIE,
  type UserRole,
  mintSessionToken,
  verifySessionCookie,
} from '../middleware/auth'
import type { OperatorGrantService } from '../services/operator-grant'
import { fail, ok } from './helpers'

/** Resolves an operatorId to its stored slug (operators.slug), or undefined when
 *  the operator is unknown. Injected so the route stays off the repo layer; the
 *  slug is server-derived (never user input) and powers /manage/<slug> redirects. */
export type FindOperatorSlug = (operatorId: string) => Promise<string | undefined>

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

// Attributes for the per-flow OAuth round-trip cookie (issue #519). HttpOnly +
// Secure + SameSite=Lax so it survives Google's top-level GET redirect back to the
// callback, scoped to '/', expiring with the flow's TTL.
const OAUTH_FLOW_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
  maxAge: OAUTH_STATE_TTL_SECONDS,
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

/** Build the provider-login error redirect (#521). `error` is an OperatorGrantResult
 *  discriminant (`access_not_found` | `invite_invalid`) — server-controlled, never
 *  user input — resolved against the web origin like every other redirect target. */
function providerLoginErrorUrl(config: GoogleOAuthConfig, locale: string, error: string): string {
  return new URL(`/${locale}/provider/login?error=${error}`, config.postLoginRedirect).toString()
}

/**
 * Auth surface for the cookie-session flow (Vite/CF Pages migration, #378).
 *
 * `GET /auth/session` is the browser's only window into its session: the web
 * app never reads the `kuruma_session` cookie directly (it's HttpOnly), so it
 * calls this endpoint to learn who it is and to obtain the `csrfToken` it must
 * echo in `X-CSRF-Token` on every state-changing request (design spec §5.3).
 *
 * `providerAccess` + `findOperatorSlug` are present only when the API has a DB
 * (composition root); without them the callback is the renter-only flow.
 */
export function createAuthRoutes(
  googleConfig?: GoogleOAuthConfig,
  googleRuntime?: GoogleAuthRuntime,
  providerAccess?: OperatorGrantService,
  findOperatorSlug?: FindOperatorSlug,
) {
  return new Hono()
    .post('/auth/google/start', (c) => {
      if (!googleConfig) return fail(c, 'Google sign-in is not configured', 503)

      // Each sign-in gets its OWN random state + per-flow cookie (issue #519): two
      // tabs starting at once bind to different cookie names and never clobber one
      // another, so neither dead-ends on the other's state. The callback validates
      // by the presence of this cookie (the CSRF binding) — only a flow this browser
      // started holds it. The validated flow data (a safe returnTo, provider intent,
      // and any syntactically-acceptable invite token; #521 §5) rides in the HttpOnly
      // cookie VALUE, not the `state` param, so returnTo never leaks into the URL.
      const state = randomToken()
      const payload = encodeFlowPayload({
        returnTo: safeReturnPath(c.req.query('returnTo')),
        intent: parseOAuthIntent(c.req.query('intent')),
        invite: safeInviteToken(c.req.query('invite')),
      })
      setCookie(c, flowCookieName(state), payload, OAUTH_FLOW_COOKIE_OPTS)
      return c.redirect(buildGoogleAuthorizeUrl(googleConfig, state), 302)
    })
    .get('/auth/google/callback', async (c) => {
      if (!googleConfig || !googleRuntime) return fail(c, 'Google sign-in is not configured', 503)

      // Validate state by the PRESENCE of this flow's own cookie (issue #519): only
      // a sign-in this browser started holds `<prefix><state>`, and it's HttpOnly so
      // an attacker can neither read nor forge it. A missing cookie ⇒ forged/expired/
      // unknown state ⇒ reject. Per-flow naming means a sibling tab's flow is irrelevant.
      const state = c.req.query('state')
      const flowCookie = state ? getCookie(c, flowCookieName(state)) : undefined
      if (!state || flowCookie === undefined) {
        // No cookie matched this state ⇒ nothing to clear. (Don't try to delete a
        // cookie named after a hostile `state` — invalid name chars would throw.)
        return fail(c, 'Invalid OAuth state', 400)
      }
      const code = c.req.query('code')
      if (!code) {
        deleteCookie(c, flowCookieName(state), { path: '/' })
        return fail(c, 'Missing authorization code', 400)
      }

      // Read the one-time flow payload into memory, then drop the cookie: the decision
      // below works from these values and never reads it again. decodeFlowPayload
      // re-validates every field (defence in depth — a tampered cookie can't
      // open-redirect); returnTo's locale segment steers server-computed redirects.
      const { returnTo, intent, invite: inviteToken } = decodeFlowPayload(flowCookie)
      const locale = localeFromReturnPath(returnTo)
      deleteCookie(c, flowCookieName(state), { path: '/' })

      const secret = process.env.AUTH_SECRET
      if (!secret) return fail(c, 'Server auth is not configured', 500)

      const { accessToken } = await googleRuntime.provider.exchangeCode(code, googleConfig)
      const profile = await googleRuntime.provider.getUserInfo(accessToken)
      const user = await googleRuntime.accountStore.resolveUser(profile)

      // Default grant = the user's already-projected identity (a renter, or an
      // operator arriving through the renter door). Provider intent may UPGRADE it
      // via an invite/membership; renter intent never touches the access decision.
      let grant: { role: UserRole; operatorId?: string } = {
        role: user.role,
        ...(user.operatorId !== undefined ? { operatorId: user.operatorId } : {}),
      }

      if (intent === 'provider' && providerAccess) {
        const access = await providerAccess.resolve({
          userId: user.id,
          ...(profile.email !== undefined ? { email: profile.email } : {}),
          ...(profile.email_verified !== undefined
            ? { emailVerified: profile.email_verified }
            : {}),
          ...(inviteToken !== undefined ? { inviteToken } : {}),
        })
        if (access.type !== 'granted') {
          // Uninvited or bad invite: bounce to the provider login with the reason,
          // minting no session — the provider door alone never logs anyone in.
          return c.redirect(providerLoginErrorUrl(googleConfig, locale, access.type), 302)
        }
        grant = { role: access.role, operatorId: access.operatorId }
      }

      // Slug is ALWAYS derived from the resolved operatorId, on every intent, so an
      // operator using the renter door still satisfies the web /manage/$slug guard.
      const operatorSlug =
        grant.operatorId !== undefined && findOperatorSlug
          ? await findOperatorSlug(grant.operatorId)
          : undefined

      // Provider intent needs a resolvable slug for the /manage/$slug destination.
      // If the grant resolved but the slug didn't (an internal inconsistency), fail
      // the door CLOSED *before* minting — a denied provider attempt must never
      // leave a session cookie behind (mirrors the access_not_found bounce above).
      if (intent === 'provider' && !operatorSlug) {
        return c.redirect(providerLoginErrorUrl(googleConfig, locale, 'access_not_found'), 302)
      }

      const token = await mintSessionToken(
        {
          sub: user.id,
          role: grant.role,
          csrf: randomToken(),
          // exactOptionalPropertyTypes: omit the key rather than pass undefined.
          ...(grant.operatorId !== undefined ? { operatorId: grant.operatorId } : {}),
          ...(operatorSlug !== undefined ? { operatorSlug } : {}),
          // Display profile for the navbar (avatar/name/email) — mirrors what
          // NextAuth seeded into its session JWT from the OAuth profile.
          ...(profile.name !== undefined ? { name: profile.name } : {}),
          ...(profile.email !== undefined ? { email: profile.email } : {}),
          ...(profile.picture !== undefined ? { image: profile.picture } : {}),
        },
        secret,
      )
      setSessionCookie(c, token)

      // Provider intent lands on the server-computed operator dashboard: the slug is
      // server-derived, so it can't be steered by returnTo. The slug is guaranteed
      // present here — the bail above already failed the path closed otherwise.
      if (intent === 'provider') {
        return c.redirect(
          new URL(
            `/${locale}/manage/${operatorSlug}/dashboard`,
            googleConfig.postLoginRedirect,
          ).toString(),
          302,
        )
      }

      // Renter intent: honour the validated returnTo, else the default landing.
      // Resolved against the web origin postLoginRedirect targets, so a relative
      // path can never land on the API's own origin if the callback is ever hit
      // off-proxy (#378 cutover insurance).
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
        user: {
          id: session.user.id,
          role: session.user.role,
          // Operator identity (#521): operatorId scopes API authz; operatorSlug lets
          // the web /manage/$slug guard match the URL. Both omitted for renters.
          ...(session.user.operatorId !== undefined ? { operatorId: session.user.operatorId } : {}),
          ...(session.operatorSlug !== undefined ? { operatorSlug: session.operatorSlug } : {}),
          ...session.profile,
        },
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

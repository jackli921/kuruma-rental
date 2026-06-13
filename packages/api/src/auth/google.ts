// Google OAuth 2.0 / OpenID Connect helpers for the API-side sign-in flow
// (Vite/CF Pages migration, #378). We drive the authorization-code flow
// directly rather than via @auth/core so the result is OUR kuruma_session
// cookie (Phase 1) — one session system, not Auth.js's parallel one.

import type { UserRole } from '../middleware/auth'

/** OpenID Connect profile we read from Google's userinfo endpoint. `sub` is the
 *  stable Google account id used as `accounts.providerAccountId`. */
export interface GoogleProfile {
  readonly sub: string
  readonly email?: string
  // Google's OIDC `email_verified` claim. Provider-invite redemption (#521) only
  // honours an invite for a Google-verified email — an unverified/absent value is
  // never grantable. Kept under Google's claim name alongside sub/email/picture.
  readonly email_verified?: boolean
  readonly name?: string
  readonly picture?: string
}

/**
 * The Google HTTP boundary, as a port. The route depends on this interface so
 * tests inject a fake instead of mocking global fetch — mirrors the injected
 * TranslationProvider pattern (services/google-translation-provider.ts).
 */
export interface GoogleOAuthProvider {
  /** Exchange an authorization code for tokens at Google's token endpoint. */
  exchangeCode(code: string, config: GoogleOAuthConfig): Promise<{ accessToken: string }>
  /** Fetch the OIDC profile for an access token. */
  getUserInfo(accessToken: string): Promise<GoogleProfile>
}

/**
 * Resolves an OAuth profile to a local user, creating + linking the account on
 * first sign-in. Implemented over the same `accounts` table Auth.js uses, so a
 * user who signed in via the old web app maps to the SAME row (compat).
 */
export interface OAuthAccountStore {
  resolveUser(profile: GoogleProfile): Promise<{ id: string; role: UserRole; operatorId?: string }>
}

/** The runtime dependencies the callback needs (vs. start, which needs only
 *  config). Bundled so it's present-or-absent as a unit. */
export interface GoogleAuthRuntime {
  readonly provider: GoogleOAuthProvider
  readonly accountStore: OAuthAccountStore
}

export const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
export const GOOGLE_SCOPE = 'openid email profile'

/** Per-flow OAuth round-trip cookie. Each sign-in gets its OWN cookie, named by
 *  its random `state` (`<prefix><state>`), instead of four fixed-name single-slot
 *  cookies — so two browser tabs starting Google sign-in at once no longer clobber
 *  each other's flow (issue #519). The cookie's PRESENCE is itself the CSRF
 *  binding: only a flow THIS browser started holds it, and it's HttpOnly so script
 *  can't forge one. SameSite=Lax so it survives Google's top-level GET redirect;
 *  it expires with the flow's TTL. The validated flow data (returnTo/intent/invite)
 *  rides in the cookie VALUE — not the `state` param — so returnTo never appears in
 *  the URL/referrer/logs. */
export const OAUTH_FLOW_COOKIE_PREFIX = 'kuruma_oauth_flow_'
export const OAUTH_STATE_TTL_SECONDS = 600

/** The per-flow cookie name for a given `state`. base64url `state` is composed of
 *  valid cookie-name token chars (A–Z a–z 0–9 `-` `_`), so this needs no escaping. */
export function flowCookieName(state: string): string {
  return `${OAUTH_FLOW_COOKIE_PREFIX}${state}`
}

/** Which sign-in door the user came through. Identity is shared; only the
 *  post-login authorization decision and destination differ (#521). */
export const OAUTH_INTENTS = ['renter', 'provider'] as const
export type OAuthIntent = (typeof OAUTH_INTENTS)[number]

/** Parse the `intent` query/cookie value. Anything but the explicit `provider`
 *  is the safe default `renter` — an unknown intent never unlocks the provider
 *  path (which still requires a membership or matched invite regardless). */
export function parseOAuthIntent(raw: string | undefined): OAuthIntent {
  return raw === 'provider' ? 'provider' : 'renter'
}

// Syntactic gate only (base64url charset, bounded length) — matches randomToken's
// base64url output. Redemption validity (hash match, expiry, email) is decided in
// the callback; this just keeps a malformed value out of the cookie.
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/

/** The invite token if syntactically acceptable, else undefined. */
export function safeInviteToken(raw: string | undefined): string | undefined {
  return raw && INVITE_TOKEN_RE.test(raw) ? raw : undefined
}

// Web locales (use-intl routing). Duplicated here because the API can't import the
// web i18n module across the package boundary; small + stable. Follow-up: lift the
// canonical list into @kuruma/shared if a third consumer appears.
const WEB_LOCALES = ['en', 'ja', 'zh'] as const

/** Locale used to build a redirect when no locale-prefixed returnTo is available. */
export const FALLBACK_LOCALE = 'en'

/**
 * The locale segment of a validated root-relative path (`/ja/manage` → `ja`), or
 * FALLBACK_LOCALE when the first segment isn't a known locale. Used by the OAuth
 * callback to build the provider redirect (`/<locale>/dashboard`) whose destination
 * is computed server-side, not carried in returnTo. Input is already
 * safeReturnPath-validated, so this only inspects the first segment.
 */
export function localeFromReturnPath(path: string | undefined): string {
  const segment = path?.split('/')[1]
  return segment && (WEB_LOCALES as readonly string[]).includes(segment) ? segment : FALLBACK_LOCALE
}

// The open-redirect guard for `returnTo` lives in @kuruma/shared so the API and
// the web boundary enforce ONE definition — a guard cloned across a trust
// boundary drifts. Imported (so decodeFlowPayload can re-validate with it) and
// re-exported so the auth routes keep importing it from here.
import { safeReturnPath } from '@kuruma/shared/lib/return-path'
export { safeReturnPath }

export interface GoogleOAuthConfig {
  readonly clientId: string
  readonly clientSecret: string
  /** Absolute URL of GET /auth/google/callback; must match a Google console entry. */
  readonly redirectUri: string
  /** Where to send the browser after a successful sign-in. */
  readonly postLoginRedirect: string
}

/** Cryptographically-random URL-safe token (state / nonce). Web Crypto so it
 *  works identically on CF Workers and Node. */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

/** Build the Google authorization-code URL. Pure — no I/O, fully assertable. */
export function buildGoogleAuthorizeUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    state,
    access_type: 'offline',
    prompt: 'select_account',
  })
  return `${GOOGLE_AUTHORIZE_ENDPOINT}?${params.toString()}`
}

/** The data a flow carries from /start to its callback, stashed in the per-flow
 *  cookie value. Keys are always present (values may be undefined) so callers can
 *  destructure without exactOptionalPropertyTypes friction. */
export interface FlowPayload {
  readonly returnTo: string | undefined
  readonly intent: OAuthIntent
  readonly invite: string | undefined
}

/** Encode a flow's payload for its cookie value. Only non-default fields are
 *  stored (renter intent + absent returnTo/invite encode to an empty object), so
 *  the cookie stays tiny. base64url(JSON) — opaque + HttpOnly, never script-read. */
export function encodeFlowPayload(payload: {
  returnTo: string | undefined
  intent: OAuthIntent
  invite: string | undefined
}): string {
  const stored: Record<string, string> = {}
  if (payload.returnTo) stored.returnTo = payload.returnTo
  if (payload.intent === 'provider') stored.intent = 'provider'
  if (payload.invite) stored.invite = payload.invite
  return Buffer.from(JSON.stringify(stored)).toString('base64url')
}

/** Decode + re-validate a per-flow cookie value into a FlowPayload. Every field
 *  runs back through its guard (safeReturnPath/parseOAuthIntent/safeInviteToken) —
 *  the cookie was set by us, but defence in depth never trusts a returned cookie.
 *  A malformed value degrades to the safe default (renter, no returnTo/invite):
 *  the state binding already held (the cookie existed), so a garbled value drops
 *  its extras rather than 400-ing a real flow. */
export function decodeFlowPayload(raw: string | undefined): FlowPayload {
  const parsed = parseFlowJson(raw)
  return {
    returnTo: safeReturnPath(parsed.returnTo),
    intent: parseOAuthIntent(parsed.intent),
    invite: safeInviteToken(parsed.invite),
  }
}

function parseFlowJson(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!value || typeof value !== 'object') return {}
    // Keep only string-valued keys: the field guards (safeReturnPath, etc.) annotate
    // `string | undefined`, and RegExp.test coerces, so an un-filtered non-string
    // (a forged `{invite: 12345}`) would slip through and later throw in sha256Hex.
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

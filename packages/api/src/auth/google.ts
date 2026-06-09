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

/** Short-lived cookie binding the OAuth `state` across the start→callback
 *  round-trip. SameSite=Lax so it survives Google's top-level GET redirect. */
export const OAUTH_STATE_COOKIE = 'kuruma_oauth_state'
export const OAUTH_STATE_TTL_SECONDS = 600

/** Short-lived cookie carrying the post-login `returnTo` path across the
 *  start→callback round-trip. Shares the state cookie's TTL/SameSite so it
 *  survives Google's top-level redirect and expires with the flow. */
export const OAUTH_RETURN_COOKIE = 'kuruma_oauth_return'

const MAX_RETURN_PATH_LENGTH = 512
const CONTROL_CHAR_MAX = 0x1f
const DEL_CHAR = 0x7f

/**
 * Validate a post-login redirect target as a *local* path — the open-redirect
 * defence. Accepts only same-origin root-relative paths (`/en/bookings`);
 * rejects protocol-relative (`//evil`), absolute URLs, backslash tricks
 * (browsers fold `\` to `/`), control chars (CR/LF header injection), and
 * anything not starting with a single `/`. Returns the trusted path, or
 * undefined to fall back to the configured postLoginRedirect.
 */
export function safeReturnPath(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RETURN_PATH_LENGTH) {
    return undefined
  }
  if (raw[0] !== '/') return undefined
  if (raw[1] === '/' || raw[1] === '\\') return undefined
  if (raw.includes('\\')) return undefined
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    if (code <= CONTROL_CHAR_MAX || code === DEL_CHAR) return undefined
  }
  return raw
}

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

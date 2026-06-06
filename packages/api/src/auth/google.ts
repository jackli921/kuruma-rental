// Google OAuth 2.0 / OpenID Connect helpers for the API-side sign-in flow
// (Vite/CF Pages migration, #378). We drive the authorization-code flow
// directly rather than via @auth/core so the result is OUR kuruma_session
// cookie (Phase 1) — one session system, not Auth.js's parallel one.

export const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
export const GOOGLE_SCOPE = 'openid email profile'

/** Short-lived cookie binding the OAuth `state` across the start→callback
 *  round-trip. SameSite=Lax so it survives Google's top-level GET redirect. */
export const OAUTH_STATE_COOKIE = 'kuruma_oauth_state'
export const OAUTH_STATE_TTL_SECONDS = 600

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

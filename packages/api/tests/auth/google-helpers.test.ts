import { describe, expect, it } from 'vitest'

import {
  FALLBACK_LOCALE,
  type GoogleOAuthConfig,
  buildGoogleAuthorizeUrl,
  decodeFlowPayload,
  encodeFlowPayload,
  localeFromReturnPath,
  parseOAuthIntent,
  randomToken,
  safeInviteToken,
} from '../../src/auth/google'

// #521 §5: the provider sign-in `intent` + `invite` token ride start→callback in
// HttpOnly cookies; the callback also derives the redirect locale from the
// validated returnTo. These three helpers are the pure decode/validate gates —
// identity is shared, but an unknown intent must never unlock the provider path,
// a malformed token must never reach the cookie, and an unknown locale must fall
// back rather than build a 404 redirect.

describe('parseOAuthIntent', () => {
  it('keeps the explicit provider intent', () => {
    expect(parseOAuthIntent('provider')).toBe('provider')
  })

  it('keeps the explicit renter intent', () => {
    expect(parseOAuthIntent('renter')).toBe('renter')
  })

  it('defaults a missing intent to renter', () => {
    expect(parseOAuthIntent(undefined)).toBe('renter')
  })

  it('defaults an unknown intent to renter (never silently unlocks provider)', () => {
    expect(parseOAuthIntent('operator')).toBe('renter')
  })

  it('is case-sensitive — only exact "provider" counts', () => {
    expect(parseOAuthIntent('Provider')).toBe('renter')
  })
})

describe('safeInviteToken', () => {
  it('passes a base64url token through unchanged', () => {
    const token = 'aB3-_xyz09ABCdef'
    expect(safeInviteToken(token)).toBe(token)
  })

  it('accepts the full base64url charset including - and _', () => {
    expect(safeInviteToken('a-b_C9')).toBe('a-b_C9')
  })

  it('rejects a missing token', () => {
    expect(safeInviteToken(undefined)).toBeUndefined()
  })

  it('rejects an empty token', () => {
    expect(safeInviteToken('')).toBeUndefined()
  })

  it('rejects a token with an out-of-charset character', () => {
    expect(safeInviteToken('abc!def')).toBeUndefined()
  })

  it('rejects a token longer than 128 chars', () => {
    expect(safeInviteToken('a'.repeat(129))).toBeUndefined()
  })

  it('accepts a token exactly at the 128-char boundary', () => {
    const token = 'a'.repeat(128)
    expect(safeInviteToken(token)).toBe(token)
  })
})

describe('buildGoogleAuthorizeUrl', () => {
  const config: GoogleOAuthConfig = {
    clientId: 'client-123.apps.googleusercontent.com',
    clientSecret: 'top-secret',
    redirectUri: 'https://api.example.com/auth/google/callback',
    postLoginRedirect: 'https://app.example.com',
  }

  // #1055: the authorize URL must carry a per-flow `nonce` so the id_token returned
  // by Google can be bound back to THIS sign-in — without it the callback can't
  // prove the token isn't a replay from another flow.
  it('binds the per-flow nonce into the authorize URL', () => {
    const url = new URL(buildGoogleAuthorizeUrl(config, 'state-abc', 'nonce-xyz'))
    expect(url.searchParams.get('nonce')).toBe('nonce-xyz')
  })

  it('keeps state and nonce as distinct params', () => {
    const url = new URL(buildGoogleAuthorizeUrl(config, 'state-abc', 'nonce-xyz'))
    expect(url.searchParams.get('state')).toBe('state-abc')
    expect(url.searchParams.get('nonce')).toBe('nonce-xyz')
  })
})

describe('flow payload nonce (#1055)', () => {
  // The per-flow nonce rides in the same HttpOnly flow cookie as returnTo/intent/invite,
  // so the callback can recover it to bind the id_token to THIS sign-in.
  it('encodes and recovers the per-flow nonce', () => {
    const nonce = randomToken()
    const encoded = encodeFlowPayload({
      returnTo: undefined,
      intent: 'renter',
      invite: undefined,
      nonce,
    })
    expect(decodeFlowPayload(encoded).nonce).toBe(nonce)
  })

  it('recovers the nonce alongside the other validated fields', () => {
    const nonce = randomToken()
    const encoded = encodeFlowPayload({
      returnTo: '/ja/manage',
      intent: 'provider',
      invite: 'inv-token',
      nonce,
    })
    const decoded = decodeFlowPayload(encoded)
    expect(decoded).toMatchObject({
      returnTo: '/ja/manage',
      intent: 'provider',
      invite: 'inv-token',
      nonce,
    })
  })

  it('yields an undefined nonce for a malformed cookie (fail-closed on verification)', () => {
    expect(decodeFlowPayload('not-base64url-json').nonce).toBeUndefined()
  })
})

describe('localeFromReturnPath', () => {
  it('extracts a known locale from the first path segment', () => {
    expect(localeFromReturnPath('/ja/manage')).toBe('ja')
  })

  it('extracts en', () => {
    expect(localeFromReturnPath('/en/dashboard')).toBe('en')
  })

  it('extracts zh', () => {
    expect(localeFromReturnPath('/zh')).toBe('zh')
  })

  it('falls back when the first segment is not a known locale', () => {
    expect(localeFromReturnPath('/fr/manage')).toBe(FALLBACK_LOCALE)
  })

  it('falls back for a non-locale segment like /manage', () => {
    expect(localeFromReturnPath('/manage')).toBe(FALLBACK_LOCALE)
  })

  it('falls back for an undefined path', () => {
    expect(localeFromReturnPath(undefined)).toBe(FALLBACK_LOCALE)
  })

  it('falls back for the root path', () => {
    expect(localeFromReturnPath('/')).toBe(FALLBACK_LOCALE)
  })
})

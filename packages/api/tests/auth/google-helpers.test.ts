import { describe, expect, it } from 'vitest'

import {
  FALLBACK_LOCALE,
  localeFromReturnPath,
  parseOAuthIntent,
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

import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../auth/token-hash'
import { INVITE_TTL_MS, mintInvite } from './invite-mint'

describe('mintInvite', () => {
  it('returns a non-empty token and tokenHash = sha256Hex(token)', () => {
    const minted = mintInvite({ webBaseUrl: 'https://app.example.com' })
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(minted.tokenHash).toBe(sha256Hex(minted.token))
  })

  it('produces a different token on each call', () => {
    const a = mintInvite({ webBaseUrl: 'https://app.example.com' })
    const b = mintInvite({ webBaseUrl: 'https://app.example.com' })
    expect(a.token).not.toBe(b.token)
  })

  it('builds inviteUrl from webBaseUrl without a trailing slash', () => {
    const minted = mintInvite({ webBaseUrl: 'https://app.example.com' })
    expect(minted.inviteUrl).toBe(`https://app.example.com/provider/invite/${minted.token}`)
  })

  it('strips a trailing slash from webBaseUrl before building inviteUrl', () => {
    const minted = mintInvite({ webBaseUrl: 'https://app.example.com/' })
    expect(minted.inviteUrl).toBe(`https://app.example.com/provider/invite/${minted.token}`)
  })

  it('computes expiresAt deterministically from the injected now + ttlMs', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const ttlMs = 60_000
    const minted = mintInvite({ webBaseUrl: 'https://app.example.com', ttlMs, now })
    expect(minted.expiresAt.getTime()).toBe(now.getTime() + ttlMs)
  })

  it('uses INVITE_TTL_MS as the default when ttlMs is omitted', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const minted = mintInvite({ webBaseUrl: 'https://app.example.com', now })
    expect(minted.expiresAt.getTime()).toBe(now.getTime() + INVITE_TTL_MS)
  })
})

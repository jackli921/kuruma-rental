import { describe, expect, it } from 'vitest'
import { emailVerifiedAt } from './email-verification'

describe('emailVerifiedAt', () => {
  const now = new Date('2026-06-25T00:00:00.000Z')

  it('records the verification instant when Google asserts email_verified: true', () => {
    expect(emailVerifiedAt(true, now)).toBe(now)
  })

  it('records null when the claim is false (Google says unverified)', () => {
    expect(emailVerifiedAt(false, now)).toBeNull()
  })

  it('records null when the claim is absent (older/partial profiles)', () => {
    expect(emailVerifiedAt(undefined, now)).toBeNull()
  })
})

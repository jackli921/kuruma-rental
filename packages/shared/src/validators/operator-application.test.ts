import { describe, expect, it } from 'vitest'
import { operatorApplicationSchema } from './operator-application'

const valid = {
  businessName: 'Osaka Rentals',
  contactName: 'Aiko Tanaka',
  contactEmail: 'AIKO@Example.com',
  contactPhone: '+81 90-1234-5678',
  serviceArea: 'Osaka',
  estimatedFleetSize: '6-20',
  consent: true,
  submittedLocale: 'en',
  website: '',
}

describe('operatorApplicationSchema', () => {
  it('accepts a valid application and lowercases the email', () => {
    const r = operatorApplicationSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.contactEmail).toBe('aiko@example.com')
  })
  it('rejects when consent is false', () => {
    const r = operatorApplicationSchema.safeParse({ ...valid, consent: false })
    expect(r.success).toBe(false)
  })
  it('rejects a bad fleet-size bucket', () => {
    const r = operatorApplicationSchema.safeParse({ ...valid, estimatedFleetSize: '999' })
    expect(r.success).toBe(false)
  })
  it('coerces an empty website to undefined', () => {
    const r = operatorApplicationSchema.safeParse({ ...valid, website: '' })
    expect(r.success && r.data.website).toBeUndefined()
  })
  it('rejects a javascript: website (httpUrl refine)', () => {
    const r = operatorApplicationSchema.safeParse({ ...valid, website: 'javascript:alert(1)' })
    expect(r.success).toBe(false)
  })
})

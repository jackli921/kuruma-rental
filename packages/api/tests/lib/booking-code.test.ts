import { describe, expect, it } from 'vitest'
import { BOOKING_CODE_PATTERN, generateBookingCode } from '../../src/lib/booking-code'

// Slice 6 (#392), proposal §10 item 3: human-facing reservation code, 8-char
// no-confusables base32 (excludes 0 O 1 I l), generated server-side, recitable
// over the phone. Internal bookings.id stays UUIDv7.
describe('generateBookingCode', () => {
  it('produces an 8-char code over the no-confusables alphabet', () => {
    const code = generateBookingCode()
    expect(code).toHaveLength(8)
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/)
  })

  it('never emits a confusable character (0 O 1 I)', () => {
    const codes = Array.from({ length: 2000 }, () => generateBookingCode()).join('')
    expect(codes).not.toMatch(/[01OI]/)
  })

  it('matches the exported BOOKING_CODE_PATTERN', () => {
    expect(BOOKING_CODE_PATTERN.test(generateBookingCode())).toBe(true)
    expect(BOOKING_CODE_PATTERN.test('HACKED01')).toBe(false) // contains 0, 1
  })

  it('generates 10k codes that all match the pattern and are unique', () => {
    const codes = Array.from({ length: 10_000 }, () => generateBookingCode())
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/)
    }
    expect(new Set(codes).size).toBe(codes.length)
  })
})

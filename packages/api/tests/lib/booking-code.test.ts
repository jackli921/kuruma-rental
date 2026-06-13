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

  it('generates 10k well-formed codes with negligible collisions', () => {
    const codes = Array.from({ length: 10_000 }, () => generateBookingCode())
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/)
    }
    // Codes are crypto-random over a 32^8 (~2^40) space, so demanding ZERO
    // collisions in 10k draws is a birthday-paradox flake (~1/22k runs, #672).
    // Real uniqueness is the `bookingCode UNIQUE` constraint + regenerate-on-23505
    // retry in booking.ts, not a generator guarantee. Tolerating <=1 collision keeps
    // the false-failure probability ~1e-9. The real entropy guard is the per-code
    // {8}-length/alphabet assertion above (any shrunk length or alphabet fails it
    // deterministically); this count only catches a same-shape RNG whose effective
    // range has collapsed.
    const collisions = codes.length - new Set(codes).size
    expect(collisions, 'unexpected booking-code collisions in 10k draws').toBeLessThanOrEqual(1)
  })
})

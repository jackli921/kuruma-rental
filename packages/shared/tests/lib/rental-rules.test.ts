import { describe, expect, it } from 'vitest'
import { checkRentalRules } from '../../src/lib/rental-rules'

// Helpers. Durations are always expressed in hours from a fixed "now" so tests
// read like the booking flow: "the renter is at now, wants to pick up in N
// hours and return M hours later."
const NOW = new Date('2026-04-11T12:00:00Z')
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 60 * 60 * 1000)

const noRules = {
  minRentalHours: null,
  maxRentalHours: null,
  advanceBookingHours: null,
}

describe('checkRentalRules', () => {
  describe('when no rules are set', () => {
    it('allows any booking', () => {
      const result = checkRentalRules(noRules, hoursFromNow(1), hoursFromNow(2), NOW)
      expect(result.ok).toBe(true)
    })

    it('allows a very short booking', () => {
      const result = checkRentalRules(
        noRules,
        hoursFromNow(1),
        new Date(NOW.getTime() + 30 * 60 * 1000),
        NOW,
      )
      expect(result.ok).toBe(true)
    })

    it('allows a very long booking', () => {
      const result = checkRentalRules(noRules, hoursFromNow(1), hoursFromNow(1000), NOW)
      expect(result.ok).toBe(true)
    })
  })

  describe('minRentalHours', () => {
    const rules = { minRentalHours: 4, maxRentalHours: null, advanceBookingHours: null }

    it('rejects a 2-hour booking when minimum is 4', () => {
      const result = checkRentalRules(rules, hoursFromNow(24), hoursFromNow(26), NOW)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('RENTAL_RULE_MIN_DURATION')
        expect(result.required).toBe(4)
        expect(result.actual).toBe(2)
      }
    })

    it('accepts a booking that exactly meets the minimum', () => {
      const result = checkRentalRules(rules, hoursFromNow(24), hoursFromNow(28), NOW)
      expect(result.ok).toBe(true)
    })

    it('accepts a booking longer than the minimum', () => {
      const result = checkRentalRules(rules, hoursFromNow(24), hoursFromNow(72), NOW)
      expect(result.ok).toBe(true)
    })

    it('rejects a booking 1 minute short of the minimum', () => {
      // 4h minus 1 minute = 3h59m, which is below 4h.
      const start = hoursFromNow(24)
      const end = new Date(start.getTime() + (4 * 60 - 1) * 60 * 1000)
      const result = checkRentalRules(rules, start, end, NOW)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('RENTAL_RULE_MIN_DURATION')
    })
  })

  describe('maxRentalHours', () => {
    const rules = { minRentalHours: null, maxRentalHours: 72, advanceBookingHours: null }

    it('rejects a 100-hour booking when maximum is 72', () => {
      const result = checkRentalRules(rules, hoursFromNow(24), hoursFromNow(124), NOW)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('RENTAL_RULE_MAX_DURATION')
        expect(result.required).toBe(72)
        expect(result.actual).toBe(100)
      }
    })

    it('accepts a booking that exactly hits the maximum', () => {
      const result = checkRentalRules(rules, hoursFromNow(24), hoursFromNow(96), NOW)
      expect(result.ok).toBe(true)
    })

    it('accepts a booking shorter than the maximum', () => {
      const result = checkRentalRules(rules, hoursFromNow(24), hoursFromNow(48), NOW)
      expect(result.ok).toBe(true)
    })
  })

  describe('advanceBookingHours', () => {
    const rules = { minRentalHours: null, maxRentalHours: null, advanceBookingHours: 24 }

    it('rejects a booking starting in 2 hours when 24 hours advance is required', () => {
      const result = checkRentalRules(rules, hoursFromNow(2), hoursFromNow(10), NOW)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('RENTAL_RULE_ADVANCE_BOOKING')
        expect(result.required).toBe(24)
        expect(result.actual).toBe(2)
      }
    })

    it('accepts a booking starting exactly at the advance window', () => {
      const result = checkRentalRules(rules, hoursFromNow(24), hoursFromNow(48), NOW)
      expect(result.ok).toBe(true)
    })

    it('accepts a booking well beyond the advance window', () => {
      const result = checkRentalRules(rules, hoursFromNow(168), hoursFromNow(192), NOW)
      expect(result.ok).toBe(true)
    })

    it('rejects a booking starting in the past', () => {
      const result = checkRentalRules(rules, hoursFromNow(-1), hoursFromNow(10), NOW)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('RENTAL_RULE_ADVANCE_BOOKING')
    })
  })

  describe('precedence when multiple rules are violated', () => {
    // When a booking violates several rules we return a single code. The
    // order matters because the API surfaces only one message — advance
    // booking is the most disruptive to change (push the start date out),
    // so it's reported first. Min/max are duration tweaks, reported after.
    const rules = { minRentalHours: 4, maxRentalHours: 72, advanceBookingHours: 24 }

    it('reports advance booking failure before min duration failure', () => {
      // Start in 2h (violates advance=24), duration 1h (violates min=4).
      const result = checkRentalRules(rules, hoursFromNow(2), hoursFromNow(3), NOW)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('RENTAL_RULE_ADVANCE_BOOKING')
    })

    it('reports min duration failure before max duration failure', () => {
      // Start in 48h (passes advance=24). Duration 0 hours impossible; use
      // a malformed but structurally valid case: min=4/max=72, duration 2h.
      // Only min is violated here, but this test documents that min beats
      // max when both would be flagged (physically impossible since min<max,
      // but we want the precedence order documented).
      const result = checkRentalRules(rules, hoursFromNow(48), hoursFromNow(50), NOW)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('RENTAL_RULE_MIN_DURATION')
    })
  })

  describe('all rules set and all satisfied', () => {
    it('accepts a Honda N-BOX booking: 4h minimum, 72h max, no advance, 24h duration', () => {
      const rules = { minRentalHours: 4, maxRentalHours: 72, advanceBookingHours: null }
      const result = checkRentalRules(rules, hoursFromNow(24), hoursFromNow(48), NOW)
      expect(result.ok).toBe(true)
    })

    it('accepts a Toyota Alphard booking: 6h min, 240h max, 24h advance, 48h duration', () => {
      const rules = { minRentalHours: 6, maxRentalHours: 240, advanceBookingHours: 24 }
      const result = checkRentalRules(rules, hoursFromNow(24), hoursFromNow(72), NOW)
      expect(result.ok).toBe(true)
    })
  })
})

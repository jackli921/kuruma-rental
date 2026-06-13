import { describe, expect, it } from 'vitest'
import { jstYearMonth } from '../lib/admin-revenue'
import { computePlatformCommission } from '../lib/commission'
import { demoPaymentRows } from './seed-bookings'
import { DEMO_BOOKINGS } from './seed-data'

// Fixed clock so the JST-month spread is deterministic regardless of when the
// suite runs (the seed shell passes `new Date()`; this passes a frozen instant).
const NOW = new Date('2026-06-15T03:00:00.000Z')

describe('demoPaymentRows', () => {
  it('emits one SUCCEEDED payment per non-cancelled booking', () => {
    const rows = demoPaymentRows(DEMO_BOOKINGS, NOW)
    const nonCancelled = DEMO_BOOKINGS.filter((b) => b.status !== 'CANCELLED')
    expect(rows).toHaveLength(nonCancelled.length)
    expect(rows.every((r) => r.status === 'SUCCEEDED')).toBe(true)
  })

  it('skips cancelled bookings — a refunded/voided booking earns no revenue', () => {
    const rows = demoPaymentRows(DEMO_BOOKINGS, NOW)
    const cancelledCodes = DEMO_BOOKINGS.filter((b) => b.status === 'CANCELLED').map(
      (b) => b.bookingCode,
    )
    expect(cancelledCodes.length).toBeGreaterThan(0)
    for (const code of cancelledCodes) {
      expect(rows.some((r) => r.stripeEventId.includes(code))).toBe(false)
    }
  })

  it('locks gross = total price and splits the 4% fee via commission.ts', () => {
    const rows = demoPaymentRows(DEMO_BOOKINGS, NOW)
    const booking = DEMO_BOOKINGS.find((b) => b.bookingCode === 'H7K2M9PQ') // CONFIRMED ¥18,000
    expect(booking).toBeDefined()
    const row = rows.find((r) => r.bookingId === booking?.id)
    expect(row).toBeDefined()
    expect(row?.grossJpy).toBe(18000)
    const { platformFeeJpy, netToPartnerJpy } = computePlatformCommission(18000)
    expect(row?.platformFeeJpy).toBe(platformFeeJpy) // 720
    expect(row?.netToPartnerJpy).toBe(netToPartnerJpy) // 17280
    // The webhook invariant: fee + net always sums back to gross (no yen lost).
    expect((row?.platformFeeJpy ?? 0) + (row?.netToPartnerJpy ?? 0)).toBe(row?.grossJpy)
  })

  it('spreads each partner across multiple JST months for a non-trivial breakdown', () => {
    const rows = demoPaymentRows(DEMO_BOOKINGS, NOW)
    const monthsByOperator = new Map<string, Set<string>>()
    for (const r of rows) {
      const months = monthsByOperator.get(r.operatorId) ?? new Set<string>()
      months.add(jstYearMonth(r.createdAt))
      monthsByOperator.set(r.operatorId, months)
    }
    const expectedOperators = new Set(
      DEMO_BOOKINGS.filter((b) => b.status !== 'CANCELLED').map((b) => b.operatorId),
    )
    expect(monthsByOperator.size).toBe(expectedOperators.size)
    for (const months of monthsByOperator.values()) {
      expect(months.size).toBeGreaterThanOrEqual(2)
    }
  })

  it('assigns unique stripe event + session ids (redelivery + one-success-per-booking seals)', () => {
    const rows = demoPaymentRows(DEMO_BOOKINGS, NOW)
    expect(new Set(rows.map((r) => r.stripeEventId)).size).toBe(rows.length)
    expect(new Set(rows.map((r) => r.stripeCheckoutSessionId)).size).toBe(rows.length)
  })
})

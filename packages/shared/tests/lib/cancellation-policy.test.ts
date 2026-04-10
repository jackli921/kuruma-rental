import { describe, expect, test } from 'vitest'
import { calculateCancellationFee } from '../../src/lib/cancellation-policy'

describe('calculateCancellationFee', () => {
  const totalPrice = 10000 // ¥10,000 in cents

  test('72h+ before pickup → FREE tier, 0% fee', () => {
    const pickupAt = new Date('2026-05-10T10:00:00Z')
    const now = new Date('2026-05-07T09:00:00Z') // 73h before

    const result = calculateCancellationFee(pickupAt, now, totalPrice)

    expect(result).toEqual({
      tier: 'FREE',
      feePercentage: 0,
      feeAmount: 0,
      refundAmount: 10000,
    })
  })

  test('48-72h before pickup → LOW tier, 30% fee', () => {
    const pickupAt = new Date('2026-05-10T10:00:00Z')
    const now = new Date('2026-05-08T00:00:00Z') // 58h before

    const result = calculateCancellationFee(pickupAt, now, totalPrice)

    expect(result).toEqual({
      tier: 'LOW',
      feePercentage: 0.3,
      feeAmount: 3000,
      refundAmount: 7000,
    })
  })

  test('24-48h before pickup → MEDIUM tier, 70% fee', () => {
    const pickupAt = new Date('2026-05-10T10:00:00Z')
    const now = new Date('2026-05-09T00:00:00Z') // 34h before

    const result = calculateCancellationFee(pickupAt, now, totalPrice)

    expect(result).toEqual({
      tier: 'MEDIUM',
      feePercentage: 0.7,
      feeAmount: 7000,
      refundAmount: 3000,
    })
  })

  test('< 24h before pickup → FULL tier, 100% fee', () => {
    const pickupAt = new Date('2026-05-10T10:00:00Z')
    const now = new Date('2026-05-10T00:00:00Z') // 10h before

    const result = calculateCancellationFee(pickupAt, now, totalPrice)

    expect(result).toEqual({
      tier: 'FULL',
      feePercentage: 1,
      feeAmount: 10000,
      refundAmount: 0,
    })
  })

  test('exactly 72h → FREE tier (boundary inclusive)', () => {
    const pickupAt = new Date('2026-05-10T10:00:00Z')
    const now = new Date('2026-05-07T10:00:00Z') // exactly 72h

    const result = calculateCancellationFee(pickupAt, now, totalPrice)

    expect(result.tier).toBe('FREE')
    expect(result.feePercentage).toBe(0)
  })

  test('exactly 48h → LOW tier (boundary inclusive)', () => {
    const pickupAt = new Date('2026-05-10T10:00:00Z')
    const now = new Date('2026-05-08T10:00:00Z') // exactly 48h

    const result = calculateCancellationFee(pickupAt, now, totalPrice)

    expect(result.tier).toBe('LOW')
    expect(result.feePercentage).toBe(0.3)
  })

  test('exactly 24h → MEDIUM tier (boundary inclusive)', () => {
    const pickupAt = new Date('2026-05-10T10:00:00Z')
    const now = new Date('2026-05-09T10:00:00Z') // exactly 24h

    const result = calculateCancellationFee(pickupAt, now, totalPrice)

    expect(result.tier).toBe('MEDIUM')
    expect(result.feePercentage).toBe(0.7)
  })

  test('after pickup time → FULL tier', () => {
    const pickupAt = new Date('2026-05-10T10:00:00Z')
    const now = new Date('2026-05-10T12:00:00Z') // 2h after

    const result = calculateCancellationFee(pickupAt, now, totalPrice)

    expect(result.tier).toBe('FULL')
    expect(result.feePercentage).toBe(1)
  })

  test('rounds fee to nearest cent', () => {
    const result = calculateCancellationFee(
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-08T00:00:00Z'), // LOW tier, 30%
      3333, // 30% of 3333 = 999.9 → rounds to 1000
    )

    expect(result.feeAmount).toBe(1000)
    expect(result.refundAmount).toBe(2333)
  })

  test('handles totalPrice of 0', () => {
    const result = calculateCancellationFee(
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-08T00:00:00Z'), // LOW tier
      0,
    )

    expect(result.feeAmount).toBe(0)
    expect(result.refundAmount).toBe(0)
  })
})

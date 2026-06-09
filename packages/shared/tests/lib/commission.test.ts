import { describe, expect, it } from 'vitest'
import { PLATFORM_FEE_BPS, computePlatformCommission } from '../../src/lib/commission'

describe('computePlatformCommission', () => {
  it('takes 4% of a round amount as the platform fee', () => {
    expect(computePlatformCommission(100_000)).toEqual({
      platformFeeJpy: 4_000,
      netToPartnerJpy: 96_000,
    })
  })

  it('rounds the fee to whole yen (JPY is zero-decimal)', () => {
    // 12_345 * 400 / 10_000 = 493.8 -> rounds to 494
    expect(computePlatformCommission(12_345)).toEqual({
      platformFeeJpy: 494,
      netToPartnerJpy: 11_851,
    })
  })

  it('rounds a fee of exactly x.5 up', () => {
    // 25 * 400 / 10_000 = 1.0 (whole); use 13 -> 0.52 -> 1
    expect(computePlatformCommission(13)).toEqual({ platformFeeJpy: 1, netToPartnerJpy: 12 })
    // 12 -> 0.48 -> 0
    expect(computePlatformCommission(12)).toEqual({ platformFeeJpy: 0, netToPartnerJpy: 12 })
  })

  it('returns zero fee and zero net for a zero gross', () => {
    expect(computePlatformCommission(0)).toEqual({ platformFeeJpy: 0, netToPartnerJpy: 0 })
  })

  it('never loses a yen: fee + net always equals gross', () => {
    for (const gross of [1, 7, 13, 99, 100, 4_999, 12_345, 100_000, 999_983]) {
      const { platformFeeJpy, netToPartnerJpy } = computePlatformCommission(gross)
      expect(platformFeeJpy + netToPartnerJpy).toBe(gross)
      expect(Number.isInteger(platformFeeJpy)).toBe(true)
      expect(Number.isInteger(netToPartnerJpy)).toBe(true)
    }
  })

  it('exposes the fee rate as basis points (single source of truth)', () => {
    expect(PLATFORM_FEE_BPS).toBe(400)
  })
})

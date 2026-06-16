import { buildCancellationPreview } from '@/vite/bookings/cancellation-preview'
import { describe, expect, it } from 'vitest'

// `buildCancellationPreview` is the functional core the renter cancel dialog
// renders (#856/#868). It wraps the shared `calculateCancellationFee` (whose
// tier math is tested in @kuruma/shared) and adds the one renter-facing decision
// the schedule alone can't express: whether `now` is already past pickup, in
// which case the tiered breakdown is moot and the full fee applies (#868 H2).
const NOW = new Date('2026-07-01T00:00:00.000Z')
const TOTAL = 20000

describe('buildCancellationPreview', () => {
  it('carries the shared tier breakdown for a cancellation before pickup', () => {
    // 50h before pickup -> LOW tier, 30% fee on a 20,000 total.
    const preview = buildCancellationPreview(new Date('2026-07-03T02:00:00.000Z'), NOW, TOTAL)
    expect(preview).toEqual({
      mode: 'tiered',
      tier: 'LOW',
      feePercentage: 0.3,
      feeAmount: 6000,
      refundAmount: 14000,
    })
  })

  it('flags a no-show (now past pickup) and applies the full fee', () => {
    const preview = buildCancellationPreview(new Date('2026-06-30T23:00:00.000Z'), NOW, TOTAL)
    expect(preview).toEqual({ mode: 'no-show', feeAmount: 20000 })
  })

  it('treats the exact pickup instant as a no-show', () => {
    expect(buildCancellationPreview(NOW, NOW, TOTAL).mode).toBe('no-show')
  })

  it('keeps a same-day FULL cancellation (still before pickup) as a tier display', () => {
    // 12h before pickup: same-day -> FULL tier (100% fee, 0 refund), but pickup
    // has NOT passed, so it's a tiered breakdown, not a no-show. Guards the
    // discriminant against being collapsed into `tier === 'FULL'`.
    const preview = buildCancellationPreview(new Date('2026-07-01T12:00:00.000Z'), NOW, TOTAL)
    expect(preview).toEqual({
      mode: 'tiered',
      tier: 'FULL',
      feePercentage: 1,
      feeAmount: 20000,
      refundAmount: 0,
    })
  })
})

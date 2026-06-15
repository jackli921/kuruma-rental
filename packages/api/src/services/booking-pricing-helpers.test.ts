import { describe, expect, it } from 'vitest'
import { composeBookingTotal } from './booking-pricing-helpers'

// The single source of truth for a booking's totalPrice composition, shared by
// initial creation and substitute() re-pricing (#862). #855 regressed precisely
// because add-on charges were folded into creation but not the swap path.
describe('composeBookingTotal', () => {
  it('returns the bare base when there is no insurance and no add-ons', () => {
    expect(
      composeBookingTotal({ baseJpy: 30000, insurancePerDayJpy: 0, days: 3, addOns: [] }),
    ).toBe(30000)
  })

  it('adds insurance priced per rental day', () => {
    // 30000 base + 1500/day * 3 days = 34500
    expect(
      composeBookingTotal({ baseJpy: 30000, insurancePerDayJpy: 1500, days: 3, addOns: [] }),
    ).toBe(34500)
  })

  it('folds every add-on flat charge into the total (the #855 regression)', () => {
    // 30000 base + 1500*3 insurance + (2000 + 800) add-ons = 37300
    expect(
      composeBookingTotal({
        baseJpy: 30000,
        insurancePerDayJpy: 1500,
        days: 3,
        addOns: [{ priceJpy: 2000 }, { priceJpy: 800 }],
      }),
    ).toBe(37300)
  })

  it('charges add-ons exactly once and ignores non-price fields on the snapshot', () => {
    // Real call sites pass full AddOnSnapshot objects (addOnId/name/priceJpy);
    // only priceJpy must reach the sum. A typed variable (not a literal) mirrors
    // that — base only + a single add-on => 32000.
    const addOns = [{ addOnId: 'a1', name: 'Child seat', priceJpy: 2000 }]
    expect(composeBookingTotal({ baseJpy: 30000, insurancePerDayJpy: 0, days: 1, addOns })).toBe(
      32000,
    )
  })
})

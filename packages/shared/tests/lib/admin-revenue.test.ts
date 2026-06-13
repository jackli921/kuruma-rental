import { describe, expect, it } from 'vitest'
import {
  type RevenueEvent,
  type RevenueOperator,
  aggregateRevenueByPartner,
  jstYearMonth,
} from '../../src/lib/admin-revenue'

const OP_A: RevenueOperator = { id: 'op-a', name: 'Best Car Rental', slug: 'best-car' }
const OP_B: RevenueOperator = { id: 'op-b', name: 'Aoki Rentals', slug: 'aoki' }

// Stored fee/net deliberately do NOT equal 4% of gross, to prove the aggregator
// SUMS the locked-in row values and never recomputes from gross.
function event(
  over: Partial<RevenueEvent> & Pick<RevenueEvent, 'operatorId' | 'createdAt'>,
): RevenueEvent {
  return {
    grossJpy: 10_000,
    platformFeeJpy: 400,
    netToPartnerJpy: 9_600,
    ...over,
  }
}

describe('jstYearMonth', () => {
  it('buckets by the Asia/Tokyo (UTC+9) calendar month', () => {
    // 23:59 JST on the 31st is still January.
    expect(jstYearMonth(new Date('2026-01-31T14:59:00Z'))).toBe('2026-01')
    // 01:00 JST on the 1st (16:00 UTC prior day) has rolled into February.
    expect(jstYearMonth(new Date('2026-01-31T16:00:00Z'))).toBe('2026-02')
  })

  it('rolls the year over at the JST boundary', () => {
    // 2026-12-31T15:00Z + 9h = 2027-01-01T00:00 JST.
    expect(jstYearMonth(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01')
  })
})

describe('aggregateRevenueByPartner', () => {
  it('returns an empty report (zero totals) when there are no payments', () => {
    expect(aggregateRevenueByPartner([], [OP_A, OP_B])).toEqual({
      partners: [],
      totals: { grossJpy: 0, platformFeeJpy: 0, netToPartnerJpy: 0, paymentCount: 0 },
    })
  })

  it('sums the stored fee/net per partner per month (never recomputes from gross)', () => {
    const report = aggregateRevenueByPartner(
      [
        event({ operatorId: 'op-a', createdAt: new Date('2026-03-10T03:00:00Z') }),
        event({ operatorId: 'op-a', createdAt: new Date('2026-03-20T03:00:00Z') }),
      ],
      [OP_A],
    )
    expect(report.partners).toHaveLength(1)
    const partner = report.partners[0]
    expect(partner).toMatchObject({
      operatorId: 'op-a',
      operatorName: 'Best Car Rental',
      operatorSlug: 'best-car',
      grossJpy: 20_000,
      platformFeeJpy: 800,
      netToPartnerJpy: 19_200,
      paymentCount: 2,
    })
    expect(partner?.months).toEqual([
      {
        month: '2026-03',
        grossJpy: 20_000,
        platformFeeJpy: 800,
        netToPartnerJpy: 19_200,
        paymentCount: 2,
      },
    ])
  })

  it('splits one partner across months, newest month first', () => {
    const report = aggregateRevenueByPartner(
      [
        event({ operatorId: 'op-a', createdAt: new Date('2026-02-15T03:00:00Z') }),
        event({ operatorId: 'op-a', createdAt: new Date('2026-04-15T03:00:00Z') }),
      ],
      [OP_A],
    )
    expect(report.partners[0]?.months.map((m) => m.month)).toEqual(['2026-04', '2026-02'])
  })

  it('orders partners by gross descending, then name ascending', () => {
    const report = aggregateRevenueByPartner(
      [
        // op-b earns more -> first.
        event({
          operatorId: 'op-b',
          grossJpy: 50_000,
          createdAt: new Date('2026-03-10T03:00:00Z'),
        }),
        event({
          operatorId: 'op-a',
          grossJpy: 10_000,
          createdAt: new Date('2026-03-10T03:00:00Z'),
        }),
      ],
      [OP_A, OP_B],
    )
    expect(report.partners.map((p) => p.operatorId)).toEqual(['op-b', 'op-a'])
  })

  it('computes grand totals across every partner and month', () => {
    const report = aggregateRevenueByPartner(
      [
        event({
          operatorId: 'op-a',
          grossJpy: 10_000,
          platformFeeJpy: 400,
          netToPartnerJpy: 9_600,
          createdAt: new Date('2026-03-10T03:00:00Z'),
        }),
        event({
          operatorId: 'op-b',
          grossJpy: 30_000,
          platformFeeJpy: 1_200,
          netToPartnerJpy: 28_800,
          createdAt: new Date('2026-04-10T03:00:00Z'),
        }),
      ],
      [OP_A, OP_B],
    )
    expect(report.totals).toEqual({
      grossJpy: 40_000,
      platformFeeJpy: 1_600,
      netToPartnerJpy: 38_400,
      paymentCount: 2,
    })
  })

  it('falls back to the operatorId when the operator is unknown (no silent drop)', () => {
    const report = aggregateRevenueByPartner(
      [event({ operatorId: 'ghost', createdAt: new Date('2026-03-10T03:00:00Z') })],
      [],
    )
    expect(report.partners[0]).toMatchObject({
      operatorId: 'ghost',
      operatorName: 'ghost',
      operatorSlug: 'ghost',
    })
  })
})

import { describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError } from '../middleware/auth'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryPaymentEventRepository } from '../repositories/in-memory/payment-event'
import type { PaymentEventRepository } from '../repositories/types'
import type { Operator, PaymentEvent } from '../stores'
import { AdminRevenueService } from './admin-revenue'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'
const ADMIN: CallerContext = { userId: 'admin-user', role: 'PLATFORM_ADMIN' }

function operator(id: string, name: string, slug: string): Operator {
  return { id, name, slug, preAuthHandoffUrl: null, createdAt: new Date(), updatedAt: new Date() }
}

function payment(
  over: Partial<PaymentEvent> & Pick<PaymentEvent, 'operatorId' | 'createdAt'>,
): PaymentEvent {
  return {
    id: crypto.randomUUID(),
    bookingId: crypto.randomUUID(),
    stripeEventId: crypto.randomUUID(),
    stripeCheckoutSessionId: crypto.randomUUID(),
    stripePaymentIntentId: null,
    grossJpy: 10_000,
    platformFeeJpy: 400,
    netToPartnerJpy: 9_600,
    currency: 'jpy',
    status: 'SUCCEEDED',
    ...over,
  }
}

const EVENTS: PaymentEvent[] = [
  payment({
    operatorId: OP_A,
    grossJpy: 10_000,
    platformFeeJpy: 400,
    netToPartnerJpy: 9_600,
    createdAt: new Date('2026-03-10T03:00:00Z'),
  }),
  payment({
    operatorId: OP_A,
    grossJpy: 20_000,
    platformFeeJpy: 800,
    netToPartnerJpy: 19_200,
    createdAt: new Date('2026-04-10T03:00:00Z'),
  }),
  payment({
    operatorId: OP_B,
    grossJpy: 50_000,
    platformFeeJpy: 2_000,
    netToPartnerJpy: 48_000,
    createdAt: new Date('2026-04-10T03:00:00Z'),
  }),
]

function seededRepos() {
  const operators = new Map<string, Operator>([
    [OP_A, operator(OP_A, 'Best Car Rental', 'best-car')],
    [OP_B, operator(OP_B, 'Aoki Rentals', 'aoki')],
  ])
  const payments = new Map<string, PaymentEvent>(EVENTS.map((e) => [e.id, e]))
  return {
    operatorRepo: new InMemoryOperatorRepository(operators),
    paymentRepo: new InMemoryPaymentEventRepository(payments),
  }
}

/**
 * Records exactly what the service asked the data layer for, so we can prove the
 * month filter + available-months derivation are pushed DOWN (bounded query +
 * distinct-months query) rather than materializing the whole table in JS (#717).
 */
class SpyPaymentEventRepository implements PaymentEventRepository {
  readonly listSucceededCalls: Array<string | undefined> = []
  monthsCallCount = 0
  constructor(private readonly inner: PaymentEventRepository) {}
  insert: PaymentEventRepository['insert'] = (e) => this.inner.insert(e)
  findSucceededByBookingId: PaymentEventRepository['findSucceededByBookingId'] = (id) =>
    this.inner.findSucceededByBookingId(id)
  async listSucceeded(month?: string): Promise<PaymentEvent[]> {
    this.listSucceededCalls.push(month)
    return this.inner.listSucceeded(month)
  }
  async listSucceededMonths(): Promise<string[]> {
    this.monthsCallCount += 1
    return this.inner.listSucceededMonths()
  }
  sumSucceededGrossJpy: PaymentEventRepository['sumSucceededGrossJpy'] = () =>
    this.inner.sumSucceededGrossJpy()
}

describe('AdminRevenueService.getReport (#717 — push month filter into the data layer)', () => {
  it('asks the repo for ONLY the requested month, not the whole table', async () => {
    const { operatorRepo, paymentRepo } = seededRepos()
    const spy = new SpyPaymentEventRepository(paymentRepo)
    await new AdminRevenueService(spy, operatorRepo).getReport(ADMIN, '2026-04')
    // The month must be pushed to the query — not fetched unbounded then filtered in JS.
    expect(spy.listSucceededCalls).toEqual(['2026-04'])
  })

  it('derives availableMonths from a dedicated distinct-months query', async () => {
    const { operatorRepo, paymentRepo } = seededRepos()
    const spy = new SpyPaymentEventRepository(paymentRepo)
    const report = await new AdminRevenueService(spy, operatorRepo).getReport(ADMIN, '2026-03')
    expect(spy.monthsCallCount).toBe(1)
    // Full set regardless of the selected month — the distinct query, not a JS re-scan.
    expect(report.availableMonths).toEqual(['2026-04', '2026-03'])
  })

  it('preserves the per-partner totals when scoped to a month', async () => {
    const { operatorRepo, paymentRepo } = seededRepos()
    const report = await new AdminRevenueService(paymentRepo, operatorRepo).getReport(
      ADMIN,
      '2026-04',
    )
    expect(report.selectedMonth).toBe('2026-04')
    expect(report.totals).toEqual({
      grossJpy: 70_000,
      platformFeeJpy: 2_800,
      netToPartnerJpy: 67_200,
      paymentCount: 2,
    })
    for (const p of report.partners) {
      expect(p.months.map((m) => m.month)).toEqual(['2026-04'])
    }
  })

  it('returns the full matrix and a null selectedMonth when no month is given', async () => {
    const { operatorRepo, paymentRepo } = seededRepos()
    const spy = new SpyPaymentEventRepository(paymentRepo)
    const report = await new AdminRevenueService(spy, operatorRepo).getReport(ADMIN)
    // No month => the repo is asked for everything (undefined bound), exactly once.
    expect(spy.listSucceededCalls).toEqual([undefined])
    expect(report.selectedMonth).toBeNull()
    expect(report.availableMonths).toEqual(['2026-04', '2026-03'])
    expect(report.totals.grossJpy).toBe(80_000)
  })

  it('gates non-platform callers before any data access (defence in depth)', async () => {
    const { operatorRepo, paymentRepo } = seededRepos()
    const spy = new SpyPaymentEventRepository(paymentRepo)
    await expect(
      new AdminRevenueService(spy, operatorRepo).getReport({
        userId: 'op-owner',
        role: 'OPERATOR_OWNER',
      }),
    ).rejects.toThrow(ForbiddenError)
    expect(spy.listSucceededCalls).toEqual([])
    expect(spy.monthsCallCount).toBe(0)
  })
})

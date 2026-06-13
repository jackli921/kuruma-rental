import type {
  AdminRevenueMonth,
  AdminRevenuePartner,
  AdminRevenueReport,
} from '../types/admin-revenue'

/**
 * Pure aggregation for the platform-admin partner revenue tab (#462). The shell
 * (AdminRevenueService) fetches the successful `payment_events` and operators;
 * this functional core groups them — no I/O, fully unit-testable.
 */

/** One successful payment, reduced to the fields revenue reporting needs. */
export interface RevenueEvent {
  operatorId: string
  /** Whole JPY locked at webhook time — SUMMED here, never recomputed. */
  grossJpy: number
  platformFeeJpy: number
  netToPartnerJpy: number
  createdAt: Date
}

/** Partner attribution for resolving names/slugs. */
export interface RevenueOperator {
  id: string
  name: string
  slug: string
}

// Japan observes no DST, so JST is a fixed UTC+9 — a constant offset is exact.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * The `YYYY-MM` calendar month of an instant in Asia/Tokyo. Payouts settle on
 * JST month boundaries, so a payment late on the 31st UTC that is already the
 * 1st in Tokyo belongs to the next month's payout.
 */
export function jstYearMonth(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 7)
}

/**
 * Scope events to a single JST payout month (`YYYY-MM`, #628). A pure pre-filter
 * for {@link aggregateRevenueByPartner}: filtering events first means the
 * resulting partner subtotals and grand totals all reflect just that month,
 * without the aggregator needing to know about filtering.
 */
export function filterEventsByMonth(
  events: readonly RevenueEvent[],
  month: string,
): RevenueEvent[] {
  return events.filter((e) => jstYearMonth(e.createdAt) === month)
}

/** The distinct JST months that have at least one payment, newest first (#628). */
export function availableRevenueMonths(events: readonly RevenueEvent[]): string[] {
  return [...new Set(events.map((e) => jstYearMonth(e.createdAt)))].sort((a, b) =>
    b.localeCompare(a),
  )
}

interface MonthAccumulator {
  grossJpy: number
  platformFeeJpy: number
  netToPartnerJpy: number
  paymentCount: number
}

function emptyMonth(): MonthAccumulator {
  return { grossJpy: 0, platformFeeJpy: 0, netToPartnerJpy: 0, paymentCount: 0 }
}

function addEvent(acc: MonthAccumulator, e: RevenueEvent): void {
  acc.grossJpy += e.grossJpy
  acc.platformFeeJpy += e.platformFeeJpy
  acc.netToPartnerJpy += e.netToPartnerJpy
  acc.paymentCount += 1
}

export function aggregateRevenueByPartner(
  events: readonly RevenueEvent[],
  operators: readonly RevenueOperator[],
): AdminRevenueReport {
  const operatorsById = new Map(operators.map((o) => [o.id, o]))
  // operatorId -> (month -> accumulator)
  const byPartner = new Map<string, Map<string, MonthAccumulator>>()

  for (const e of events) {
    const months = byPartner.get(e.operatorId) ?? new Map<string, MonthAccumulator>()
    const month = jstYearMonth(e.createdAt)
    const acc = months.get(month) ?? emptyMonth()
    addEvent(acc, e)
    months.set(month, acc)
    byPartner.set(e.operatorId, months)
  }

  const partners: AdminRevenuePartner[] = [...byPartner.entries()].map(([operatorId, months]) => {
    const op = operatorsById.get(operatorId)
    // Fallback to the id (never silently drop revenue if an operator row is missing).
    const subtotal = emptyMonth()
    const monthRows: AdminRevenueMonth[] = [...months.entries()]
      .map(([month, acc]) => {
        subtotal.grossJpy += acc.grossJpy
        subtotal.platformFeeJpy += acc.platformFeeJpy
        subtotal.netToPartnerJpy += acc.netToPartnerJpy
        subtotal.paymentCount += acc.paymentCount
        return { month, ...acc }
      })
      .sort((a, b) => b.month.localeCompare(a.month)) // newest first

    return {
      operatorId,
      operatorName: op?.name ?? operatorId,
      operatorSlug: op?.slug ?? operatorId,
      ...subtotal,
      months: monthRows,
    }
  })

  partners.sort((a, b) => b.grossJpy - a.grossJpy || a.operatorName.localeCompare(b.operatorName))

  const totals = partners.reduce<MonthAccumulator>((acc, p) => {
    acc.grossJpy += p.grossJpy
    acc.platformFeeJpy += p.platformFeeJpy
    acc.netToPartnerJpy += p.netToPartnerJpy
    acc.paymentCount += p.paymentCount
    return acc
  }, emptyMonth())

  return { partners, totals }
}

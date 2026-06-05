import { bookings, users, vehicles } from '@kuruma/shared/db/schema'
import type {
  Customer,
  CustomerBookingSummary,
  CustomerSort,
  CustomerWithBookings,
} from '@kuruma/shared/types/customer'
import type { SQL } from 'drizzle-orm'
import { and, asc, count, desc, eq, gt, ilike, lt, max, or, sql } from 'drizzle-orm'
import type { CustomerListFilters, CustomerRepository } from '../types'
import type { Db } from './shared'

export class DrizzleCustomerRepository implements CustomerRepository {
  constructor(private readonly db: Db) {}

  async findAllWithAggregates(filters: CustomerListFilters): Promise<Customer[]> {
    const sort: CustomerSort = filters.sort ?? 'lastBookingAt'

    const bookingCountExpr = count(bookings.id)
    // Exclude CANCELLED rows from the sum but keep them in the count.
    const totalSpentExpr = sql<number>`COALESCE(SUM(
      CASE WHEN ${bookings.status} = 'COMPLETED' THEN ${bookings.totalPrice} ELSE 0 END
    ), 0)::int`
    const lastBookingAtExpr = max(bookings.startAt)

    const conditions = []
    if (filters.search) {
      const q = `${filters.search.replaceAll('%', '\\%')}%`
      conditions.push(or(ilike(users.name, q), ilike(users.email, q))!)
    }

    let query = this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        language: users.language,
        country: users.country,
        bookingCount: bookingCountExpr,
        totalSpent: totalSpentExpr,
        lastBookingAt: lastBookingAtExpr,
      })
      .from(users)
      .innerJoin(bookings, eq(bookings.renterId, users.id))
      .groupBy(users.id)

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query
    }

    // Cursor pagination — seek-method on the sort column, breaking ties by id.
    if (filters.cursor) {
      const pivot = decodeCursor(filters.cursor)
      if (pivot) {
        const having = cursorHavingClause(sort, pivot, bookingCountExpr, lastBookingAtExpr)
        if (having) query = query.having(having) as typeof query
      }
    }

    const orderBy = buildOrderBy(sort, bookingCountExpr, lastBookingAtExpr)
    query = query.orderBy(...orderBy) as typeof query

    if (filters.limit) {
      query = query.limit(filters.limit) as typeof query
    }

    const rows = await query
    return rows.map(toCustomer)
  }

  async findByIdWithBookings(id: string): Promise<CustomerWithBookings | undefined> {
    const [user] = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        language: users.language,
        country: users.country,
      })
      .from(users)
      .where(eq(users.id, id))

    if (!user) return undefined

    const bookingRows = await this.db
      .select({
        id: bookings.id,
        vehicleId: bookings.assignedVehicleId,
        vehicleName: vehicles.name,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status,
        totalPrice: bookings.totalPrice,
      })
      .from(bookings)
      .leftJoin(vehicles, eq(vehicles.id, bookings.assignedVehicleId))
      .where(eq(bookings.renterId, id))
      .orderBy(desc(bookings.startAt))

    if (bookingRows.length === 0) return undefined

    const summaries: CustomerBookingSummary[] = bookingRows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicleId,
      vehicleName: r.vehicleName,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status: r.status,
      totalPrice: r.totalPrice,
    }))

    const bookingCount = summaries.length
    const totalSpent = summaries
      .filter((s) => s.status === 'COMPLETED')
      .reduce((sum, s) => sum + (s.totalPrice ?? 0), 0)
    const lastBookingAt = summaries[0]!.startAt

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      language: user.language,
      country: user.country,
      bookingCount,
      totalSpent,
      lastBookingAt,
      bookings: summaries,
    }
  }
}

type CursorPivot = { primary: string; id: string }

function decodeCursor(cursor: string): CursorPivot | undefined {
  const sep = cursor.indexOf('_')
  if (sep < 0) return undefined
  return { primary: cursor.slice(0, sep), id: cursor.slice(sep + 1) }
}

function cursorHavingClause(
  sort: CustomerSort,
  pivot: CursorPivot,
  bookingCountExpr: SQL<number>,
  lastBookingAtExpr: SQL<Date | null>,
): SQL | undefined {
  if (sort === 'bookingCount') {
    const n = Number(pivot.primary)
    if (!Number.isFinite(n)) return undefined
    return or(lt(bookingCountExpr, n), and(eq(bookingCountExpr, n), gt(users.id, pivot.id)))
  }
  if (sort === 'name') {
    return or(
      gt(users.name, pivot.primary),
      and(eq(users.name, pivot.primary), gt(users.id, pivot.id)),
    )
  }
  // lastBookingAt
  const cursorIso = pivot.primary
  return or(
    sql`${lastBookingAtExpr} < ${cursorIso}::timestamptz`,
    and(sql`${lastBookingAtExpr} = ${cursorIso}::timestamptz`, gt(users.id, pivot.id)),
  )
}

function buildOrderBy(
  sort: CustomerSort,
  bookingCountExpr: SQL<number>,
  lastBookingAtExpr: SQL<Date | null>,
) {
  if (sort === 'bookingCount') return [desc(bookingCountExpr), asc(users.id)] as const
  if (sort === 'name') return [asc(users.name), asc(users.id)] as const
  return [desc(lastBookingAtExpr), asc(users.id)] as const
}

function toCustomer(r: {
  id: string
  name: string | null
  email: string
  language: string
  country: string | null
  bookingCount: number
  totalSpent: number
  lastBookingAt: Date | null
}): Customer {
  if (!r.lastBookingAt) {
    throw new Error(`Customer ${r.id} has no bookings — should have been filtered out by INNER JOIN`)
  }
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    language: r.language,
    country: r.country,
    bookingCount: r.bookingCount,
    totalSpent: r.totalSpent,
    lastBookingAt: r.lastBookingAt.toISOString(),
  }
}

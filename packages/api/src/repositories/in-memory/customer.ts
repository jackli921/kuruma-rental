import type {
  Customer,
  CustomerBookingSummary,
  CustomerSort,
  CustomerWithBookings,
} from '@kuruma/shared/types/customer'
import type { Booking, User, Vehicle } from '../../stores'
import type { CustomerListFilters, CustomerRepository } from '../types'

export class InMemoryCustomerRepository implements CustomerRepository {
  constructor(
    private readonly users: Map<string, User>,
    private readonly bookings: Map<string, Booking>,
    private readonly vehicles: Map<string, Vehicle> = new Map(),
  ) {}

  async findAllWithAggregates(filters: CustomerListFilters): Promise<Customer[]> {
    const byRenter = groupBookingsByRenter(this.bookings)
    const rows: Customer[] = []

    for (const [renterId, bookings] of byRenter) {
      const user = this.users.get(renterId)
      if (!user) continue
      rows.push(aggregate(user, bookings))
    }

    const filtered = applySearch(rows, filters.search)
    const sorted = applySort(filtered, filters.sort ?? 'lastBookingAt')

    if (filters.cursor) {
      const pivot = decodeCursor(filters.cursor, filters.sort ?? 'lastBookingAt')
      if (pivot) {
        return sorted.filter((c) => isAfterCursor(c, pivot, filters.sort ?? 'lastBookingAt'))
      }
    }
    return sorted
  }

  async findByIdWithBookings(id: string): Promise<CustomerWithBookings | undefined> {
    const user = this.users.get(id)
    if (!user) return undefined

    const bookings = [...this.bookings.values()].filter((b) => b.renterId === id)
    if (bookings.length === 0) return undefined

    const agg = aggregate(user, bookings)
    const summaries: CustomerBookingSummary[] = bookings
      .slice()
      .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
      .map((b) => ({
        id: b.id,
        vehicleId: b.vehicleId,
        vehicleName: this.vehicles.get(b.vehicleId)?.name ?? null,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status: b.status,
        totalPrice: b.totalPrice,
      }))

    return { ...agg, bookings: summaries }
  }
}

function groupBookingsByRenter(bookings: Map<string, Booking>): Map<string, Booking[]> {
  const out = new Map<string, Booking[]>()
  for (const b of bookings.values()) {
    const list = out.get(b.renterId)
    if (list) list.push(b)
    else out.set(b.renterId, [b])
  }
  return out
}

function aggregate(user: User, bookings: Booking[]): Customer {
  const lastBookingAt = bookings.reduce(
    (max, b) => (b.startAt > max ? b.startAt : max),
    bookings[0]!.startAt,
  )
  const totalSpent = bookings
    .filter((b) => b.status === 'COMPLETED')
    .reduce((sum, b) => sum + (b.totalPrice ?? 0), 0)

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    language: user.language,
    country: user.country,
    bookingCount: bookings.length,
    lastBookingAt: lastBookingAt.toISOString(),
    totalSpent,
  }
}

function applySearch(rows: Customer[], search: string | undefined): Customer[] {
  if (!search) return rows
  const q = search.toLowerCase()
  return rows.filter(
    (r) =>
      (r.name?.toLowerCase() ?? '').startsWith(q) || (r.email?.toLowerCase() ?? '').startsWith(q),
  )
}

function applySort(rows: Customer[], sort: CustomerSort): Customer[] {
  const copy = rows.slice()
  if (sort === 'bookingCount') {
    copy.sort((a, b) => b.bookingCount - a.bookingCount || a.id.localeCompare(b.id))
  } else if (sort === 'name') {
    copy.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id))
  } else {
    copy.sort((a, b) => b.lastBookingAt.localeCompare(a.lastBookingAt) || a.id.localeCompare(b.id))
  }
  return copy
}

type CursorPivot = { primary: string | number; id: string }

function decodeCursor(cursor: string, _sort: CustomerSort): CursorPivot | undefined {
  const sep = cursor.indexOf('_')
  if (sep < 0) return undefined
  const primary = cursor.slice(0, sep)
  const id = cursor.slice(sep + 1)
  const asNum = Number(primary)
  return { primary: Number.isFinite(asNum) && /^-?\d+$/.test(primary) ? asNum : primary, id }
}

function isAfterCursor(c: Customer, pivot: CursorPivot, sort: CustomerSort): boolean {
  if (sort === 'bookingCount') {
    if (c.bookingCount < (pivot.primary as number)) return true
    if (c.bookingCount === (pivot.primary as number) && c.id > pivot.id) return true
    return false
  }
  if (sort === 'name') {
    const cmp = (c.name ?? '').localeCompare(pivot.primary as string)
    if (cmp > 0) return true
    if (cmp === 0 && c.id > pivot.id) return true
    return false
  }
  const cmp = c.lastBookingAt.localeCompare(pivot.primary as string)
  if (cmp < 0) return true
  if (cmp === 0 && c.id > pivot.id) return true
  return false
}

import type { Customer, CustomerSort, CustomerWithBookings } from '@kuruma/shared/types/customer'
import type { CustomerListFilters, CustomerRepository } from '../repositories/types'

export interface CustomerListQuery {
  limit: number
  cursor?: string | undefined
  sort?: CustomerSort | undefined
  search?: string | undefined
}

export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async findAllPaginated(
    q: CustomerListQuery,
  ): Promise<{ data: Customer[]; nextCursor: string | null }> {
    const filters: CustomerListFilters = {
      limit: q.limit + 1, // overfetch by 1 to detect hasMore
      cursor: q.cursor,
      sort: q.sort,
      search: q.search,
    }
    const rows = await this.repo.findAllWithAggregates(filters)
    const hasMore = rows.length > q.limit
    const data = hasMore ? rows.slice(0, q.limit) : rows
    const last = data[data.length - 1]
    const nextCursor = hasMore && last ? encodeCursor(last, q.sort ?? 'lastBookingAt') : null
    return { data, nextCursor }
  }

  async findById(id: string): Promise<CustomerWithBookings | undefined> {
    return this.repo.findByIdWithBookings(id)
  }
}

function encodeCursor(c: Customer, sort: CustomerSort): string {
  if (sort === 'bookingCount') return `${c.bookingCount}_${c.id}`
  if (sort === 'name') return `${c.name ?? ''}_${c.id}`
  return `${c.lastBookingAt}_${c.id}`
}

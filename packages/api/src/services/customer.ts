import type { Customer, CustomerSort, CustomerWithBookings } from '@kuruma/shared/types/customer'
import type { CustomerListFilters, CustomerRepository, UserRepository } from '../repositories/types'
import type { User } from '../stores'

export interface CustomerListQuery {
  limit: number
  cursor?: string | undefined
  sort?: CustomerSort | undefined
  search?: string | undefined
}

export class CustomerService {
  constructor(
    private readonly customerRepo: CustomerRepository,
    private readonly userRepo: UserRepository,
  ) {}

  async findAllPaginated(
    q: CustomerListQuery,
  ): Promise<{ data: Customer[]; nextCursor: string | null }> {
    const filters: CustomerListFilters = {
      limit: q.limit + 1, // overfetch by 1 to detect hasMore
      cursor: q.cursor,
      sort: q.sort,
      search: q.search,
    }
    const rows = await this.customerRepo.findAllWithAggregates(filters)
    const hasMore = rows.length > q.limit
    const data = hasMore ? rows.slice(0, q.limit) : rows
    const last = data[data.length - 1]
    const nextCursor = hasMore && last ? encodeCursor(last, q.sort ?? 'lastBookingAt') : null
    return { data, nextCursor }
  }

  async findById(id: string): Promise<CustomerWithBookings | undefined> {
    return this.customerRepo.findByIdWithBookings(id)
  }

  async search(query: string): Promise<User[]> {
    return this.userRepo.search(query)
  }

  async quickCreate(input: {
    name: string
    email?: string | undefined
    phone?: string | undefined
    language: string
  }): Promise<{ user: User; created: boolean }> {
    // Email is a case-insensitive identity (#715): normalize at the boundary so
    // Bob@x.com and bob@x.com resolve to one human, not two rows.
    const email = input.email?.toLowerCase()
    // Fast-path: if a customer already exists for this email/phone, return it
    // without attempting an insert. The repository also handles concurrent
    // inserts idempotently, but this short-circuits the common case.
    if (email) {
      const existing = await this.userRepo.findByEmail(email)
      if (existing) return { user: existing, created: false }
    }
    if (input.phone) {
      const existing = await this.userRepo.findByPhone(input.phone)
      if (existing) return { user: existing, created: false }
    }

    const user = await this.userRepo.quickCreate({
      name: input.name,
      email: email ?? null,
      phone: input.phone ?? null,
      language: input.language,
    })
    return { user, created: true }
  }
}

function encodeCursor(c: Customer, sort: CustomerSort): string {
  if (sort === 'bookingCount') return `${c.bookingCount}_${c.id}`
  if (sort === 'name') return `${c.name ?? ''}_${c.id}`
  return `${c.lastBookingAt}_${c.id}`
}

import type { Customer, CustomerSort, CustomerWithBookings } from '@kuruma/shared/types/customer'
import type { CallerContext } from '../auth/context'
import { PRIVILEGED_ROLES } from '../middleware/auth'
import type {
  BookingRepository,
  CustomerListFilters,
  CustomerRepository,
  UserRepository,
} from '../repositories/types'
import type { User } from '../stores'

export interface CustomerListQuery {
  limit: number
  cursor?: string | undefined
  sort?: CustomerSort | undefined
  search?: string | undefined
}

/**
 * Customer directory for the platform screen + operator manual booking (#589).
 *
 * findAllPaginated (full list) and findById (cross-operator booking history) stay
 * PLATFORM_ADMIN-only — they take no scope and would leak every operator's
 * customers if widened. search() is the ONE operator-reachable method: it threads
 * CallerContext and scopes an OPERATOR_* caller to renters within its own tenant
 * boundary (those with a prior booking with it), so manual-booking can't become a
 * global user-enumeration vector (#396/#475). Only PRIVILEGED_ROLES (PLATFORM_ADMIN
 * since #1168) search the full user table — PARTNER does NOT, even though it carries
 * bypassScope. The route gate (routes/customers.ts) mirrors this split.
 */
export class CustomerService {
  constructor(
    private readonly customerRepo: CustomerRepository,
    private readonly userRepo: UserRepository,
    private readonly bookingRepo: BookingRepository,
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

  async search(query: string, ctx: CallerContext, actingOperatorId?: string): Promise<User[]> {
    const matches = await this.userRepo.search(query)
    // Only the privileged platform tier searches the full user table. Gated on
    // PRIVILEGED_ROLES (PLATFORM_ADMIN-only since #1168), NOT the coarse
    // `bypassScope` flag — that also carries PARTNER, which must never enumerate
    // the cross-tenant directory. The route already 403s PARTNER (#1116); this is
    // the service-layer seal (defense-in-depth, mirrors #1119).
    // #1260: when that admin is acting through the operator picker (?operatorId=),
    // its manual-booking search scopes to the picked operator's customers so it can
    // only offer renters it can actually book (the create-time customer scope would
    // otherwise 403 a foreign pick). No pick -> full directory (admin screen).
    if (PRIVILEGED_ROLES.has(ctx.role)) {
      return actingOperatorId ? this.scopeToOperatorCustomers(matches, actingOperatorId) : matches
    }
    // An operator only resolves renters within its own tenant boundary — those
    // with a prior booking with it — so manual-booking can't enumerate the global
    // user table (#396/#475). Fail closed if somehow operator-less.
    if (!ctx.operatorId) return []
    return this.scopeToOperatorCustomers(matches, ctx.operatorId)
  }

  // Narrow a user-search result to an operator's own customers — those with a prior
  // booking with it (listRenterIdsForOperator). NOTE (MVP): userRepo.search caps at
  // 20 by text first, so an in-scope name past that cap could be missed for a very
  // large customer base; fine for the picker at MVP scale.
  private async scopeToOperatorCustomers(matches: User[], operatorId: string): Promise<User[]> {
    const allowed = new Set(await this.bookingRepo.listRenterIdsForOperator(operatorId))
    return matches.filter((u) => allowed.has(u.id))
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

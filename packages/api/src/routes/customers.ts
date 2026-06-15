import { quickCreateCustomerSchema } from '@kuruma/shared/validators/customer'
import { Hono } from 'hono'
import { toCallerContext } from '../auth/context'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { CustomerService } from '../services/customer'
import { fail, ok, parseBody, parseId, parseLimit } from './helpers'

const ALLOWED_SORTS = new Set(['lastBookingAt', 'bookingCount', 'name'])

export function createCustomerRoutes(service: CustomerService) {
  const app = new Hono()

  // /customers (full list) and /customers/:id return cross-operator data and stay
  // PLATFORM_ADMIN-only; /customers/quick-create likewise (operator walk-ins are
  // created atomically via POST /bookings instead — #589). /customers/search is
  // the ONE operator-reachable route: CustomerService.search scopes an OPERATOR_*
  // caller to its own renters (prior-booking), so it can't enumerate the global
  // user table (cf. #396/#475). Anything not explicitly operator-allowed → 403.
  app.use('/customers', requireStaff)
  app.use('/customers/*', async (c, next) => {
    const ctx = toCallerContext(requireUser(c))
    if (STAFF_ROLES.has(ctx.role)) return next()
    if (c.req.path.endsWith('/customers/search') && ctx.operatorId) return next()
    return fail(c, 'Forbidden', 403)
  })

  return app
    .get('/customers', async (c) => {
      const pg = parseLimit(c, { defaultLimit: 50 })
      if (!pg.ok) return pg.response

      const sortRaw = c.req.query('sort')
      if (sortRaw && !ALLOWED_SORTS.has(sortRaw)) {
        return fail(c, `sort must be one of ${[...ALLOWED_SORTS].join(', ')}`, 400)
      }
      const search = c.req.query('search')?.trim()
      const cursor = c.req.query('cursor')

      const result = await service.findAllPaginated({
        limit: pg.limit,
        sort: sortRaw as 'lastBookingAt' | 'bookingCount' | 'name' | undefined,
        cursor: cursor || undefined,
        search: search || undefined,
      })
      return ok(c, result.data, 200, { nextCursor: result.nextCursor })
    })
    .get('/customers/search', async (c) => {
      // Flat user lookup for the manual-booking dialog. Separate from the
      // paginated list above so callers get a predictable User[] shape.
      const q = c.req.query('q')
      if (!q || q.length < 2) {
        return fail(c, 'Search query must be at least 2 characters', 400)
      }
      const customers = await service.search(q, toCallerContext(requireUser(c)))
      return ok(c, customers)
    })
    .post('/customers/quick-create', async (c) => {
      const parsed = await parseBody(c, quickCreateCustomerSchema)
      if (!parsed.ok) return parsed.response

      const { user: customer, created } = await service.quickCreate(parsed.data)
      return ok(c, customer, created ? 201 : 200)
    })
    .get('/customers/:id', async (c) => {
      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response
      const customer = await service.findById(idResult.id)
      if (!customer) return fail(c, 'Customer not found', 404)
      return ok(c, customer)
    })
}

async function requireStaff(
  c: Parameters<Parameters<Hono['use']>[1]>[0],
  next: () => Promise<void>,
) {
  const user = requireUser(c)
  if (!STAFF_ROLES.has(user.role)) {
    return fail(c, 'Forbidden', 403)
  }
  return next()
}

import { quickCreateCustomerSchema } from '@kuruma/shared/validators/customer'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { toCallerContext } from '../auth/context'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { CustomerService } from '../services/customer'
import { fail, ok, parseBody, parseId, parseLimit } from './helpers'

const ALLOWED_SORTS = new Set(['lastBookingAt', 'bookingCount', 'name'])

// Staff-default authz used by every /customers route except `/customers/search`
// (which widens to operator-with-tenant — see its handler). Bound to the route,
// not pattern-matched on `c.req.path`, so a future `/customers/something-else`
// can't silently inherit a different policy from a path-prefix carve-out.
function rejectIfNotStaff(c: Context): Response | null {
  const ctx = toCallerContext(requireUser(c))
  if (!STAFF_ROLES.has(ctx.role)) return fail(c, 'Forbidden', 403)
  return null
}

export function createCustomerRoutes(service: CustomerService) {
  const app = new Hono()

  return app
    .get('/customers', async (c) => {
      const denied = rejectIfNotStaff(c)
      if (denied) return denied

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
      // The ONE operator-reachable route in this module: `CustomerService.search`
      // scopes an OPERATOR_* caller to its own renters (those with a prior
      // booking with it), so a tenant-scoped caller can't enumerate the global
      // user table (cf. #396/#475). Anything else without staff → 403.
      const ctx = toCallerContext(requireUser(c))
      if (!STAFF_ROLES.has(ctx.role) && !ctx.operatorId) {
        return fail(c, 'Forbidden', 403)
      }

      // Flat user lookup for the manual-booking dialog. Separate from the
      // paginated list above so callers get a predictable User[] shape.
      const q = c.req.query('q')
      if (!q || q.length < 2) {
        return fail(c, 'Search query must be at least 2 characters', 400)
      }
      // #1260: a picker admin (PLATFORM_ADMIN) scopes the manual-booking search to
      // the operator it is acting as; without a pick it keeps the full-directory
      // search. A tenant operator's own scope is unaffected (the service ignores it).
      const actingOperatorId = c.req.query('operatorId')
      const customers = await service.search(q, ctx, actingOperatorId)
      return ok(c, customers)
    })
    .post('/customers/quick-create', async (c) => {
      const denied = rejectIfNotStaff(c)
      if (denied) return denied

      const parsed = await parseBody(c, quickCreateCustomerSchema)
      if (!parsed.ok) return parsed.response

      const { user: customer, created } = await service.quickCreate(parsed.data)
      return ok(c, customer, created ? 201 : 200)
    })
    .get('/customers/:id', async (c) => {
      const denied = rejectIfNotStaff(c)
      if (denied) return denied

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response
      const customer = await service.findById(idResult.id)
      if (!customer) return fail(c, 'Customer not found', 404)
      return ok(c, customer)
    })
}

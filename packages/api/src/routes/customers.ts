import { quickCreateCustomerSchema } from '@kuruma/shared/validators/customer'
import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { CustomerService } from '../services/customer'
import { fail, ok, parseLimit } from './helpers'

const ALLOWED_SORTS = new Set(['lastBookingAt', 'bookingCount', 'name'])

export function createCustomerRoutes(service: CustomerService) {
  const app = new Hono()

  // All customer routes are staff-only.
  app.use('/customers', requireStaff)
  app.use('/customers/*', requireStaff)

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
      const customers = await service.search(q)
      return ok(c, customers)
    })
    .post('/customers/quick-create', async (c) => {
      const body = await c.req.json()
      const result = quickCreateCustomerSchema.safeParse(body)
      if (!result.success) {
        return fail(c, result.error.flatten().fieldErrors as Record<string, unknown>, 400)
      }

      const { user: customer, created } = await service.quickCreate(result.data)
      return ok(c, customer, created ? 201 : 200)
    })
    .get('/customers/:id', async (c) => {
      const customer = await service.findById(c.req.param('id'))
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

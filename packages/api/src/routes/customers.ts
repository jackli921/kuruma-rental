import { quickCreateCustomerSchema } from '@kuruma/shared/validators/customer'
import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { CustomerService } from '../services/customer'
import { fail, ok } from './helpers'

export function createCustomerRoutes(service: CustomerService) {
  return new Hono()
    .get('/customers', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const search = c.req.query('search')
      if (!search || search.length < 2) {
        return fail(c, 'Search query must be at least 2 characters', 400)
      }

      const customers = await service.search(search)
      return ok(c, customers)
    })
    .post('/customers/quick-create', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const body = await c.req.json()
      const result = quickCreateCustomerSchema.safeParse(body)
      if (!result.success) {
        return fail(c, result.error.flatten().fieldErrors as Record<string, unknown>, 400)
      }

      const { user: customer, created } = await service.quickCreate(result.data)
      return ok(c, customer, created ? 201 : 200)
    })
}

import { updateOperatorSchema } from '@kuruma/shared/validators/operator'
import { Hono } from 'hono'
import { FLEET_WRITE_ROLES, requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import type { OperatorService } from '../services/operator'
import { fail, ok, parseBody, parseId } from './helpers'

/**
 * Read-only operator resolution for the business portal (#387). The web layout
 * resolves the `/manage/<slug>` URL segment to an operator id, and the sidebar
 * resolves the caller's own slug. Operator listing / mutation stays out of
 * slice 2 (operator bootstrap lives in the env-gated admin routes).
 */
export function createOperatorRoutes(service: OperatorService) {
  const app = new Hono()

  // `/operators/*` does not match the bare `/operators` collection path, so gate
  // it explicitly; `requireUser` in each handler is the 401 backstop regardless.
  app.use('/operators', requireAuth())
  app.use('/operators/*', requireAuth())

  return (
    app
      // List operators for the admin picker (#407). Bypass roles see all; an
      // OPERATOR_* caller sees only its own row (scoped in the service).
      .get('/operators', async (c) => {
        const user = requireUser(c)
        if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

        const operators = await service.list(toCallerContext(user))
        return ok(
          c,
          operators.map(({ id, name, slug }) => ({ id, name, slug })),
        )
      })
      // The literal `by-slug` segment MUST be registered before the parametric
      // `:id` so `/operators/by-slug/foo` can never be captured as an id.
      .get('/operators/by-slug/:slug', async (c) => {
        const user = requireUser(c)
        if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

        const operator = await service.getBySlug(toCallerContext(user), c.req.param('slug'))
        if (!operator) return fail(c, 'Operator not found', 404)
        return ok(c, operator)
      })
      .get('/operators/:id', async (c) => {
        const user = requireUser(c)
        if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

        const idResult = parseId(c)
        if (!idResult.ok) return idResult.response

        const operator = await service.getById(toCallerContext(user), idResult.id)
        if (!operator) return fail(c, 'Operator not found', 404)
        return ok(c, operator)
      })
      // Operator self-service profile update (#903). FLEET_WRITE gate is the
      // baseline (an OPERATOR_STAFF may edit the display name); the owner-only
      // `preAuthHandoffUrl` is enforced in the service AFTER the 404 check, so a
      // foreign id never surfaces as a 403. The service projects the response.
      .patch('/operators/:id', async (c) => {
        const user = requireUser(c)
        if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

        const idResult = parseId(c)
        if (!idResult.ok) return idResult.response

        const parsed = await parseBody(c, updateOperatorSchema)
        if (!parsed.ok) return parsed.response

        const profile = await service.update(toCallerContext(user), idResult.id, parsed.data)
        if (!profile) return fail(c, 'Operator not found', 404)
        return ok(c, profile)
      })
  )
}

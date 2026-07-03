import { inviteStaffSchema } from '@kuruma/shared/validators/provider-invite'
import { Hono } from 'hono'
import { requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import type { OperatorTeamService } from '../services/operator-team'
import { ok, parseBody } from './helpers'

/**
 * #904: operator self-service team management. The tenant is ALWAYS the caller's
 * own operator — these are `/operators/me/*` paths with no id segment, so there
 * is no foreign-id surface to scope-check or leak. Owner-vs-member gating and the
 * absent-tenant seal live in `OperatorTeamService`; a denied write surfaces as a
 * 403 via the global `ForbiddenError` handler, so the routes stay HTTP-only.
 */
export function createOperatorTeamRoutes(service: OperatorTeamService) {
  const app = new Hono()

  app.use('/operators/me/*', requireAuth())

  return app
    .post('/operators/me/invites', async (c) => {
      const user = requireUser(c)
      const parsed = await parseBody(c, inviteStaffSchema)
      if (!parsed.ok) return parsed.response

      const created = await service.inviteStaff(toCallerContext(user), parsed.data)
      // The URL embeds the one-time token (never persisted in cleartext); the
      // owner copies it to share. We omit the bare `token` field — the URL is the
      // only form the page needs.
      return ok(c, { inviteUrl: created.inviteUrl, expiresAt: created.expiresAt }, 201)
    })
    .get('/operators/me/invites', async (c) => {
      const invites = await service.listInvites(
        toCallerContext(requireUser(c)),
        c.req.query('operatorId'),
      )
      return ok(c, invites)
    })
    .post('/operators/me/invites/:id/revoke', async (c) => {
      const id = c.req.param('id')
      // Owner-only + tenant scope live in the service; an unknown/foreign id
      // throws NotFoundError (-> 404) via the global handler, so no id is leaked.
      await service.revokeInvite(toCallerContext(requireUser(c)), id)
      return ok(c, { id })
    })
    .get('/operators/me/members', async (c) => {
      const members = await service.listMembers(
        toCallerContext(requireUser(c)),
        c.req.query('operatorId'),
      )
      return ok(c, members)
    })
    .post('/operators/me/members/:id/deactivate', async (c) => {
      const id = c.req.param('id')
      // Owner-only + tenant scope + last-owner lockout live in the service: an
      // unknown/foreign id throws NotFoundError (-> 404) and the last owner throws
      // ConflictError (-> 409), both via the global handler, so no id is leaked.
      await service.deactivateMember(toCallerContext(requireUser(c)), id)
      return ok(c, { id })
    })
}

import { Hono } from 'hono'
import { requireAuth, requirePlatformRead, requireUser, toCallerContext } from '../middleware/auth'
import type { TemplateLibraryService } from '../services/template-library'
import { ok } from './helpers'

/**
 * Platform-admin template library (#1319). Mounts under `/admin/*`, so the
 * structural platform read-floor (`requirePlatformMember`) already gates the
 * path; the per-handler `requirePlatformRead` is defence in depth (AGENTS.md) and
 * the service re-asserts it. Read-only in slice 1 — the admin sees every add-on
 * and insurance template, ALL statuses, so it can later translate + promote the
 * ARCHIVED, en-only rows the slice-2/3 backfills mint.
 */
export function createAdminTemplateRoutes(service: TemplateLibraryService) {
  const app = new Hono()
  app.use('/admin/templates', requireAuth())

  return app.get('/admin/templates', async (c) => {
    const ctx = toCallerContext(requireUser(c))
    requirePlatformRead(ctx)
    return ok(c, await service.listAll(ctx))
  })
}

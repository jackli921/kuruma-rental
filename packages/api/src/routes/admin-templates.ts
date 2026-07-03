import {
  type TemplateCreate,
  type TemplatePatch,
  templateCreateSchema,
  templatePatchSchema,
} from '@kuruma/shared/types/template-admin'
import { type Context, Hono } from 'hono'
import {
  type CallerContext,
  requireAuth,
  requirePlatformRead,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { TemplateLibraryService } from '../services/template-library'
import { ok, parseBody, parseId } from './helpers'

type PatchInput =
  | { ok: true; id: string; patch: TemplatePatch; ctx: CallerContext }
  | { ok: false; response: Response }

/**
 * Parse + validate a template PATCH at the HTTP boundary: a uuid `:id`, a
 * non-empty patch body, and the caller context. Returns a short-circuit response
 * on a bad id (400) or body (400); the service applies the `requirePlatformAdmin`
 * write gate (403) and the not-found (404), so those stay out of the route.
 */
async function parsePatch(c: Context): Promise<PatchInput> {
  const idResult = parseId(c)
  if (!idResult.ok) return idResult
  const parsed = await parseBody(c, templatePatchSchema)
  if (!parsed.ok) return parsed
  return { ok: true, id: idResult.id, patch: parsed.data, ctx: toCallerContext(requireUser(c)) }
}

type CreateInput =
  | { ok: true; data: TemplateCreate; ctx: CallerContext }
  | { ok: false; response: Response }

/**
 * Parse + validate a template POST at the HTTP boundary: the create body (`name`
 * required; `key` is NOT accepted — the service derives it) and the caller
 * context. A malformed body is a 400 here; the service applies the
 * `requirePlatformAdmin` write gate (403) and the duplicate-key (409).
 */
async function parseCreate(c: Context): Promise<CreateInput> {
  const parsed = await parseBody(c, templateCreateSchema)
  if (!parsed.ok) return parsed
  return { ok: true, data: parsed.data, ctx: toCallerContext(requireUser(c)) }
}

/**
 * Platform-admin template library (#1319). Mounts under `/admin/*`, so the
 * structural platform read-floor already gates the path; per-handler guards are
 * defence in depth (AGENTS.md). Slice 1 read (`GET`) exposes every status; slice
 * 2 adds the curation WRITES (`PATCH`) — translate/edit the localized bundles and
 * promote an ARCHIVED backfill-minted row to ACTIVE; slice 3 adds `POST` to mint a
 * new template — each gated by the stricter `requirePlatformAdmin` in the service.
 * Add-on and insurance catalogs are distinct paths (`/add-ons`, `/insurance`) over
 * structurally identical rows.
 */
export function createAdminTemplateRoutes(service: TemplateLibraryService) {
  const app = new Hono()
  app.use('/admin/templates', requireAuth())
  app.use('/admin/templates/*', requireAuth())

  return app
    .get('/admin/templates', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformRead(ctx)
      return ok(c, await service.listAll(ctx))
    })
    .post('/admin/templates/add-ons', async (c) => {
      const input = await parseCreate(c)
      if (!input.ok) return input.response
      return ok(c, await service.createAddOn(input.ctx, input.data), 201)
    })
    .post('/admin/templates/insurance', async (c) => {
      const input = await parseCreate(c)
      if (!input.ok) return input.response
      return ok(c, await service.createInsurance(input.ctx, input.data), 201)
    })
    .patch('/admin/templates/add-ons/:id', async (c) => {
      const input = await parsePatch(c)
      if (!input.ok) return input.response
      return ok(c, await service.updateAddOn(input.ctx, input.id, input.patch))
    })
    .patch('/admin/templates/insurance/:id', async (c) => {
      const input = await parsePatch(c)
      if (!input.ok) return input.response
      return ok(c, await service.updateInsurance(input.ctx, input.id, input.patch))
    })
}

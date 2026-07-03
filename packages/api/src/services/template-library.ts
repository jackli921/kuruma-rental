import type {
  TemplateAdminRow,
  TemplateLibraryResponse,
  TemplatePatch,
} from '@kuruma/shared/types/template-admin'
import {
  type CallerContext,
  NotFoundError,
  requirePlatformAdmin,
  requirePlatformRead,
} from '../middleware/auth'
import type { AddOnTemplateRepository, InsuranceTemplateRepository } from '../repositories/types'
import type { AddOnTemplate, InsuranceTemplate } from '../stores'

/**
 * Project a persisted template onto the admin wire row (@kuruma/shared): the
 * multi-locale `name` / `description` bundles reach the admin RAW (it curates
 * them), unlike the operator picker which resolves one label. Timestamps are
 * dropped — the library list has no use for them. Add-on and insurance rows are
 * structurally identical, so one projector serves both.
 */
function toRow(t: AddOnTemplate | InsuranceTemplate): TemplateAdminRow {
  return { id: t.id, key: t.key, name: t.name, description: t.description, status: t.status }
}

/**
 * Platform-admin template library (#1319). Cross-tenant by nature (the catalogs
 * are platform-global), so the read is gated by `requirePlatformRead` here in the
 * service — defence in depth behind the route's structural `/admin/*` guard — and
 * OPERATOR_* / RENTER / PARTNER are rejected. Returns EVERY status so the admin can
 * see and promote the ARCHIVED, en-only rows the slice-2/3 backfills mint.
 */
export class TemplateLibraryService {
  constructor(
    private readonly addOnTemplateRepo: AddOnTemplateRepository,
    private readonly insuranceTemplateRepo: InsuranceTemplateRepository,
  ) {}

  async listAll(ctx: CallerContext): Promise<TemplateLibraryResponse> {
    requirePlatformRead(ctx)
    const [addOns, insurance] = await Promise.all([
      this.addOnTemplateRepo.findAll(),
      this.insuranceTemplateRepo.findAll(),
    ])
    return { addOns: addOns.map(toRow), insurance: insurance.map(toRow) }
  }

  /**
   * Curate one add-on template — translate/edit its bundles and/or promote an
   * ARCHIVED backfill-minted row to ACTIVE (#1319 slice 2). A WRITE, so gated by
   * the stricter `requirePlatformAdmin` (read-floor `requirePlatformRead` admits
   * the whole platform tier; a write must not). The 403 is asserted BEFORE the
   * lookup so a missing id never leaks existence to a non-admin. Returns the raw
   * admin row; throws `NotFoundError` (-> 404) when no row matches.
   */
  async updateAddOn(
    ctx: CallerContext,
    id: string,
    patch: TemplatePatch,
  ): Promise<TemplateAdminRow> {
    requirePlatformAdmin(ctx)
    const updated = await this.addOnTemplateRepo.update(id, patch)
    if (!updated) throw new NotFoundError('add-on template not found')
    return toRow(updated)
  }

  /** Curate one insurance template — same contract as {@link updateAddOn} over
   *  the insurance catalog. */
  async updateInsurance(
    ctx: CallerContext,
    id: string,
    patch: TemplatePatch,
  ): Promise<TemplateAdminRow> {
    requirePlatformAdmin(ctx)
    const updated = await this.insuranceTemplateRepo.update(id, patch)
    if (!updated) throw new NotFoundError('insurance template not found')
    return toRow(updated)
  }
}
